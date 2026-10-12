// Shared driver for the bounded state serialization fixtures.
//
// The main thread blocks in a JavaScript busy loop inside an AsyncLocalStorage
// store while a watchdog worker calls captureStackTrace(), so the state is
// serialized while the main thread's JavaScript is interrupted. The fixture
// prints a single JSON line with the capture result, whether the interrupted
// JavaScript saw an exception and how much the peak RSS grew.
//
// The busy loop gives up after MAX_BLOCK_MS, but cannot interrupt a stuck
// native serialization; e2e.test.mjs kills fixtures that run too long.
import { AsyncLocalStorage } from 'node:async_hooks';
import { Worker } from 'node:worker_threads';
import { registerThread } from '@sentry/node-native-stacktrace';

export const MAX_BLOCK_MS = 10000;

// Node 18 on macOS reports maxRSS in bytes instead of kilobytes.
const MAX_RSS_DIVISOR =
  process.platform === 'darwin' && Number(process.versions.node.split('.')[0]) < 20 ? 1024 : 1;

function maxRssKb() {
  return process.resourceUsage().maxRSS / MAX_RSS_DIVISOR;
}

/**
 * Busy-waits inside the current AsyncLocalStorage store until flags[1] is set.
 * Sets flags[0] first, which starts the capture in bounded-watchdog.mjs.
 * Returns true if MAX_BLOCK_MS passed without the capture finishing.
 */
export function blockedInsideState(flags) {
  Atomics.store(flags, 0, 1);
  Atomics.notify(flags, 0);
  const deadline = Date.now() + MAX_BLOCK_MS;
  while (Atomics.load(flags, 1) === 0) {
    if (Date.now() > deadline) {
      return true;
    }
  }
  return false;
}

/**
 * Starts bounded-watchdog.mjs, which captures all registered threads once
 * flags[0] is set and then sets flags[1].
 */
export function startWatchdog(flags) {
  return new Worker(new URL('./bounded-watchdog.mjs', import.meta.url), { workerData: { flags } });
}

/** Prints the fixture result as a single JSON line. */
export function printResult(result) {
  // ASCII only: runTest() decodes stdout chunk by chunk, which would break
  // multi-byte UTF-8 sequences split across chunks
  const json = JSON.stringify(result);
  console.log(json.replace(/[\u007f-\uffff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`));
}

function describeError(e) {
  return `${e?.name}: ${e?.message}`;
}

/**
 * @param {object} options
 * @param {unknown} [options.store] AsyncLocalStorage store the main thread blocks in
 * @param {Array<string | symbol>} [options.stateLookup] passed to registerThread
 * @param {() => void} [options.beforeBlock] runs right before blocking, errors are reported as setupError
 * @param {() => void} [options.afterBlock] runs right after blocking, before anything is printed
 * @param {() => object} [options.report] extra fields for the printed result
 */
export function captureWhileBlocked({ store, stateLookup, beforeBlock, afterBlock, report }) {
  const asyncLocalStorage = new AsyncLocalStorage();
  registerThread(stateLookup ? { asyncLocalStorage, stateLookup } : { asyncLocalStorage });

  // flags[0]: main thread is blocked inside the store, flags[1]: capture is done
  const flags = new Int32Array(new SharedArrayBuffer(8));
  const watchdog = startWatchdog(flags);
  const maxRssBeforeKb = maxRssKb();

  let setupError = null;
  try {
    beforeBlock?.();
  } catch (e) {
    setupError = describeError(e);
  }

  let appError = null;
  let timedOut = false;
  asyncLocalStorage.run(store, () => {
    try {
      timedOut = blockedInsideState(flags);
    } catch (e) {
      appError = describeError(e);
    }
  });
  afterBlock?.();

  watchdog.once('message', result => {
    const maxRssGrowthMb = (maxRssKb() - maxRssBeforeKb) / 1024;
    printResult({ ...result, appError, setupError, timedOut, maxRssGrowthMb, ...report?.() });
  });
}
