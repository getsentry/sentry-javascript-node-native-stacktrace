#include <chrono>
#include <future>
#include <mutex>
#include <node.h>
#include <node_version.h>
#include <optional>
#include <vector>

// Platform-specific includes for time functions
#ifdef _WIN32
#include <windows.h>
#elif defined(__APPLE__)
#include <time.h>
#elif defined(__linux__)
#include <time.h>
#endif

#ifndef NODE_MAJOR_VERSION
#error "NODE_MAJOR_VERSION is not defined"
#endif

#define SUPPORTS_ASYNC_CONTEXT_FRAME NODE_MAJOR_VERSION >= 22
#define GET_CONTINUATION_PRESERVED_EMBEDDER_DATA_V2 V8_MAJOR_VERSION >= 14
// String::WriteV2 and Object::SetPrototypeV2 replace String::Write and
// Object::SetPrototype, which newer V8 versions no longer provide
#define USE_V8_API_V2                                                          \
  (V8_MAJOR_VERSION > 13 || (V8_MAJOR_VERSION == 13 && V8_MINOR_VERSION >= 6))

using namespace v8;
using namespace node;
using namespace std::chrono;

static const int kMaxStackFrames = 50;

// Limits for serializing thread state (AsyncLocalStorage state and threadPoll
// state). The AsyncLocalStorage state is serialized on the captured thread
// while its JavaScript is interrupted, so the work must stay bounded whatever
// the shape of the object graph.
//
// Maximum nesting depth of objects/arrays. The root value is at depth 0, and
// objects/arrays at this depth are replaced by "[Object]"/"[Array]". Sentry
// keeps breadcrumb data at isolationScope._breadcrumbs[i].data (depth 4), so
// five levels below `data` are kept (Sentry normalizes events to depth 3).
static const size_t kMaxStateDepth = 10;
// Maximum number of properties/elements copied per object/array. The rest is
// replaced by a single "[MaxProperties ~]" entry.
static const uint32_t kMaxStateBreadth = 1000;
// Maximum number of properties/elements read per serialization, including
// reads that throw. Shared references are copied once per path, which can grow
// exponentially without this budget. Once it is used up, nothing more is read:
// the objects/arrays being copied end with a "[MaxProperties ~]" entry.
static const uint32_t kMaxStateNodes = 20000;
// Maximum total length (UTF-16 code units) of the strings copied per
// serialization, counting string values and property keys. Without it, one
// large string referenced many times is copied every time. A string value that
// does not fit is cut to the rest of the budget plus "...", later string values
// become "[String]", and an object whose next key does not fit ends with a
// "...": "[MaxProperties ~]" entry.
static const uint32_t kMaxStateStringLength = 1024 * 1024;

struct AsyncLocalStorageLookup {
  // Async local storage instance associated with this thread
  v8::Global<v8::Value> async_local_storage;
  // Optional ordered array of keys (string | symbol) to traverse nested
  // Map/Object structures to fetch the final state object
  std::optional<std::vector<v8::Global<v8::Value>>> storage_keys;
};

// Structure to hold information for each thread/isolate
struct ThreadInfo {
  // Mutex protecting this thread's mutable data (poll_state, last_seen)
  // Does NOT protect async_store (immutable after creation)
  mutable std::mutex mutex;
  // Thread name (immutable after creation)
  std::string thread_name;
  // Last time this thread was seen in milliseconds since epoch
  milliseconds last_seen; // Protected by mutex
  // Optional async local storage associated with this thread
  // Using shared_ptr to safely share with async tasks even if ThreadInfo is
  // erased
  std::shared_ptr<std::optional<AsyncLocalStorageLookup>> async_store;
  // Some JSON serialized state sent via threadPoll
  std::string poll_state; // Protected by mutex

  // Constructor needed because std::mutex is not movable/copyable
  ThreadInfo(std::string name, milliseconds seen,
             std::shared_ptr<std::optional<AsyncLocalStorageLookup>> store,
             std::string state)
      : thread_name(std::move(name)), last_seen(seen),
        async_store(std::move(store)), poll_state(std::move(state)) {}
};

// Separate mutexes for different concerns:
// - threads_map_mutex: protects the threads map structure
// (insert/erase/iteration)
// - ThreadInfo::mutex: protects each thread's mutable data
static std::mutex threads_map_mutex;
// Map to hold all registered threads and their information
static std::unordered_map<v8::Isolate *, ThreadInfo> threads = {};

// Structure to hold stack frame information
struct JsStackFrame {
  std::string function_name;
  std::string filename;
  int lineno;
  int colno;
};

// Type alias for a vector of JsStackFrame
using JsStackFrames = std::vector<JsStackFrame>;

struct JsStackTrace {
  // The frames in the stack trace
  JsStackFrames frames;
  // JSON serialized string of the async state
  std::string async_state;
};

struct ThreadResult {
  std::string thread_name;
  JsStackTrace stack_trace;
  // JSON serialized string of the poll state
  std::string poll_state;
};

// Traversal state of one SanitizeForJSON walk
struct SanitizeState {
  explicit SanitizeState(v8::TryCatch &try_catch) : try_catch(try_catch) {}

  // Catches exceptions thrown by getters during the walk
  v8::TryCatch &try_catch;
  // Objects/arrays on the current path, used for cycle detection. Its size is
  // the current depth, so it never exceeds kMaxStateDepth.
  std::vector<v8::Local<v8::Object>> ancestors;
  // Properties/elements that may still be read, see kMaxStateNodes
  uint32_t remaining_nodes = kMaxStateNodes;
  // String length that may still be copied, see kMaxStateStringLength
  uint32_t remaining_string_length = kMaxStateStringLength;
  // Set when execution is terminating; the walk must not call into V8 anymore
  bool terminating = false;
};

// Creates one of the marker strings that replace cut-off data
template <int N>
static v8::Local<v8::String> Marker(v8::Isolate *isolate,
                                    const char (&text)[N]) {
  return v8::String::NewFromUtf8Literal(isolate, text,
                                        v8::NewStringType::kInternalized);
}

// Handles a failed V8 call during the walk: clears the exception so the walk
// can continue without the value. If execution is terminating, the exception
// is kept and the walk stops (see KeepTermination).
static void RecoverFromException(SanitizeState &state) {
  if (!state.try_catch.CanContinue()) {
    state.terminating = true;
    return;
  }
  state.try_catch.Reset();
}

// Takes one read from the budget before a property/element is read. Returns
// false once the budget is used up.
static bool TakeNode(SanitizeState &state) {
  if (state.remaining_nodes == 0) {
    return false;
  }
  state.remaining_nodes--;
  return true;
}

// An execution termination (e.g. from worker.terminate()) caught by a TryCatch
// does not survive it: the thread would keep running. This cancels the caught
// termination and requests it again, so it takes effect as soon as JavaScript
// runs again on this thread. Ordinary exceptions stay caught. Call this last
// in the TryCatch's scope.
static void KeepTermination(v8::Isolate *isolate, v8::TryCatch &try_catch) {
  if (!try_catch.HasTerminated() && !isolate->IsExecutionTerminating()) {
    return;
  }
  isolate->CancelTerminateExecution();
  try_catch.Reset();
  isolate->TerminateExecution();
}

// Returns the string if it fits into the remaining string budget. Otherwise
// returns the part that still fits followed by "...", or "[String]" once the
// budget is used up. Only the part that is kept is copied (V8 may flatten a
// concatenated string first).
static v8::Local<v8::String> SanitizeString(v8::Isolate *isolate,
                                            v8::Local<v8::String> str,
                                            SanitizeState &state) {
  auto length = static_cast<uint32_t>(str->Length());
  if (length <= state.remaining_string_length) {
    state.remaining_string_length -= length;
    return str;
  }

  auto prefix_length = state.remaining_string_length;
  state.remaining_string_length = 0;
  if (prefix_length == 0) {
    return Marker(isolate, "[String]");
  }

  std::vector<uint16_t> buffer(prefix_length);
#if USE_V8_API_V2
  str->WriteV2(isolate, 0, prefix_length, buffer.data());
#else
  str->Write(isolate, buffer.data(), 0, static_cast<int>(prefix_length),
             v8::String::NO_NULL_TERMINATION);
#endif
  // Do not split a surrogate pair
  auto last = buffer[prefix_length - 1];
  if (last >= 0xD800 && last <= 0xDBFF) {
    prefix_length--;
  }

  v8::Local<v8::String> prefix;
  if (!v8::String::NewFromTwoByte(isolate, buffer.data(),
                                  v8::NewStringType::kNormal,
                                  static_cast<int>(prefix_length))
           .ToLocal(&prefix)) {
    return Marker(isolate, "[String]");
  }
  return v8::String::Concat(isolate, prefix, Marker(isolate, "..."));
}

// Recursively sanitize a value to be safely JSON-stringifiable by:
// - Removing properties whose values are BigInt, Function, or Symbol
//   (dropped for objects, omitted from arrays)
// - Breaking cycles by omitting repeated objects (undefined -> dropped/omitted)
// - Dropping values that throw when read
// - Preserving primitives and traversing arrays/objects (own enumerable
//   string-keyed properties only)
// - Replacing Proxies by "[Proxy]" without running their traps
// - Bounding the work: objects/arrays nested kMaxStateDepth deep, or reached
//   once kMaxStateNodes reads are used up, are replaced by
//   "[Object]"/"[Array]", and objects/arrays cut by kMaxStateBreadth,
//   kMaxStateNodes or kMaxStateStringLength end with a "[MaxProperties ~]"
//   entry
// The copies have no prototype, so JSON::Stringify finds no inherited toJSON
// on them, and are built with CreateDataProperty, which runs no setters.
// Returns undefined if the walk stopped because execution is terminating.
static v8::Local<v8::Value> SanitizeForJSON(v8::Isolate *isolate,
                                            v8::Local<v8::Context> context,
                                            v8::Local<v8::Value> value,
                                            SanitizeState &state) {
  if (value->IsString()) {
    return SanitizeString(isolate, value.As<v8::String>(), state);
  }

  // Fast-path for primitives that are always JSON-compatible
  if (value->IsNull() || value->IsBoolean() || value->IsNumber()) {
    return value;
  }

  // Values that JSON.stringify cannot handle directly
  if (value->IsBigInt() || value->IsSymbol() || value->IsFunction() ||
      value->IsUndefined()) {
    // Returning undefined here lets callers decide to drop (object) or null
    // (array)
    return v8::Undefined(isolate);
  }

  // Fallback: return as-is (shouldn't hit here for other exotic types)
  if (!value->IsObject()) {
    return value;
  }

  // Reading a Proxy's keys or values would run its traps
  if (value->IsProxy()) {
    return Marker(isolate, "[Proxy]");
  }

  // Arrays and objects (including Dates, RegExps, Maps as objects; we only
  // traverse enumerable own props)
  auto obj = value.As<v8::Object>();
  // Cycle detection
  for (auto &a : state.ancestors) {
    if (a->StrictEquals(obj)) {
      return v8::Undefined(isolate);
    }
  }

  auto is_array = value->IsArray();
  if (state.ancestors.size() >= kMaxStateDepth || state.remaining_nodes == 0) {
    return is_array ? Marker(isolate, "[Array]") : Marker(isolate, "[Object]");
  }

  v8::Local<v8::Value> result = v8::Undefined(isolate);
  state.ancestors.push_back(obj);

  if (is_array) {
    auto arr = value.As<v8::Array>();
    auto length = arr->Length();
    auto out = v8::Array::New(isolate, 0);
#if USE_V8_API_V2
    out->SetPrototypeV2(context, v8::Null(isolate)).FromMaybe(false);
#else
    out->SetPrototype(context, v8::Null(isolate)).FromMaybe(false);
#endif

    uint32_t out_index = 0;
    uint32_t i = 0;
    for (; i < length && i < kMaxStateBreadth && !state.terminating; ++i) {
      if (!TakeNode(state)) {
        break;
      }

      v8::Local<v8::Value> el;
      if (!arr->Get(context, i).ToLocal(&el)) {
        RecoverFromException(state);
        continue; // omit entries that cannot be read
      }

      auto sanitized = SanitizeForJSON(isolate, context, el, state);
      if (!sanitized->IsUndefined()) {
        out->CreateDataProperty(context, out_index++, sanitized)
            .FromMaybe(false); // omit undefined entries entirely
      }
    }

    if (i < length && !state.terminating) {
      out->CreateDataProperty(context, out_index,
                              Marker(isolate, "[MaxProperties ~]"))
          .FromMaybe(false);
    }
    result = out;
  } else {
    // Collect own enumerable property names (string-keyed). Integer-indexed
    // keys are skipped, as they were never serialized.
    v8::Local<v8::Array> props;
    if (obj->GetPropertyNames(context, v8::KeyCollectionMode::kOwnOnly,
                              static_cast<v8::PropertyFilter>(
                                  v8::ONLY_ENUMERABLE | v8::SKIP_SYMBOLS),
                              v8::IndexFilter::kSkipIndices)
            .ToLocal(&props)) {
      auto out =
          v8::Object::New(isolate, v8::Null(isolate), nullptr, nullptr, 0);
      auto len = props->Length();
      if (len > kMaxStateBreadth) {
        // Collecting the keys costs O(len), so the keys that are not visited
        // are charged to the budget as well
        auto skipped = len - kMaxStateBreadth;
        state.remaining_nodes -=
            skipped < state.remaining_nodes ? skipped : state.remaining_nodes;
      }

      for (uint32_t i = 0; i < len && !state.terminating; ++i) {
        v8::Local<v8::Value> key;
        if (!props->Get(context, i).ToLocal(&key)) {
          RecoverFromException(state);
          continue;
        }

        if (!key->IsString()) {
          // Skip symbol and non-string keys to match JSON behavior
          continue;
        }

        auto key_str = key.As<v8::String>();
        auto key_length = static_cast<uint32_t>(key_str->Length());
        auto key_fits = key_length <= state.remaining_string_length;
        state.remaining_string_length =
            key_fits ? state.remaining_string_length - key_length : 0;

        if (!key_fits || i >= kMaxStateBreadth || !TakeNode(state)) {
          // Cut the object here. The marker takes this key, or "..." if the
          // key itself does not fit into the string budget.
          out->CreateDataProperty(context,
                                  key_fits ? key_str : Marker(isolate, "..."),
                                  Marker(isolate, "[MaxProperties ~]"))
              .FromMaybe(false);
          break;
        }

        v8::Local<v8::Value> val;
        if (!obj->Get(context, key_str).ToLocal(&val)) {
          RecoverFromException(state);
          continue; // drop properties that cannot be read
        }

        auto sanitized = SanitizeForJSON(isolate, context, val, state);
        if (!sanitized->IsUndefined()) {
          out->CreateDataProperty(context, key_str, sanitized).FromMaybe(false);
        }
        // else: undefined -> drop property
      }
      result = out;
    } else {
      RecoverFromException(state); // drop objects whose keys cannot be read
    }
  }

  state.ancestors.pop_back();
  if (state.terminating) {
    return v8::Undefined(isolate);
  }
  return result;
}

std::string JSONStringify(Isolate *isolate, Local<Value> value) {
  auto context = isolate->GetCurrentContext();

  // Exceptions thrown while reading the value (getters) are caught here, so
  // they never reach the JavaScript running on this thread
  v8::TryCatch try_catch(isolate);

  // Sanitize the value first to avoid JSON failures (e.g., BigInt, cycles)
  SanitizeState state(try_catch);
  auto sanitized = SanitizeForJSON(isolate, context, value, state);

  // Undefined: nothing serializable, or execution is terminating
  std::string json;
  v8::Local<v8::String> json_str;
  if (!sanitized->IsUndefined() &&
      v8::JSON::Stringify(context, sanitized).ToLocal(&json_str)) {
    v8::String::Utf8Value utf8(isolate, json_str);
    json = *utf8 ? *utf8 : "";
  }

  KeepTermination(isolate, try_catch);
  return json;
}

// Function to get stack frames from a V8 stack trace
JsStackFrames GetStackFrames(Isolate *isolate) {
  auto stack = StackTrace::CurrentStackTrace(isolate, kMaxStackFrames,
                                             StackTrace::kDetailed);

  JsStackFrames frames;
  if (!stack.IsEmpty()) {
    for (int i = 0; i < stack->GetFrameCount(); i++) {
      auto frame = stack->GetFrame(isolate, i);
      auto fn_name = frame->GetFunctionName();

      std::string function_name;
      if (frame->IsEval()) {
        function_name = "[eval]";
      } else if (fn_name.IsEmpty() || fn_name->Length() == 0) {
        function_name = "?";
      } else if (frame->IsConstructor()) {
        function_name = "[constructor]";
      } else {
        v8::String::Utf8Value utf8_fn(isolate, fn_name);
        function_name = *utf8_fn ? *utf8_fn : "?";
      }

      std::string filename;
      auto script_name = frame->GetScriptName();
      if (!script_name.IsEmpty()) {
        v8::String::Utf8Value utf8_filename(isolate, script_name);
        filename = *utf8_filename ? *utf8_filename : "<unknown>";
      } else {
        filename = "<unknown>";
      }

      int lineno = frame->GetLineNumber();
      int colno = frame->GetColumn();

      frames.push_back(JsStackFrame{function_name, filename, lineno, colno});
    }
  }

  return frames;
}

#if SUPPORTS_ASYNC_CONTEXT_FRAME
// Function to fetch the thread state from the async context store
std::string GetThreadState(Isolate *isolate,
                           const AsyncLocalStorageLookup &store) {

// Node.js stores the async local storage in the isolate's
// "ContinuationPreservedEmbedderData" map, keyed by the
// AsyncLocalStorage instance.
// https://github.com/nodejs/node/blob/c6316f9db9869864cea84e5f07585fa08e3e06d2/src/async_context_frame.cc#L37
#if GET_CONTINUATION_PRESERVED_EMBEDDER_DATA_V2
  auto data = isolate->GetContinuationPreservedEmbedderDataV2().As<Value>();
#else
  auto data = isolate->GetContinuationPreservedEmbedderData();
#endif
  auto async_local_storage_local = store.async_local_storage.Get(isolate);

  if (data.IsEmpty() || !data->IsMap() || async_local_storage_local.IsEmpty()) {
    return "";
  }

  auto map = data.As<v8::Map>();
  auto context = isolate->GetCurrentContext();
  auto maybe_root_store = map->Get(context, async_local_storage_local);

  if (maybe_root_store.IsEmpty()) {
    return "";
  }

  auto root_store = maybe_root_store.ToLocalChecked();

  if (store.storage_keys.has_value()) {
    // Walk the keys to get the desired nested value
    const auto &keys = store.storage_keys.value();
    auto current = root_store;

    for (auto &gkey : keys) {
      auto local_key = gkey.Get(isolate);
      if (!(local_key->IsString() || local_key->IsSymbol())) {
        continue;
      }

      v8::MaybeLocal<v8::Value> maybeValue;
      if (current->IsMap()) {
        auto map_val = current.As<v8::Map>();
        maybeValue = map_val->Get(context, local_key);
      } else if (current->IsObject()) {
        auto obj_val = current.As<v8::Object>();
        maybeValue = obj_val->Get(context, local_key);
      } else {
        return "";
      }

      if (maybeValue.IsEmpty()) {
        return "";
      }

      current = maybeValue.ToLocalChecked();
    }

    root_store = current;
  }

  return JSONStringify(isolate, root_store);
}
#endif

struct InterruptArgs {
  std::promise<JsStackTrace> promise;
  std::shared_ptr<std::optional<AsyncLocalStorageLookup>> store;
};

// Function to be called when an isolate's execution is interrupted
static void ExecutionInterrupted(Isolate *isolate, void *data) {
  auto args = static_cast<InterruptArgs *>(data);
  Locker locker(isolate);
  HandleScope handle_scope(isolate);

  if (isolate->IsExecutionTerminating()) {
    args->promise.set_value({{}, ""});
    delete args;
    return;
  }

  auto frames = GetStackFrames(isolate);
  std::string state = "";

#if SUPPORTS_ASYNC_CONTEXT_FRAME
  if (args->store && args->store->has_value()) {
    // Exceptions while reading the state (e.g. from getters or proxy traps on
    // the stateLookup path) must not reach the interrupted JavaScript; the
    // state is left empty or partial instead. Execution termination is kept.
    TryCatch try_catch(isolate);
    state = GetThreadState(isolate, args->store->value());
    KeepTermination(isolate, try_catch);
  }
#endif

  args->promise.set_value({frames, state});

  delete args;
}

// Function to capture the stack trace of a single isolate
JsStackTrace CaptureStackTrace(
    Isolate *isolate,
    const std::shared_ptr<std::optional<AsyncLocalStorageLookup>> &store) {
  if (isolate->IsExecutionTerminating()) {
    return JsStackTrace{{}, ""};
  }

  std::promise<JsStackTrace> promise;
  auto future = promise.get_future();

  // The v8 isolate must be interrupted to capture the stack trace
  // Note: Even if we timeout below, the interrupt may still fire later.
  // The InterruptArgs holds a shared_ptr to keep data alive until the callback
  // executes.
  isolate->RequestInterrupt(ExecutionInterrupted,
                            new InterruptArgs{std::move(promise), store});

  // Wait with timeout to prevent infinite hang if isolate never processes
  // interrupt (e.g., stuck in native code or terminating)
  if (future.wait_for(std::chrono::seconds(5)) == std::future_status::timeout) {
    // Timeout occurred. The InterruptArgs is intentionally leaked - it will be
    // deleted by ExecutionInterrupted if/when the callback eventually fires.
    // The shared_ptr keeps the store data alive.
    return JsStackTrace{{}, ""};
  }

  return future.get();
}

// Function to capture stack traces from all registered threads
void CaptureStackTraces(const FunctionCallbackInfo<Value> &args) {
  auto capture_from_isolate = args.GetIsolate();

  std::vector<ThreadResult> results;

  std::vector<std::future<ThreadResult>> futures;
  {
    // Only need map lock to safely iterate and copy shared_ptrs
    // No deadlock risk because we release lock before fut.get()
    std::lock_guard<std::mutex> lock(threads_map_mutex);
    for (auto &thread : threads) {
      auto thread_isolate = thread.first;
      auto &thread_info = thread.second;

      if (thread_isolate == capture_from_isolate)
        continue;

      // Copy immutable data and shared_ptrs (no individual thread lock needed)
      // thread_name and async_store are immutable after creation
      auto thread_name = thread_info.thread_name;
      auto async_store_ptr = thread_info.async_store;

      // For poll_state, we need to lock the thread's mutex briefly
      std::string poll_state;
      {
        std::lock_guard<std::mutex> thread_lock(thread_info.mutex);
        poll_state = thread_info.poll_state;
      }

      futures.emplace_back(std::async(
          std::launch::async,
          [thread_isolate, thread_name, poll_state,
           async_store_ptr]() -> ThreadResult {
            return ThreadResult{
                thread_name, CaptureStackTrace(thread_isolate, async_store_ptr),
                poll_state};
          }));
    }
  }

  // Wait for all futures to complete AFTER releasing the lock
  // No deadlock because ThreadPoll uses a different lock (thread's own mutex)
  for (auto &fut : futures) {
    results.emplace_back(fut.get());
  }

  auto current_context = capture_from_isolate->GetCurrentContext();

  Local<Object> output = Object::New(capture_from_isolate);

  for (auto &result : results) {
    auto key =
        String::NewFromUtf8(capture_from_isolate, result.thread_name.c_str(),
                            NewStringType::kNormal)
            .ToLocalChecked();

    Local<Array> jsFrames =
        Array::New(capture_from_isolate, result.stack_trace.frames.size());
    for (size_t i = 0; i < result.stack_trace.frames.size(); ++i) {
      const auto &frame = result.stack_trace.frames[i];
      Local<Object> frameObj = Object::New(capture_from_isolate);
      frameObj
          ->Set(current_context,
                String::NewFromUtf8(capture_from_isolate, "function",
                                    NewStringType::kInternalized)
                    .ToLocalChecked(),
                String::NewFromUtf8(capture_from_isolate,
                                    frame.function_name.c_str(),
                                    NewStringType::kNormal)
                    .ToLocalChecked())
          .Check();
      frameObj
          ->Set(current_context,
                String::NewFromUtf8(capture_from_isolate, "filename",
                                    NewStringType::kInternalized)
                    .ToLocalChecked(),
                String::NewFromUtf8(capture_from_isolate,
                                    frame.filename.c_str(),
                                    NewStringType::kNormal)
                    .ToLocalChecked())
          .Check();
      frameObj
          ->Set(current_context,
                String::NewFromUtf8(capture_from_isolate, "lineno",
                                    NewStringType::kInternalized)
                    .ToLocalChecked(),
                Integer::New(capture_from_isolate, frame.lineno))
          .Check();
      frameObj
          ->Set(current_context,
                String::NewFromUtf8(capture_from_isolate, "colno",
                                    NewStringType::kInternalized)
                    .ToLocalChecked(),
                Integer::New(capture_from_isolate, frame.colno))
          .Check();
      jsFrames->Set(current_context, static_cast<uint32_t>(i), frameObj)
          .Check();
    }

    // Create a thread object with a 'frames' property and optional 'state'
    Local<Object> threadObj = Object::New(capture_from_isolate);
    threadObj
        ->Set(current_context,
              String::NewFromUtf8(capture_from_isolate, "frames",
                                  NewStringType::kInternalized)
                  .ToLocalChecked(),
              jsFrames)
        .Check();

    if (!result.poll_state.empty()) {
      v8::MaybeLocal<v8::String> stateStr = v8::String::NewFromUtf8(
          capture_from_isolate, result.poll_state.c_str(),
          NewStringType::kNormal);
      if (!stateStr.IsEmpty()) {
        threadObj
            ->Set(current_context,
                  String::NewFromUtf8(capture_from_isolate, "pollState",
                                      NewStringType::kInternalized)
                      .ToLocalChecked(),
                  stateStr.ToLocalChecked())
            .Check();
      }
    }

    if (!result.stack_trace.async_state.empty()) {
      v8::MaybeLocal<v8::String> stateStr = v8::String::NewFromUtf8(
          capture_from_isolate, result.stack_trace.async_state.c_str(),
          NewStringType::kNormal);
      if (!stateStr.IsEmpty()) {
        threadObj
            ->Set(current_context,
                  String::NewFromUtf8(capture_from_isolate, "asyncState",
                                      NewStringType::kInternalized)
                      .ToLocalChecked(),
                  stateStr.ToLocalChecked())
            .Check();
      }
    }

    output->Set(current_context, key, threadObj).Check();
  }

  args.GetReturnValue().Set(output);
}

// Cleanup function to remove the thread from the map when the isolate is
// destroyed
void Cleanup(void *arg) {
  auto isolate = static_cast<Isolate *>(arg);
  std::lock_guard<std::mutex> lock(threads_map_mutex);
  threads.erase(isolate);
}

void RegisterThreadInternal(
    Isolate *isolate, const std::string &thread_name,
    std::optional<AsyncLocalStorageLookup> async_store) {

  std::lock_guard<std::mutex> lock(threads_map_mutex);
  // try_emplace constructs the ThreadInfo in-place if the key doesn't exist
  // The mutex will be default-constructed automatically by ThreadInfo
  // constructor
  auto [iter, inserted] = threads.try_emplace(
      isolate, thread_name, milliseconds::zero(),
      std::make_shared<std::optional<AsyncLocalStorageLookup>>(
          std::move(async_store)),
      "");

  if (inserted) {
    // Register a cleanup hook to remove this thread when the isolate is
    // destroyed
    node::AddEnvironmentCleanupHook(isolate, Cleanup, isolate);
  }
}

// Function to register a thread and update its last seen time
void RegisterThread(const FunctionCallbackInfo<Value> &args) {
  auto isolate = args.GetIsolate();
  auto context = isolate->GetCurrentContext();

  if (args.Length() == 1 && args[0]->IsString()) {
    v8::String::Utf8Value utf8(isolate, args[0]);
    std::string thread_name(*utf8 ? *utf8 : "");

    RegisterThreadInternal(isolate, thread_name, std::nullopt);
  } else if (args.Length() == 2 && args[0]->IsObject() && args[1]->IsString()) {
    v8::String::Utf8Value utf8(isolate, args[1]);
    std::string thread_name(*utf8 ? *utf8 : "");

    auto obj = args[0].As<Object>();
    auto async_local_storage_val =
        obj->Get(context, String::NewFromUtf8(isolate, "asyncLocalStorage",
                                              NewStringType::kInternalized)
                              .ToLocalChecked());

    if (async_local_storage_val.IsEmpty() ||
        !async_local_storage_val.ToLocalChecked()->IsObject()) {
      isolate->ThrowException(Exception::Error(
          String::NewFromUtf8(isolate,
                              "The first argument must be an object with an "
                              "asyncLocalStorage property",
                              NewStringType::kInternalized)
              .ToLocalChecked()));
      return;
    }

    std::optional<std::vector<v8::Global<v8::Value>>> storage_keys =
        std::nullopt;

    auto storage_key_val =
        obj->Get(context, String::NewFromUtf8(isolate, "stateLookup",
                                              NewStringType::kInternalized)
                              .ToLocalChecked());

    if (!storage_key_val.IsEmpty()) {

      auto local_val = storage_key_val.ToLocalChecked();
      if (!local_val->IsUndefined() && !local_val->IsNull()) {
        if (local_val->IsArray()) {

          auto arr = local_val.As<v8::Array>();
          std::vector<v8::Global<v8::Value>> keys_vec;
          uint32_t length = arr->Length();
          for (uint32_t i = 0; i < length; ++i) {
            auto maybeEl = arr->Get(context, i);
            if (maybeEl.IsEmpty())
              continue;
            auto el = maybeEl.ToLocalChecked();
            if (el->IsString() || el->IsSymbol()) {

              keys_vec.emplace_back(isolate, el);
            }
          }
          if (!keys_vec.empty()) {
            storage_keys = std::move(keys_vec);
          }
        }
      }
    }

    auto store = AsyncLocalStorageLookup{
        v8::Global<v8::Value>(isolate,
                              async_local_storage_val.ToLocalChecked()),
        std::move(storage_keys)};

    RegisterThreadInternal(isolate, thread_name, std::move(store));
  } else {
    isolate->ThrowException(Exception::Error(
        String::NewFromUtf8(
            isolate,
            "Incorrect arguments. Expected: \n"
            "- registerThread(threadName: string) or \n"
            "- registerThread(storage: {asyncLocalStorage: AsyncLocalStorage; "
            "stateLookup?: Array<string | symbol>}, "
            "threadName: string)",
            NewStringType::kInternalized)
            .ToLocalChecked()));
  }
}

// Cross-platform monotonic time function. Provides a monotonic clock that only
// increases and does not tick when the system is suspended.
steady_clock::time_point GetUnbiasedMonotonicTime() {
#ifdef _WIN32
  // Windows: QueryUnbiasedInterruptTimePrecise returns time in 100-nanosecond
  // units
  ULONGLONG interrupt_time;
  QueryUnbiasedInterruptTimePrecise(&interrupt_time);
  // Convert from 100-nanosecond units to nanoseconds
  uint64_t time_ns = interrupt_time * 100;
  return steady_clock::time_point(nanoseconds(time_ns));
#elif defined(__APPLE__)
  uint64_t time_ns = clock_gettime_nsec_np(CLOCK_UPTIME_RAW);
  return steady_clock::time_point(nanoseconds(time_ns));
#elif defined(__linux__)
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return steady_clock::time_point(seconds(ts.tv_sec) + nanoseconds(ts.tv_nsec));
#else
  // Fallback for other platforms using steady_clock. Note: this will be
  // monotonic but is not guaranteed to ignore time spent while suspended.
  return steady_clock::now();
#endif
}

// Function to track a thread and set its state
void ThreadPoll(const FunctionCallbackInfo<Value> &args) {
  auto isolate = args.GetIsolate();

  bool enable_last_seen = true;
  if (args.Length() > 0 && args[0]->IsBoolean()) {
    enable_last_seen = args[0]->BooleanValue(isolate);
  }

  std::string poll_state = "";
  if (args.Length() > 1 && args[1]->IsObject()) {
    auto obj = args[1].As<Object>();
    poll_state = JSONStringify(isolate, obj);
  }

  // First, find the thread without holding any lock (map reads are safe)
  // Then lock only that specific thread's mutex (not the global map mutex)
  ThreadInfo *thread_info_ptr = nullptr;
  {
    std::lock_guard<std::mutex> map_lock(threads_map_mutex);
    auto found = threads.find(isolate);
    if (found != threads.end()) {
      thread_info_ptr = &found->second;
    }
  }

  // Update thread-specific data with only the thread's mutex held
  // This prevents deadlock with CaptureStackTraces which holds map mutex
  if (thread_info_ptr != nullptr) {
    std::lock_guard<std::mutex> thread_lock(thread_info_ptr->mutex);
    thread_info_ptr->poll_state = std::move(poll_state);

    if (enable_last_seen) {
      thread_info_ptr->last_seen = duration_cast<milliseconds>(
          GetUnbiasedMonotonicTime().time_since_epoch());
    } else {
      thread_info_ptr->last_seen = milliseconds::zero();
    }
  }
}

// Function to get the last seen time of all registered threads
void GetThreadsLastSeen(const FunctionCallbackInfo<Value> &args) {
  Isolate *isolate = args.GetIsolate();

  Local<Object> result = Object::New(isolate);
  milliseconds now = duration_cast<milliseconds>(
      GetUnbiasedMonotonicTime().time_since_epoch());
  {
    std::lock_guard<std::mutex> map_lock(threads_map_mutex);
    for (const auto &[thread_isolate, info] : threads) {
      // Lock each thread's mutex briefly to read last_seen
      milliseconds last_seen;
      {
        std::lock_guard<std::mutex> thread_lock(info.mutex);
        last_seen = info.last_seen;
      }

      if (last_seen == milliseconds::zero())
        continue; // Skip threads that have not registered more than once

      int64_t ms_since = (now - last_seen).count();
      result
          ->Set(isolate->GetCurrentContext(),
                String::NewFromUtf8(isolate, info.thread_name.c_str(),
                                    NewStringType::kNormal)
                    .ToLocalChecked(),
                Number::New(isolate, ms_since))
          .Check();
    }
  }
  args.GetReturnValue().Set(result);
}

extern "C" NODE_MODULE_EXPORT void
NODE_MODULE_INITIALIZER(Local<Object> exports, Local<Value> module,
                        Local<Context> context) {
  auto isolate = v8::Isolate::GetCurrent();

  exports
      ->Set(context,
            String::NewFromUtf8(isolate, "captureStackTrace",
                                NewStringType::kInternalized)
                .ToLocalChecked(),
            FunctionTemplate::New(isolate, CaptureStackTraces)
                ->GetFunction(context)
                .ToLocalChecked())
      .Check();

  exports
      ->Set(context,
            String::NewFromUtf8(isolate, "registerThread",
                                NewStringType::kInternalized)
                .ToLocalChecked(),
            FunctionTemplate::New(isolate, RegisterThread)
                ->GetFunction(context)
                .ToLocalChecked())
      .Check();

  exports
      ->Set(context,
            String::NewFromUtf8(isolate, "threadPoll",
                                NewStringType::kInternalized)
                .ToLocalChecked(),
            FunctionTemplate::New(isolate, ThreadPoll)
                ->GetFunction(context)
                .ToLocalChecked())
      .Check();

  exports
      ->Set(context,
            String::NewFromUtf8(isolate, "getThreadsLastSeen",
                                NewStringType::kInternalized)
                .ToLocalChecked(),
            FunctionTemplate::New(isolate, GetThreadsLastSeen)
                ->GetFunction(context)
                .ToLocalChecked())
      .Check();
}
