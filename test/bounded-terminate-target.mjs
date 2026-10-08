// Worker for bounded-terminate.mjs: blocks inside an AsyncLocalStorage store
// whose getter keeps running until the worker is terminated. The blocked loop
// does not end when the capture is done, so only a termination that survives
// the capture stops this worker early.
import { AsyncLocalStorage } from 'node:async_hooks';
import { workerData } from 'node:worker_threads';
import { registerThread } from '@sentry/node-native-stacktrace';

// The getter and the blocked loop give up after this long; termination must
// stop them much earlier
const GETTER_MAX_MS = 6000;
const BLOCK_MAX_MS = 8000;

const { flags, sync } = workerData;

const asyncLocalStorage = new AsyncLocalStorage();
registerThread({ asyncLocalStorage }, 'target');

const store = { before: 1 };
Object.defineProperty(store, 'slow', {
  enumerable: true,
  get() {
    Atomics.store(sync, 0, 1); // getter started
    Atomics.notify(sync, 0);
    const deadline = Date.now() + GETTER_MAX_MS;
    while (Date.now() < deadline) {
      // busy, like a slow application getter
    }
    Atomics.store(sync, 1, 1); // getter ran to its deadline
    return 'slow';
  },
});

function blockedUntilTerminated() {
  Atomics.store(flags, 0, 1); // starts the capture in bounded-watchdog.mjs
  Atomics.notify(flags, 0);
  const deadline = Date.now() + BLOCK_MAX_MS;
  while (Date.now() < deadline) {
    // busy
  }
}

asyncLocalStorage.run(store, () => {
  blockedUntilTerminated();
  Atomics.store(sync, 2, 1); // the blocked loop returned
});
