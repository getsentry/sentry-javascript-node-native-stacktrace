#include <chrono>
#include <future>
#include <mutex>
#include <node.h>

// Platform-specific includes for time functions
#ifdef _WIN32
#include <windows.h>
#elif defined(__APPLE__)
#include <time.h>
#elif defined(__linux__)
#include <time.h>
#endif

using namespace v8;
using namespace node;
using namespace std::chrono;

static const int kMaxStackFrames = 255;

// Structure to hold information for each thread/isolate
struct ThreadInfo {
  // Thread name
  std::string thread_name;
  // Last time this thread was seen in milliseconds since epoch
  milliseconds last_seen;
  // Some JSON serialized state for the thread
  std::string state;
};

static std::mutex threads_mutex;
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
using JsStackTrace = std::vector<JsStackFrame>;

struct ThreadResult {
  std::string thread_name;
  std::string state;
  JsStackTrace stack_frames;
};

// Function to be called when an isolate's execution is interrupted
static void ExecutionInterrupted(Isolate *isolate, void *data) {
  auto promise = static_cast<std::promise<JsStackTrace> *>(data);
  auto stack = StackTrace::CurrentStackTrace(isolate, kMaxStackFrames,
                                             StackTrace::kDetailed);

  JsStackTrace frames;
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

  promise->set_value(frames);
}

// Function to capture the stack trace of a single isolate
JsStackTrace CaptureStackTrace(Isolate *isolate) {
  std::promise<JsStackTrace> promise;
  auto future = promise.get_future();

  // The v8 isolate must be interrupted to capture the stack trace
  // Execution resumes automatically after ExecutionInterrupted returns
  isolate->RequestInterrupt(ExecutionInterrupted, &promise);
  return future.get();
}

// Function to capture stack traces from all registered threads
void CaptureStackTraces(const FunctionCallbackInfo<Value> &args) {
  auto capture_from_isolate = args.GetIsolate();
  auto current_context = capture_from_isolate->GetCurrentContext();

  std::vector<std::future<ThreadResult>> futures;

  {
    std::lock_guard<std::mutex> lock(threads_mutex);
    for (auto [thread_isolate, thread_info] : threads) {
      if (thread_isolate == capture_from_isolate)
        continue;
      auto thread_name = thread_info.thread_name;
      auto state = thread_info.state;

      futures.emplace_back(std::async(
          std::launch::async,
          [thread_name, state](Isolate *isolate) -> ThreadResult {
            return ThreadResult{thread_name, state, CaptureStackTrace(isolate)};
          },
          thread_isolate));
    }
  }

  Local<Object> output = Object::New(capture_from_isolate);

  for (auto &future : futures) {
    auto result = future.get();
    auto key =
        String::NewFromUtf8(capture_from_isolate, result.thread_name.c_str(),
                            NewStringType::kNormal)
            .ToLocalChecked();

    Local<Array> jsFrames =
        Array::New(capture_from_isolate, result.stack_frames.size());
    for (size_t i = 0; i < result.stack_frames.size(); ++i) {
      const auto &frame = result.stack_frames[i];
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

    if (!result.state.empty()) {
      v8::MaybeLocal<v8::String> stateStr = v8::String::NewFromUtf8(
          capture_from_isolate, result.state.c_str(), NewStringType::kNormal);
      if (!stateStr.IsEmpty()) {
        v8::MaybeLocal<v8::Value> maybeStateVal =
            v8::JSON::Parse(current_context, stateStr.ToLocalChecked());
        v8::Local<v8::Value> stateVal;
        if (maybeStateVal.ToLocal(&stateVal)) {
          threadObj
              ->Set(current_context,
                    String::NewFromUtf8(capture_from_isolate, "state",
                                        NewStringType::kInternalized)
                        .ToLocalChecked(),
                    stateVal)
              .Check();
        }
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
  std::lock_guard<std::mutex> lock(threads_mutex);
  threads.erase(isolate);
}

// Function to register a thread and update it's last seen time
void RegisterThread(const FunctionCallbackInfo<Value> &args) {
  auto isolate = args.GetIsolate();

  if (args.Length() != 1 || !args[0]->IsString()) {
    isolate->ThrowException(Exception::Error(
        String::NewFromUtf8(
            isolate, "registerThread(name) requires a single name argument",
            NewStringType::kInternalized)
            .ToLocalChecked()));

    return;
  }

  v8::String::Utf8Value utf8(isolate, args[0]);
  std::string thread_name(*utf8 ? *utf8 : "");

  {
    std::lock_guard<std::mutex> lock(threads_mutex);
    auto found = threads.find(isolate);
    if (found == threads.end()) {
      threads.emplace(isolate,
                      ThreadInfo{thread_name, milliseconds::zero(), ""});
      // Register a cleanup hook to remove this thread when the isolate is
      // destroyed
      node::AddEnvironmentCleanupHook(isolate, Cleanup, isolate);
    }
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
  // monotonic but is not gaurenteed to ignore time spent while suspended.
  return steady_clock::now();
#endif
}

// Function to track a thread and set its state
void ThreadPoll(const FunctionCallbackInfo<Value> &args) {
  auto isolate = args.GetIsolate();
  auto context = isolate->GetCurrentContext();

  std::string state_str;
  if (args.Length() > 0 && args[0]->IsValue()) {
    MaybeLocal<String> maybe_json = v8::JSON::Stringify(context, args[0]);
    if (!maybe_json.IsEmpty()) {
      v8::String::Utf8Value utf8_state(isolate, maybe_json.ToLocalChecked());
      state_str = *utf8_state ? *utf8_state : "";
    } else {
      state_str = "";
    }
  } else {
    state_str = "";
  }

  bool disable_last_seen = false;
  if (args.Length() > 1 && args[1]->IsBoolean()) {
    disable_last_seen = args[1]->BooleanValue(isolate);
  }

  {
    std::lock_guard<std::mutex> lock(threads_mutex);
    auto found = threads.find(isolate);
    if (found != threads.end()) {
      auto &thread_info = found->second;
      thread_info.state = state_str;
      if (disable_last_seen) {
        thread_info.last_seen = milliseconds::zero();
      } else {
        thread_info.last_seen = duration_cast<milliseconds>(
            GetUnbiasedMonotonicTime().time_since_epoch());
      }
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
    std::lock_guard<std::mutex> lock(threads_mutex);
    for (const auto &[thread_isolate, info] : threads) {
      if (info.last_seen == milliseconds::zero())
        continue; // Skip threads that have not registered more than once

      int64_t ms_since = (now - info.last_seen).count();
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
  auto isolate = context->GetIsolate();

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
