import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const __dirname = import.meta.dirname || new URL('.', import.meta.url).pathname;

const NODE_MAJOR_VERSION = parseInt(process.versions.node.split('.')[0], 10);

// macOS emulated x64 in CI is very slow!
const timeout = process.env.CI && process.platform === 'darwin' ? 60000 : 20000;

async function runTest(...paths) {
  return runFile(join(...paths));
}

// Runs a node script and collects its output. With deadlineMs, a script that
// is still running after deadlineMs is killed and the run fails.
async function runFile(file, deadlineMs) {
  console.time('Test Run');
  const args = NODE_MAJOR_VERSION === 22 ? ['--experimental-async-context-frame', file] : [file];

  return new Promise((resolve, reject) => {
    const child = spawn('node', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdoutBuf = '';
    let stderrBuf = '';

    child.stdout?.on('data', chunk => {
      stdoutBuf += chunk.toString();
    });
    child.stderr?.on('data', chunk => {
      stderrBuf += chunk.toString();
    });

    let killedAtDeadline = false;
    const deadline = deadlineMs === undefined ? undefined : setTimeout(() => {
      killedAtDeadline = true;
      child.kill('SIGKILL');
    }, deadlineMs);

    child.on('error', err => {
      clearTimeout(deadline);
      reject(err);
    });

    // 'close' fires once the process has exited (and been reaped) and its
    // output streams are closed, also after it was killed at the deadline
    child.on('close', code => {
      clearTimeout(deadline);
      const stdout = stdoutBuf
        .split('\n')
        .map(line => line.trim())
        .filter(line => line !== '');
      const stderr = stderrBuf
        .split('\n')
        .map(line => line.trim())
        .filter(line => line !== '');

      let trace;
      for (const line of stdout) {
        try {
          trace = JSON.parse(line);
          break;
        } catch (_) {
          // ignore non-JSON lines
        }
      }

      console.timeEnd('Test Run');
      if (stdout.length > 0) {
        console.log('stdout:', stdout);
      }
      if (stderr.length > 0) {
        console.log('stderr:', stderr);
      }

      if (killedAtDeadline) {
        reject(new Error(
          `Fixture timeout: ${file} did not exit within ${deadlineMs} ms and was killed (SIGKILL). ` +
          `stdout: ${JSON.stringify(stdout).slice(0, 2000)} stderr: ${JSON.stringify(stderr).slice(0, 2000)}`,
        ));
        return;
      }

      resolve({ status: code, stdout, trace });
    });
  });
}

describe('e2e Tests', { timeout }, () => {
  test('Capture stack trace from multiple threads', async () => {
    const result = await runTest(__dirname, 'stack-traces.js')

    expect(result.status).toEqual(0);

    expect(result.trace).toEqual(expect.objectContaining({
      '0': {
        frames: expect.arrayContaining([
          {
            function: 'pbkdf2Sync',
            filename: expect.any(String),
            lineno: expect.any(Number),
            colno: expect.any(Number),
          },
          {
            function: 'longWork',
            filename: expect.stringMatching(/long-work.js$/),
            lineno: expect.any(Number),
            colno: expect.any(Number),
          },
          {
            function: '?',
            filename: expect.stringMatching(/stack-traces.js$/),
            lineno: expect.any(Number),
            colno: expect.any(Number),
          },
        ]),
      },
      '2': {
        frames: expect.arrayContaining([
          {
            function: 'pbkdf2Sync',
            filename: expect.any(String),
            lineno: expect.any(Number),
            colno: expect.any(Number),
          },
          {
            function: 'longWork',
            filename: expect.stringMatching(/long-work.js$/),
            lineno: expect.any(Number),
            colno: expect.any(Number),
          },
          {
            function: '?',
            filename: expect.stringMatching(/worker.js$/),
            lineno: expect.any(Number),
            colno: expect.any(Number),
          },
        ]),
      },
    }));
  });

  test('detect stalled thread', async () => {
    const result = await runTest(__dirname, 'stalled.js');

    expect(result.status).toEqual(0);

    expect(result.trace).toEqual(expect.objectContaining({
      '0': {
        frames: expect.arrayContaining([
          {
            function: 'pbkdf2Sync',
            filename: expect.any(String),
            lineno: expect.any(Number),
            colno: expect.any(Number),
          },
          {
            function: 'longWork',
            filename: expect.stringMatching(/long-work.js$/),
            lineno: expect.any(Number),
            colno: expect.any(Number),
          },
          {
            function: '?',
            filename: expect.stringMatching(/stalled.js$/),
            lineno: expect.any(Number),
            colno: expect.any(Number),
          },
        ]),
        pollState: { some_property: 'some_value' },
      },
      '2': {
        frames: expect.any(Array),
      },
    }));
  });

  test('detect completely blocked thread', async () => {
    const result = await runTest(__dirname, 'stalled-forever.js');

    expect(result.status).toEqual(0);

    expect(result.trace).toEqual(expect.objectContaining({
      '0': {
        frames: expect.any(Array),
        pollState: { some_property: 'main_thread' }
      },
      '2': {
        frames: expect.arrayContaining([
          {
            function: 'pbkdf2Sync',
            filename: expect.any(String),
            lineno: expect.any(Number),
            colno: expect.any(Number),
          },
          {
            function: 'longWork',
            filename: expect.stringMatching(/long-work.js$/),
            lineno: expect.any(Number),
            colno: expect.any(Number),
          },
          {
            function: '?',
            filename: expect.stringMatching(/worker-forever.js$/),
            lineno: expect.any(Number),
            colno: expect.any(Number),
          },
        ]),
        pollState: { some_property: 'worker_thread' },
      },
    }));
  });

  test('async storage state', async (ctx) => {
    if (NODE_MAJOR_VERSION < 22) {
      ctx.skip();
      return;
    }

    const result = await runTest(__dirname, 'async-storage.mjs');

    expect(result.status).toEqual(0);

    expect(result.trace).toEqual(expect.objectContaining({
      '0': expect.objectContaining({
        frames: expect.arrayContaining([
          {
            function: 'pbkdf2Sync',
            filename: expect.any(String),
            lineno: expect.any(Number),
            colno: expect.any(Number),
          },
          {
            function: 'longWork',
            filename: expect.stringMatching(/long-work.js$/),
            lineno: expect.any(Number),
            colno: expect.any(Number),
          },
          {
            function: '?',
            filename: expect.stringMatching(/async-storage.mjs$/),
            lineno: expect.any(Number),
            colno: expect.any(Number),
          },
        ]),
        asyncState: { traceId: 'trace-5' },
      }),
    }));
  });

  test('can be disabled', async () => {
    const result = await runTest(__dirname, 'stalled-disabled.js');

    expect(result.status).toEqual(0);
    expect(result.stdout).toContain('complete');
  });
});

// Bounded fixtures are killed after this long, before vitest gives up on the
// test (vitest does not stop a child process when a test times out)
const FIXTURE_DEADLINE_MS = timeout - 5000;

function runBounded(fixture) {
  return runFile(join(__dirname, fixture), FIXTURE_DEADLINE_MS);
}

// Loose limits: the specified targets are < 100 ms and < 50 MB, the unbounded
// serializer needed > 1 s and > 800 MB for these inputs. The RSS growth also
// includes starting the watchdog worker.
const MAX_CAPTURE_MS = 2000;
const MAX_RSS_GROWTH_MB = 100;

// Asserts that the main thread was captured while blocked inside its
// AsyncLocalStorage store and that the interrupted JavaScript saw no exception
function expectCleanCapture(result) {
  expect(result.status).toEqual(0);

  const report = result.trace;
  expect(report).toEqual(expect.objectContaining({ appError: null, setupError: null, timedOut: false }));
  expect(report.captureError).toBeUndefined();
  expect(report.captureMs).toBeLessThan(MAX_CAPTURE_MS);
  expect(report.maxRssGrowthMb).toBeLessThan(MAX_RSS_GROWTH_MB);

  const thread = report.trace['0'];
  expect(thread.frames).toEqual(expect.arrayContaining([
    {
      function: 'blockedInsideState',
      filename: expect.stringMatching(/bounded-harness.mjs$/),
      lineno: expect.any(Number),
      colno: expect.any(Number),
    },
  ]));

  return { report, thread };
}

function follow(value, key, hops) {
  for (let i = 0; i < hops; i++) {
    value = value[key];
  }
  return value;
}

// Number of objects followed along `key` before reaching a non-object
function chainLength(value, key) {
  let length = 0;
  while (typeof value === 'object' && value !== null) {
    value = value[key];
    length++;
  }
  return { length, end: value };
}

function nest(depth, wrap, leaf) {
  let value = leaf;
  for (let i = 0; i < depth; i++) {
    value = wrap(value);
  }
  return value;
}

const range = n => Array.from({ length: n }, (_, i) => i);

const MAX_PROPERTIES = '[MaxProperties ~]';

describe('bounded state serialization', { timeout }, () => {
  const asyncStateTest = test.skipIf(NODE_MAJOR_VERSION < 22);

  asyncStateTest('shared-reference graph of depth 24', async () => {
    const { report, thread } = expectCleanCapture(await runBounded('bounded-shared-graph.mjs'));

    expect(report.stateJsonLength).toBeGreaterThan(0);
    expect(report.stateJsonLength).toBeLessThan(64 * 1024);
    // Nesting is cut at depth 10, long before the leaf
    expect(follow(thread.asyncState, 'a', 9)).toEqual({ a: '[Object]', b: '[Object]' });
    expect(follow(thread.asyncState, 'b', 9)).toEqual({ a: '[Object]', b: '[Object]' });
    expect(JSON.stringify(thread.asyncState)).not.toContain('leaf');
  });

  asyncStateTest('wide shared references are cut by the read budget', async () => {
    const { report, thread } = expectCleanCapture(await runBounded('bounded-node-budget.mjs'));

    const json = JSON.stringify(thread.asyncState);
    // Each copied leaf costs two reads (the array element and its property),
    // so at most 10,000 of the 10^9 leaves fit into 20,000 reads
    const copiedLeaves = json.split('{"leaf":1}').length - 1;
    expect(copiedLeaves).toBeGreaterThan(9900);
    expect(copiedLeaves).toBeLessThanOrEqual(10000);
    expect(report.stateJsonLength).toBeLessThan(512 * 1024);

    // Once the budget is used up nothing more is read: every array that was
    // being copied ends with the marker
    const { graph } = thread.asyncState;
    expect(graph).toEqual([expect.any(Array), MAX_PROPERTIES]);
    const [first] = graph;
    expect(first.at(-1)).toEqual(MAX_PROPERTIES);
    expect(first.length).toBeLessThan(1000);
    const copied = first.slice(0, -1);
    expect(copied.slice(0, -1).every(level => level.length === 1000)).toBe(true);
    expect(copied.at(-1).at(-1)).toEqual(MAX_PROPERTIES);
  });

  asyncStateTest('read budget stops further getter calls', async () => {
    const { report, thread } = expectCleanCapture(await runBounded('bounded-getter-budget.mjs'));

    // 1,001,000 getters without the budget, at most 20,000 reads with it
    expect(report.getterReads).toBeGreaterThan(10000);
    expect(report.getterReads).toBeLessThanOrEqual(20000);

    const outer = Object.entries(thread.asyncState.outer);
    expect(outer.length).toBeLessThan(1000);
    expect(outer.at(-1)[1]).toEqual(MAX_PROPERTIES);
    expect(outer[0]).toEqual(['k0', Object.fromEntries(range(1000).map(i => [`k${i}`, i]))]);
    expect(report.stateJsonLength).toBeLessThan(512 * 1024);
  });

  asyncStateTest('Node Timeout in a list of 12,000 timers', async () => {
    const { report, thread } = expectCleanCapture(await runBounded('bounded-timers.mjs'));

    expect(report.timers).toEqual(12000);
    expect(report.stateJsonLength).toBeLessThan(64 * 1024);

    const timer = thread.asyncState.profiler._chunkData.timer;
    expect(timer._idleTimeout).toEqual(60000);
    // Both directions of the timer list end in a depth marker after a few links
    for (const key of ['_idlePrev', '_idleNext']) {
      const chain = chainLength(timer[key], key);
      expect(chain.end).toEqual('[Object]');
      expect(chain.length).toBeGreaterThan(0);
      expect(chain.length).toBeLessThan(10);
    }
  });

  asyncStateTest('exceptions while reading the state do not reach the application', async () => {
    const { report, thread } = expectCleanCapture(await runBounded('bounded-throwing.mjs'));

    // Every throwing getter ran during the capture
    expect(report.throwingReads).toEqual(4);
    expect(thread.asyncState).toEqual({
      ok: 1,
      list: [1, 3],
      nested: { fine: 'yes', alsoFine: 2 },
      after: 'kept',
    });
  });

  asyncStateTest('exceptions while looking up the state do not reach the application', async () => {
    const { report, thread } = expectCleanCapture(await runBounded('bounded-throwing-lookup.mjs'));

    expect(report.throwingReads).toEqual(1);
    expect(thread.asyncState).toBeUndefined();
  });

  asyncStateTest('proxies become "[Proxy]" without running traps', async () => {
    const { report, thread } = expectCleanCapture(await runBounded('bounded-proxy.mjs'));

    expect(report.trapLookups).toEqual([]);
    expect(thread.asyncState).toEqual({
      before: 1,
      plain: '[Proxy]',
      list: ['[Proxy]', 2],
      revoked: '[Proxy]',
      after: 'kept',
    });
  });

  for (const fixture of ['bounded-tojson-object.mjs', 'bounded-tojson-array.mjs']) {
    asyncStateTest(`inherited toJSON hooks cannot change the state (${fixture})`, async () => {
      const { report, thread } = expectCleanCapture(await runBounded(fixture));

      expect(report.toJSONCalls).toEqual(0);
      expect(thread.asyncState).toEqual({ text: 't', obj: { a: 1 }, list: [1, { b: 2 }, [3]] });
      expect(report.stateJsonLength).toBeLessThan(1024);
    });
  }

  asyncStateTest('worker.terminate() during a state getter stops the worker on the first call', async () => {
    const result = await runBounded('bounded-terminate.mjs');
    expect(result.status).toEqual(0);

    const report = result.trace;
    expect(report).toEqual(expect.objectContaining({
      getterStarted: true,
      terminateCalls: 1,
      terminateResolved: true,
      // Termination stopped the getter and the worker's own code
      getterRanToDeadline: false,
      blockedLoopReturned: false,
      targetErrors: [],
    }));
    // The getter would keep running for 6 s, the blocked loop for 8 s
    expect(report.terminateMs).toBeLessThan(MAX_CAPTURE_MS);

    // The capture returns the frames, without state from the stopped walk
    const capture = report.capture;
    expect(capture).toBeDefined();
    expect(capture.captureError).toBeUndefined();
    expect(capture.captureMs).toBeLessThan(MAX_CAPTURE_MS);
    expect(capture.trace.target.frames).toEqual(expect.arrayContaining([
      expect.objectContaining({
        function: 'blockedUntilTerminated',
        filename: expect.stringMatching(/bounded-terminate-target.mjs$/),
      }),
    ]));
    expect(capture.trace.target.asyncState).toBeUndefined();
  });

  asyncStateTest('large string referenced many times is cut by the string budget', async () => {
    const { report, thread } = expectCleanCapture(await runBounded('bounded-strings.mjs'));

    const big = '\u{1F600}'.repeat(150 * 1024);
    expect(report.bigLength).toEqual(big.length);
    expect(report.stateJsonLength).toBeLessThanOrEqual(1024 * 1024 + 1024);

    const items = thread.asyncState.items;
    expect(items).toHaveLength(8);
    // Plain boolean checks: diffs of these strings would be megabytes long
    expect(items.slice(0, 3).map(item => item === big)).toEqual([true, true, true]);

    const truncated = items[3];
    expect(truncated.endsWith('...')).toBe(true);
    const prefix = truncated.slice(0, -3);
    expect(prefix.length).toBeGreaterThan(0);
    expect(prefix.length).toBeLessThan(big.length);
    expect(big.startsWith(prefix)).toBe(true);
    // The cut does not leave half of a surrogate pair behind
    expect(/[\uD800-\uDBFF]$/.test(prefix)).toBe(false);
    expect(3 * big.length + prefix.length).toBeLessThanOrEqual(1024 * 1024);

    expect(items.slice(4)).toEqual(['[String]', '[String]', '[String]', '[String]']);
  });

  asyncStateTest('a first key larger than the string budget cuts the object visibly', async () => {
    const { report, thread } = expectCleanCapture(await runBounded('bounded-key-first.mjs'));

    // The oversized key and everything after it is replaced by the marker,
    // also in the root object, whose next key no longer fits either
    expect(thread.asyncState).toEqual({ first: { '...': MAX_PROPERTIES }, '...': MAX_PROPERTIES });
    expect(report.stateJsonLength).toBeLessThan(1024);
  });

  asyncStateTest('keys after the string budget is used up cut the object visibly', async () => {
    const { report, thread } = expectCleanCapture(await runBounded('bounded-key-after.mjs'));

    const state = thread.asyncState;
    expect(Object.keys(state)).toEqual(['ok', 'a', '...']);
    expect(state.ok).toEqual(1);
    // Plain boolean check: a diff of this string would be a megabyte long
    expect(state.a === 'y'.repeat(1024 * 1024 - 3)).toBe(true);
    expect(state['...']).toEqual(MAX_PROPERTIES);
    expect(report.stateJsonLength).toBeLessThanOrEqual(1024 * 1024 + 1024);
  });

  asyncStateTest('arrays and objects with more than 1000 entries are cut', async () => {
    const { thread } = expectCleanCapture(await runBounded('bounded-breadth.mjs'));

    const state = thread.asyncState;
    expect(state.wideArray).toEqual([...range(1000), MAX_PROPERTIES]);
    expect(state.exactArray).toEqual(range(1000));

    const wideEntries = Object.entries(state.wideObject);
    expect(wideEntries).toHaveLength(1001);
    expect(wideEntries.slice(0, 1000)).toEqual(range(1000).map(i => [`k${i}`, i]));
    expect(wideEntries[1000][1]).toEqual(MAX_PROPERTIES);
    expect(state.exactObject).toEqual(Object.fromEntries(range(1000).map(i => [`k${i}`, i])));
  });

  asyncStateTest('nesting is cut at depth 10 and keeps Sentry breadcrumb data', async () => {
    const { thread } = expectCleanCapture(await runBounded('bounded-depth.mjs'));

    expect(thread.asyncState).toEqual({
      isolationScope: {
        _breadcrumbs: [
          {
            category: 'console',
            // At least three levels below `data` are kept
            data: { arguments: [{ a: { b: { c: { d: '[Object]' } } } }] },
          },
        ],
      },
      objectChain: nest(9, child => ({ child }), '[Object]'),
      arrayChain: nest(9, child => [child], '[Array]'),
    });
  });

  asyncStateTest('small states keep JSON semantics', async () => {
    const { thread } = expectCleanCapture(await runBounded('bounded-semantics.mjs'));

    expect(thread.asyncState).toEqual({
      traceId: 'trace-5',
      count: 3,
      flag: true,
      nothing: null,
      list: [1, 'two', { deep: { deeper: true } }],
      shared: { x: 1 },
      alsoShared: { x: 1 },
    });
  });

  test('threadPoll state is bounded and exceptions do not reach the caller', async () => {
    const { report, thread } = expectCleanCapture(await runBounded('bounded-poll-state.mjs'));

    expect(report.throwingReads).toEqual(1);
    expect(report.threadPollMs).toBeLessThan(MAX_CAPTURE_MS);
    expect(report.pollStateJsonLength).toBeLessThan(64 * 1024);

    const pollState = thread.pollState;
    expect(pollState.ok).toEqual(1);
    expect(pollState).not.toHaveProperty('boom');
    expect(follow(pollState.graph, 'a', 8)).toEqual({ a: '[Object]', b: '[Object]' });
  });
});
