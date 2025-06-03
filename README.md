# `@sentry-internal/node-native-stacktrace`

Native Node module to capture stack traces from all registered threads.

This allows capturing main and worker thread stack traces from another watchdog
thread, even if the event loops are blocked.

In the main or worker threads:

```ts
const { registerThread } = require("@sentry-internal/node-native-stacktrace");

registerThread();
```

Watchdog thread:

```ts
const { captureStackTrace } = require(
  "@sentry-internal/node-native-stacktrace",
);

const stacks = captureStackTrace();
console.log(stacks);
```

Results in:

```js
{
   '0': '    at from (node:buffer:299:28)\n' +
    '    at pbkdf2Sync (node:internal/crypto/pbkdf2:78:17)\n' +
    '    at longWork (/Users/tim/test/test/long-work.js:6:25)\n' +
    '    at ? (/Users/tim/test/test/stack-traces.js:11:1)\n' +
    '    at ? (node:internal/modules/cjs/loader:1734:14)\n' +
    '    at ? (node:internal/modules/cjs/loader:1899:10)\n' +
    '    at ? (node:internal/modules/cjs/loader:1469:32)\n' +
    '    at ? (node:internal/modules/cjs/loader:1286:12)\n' +
    '    at traceSync (node:diagnostics_channel:322:14)\n' +
    '    at wrapModuleLoad (node:internal/modules/cjs/loader:235:24)\n' +
    '    at executeUserEntryPoint (node:internal/modules/run_main:152:5)\n' +
    '    at ? (node:internal/main/run_main_module:33:47)',
  '2': '    at from (node:buffer:299:28)\n' +
    '    at pbkdf2Sync (node:internal/crypto/pbkdf2:78:17)\n' +
    '    at longWork (/Users/tim/test/test/long-work.js:6:25)\n' +
    '    at ? (/Users/tim/test/test/worker.js:6:1)\n' +
    '    at ? (node:internal/modules/cjs/loader:1734:14)\n' +
    '    at ? (node:internal/modules/cjs/loader:1899:10)\n' +
    '    at ? (node:internal/modules/cjs/loader:1469:32)\n' +
    '    at ? (node:internal/modules/cjs/loader:1286:12)\n' +
    '    at traceSync (node:diagnostics_channel:322:14)\n' +
    '    at wrapModuleLoad (node:internal/modules/cjs/loader:235:24)\n' +
    '    at executeUserEntryPoint (node:internal/modules/run_main:152:5)\n' +
    '    at ? (node:internal/main/worker_thread:212:26)\n' +
    '    at [nodejs.internal.kHybridDispatch] (node:internal/event_target:827:20)\n' +
    '    at ? (node:internal/per_context/messageport:23:28)'
}
```

## Detecting blocked event loops

In the main or worker threads if you call `registerThread()` regularly, times
are recorded.

```ts
const { registerThread } = require("@sentry-internal/node-native-stacktrace");

setInterval(() => {
  registerThread();
}, 200);
```

In the watchdog thread you can call `getThreadsLastSeen()` to get how long it's
been in milliseconds since each thread registered.

If any thread has exceeded a threshold, you can call `captureStackTrace()` to
get the stack traces for all threads.

```ts
const {
  captureStackTrace,
  getThreadsLastSeen,
} = require("@sentry-internal/node-native-stacktrace");

const THRESHOLD = 1000; // 1 second

setInterval(() => {
  for (const [thread, time] in Object.entries(getThreadsLastSeen())) {
    if (time > THRESHOLD) {
      const stacks = captureStackTrace();
      const blockedThread = stacks[thread];
      console.log(
        `Thread '${thread}' blocked more than ${THRESHOLD}ms`,
        blockedThread,
      );
    }
  }
}, 1000);
```
