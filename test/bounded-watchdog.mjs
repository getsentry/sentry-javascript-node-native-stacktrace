// Watchdog worker for bounded-harness.mjs: waits until the main thread is
// blocked inside its AsyncLocalStorage store, captures it and releases it.
import { performance } from 'node:perf_hooks';
import { parentPort, workerData } from 'node:worker_threads';
import { captureStackTrace } from '@sentry/node-native-stacktrace';

const { flags } = workerData;

function jsonLength(value) {
  return value === undefined ? 0 : JSON.stringify(value).length;
}

Atomics.wait(flags, 0, 0, 15000);

let result;
try {
  const start = performance.now();
  const trace = captureStackTrace();
  const captureMs = performance.now() - start;
  // The main thread registers without a name, so it is keyed by its threadId
  const main = trace['0'];
  result = {
    captureMs,
    stateJsonLength: jsonLength(main?.asyncState),
    pollStateJsonLength: jsonLength(main?.pollState),
    trace,
  };
} catch (e) {
  result = { captureError: `${e?.name}: ${e?.message}` };
} finally {
  Atomics.store(flags, 1, 1);
}

parentPort.postMessage(result);
