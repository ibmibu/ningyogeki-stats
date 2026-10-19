const LIMITER_KEY = Symbol.for('ningyogeki.smashmate-request-limiter');
const MIN_INTERVAL_MS = 60_000;

function getLimiterState() {
  if (!globalThis[LIMITER_KEY]) {
    globalThis[LIMITER_KEY] = {
      queue: Promise.resolve(),
      lastStartedAt: 0,
    };
  }
  return globalThis[LIMITER_KEY];
}

/**
 * Sends Smashmate requests one at a time, with at least 60 seconds between
 * request start times within the same Node.js runtime instance.
 */
export function smashmateFetch(url, options = {}) {
  const state = getLimiterState();
  const { timeoutMs, ...fetchOptions } = options;

  const task = state.queue.then(async () => {
    const waitMs = MIN_INTERVAL_MS - (Date.now() - state.lastStartedAt);
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    state.lastStartedAt = Date.now();

    // Start the timeout only after rate-limit waiting has finished.
    if (!timeoutMs) return fetch(url, fetchOptions);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...fetchOptions, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  });

  // Keep the queue usable even if a request fails.
  state.queue = task.then(
    () => undefined,
    () => undefined
  );

  return task;
}
