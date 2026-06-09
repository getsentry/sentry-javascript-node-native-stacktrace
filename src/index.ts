/* eslint-disable no-console */
import type { AsyncLocalStorage } from 'node:async_hooks';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { env, versions } from 'node:process';
import { threadId } from 'node:worker_threads';
import * as libc from 'detect-libc';
import { getAbi } from 'node-abi';

const stdlib = libc.familySync();
const platform = process.env['BUILD_PLATFORM'] || os.platform();
const arch = process.env['BUILD_ARCH'] || os.arch();
const abi = getAbi(versions.node, 'node');
const identifier = [platform, arch, stdlib, abi].filter(c => c !== undefined && c !== null).join('-');

type AsyncStorageArgs = {
  /** The AsyncLocalStorage instance used to fetch the store */
  asyncLocalStorage: AsyncLocalStorage<unknown>;
  /**
   * Optional array of keys to fetch a specific property from the store
   * Key will be traversed in order through Objects/Maps to reach the desired property.
   *
   * This is useful if you want to capture Open Telemetry context values as state.
   *
   * To get this value:
   * context.getValue(my_unique_symbol_ref)
   *
   * You would set:
   * stateLookup: ['_currentContext', my_unique_symbol_ref]
   */
  stateLookup?: Array<string | symbol>;
}

type Thread<A = unknown, P = unknown> = {
  frames: StackFrame[];
  /** State captured from the AsyncLocalStorage, if provided */
  asyncState?: A;
  /** Optional state provided when calling threadPoll */
  pollState?: P;
}

type StackFrame = {
  function: string;
  filename: string;
  lineno: number;
  colno: number;
};

interface Native {
  registerThread(threadName: string): void;
  registerThread(storage: AsyncStorageArgs, threadName: string): void;
  threadPoll(enableLastSeen?: boolean, pollState?: object): void;
  captureStackTrace(): Record<string, Thread<string, string>>;
  getThreadsLastSeen(): Record<string, number>;
}

/**
 * Copies the compiled binary from the build directory to the lib directory with the correct name based on the current platform and Node version.
 *
 * @hidden We only use this for copying the binary after building, it is not intended to be used by end users.
 */
export function copyBinary(): void {
  const build = path.resolve(__dirname, '..', 'lib');
  if (!fs.existsSync(build)) {
    fs.mkdirSync(build, { recursive: true });
  }

  if (!fs.existsSync(source)) {
    console.log('Source file does not exist:', source);
    process.exit(1);
  } else {
    if (fs.existsSync(target)) {
      console.log('Target file already exists, overwriting it');
      fs.unlinkSync(target);
    }
    console.log('Copying', source, 'to', target);
    fs.copyFileSync(source, target);
  }
}

const source = path.join(__dirname, '..', 'build', 'Release', 'stack-trace.node');
const target = path.join(__dirname, '..', 'lib', `stack-trace-${identifier}.node`);

function clean(err: Buffer): string {
  return err.toString().trim();
}

function recompileFromSource(): void {
  const cwd = path.join(__dirname, '..');
  console.log('Compiling from source...');
  let spawn = spawnSync('node-gyp', ['configure'], {
    cwd,
    stdio: ['inherit', 'inherit', 'pipe'],
    env: process.env,
    shell: true,
  });
  if (spawn.status !== 0) {
    console.log('Failed to configure gyp');
    console.log(clean(spawn.stderr));
    return;
  }
  spawn = spawnSync('node-gyp', ['build'], {
    cwd,
    stdio: ['inherit', 'inherit', 'pipe'],
    env: process.env,
    shell: true,
  });
  if (spawn.status !== 0) {
    console.log('Failed to build bindings');
    console.log(clean(spawn.stderr));
    return;
  }

  console.log('Successfully compiled from source...');

  copyBinary();
}

// eslint-disable-next-line complexity
function tryLoad(): Native | undefined {
  try {
    // We could just dynamically require the module based on the identifier, but
    // doing so means that bundlers will not pick these files up.
    if (platform === 'darwin') {
      if (arch === 'x64') {
        if (abi === '108') {
          return require('./stack-trace-darwin-x64-108.node');
        }
        if (abi === '115') {
          return require('./stack-trace-darwin-x64-115.node');
        }
        if (abi === '127') {
          return require('./stack-trace-darwin-x64-127.node');
        }
        if (abi === '137') {
          return require('./stack-trace-darwin-x64-137.node');
        }
        if (abi === '147') {
          return require('./stack-trace-darwin-x64-147.node');
        }
      }

      if (arch === 'arm64') {
        if (abi === '108') {
          return require('./stack-trace-darwin-arm64-108.node');
        }
        if (abi === '115') {
          return require('./stack-trace-darwin-arm64-115.node');
        }
        if (abi === '127') {
          return require('./stack-trace-darwin-arm64-127.node');
        }
        if (abi === '137') {
          return require('./stack-trace-darwin-arm64-137.node');
        }
        if (abi === '147') {
          return require('./stack-trace-darwin-arm64-147.node');
        }
      }
    }

    if (platform === 'win32') {
      if (arch === 'x64') {
        if (abi === '108') {
          return require('./stack-trace-win32-x64-108.node');
        }
        if (abi === '115') {
          return require('./stack-trace-win32-x64-115.node');
        }
        if (abi === '127') {
          return require('./stack-trace-win32-x64-127.node');
        }
        if (abi === '137') {
          return require('./stack-trace-win32-x64-137.node');
        }
        if (abi === '147') {
          return require('./stack-trace-win32-x64-147.node');
        }
      }
    }

    if (platform === 'linux') {
      if (arch === 'x64') {
        if (stdlib === 'musl') {
          if (abi === '108') {
            return require('./stack-trace-linux-x64-musl-108.node');
          }
          if (abi === '115') {
            return require('./stack-trace-linux-x64-musl-115.node');
          }
          if (abi === '127') {
            return require('./stack-trace-linux-x64-musl-127.node');
          }
          if (abi === '137') {
            return require('./stack-trace-linux-x64-musl-137.node');
          }
          if (abi === '147') {
            return require('./stack-trace-linux-x64-musl-147.node');
          }
        }
        if (stdlib === 'glibc') {
          if (abi === '108') {
            return require('./stack-trace-linux-x64-glibc-108.node');
          }
          if (abi === '115') {
            return require('./stack-trace-linux-x64-glibc-115.node');
          }
          if (abi === '127') {
            return require('./stack-trace-linux-x64-glibc-127.node');
          }
          if (abi === '137') {
            return require('./stack-trace-linux-x64-glibc-137.node');
          }
          if (abi === '147') {
            return require('./stack-trace-linux-x64-glibc-147.node');
          }
        }
      }
      if (arch === 'arm64') {
        if (stdlib === 'musl') {
          if (abi === '108') {
            return require('./stack-trace-linux-arm64-musl-108.node');
          }
          if (abi === '115') {
            return require('./stack-trace-linux-arm64-musl-115.node');
          }
          if (abi === '127') {
            return require('./stack-trace-linux-arm64-musl-127.node');
          }
          if (abi === '137') {
            return require('./stack-trace-linux-arm64-musl-137.node');
          }
          if (abi === '147') {
            return require('./stack-trace-linux-arm64-musl-147.node');
          }
        }

        if (stdlib === 'glibc') {
          if (abi === '108') {
            return require('./stack-trace-linux-arm64-glibc-108.node');
          }
          if (abi === '115') {
            return require('./stack-trace-linux-arm64-glibc-115.node');
          }
          if (abi === '127') {
            return require('./stack-trace-linux-arm64-glibc-127.node');
          }
          if (abi === '137') {
            return require('./stack-trace-linux-arm64-glibc-137.node');
          }
          if (abi === '147') {
            return require('./stack-trace-linux-arm64-glibc-147.node');
          }
        }
      }
    }

    return require(`./stack-trace-${identifier}.node`);
  } catch {
    return undefined;
  }
}

function getNativeModule(): Native {
  // If a binary path is specified, use that.
  if (env['SENTRY_STACK_TRACE_BINARY_PATH']) {
    const envPath = env['SENTRY_STACK_TRACE_BINARY_PATH'];
    return require(envPath);
  }

  // If a user specifies a different binary dir, they are in control of the binaries being moved there
  if (env['SENTRY_STACK_TRACE_BINARY_DIR']) {
    const binaryPath = path.join(path.resolve(env['SENTRY_STACK_TRACE_BINARY_DIR']), `stack-trace-${identifier}.node`);
    return require(binaryPath);
  }

  if (process.versions.electron) {
    try {
      return require('../build/Release/stack-trace.node');
    } catch (e) {
      console.warn('The \'@sentry-internal/node-native-stacktrace\' binary could not be found. Use \'@electron/rebuild\' to ensure the native module is built for Electron.');
      throw e;
    }
  }

  let nativeModule = tryLoad();
  if (nativeModule) {
    return nativeModule;
  }

  try {
    recompileFromSource();
  } catch (e) {
    console.warn('Failed to compile from source:', e);
  }

  // Try again after attempting to recompile, in case the binary is now available.
  nativeModule = tryLoad();

  if (nativeModule) {
    return nativeModule;
  }

  throw new Error('Failed to load native module. A prebuilt binary for your platform and Node version was not found and recompiling from source failed.');
}

const native = getNativeModule();

export function registerThread(threadName?: string): void;
export function registerThread(storageOrThread: AsyncStorageArgs | string, threadName?: string): void;
/**
 * Registers the current thread with the native module.
 *
 * This should be called on every thread that you want to capture stack traces from.
 *
 * @param storageOrThreadName Either the name of the thread, or an object containing an AsyncLocalStorage instance and optional storage key.
 * @param threadName The name of the thread, if the first argument is an object.
 *
 * threadName defaults to the `threadId` if not provided.
 */
export function registerThread(storageOrThreadName?: AsyncStorageArgs | string, threadName?: string): void {
  if (typeof storageOrThreadName === 'object') {
    native.registerThread(storageOrThreadName, threadName || String(threadId));
  } else {
    native.registerThread(storageOrThreadName || String(threadId));
  }
}

/**
 * Tells the native module that the thread is still running and updates the state.
 *
 * @param enableLastSeen If true, enables the last seen tracking for this thread.
 */
export function threadPoll(enableLastSeen: boolean = true, pollState?: object): void {
  native.threadPoll(enableLastSeen, pollState);
}

/**
 * Captures stack traces for all registered threads.
 */
export function captureStackTrace<A = unknown, P = unknown>(): Record<string, Thread<A, P>> {
  const result = native.captureStackTrace();

  // Parse the asyncState and pollState from JSON strings back into objects
  const transformedResult: Record<string, Thread<A, P>> = {};
  for (const [key, value] of Object.entries(result)) {
    const thread: Thread<A, P> = {
      frames: value.frames,
      ...(value.asyncState && { asyncState: JSON.parse(value.asyncState) }),
      ...(value.pollState && { pollState: JSON.parse(value.pollState) }),
    };
    transformedResult[key] = thread;
  }

  return transformedResult;
}

/**
 * Returns the number of milliseconds since the last time each thread was seen.
 *
 * This is useful for determining if a threads event loop has been blocked for a long time.
 */
export function getThreadsLastSeen(): Record<string, number> {
  return native.getThreadsLastSeen();
}
