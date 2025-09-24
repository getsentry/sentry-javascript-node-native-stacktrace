import { AsyncLocalStorage } from 'node:async_hooks';
import { Worker } from 'node:worker_threads';
import { registerThread } from '@sentry-internal/node-native-stacktrace';
import { longWork } from './long-work.js';

const asyncLocalStorage = new AsyncLocalStorage();
const storageKey = Symbol.for('sentry_scopes');

registerThread({ asyncLocalStorage, storageKey });

function withTraceId(traceId, fn) {
  return asyncLocalStorage.run({
    [storageKey]: { traceId },
  }, fn);
}

const watchdog = new Worker('./test/watchdog.js');

for (let i = 0; i < 10; i++) {
  withTraceId(`trace-${i}`, () => {
    if (i === 5) {
      longWork();
    }
  });
}
