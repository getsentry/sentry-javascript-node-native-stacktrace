# `@sentry-internal/node-native-stacktrace`

A native Node.js module that can capture JavaScript stack traces for registered
main or worker threads from any other thread, even if event loops are blocked.

The module also provides a means to create a watchdog system to track event loop
blocking via periodic heartbeats. When the time from the last heartbeat crosses
a threshold, JavaScript stack traces can be captured. The heartbeats can
optionally include state information which is included with the corresponding
stack trace.

## Basic Usage

### 1. Register threads you want to monitor

In your main thread or worker threads:

```ts
import { registerThread } from "@sentry-internal/node-native-stacktrace";

// Register this thread for monitoring
registerThread();
```

### 2. Capture stack traces from any thread

```ts
import { captureStackTrace } from "@sentry-internal/node-native-stacktrace";

// Capture stack traces from all registered threads
const stacks = captureStackTrace();
console.log(stacks);
```

### Example Output

Stack traces show where each thread is currently executing:

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

## Advanced Usage: Automatic blocked event loop Detection

Set up automatic detection of blocked event loops:

### 1. Set up thread heartbeats

Send regular heartbeats with optional state information:

```ts
import {
  registerThread,
  threadPoll,
} from "@sentry-internal/node-native-stacktrace";

// Register this thread
registerThread();

// Send heartbeats every 200ms with optional state
setInterval(() => {
  threadPoll({
    endpoint: "/api/current-request",
    userId: getCurrentUserId(),
  });
}, 200);
```

### 2. Monitor from a watchdog thread

Monitor all registered threads from a dedicated thread:

```ts
import {
  captureStackTrace,
  getThreadsLastSeen,
} from "@sentry-internal/node-native-stacktrace";

const THRESHOLD = 1000; // 1 second

setInterval(() => {
  const threadsLastSeen = getThreadsLastSeen();

  for (const [threadId, timeSinceLastSeen] of Object.entries(threadsLastSeen)) {
    if (timeSinceLastSeen > THRESHOLD) {
      // Thread appears to be blocked - capture diagnostics
      const stackTraces = captureStackTrace();
      const blockedThread = stackTraces[threadId];

      console.error(`🚨 Thread ${threadId} blocked for ${timeSinceLastSeen}ms`);
      console.error("Stack trace:", blockedThread.frames);
      console.error("Last known state:", blockedThread.state);
    }
  }
}, 500); // Check every 500ms
```

## API Reference

### Functions

#### `registerThread(threadName?: string): void`

Registers the current thread for monitoring. Must be called from each thread you
want to capture stack traces from.

- `threadName` (optional): Name for the thread. Defaults to the current thread
  ID.

#### `captureStackTrace<State>(): Record<string, Thread<State>>`

Captures stack traces from all registered threads. Can be called from any thread
but will not capture the stack trace of the calling thread itself.

```ts
type Thread<S> = {
  frames: StackFrame[];
  state?: S;
};

type StackFrame = {
  function: string;
  filename: string;
  lineno: number;
  colno: number;
};
```

#### `threadPoll<State>(state?: State): void`

Sends a heartbeat from the current thread with optional state information. The
state object will be serialized and included as a JavaScript object with the
corresponding stack trace.

#### `getThreadsLastSeen(): Record<string, number>`

Returns the time in milliseconds since each registered thread called
`threadPoll()`.
