import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const __dirname = import.meta.dirname || new URL('.', import.meta.url).pathname;

const NODE_MAJOR_VERSION = parseInt(process.versions.node.split('.')[0], 10);

// macOS emulated x64 in CI is very slow!
const timeout = process.env.CI && process.platform === 'darwin' ? 60000 : 20000;

async function runTest(...paths) {
  console.time('Test Run');
  const file = join(...paths);
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

    child.on('error', err => reject(err));

    child.on('close', code => {
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
