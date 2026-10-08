// worker.terminate() while the worker's state is serialized: a state getter
// is running inside the capture interrupt when terminate() is called. The
// serialization must not swallow the termination, so the FIRST terminate()
// call stops the worker promptly and the capture returns.
import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { printResult, startWatchdog } from './bounded-harness.mjs';

// Each wait is short enough that all of them end before the parent deadline
const WAIT_MS = 3000;

// flags[0]: target is blocked (starts the capture in bounded-watchdog.mjs).
// sync[0]: getter started, sync[1]: getter ran to its deadline, sync[2]:
// blocked loop returned
const flags = new Int32Array(new SharedArrayBuffer(8));
const sync = new Int32Array(new SharedArrayBuffer(12));

function within(ms, promise) {
  let timer;
  const timeout = new Promise(resolve => {
    timer = setTimeout(() => resolve({ timedOut: true }), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const target = new Worker(new URL('./bounded-terminate-target.mjs', import.meta.url), {
  workerData: { flags, sync },
});
const targetErrors = [];
target.on('error', e => targetErrors.push(`${e?.name}: ${e?.message}`));

const watchdog = startWatchdog(flags);
const capture = new Promise(resolve => watchdog.once('message', resolve));

const getterStarted = await within(WAIT_MS, Atomics.waitAsync(sync, 0, 0).value);

let terminateCalls = 0;
let terminate = { timedOut: true };
const start = performance.now();
if (!getterStarted.timedOut) {
  terminateCalls++;
  terminate = await within(WAIT_MS, target.terminate().then(exitCode => ({ exitCode })));
}
const terminateMs = performance.now() - start;

const captureResult = await within(WAIT_MS, capture);

printResult({
  getterStarted: !getterStarted.timedOut,
  terminateCalls,
  terminateResolved: !terminate.timedOut,
  terminateMs,
  exitCode: terminate.exitCode,
  getterRanToDeadline: Atomics.load(sync, 1) === 1,
  blockedLoopReturned: Atomics.load(sync, 2) === 1,
  targetErrors,
  capture: captureResult,
});
process.exit(0);
