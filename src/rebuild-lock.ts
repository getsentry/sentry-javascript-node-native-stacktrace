import * as fs from 'fs';
import * as path from 'path';

const lockFile = path.join(__dirname, '..', '.rebuild-lock');

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: process exists but we can't signal it — treat as alive
    // ESRCH: no such process — stale lock
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function tryAcquire(): number | undefined {
  let fd: number | undefined;
  try {
    fd = fs.openSync(lockFile, 'wx');
    fs.writeSync(fd, String(process.pid));
    return fd;
  } catch {
    try { if (fd !== undefined) fs.closeSync(fd); } catch { /* ignore */ }
    return undefined;
  }
}

function release(fd: number): void {
  try { fs.closeSync(fd); } catch { /* ignore */ }
  try { fs.unlinkSync(lockFile); } catch { /* ignore */ }
}

function clearStaleLock(): void {
  try {
    const pid = parseInt(fs.readFileSync(lockFile, 'utf8'), 10);
    if (!isNaN(pid) && !isProcessAlive(pid)) {
      fs.unlinkSync(lockFile);
    }
  } catch { /* ignore — another waiter may have already cleared it */ }
}

function waitForLockRelease(): void {
  const timer = new Int32Array(new SharedArrayBuffer(4));
  while (fs.existsSync(lockFile)) {
    clearStaleLock();
    Atomics.wait(timer, 0, 0, 250);
  }
}

/**
 * Runs `work` while holding an exclusive lock on `lockFile`. If another caller
 * holds the lock, blocks until it is released (or until a stale lock from a
 * crashed process is detected and cleared).
 */
export function withRebuildLock(work: () => void): void {
  let fd = tryAcquire();

  if (fd === undefined) {
    waitForLockRelease();
    // Try once more after waiting — another waiter may have cleared a stale
    // lock and then done the rebuild itself, so we may not need to rebuild.
    fd = tryAcquire();
  }

  if (fd !== undefined) {
    try {
      work();
    } finally {
      release(fd);
    }
  }
}
