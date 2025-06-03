import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createStackParser, nodeStackLineParser  } from '@sentry/core';
import { beforeAll, describe, expect, test } from 'vitest';
import { installTarballAsDependency } from './prepare.mjs';

const __dirname = import.meta.dirname || new URL('.', import.meta.url).pathname;
const defaultStackParser = createStackParser(nodeStackLineParser());

function parseStacks(stacks) {
  return Object.fromEntries(
    Object.entries(stacks).map(([id, stack]) => [id, defaultStackParser(stack)]),
  );
}

describe('e2e Tests', { timeout: 20000 }, () => {
  beforeAll(() => {
    installTarballAsDependency(__dirname);
  });

  test('Capture stack trace from multiple threads', () => {
    const testFile = join(__dirname, 'stack-traces.js');
    const result = spawnSync('node', [testFile])

    expect(result.status).toBe(0);

    const stacks = parseStacks(JSON.parse(result.stdout.toString()));

    expect(stacks['0']).toEqual(expect.arrayContaining([
      {
        function: 'pbkdf2Sync',
        filename: expect.any(String),
        lineno: expect.any(Number),
        colno: expect.any(Number),
        in_app: false,
        module: undefined,
      },
      {
        function: 'longWork',
        filename: expect.stringMatching(/long-work.js$/),
        lineno: expect.any(Number),
        colno: expect.any(Number),
        in_app: true,
        module: undefined,
      },
      {
        function: '?',
        filename: expect.stringMatching(/stack-traces.js$/),
        lineno: expect.any(Number),
        colno: expect.any(Number),
        in_app: true,
        module: undefined,
      },
    ]));

    expect(stacks['2']).toEqual(expect.arrayContaining([
      {
        function: 'pbkdf2Sync',
        filename: expect.any(String),
        lineno: expect.any(Number),
        colno: expect.any(Number),
        in_app: false,
        module: undefined,
      },
      {
        function: 'longWork',
        filename: expect.stringMatching(/long-work.js$/),
        lineno: expect.any(Number),
        colno: expect.any(Number),
        in_app: true,
        module: undefined,
      },
      {
        function: '?',
        filename: expect.stringMatching(/worker.js$/),
        lineno: expect.any(Number),
        colno: expect.any(Number),
        in_app: true,
        module: undefined,
      },
    ]));
  });

  test('Detect stalled thread', { timeout: 20000 }, () => {
    const testFile = join(__dirname, 'stalled.js');
    const result = spawnSync('node', [testFile]);

    expect(result.status).toBe(0);

    const stacks = parseStacks(JSON.parse(result.stdout.toString()));

    expect(stacks['0']).toEqual(expect.arrayContaining([
      {
        function: 'pbkdf2Sync',
        filename: expect.any(String),
        lineno: expect.any(Number),
        colno: expect.any(Number),
        in_app: false,
        module: undefined,
      },
      {
        function: 'longWork',
        filename: expect.stringMatching(/long-work.js$/),
        lineno: expect.any(Number),
        colno: expect.any(Number),
        in_app: true,
        module: undefined,
      },
      {
        function: '?',
        filename: expect.stringMatching(/stalled.js$/),
        lineno: expect.any(Number),
        colno: expect.any(Number),
        in_app: true,
        module: undefined,
      },
    ]));

    expect(stacks['2'].length).toEqual(1);
  });
});
