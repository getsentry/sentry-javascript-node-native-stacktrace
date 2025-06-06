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
const {
  captureStackTrace,
} = require("@sentry-internal/node-native-stacktrace");

const stacks = captureStackTrace();
console.log(stacks);
```

Results in:

```js
{
  '0': [
    {
      function: 'from',
      filename: 'node:buffer',
      lineno: 298,
      colno: 28
    },
    {
      function: 'pbkdf2Sync',
      filename: 'node:internal/crypto/pbkdf2',
      lineno: 78,
      colno: 17
    },
    {
      function: 'longWork',
      filename: '/app/test.js',
      lineno: 20,
      colno: 29
    },
    {
      function: '?',
      filename: '/app/test.js',
      lineno: 24,
      colno: 1
    }
  ],
  '2': [
    {
      function: 'from',
      filename: 'node:buffer',
      lineno: 298,
      colno: 28
    },
    {
      function: 'pbkdf2Sync',
      filename: 'node:internal/crypto/pbkdf2',
      lineno: 78,
      colno: 17
    },
    {
      function: 'longWork',
      filename: '/app/worker.js',
      lineno: 10,
      colno: 29
    },
    {
      function: '?',
      filename: '/app/worker.js',
      lineno: 14,
      colno: 1
    }
  ]
}
```

## Detecting blocked event loops

In the main or worker threads if you call `registerThread()` regularly, times
are recorded.

```ts
const {
  registerThread,
  threadPoll,
} = require("@sentry-internal/node-native-stacktrace");

registerThread();

setInterval(() => {
  threadPoll({ optional_state: "some_value" });
}, 200);
```

In the watchdog thread you can call `getThreadsLastSeen()` to get how long it's
been in milliseconds since each thread polled.

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
      const threads = captureStackTrace();
      const blockedThread = threads[thread];
      const { frames, state } = blockedThread;
      console.log(
        `Thread '${thread}' blocked more than ${THRESHOLD}ms`,
        frames,
        state,
      );
    }
  }
}, 1000);
```
