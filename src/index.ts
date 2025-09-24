import type { AsyncLocalStorage } from 'node:async_hooks';
import { arch as _arch, platform as _platform } from 'node:os';
import { join, resolve } from 'node:path';
import { env, versions } from 'node:process';
import { threadId } from 'node:worker_threads';
import { familySync } from 'detect-libc';
import { getAbi } from 'node-abi';

const stdlib = familySync();
const platform = process.env['BUILD_PLATFORM'] || _platform();
const arch = process.env['BUILD_ARCH'] || _arch();
const abi = getAbi(versions.node, 'node');
const identifier = [platform, arch, stdlib, abi].filter(c => c !== undefined && c !== null).join('-');

type AsyncStorageArgs = {
  /** The AsyncLocalStorage instance used to fetch the store */
  asyncLocalStorage: AsyncLocalStorage<unknown>;
  /**
   * Optional key in the store to fetch the state from. If not provided, the entire store will be returned.
   *
   * This can be useful to fetch only a specific part of the state or in the
   * case of Open Telemetry, where it stores context under a symbol key.
   */
  storageKey?: string | symbol;
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
  captureStackTrace<A = unknown, P = unknown>(): Record<string, Thread<A, P>>;
  getThreadsLastSeen(): Record<string, number>;
}

// eslint-disable-next-line complexity
function getNativeModule(): Native {
  // If a binary path is specified, use that.
  if (env['SENTRY_STACK_TRACE_BINARY_PATH']) {
    const envPath = env['SENTRY_STACK_TRACE_BINARY_PATH'];
    return require(envPath);
  }

  // If a user specifies a different binary dir, they are in control of the binaries being moved there
  if (env['SENTRY_STACK_TRACE_BINARY_DIR']) {
    const binaryPath = join(resolve(env['SENTRY_STACK_TRACE_BINARY_DIR']), `stack-trace-${identifier}.node`);
    return require(binaryPath);
  }

  if (process.versions.electron) {
    try {
      return require('../build/Release/stack-trace.node');
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('The \'@sentry-internal/node-native-stacktrace\' binary could not be found. Use \'@electron/rebuild\' to ensure the native module is built for Electron.');
      throw e;
    }
  }

  // We need the fallthrough so that in the end, we can fallback to the dynamic require.
  // This is for cases where precompiled binaries were not provided, but may have been compiled from source.
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
      }
    }
  }

  return require(`./stack-trace-${identifier}.node`);
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
  return native.captureStackTrace<A, P>();
}

/**
 * Returns the number of milliseconds since the last time each thread was seen.
 *
 * This is useful for determining if a threads event loop has been blocked for a long time.
 */
export function getThreadsLastSeen(): Record<string, number> {
  return native.getThreadsLastSeen();
}
