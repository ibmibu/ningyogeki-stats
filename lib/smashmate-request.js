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
export function smashmateFetch(url, options) {
  const state = getLimiterState();

  const task = state.queue.then(async () => {
    const waitMs = MIN_INTERVAL_MS - (Date.now() - state.lastStartedAt);
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    state.lastStartedAt = Date.now();
    return fetch(url, options);
  });

  // Keep the queue usable even if a request fails.
  state.queue = task.then(
    () => undefined,
    () => undefined
  );

  return task;
}
