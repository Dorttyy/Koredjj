/**
 * Concurrency gate for backend requests.
 *
 * Why this exists: on Android every `fetch` goes through OkHttp, whose
 * dispatcher allows only FIVE concurrent calls PER HOST, and a WebSocket
 * occupies one of those slots for its entire lifetime. A screen that fires a
 * dozen requests at once (or one stalled request on a flaky mobile link) can
 * therefore leave later requests sitting in OkHttp's queue with no timeout of
 * their own — which is exactly what a "spinner that never finishes" looks
 * like. Capping in-flight requests below that limit keeps a slot free for the
 * socket and guarantees every request is actually started (and therefore
 * covered by our own per-attempt deadline) instead of silently parked.
 */

const MAX_IN_FLIGHT = 4;

type Job = () => void;

let inFlight = 0;
const waiting: Job[] = [];

const pump = () => {
  while (inFlight < MAX_IN_FLIGHT && waiting.length > 0) {
    const next = waiting.shift();
    if (!next) break;
    inFlight += 1;
    next();
  }
};

/** Run `task` as soon as a slot is free; always releases the slot. */
export const withSlot = async <T>(task: () => Promise<T>): Promise<T> => {
  await new Promise<void>((resolve) => {
    waiting.push(resolve);
    pump();
  });
  try {
    return await task();
  } finally {
    inFlight = Math.max(0, inFlight - 1);
    pump();
  }
};

export const queueStats = () => ({ inFlight, waiting: waiting.length });
