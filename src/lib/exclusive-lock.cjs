'use strict';

const fs = require('node:fs');

const DEFAULT_MAX_ATTEMPTS = 150;
const DEFAULT_RETRY_MS = 25;
const DEFAULT_STALE_MS = 10000;
const FUTURE_SKEW_MS = 5000;

function busyWait(ms) {
  if (!(ms > 0)) return;
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch (_) {
    const target = Date.now() + ms;
    while (Date.now() < target) { /* spin fallback */ }
  }
}

function acquire(lockPath, opts = {}) {
  const maxAttempts = opts.maxAttempts || DEFAULT_MAX_ATTEMPTS;
  const retryMs = opts.retryMs != null ? opts.retryMs : DEFAULT_RETRY_MS;
  const staleMs = opts.staleMs != null ? opts.staleMs : DEFAULT_STALE_MS;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let lockFd = null;
    try {
      lockFd = fs.openSync(lockPath, 'wx');
    } catch (err) {
      if (err && err.code === 'EEXIST') {
        let recovered = false;
        try {
          const stat = fs.statSync(lockPath);
          const age = Date.now() - stat.mtimeMs;
          if (age > staleMs || age < -FUTURE_SKEW_MS) {
            try { fs.unlinkSync(lockPath); recovered = true; } catch (_) { /* another process won */ }
          }
        } catch (_) {
          recovered = true;
        }
        if (recovered) continue;
        if (attempt < maxAttempts - 1) {
          busyWait(retryMs + (process.pid % 16));
          continue;
        }
        throw new Error(`exclusive-lock: could not acquire ${lockPath} after ${maxAttempts} attempts`);
      }
      throw err;
    }

    try { fs.writeSync(lockFd, JSON.stringify({ pid: process.pid, at: Date.now() })); } catch (_) { /* ignore */ }

    let released = false;
    return function release() {
      if (released) return;
      released = true;
      try { fs.closeSync(lockFd); } catch (_) { /* ignore */ }
      try { fs.unlinkSync(lockPath); } catch (_) { /* ignore */ }
    };
  }
  throw new Error(`exclusive-lock: could not acquire ${lockPath}`);
}

function withLock(targetPath, fn, opts = {}) {
  const release = acquire(`${targetPath}.lock`, opts);
  try {
    return fn();
  } finally {
    release();
  }
}

module.exports = {
  acquire,
  withLock,
  busyWait,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_RETRY_MS,
  DEFAULT_STALE_MS,
};
