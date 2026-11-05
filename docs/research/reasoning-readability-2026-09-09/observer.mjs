// Research-only asynchronous observer. In production, expensive local work
// belongs in a worker/process; request() here MUST return promptly with a Promise.
// Caller supplies immutable snapshots; this module has no model-history access.
export function createObserver({ request, publish, maxCacheEntries = 16 }) {
  const cache = new Map();
  let latest, busy = false, disposed = false;
  const stats = { requests: 0, cacheHits: 0, errors: 0, maxInFlight: 0 };
  function pump() {
    if (disposed || busy || !latest) return;
    const job = latest;
    if (cache.has(job.key)) { stats.cacheHits++; publish(cache.get(job.key)); return; }
    busy = true;
    stats.requests++;
    stats.maxInFlight = 1;
    Promise.resolve().then(() => request(job)).then(value => {
      if (disposed) return;
      cache.set(job.key, value);
      if (cache.size > maxCacheEntries) cache.delete(cache.keys().next().value);
      if (latest?.key === job.key) publish(value);
    }).catch(() => { stats.errors++; }).finally(() => {
      busy = false;
      if (latest?.key !== job.key) queueMicrotask(pump);
    });
  }
  return {
    // key must include snapshot hash, style, summarizer version, language, and
    // policy version. Passing duplicate keys for different content is invalid.
    push(job) { latest = Object.freeze({ ...job }); queueMicrotask(pump); },
    dispose() { disposed = true; latest = undefined; cache.clear(); },
    stats,
  };
}
