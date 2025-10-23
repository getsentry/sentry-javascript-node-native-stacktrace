import { AsyncLocalStorage } from 'node:async_hooks';
import { Worker } from 'node:worker_threads';
import { registerThread } from '@sentry-internal/node-native-stacktrace';
import { longWork } from './long-work.js';

const asyncLocalStorage = new AsyncLocalStorage();
const SOME_UNIQUE_SYMBOL = Symbol.for('sentry_scopes');

registerThread({ asyncLocalStorage, stateLookup: ['_currentContext', SOME_UNIQUE_SYMBOL] });

function withTraceId(traceId, fn) {
  // This is a decent approximation of how Otel stores context in the ALS store
  const store = {
    _currentContext: new Map([ [SOME_UNIQUE_SYMBOL, { traceId }] ])
  };
  return asyncLocalStorage.run(store, fn);
}

const watchdog = new Worker('./test/watchdog.js');

for (let i = 0; i < 10; i++) {
  withTraceId(`trace-${i}`, () => {
    if (i === 5) {
      longWork();
    }
  });
}
