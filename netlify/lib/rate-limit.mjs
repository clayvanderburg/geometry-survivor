// Per-client cooldowns kept in a Netlify Blobs store, shared by /api/scores and /api/stats.
//
// One small blob per hashed client IP per window: `<prefix><window>/<ip hash>` = { t } (the client's last
// accepted request). Only the current and previous windows are read, so a window boundary is no loophole,
// and nothing older is ever looked at again. Each function instance sweeps older windows (and keys from
// before windows existed, `<prefix><ip hash>`) once per window, at most `sweepMaxDeletes` per sweep, so
// the store never piles up one blob per visitor forever.
//
// Storage-agnostic: anything with getWithMetadata (or get), setJSON(key, value, { onlyIfNew | onlyIfMatch }),
// list({ prefix[, paginate] }) and delete(key), which is the @netlify/blobs Store API.

// Compare-and-swap options for a blob read as `current` (null when it didn't exist). Netlify Blobs
// returns an ETag on every read in production; the local `netlify dev` sandbox doesn't, and there we
// fall back to a plain last-writer-wins write.
export function writeConditions(current) {
  if (!current) return { onlyIfNew: true };
  return current.etag ? { onlyIfMatch: current.etag } : {};
}

async function readJson(blobs, key) {
  if (typeof blobs.getWithMetadata === 'function') return (await blobs.getWithMetadata(key, { type: 'json' })) || null;
  const data = await blobs.get(key, { type: 'json' });
  return data == null ? null : { data };
}

// Every key under `prefix`, following list() pages when the store paginates.
async function* listKeys(blobs, prefix) {
  const paged = blobs.list({ prefix, paginate: true });
  if (paged && typeof paged[Symbol.asyncIterator] === 'function') {
    for await (const page of paged) for (const b of page?.blobs || []) yield String(b.key);
    return;
  }
  const listing = await paged;
  for (const b of listing?.blobs || []) yield String(b.key);
}

export function createRateLimiter({ prefix, cooldownMs, windowMs = 10 * 60_000, sweepMaxDeletes = 500, log = console }) {
  const bucketOf = (t) => Math.floor(t / windowMs);
  const keyOf = (bucket, ipHash) => `${prefix}${bucket}/${ipHash}`;
  let sweptBucket = null;

  return {
    bucketOf,
    keyOf,

    // Claims this client's slot at time `t`. Conditional write, so parallel requests can't all slip
    // through. Resolves { retryAfter } (seconds; 0 when claimed) and the claimed `key`.
    async claim(blobs, ipHash, t) {
      const bucket = bucketOf(t);
      const key = keyOf(bucket, ipHash);
      const [cur, prev] = await Promise.all([readJson(blobs, key), readJson(blobs, keyOf(bucket - 1, ipHash))]);
      const last = Math.max(Number(cur?.data?.t) || 0, Number(prev?.data?.t) || 0);
      if (last && t - last < cooldownMs) return { retryAfter: Math.ceil((cooldownMs - (t - last)) / 1000), key };
      const write = await blobs.setJSON(key, { t }, writeConditions(cur?.data ? cur : null));
      return { retryAfter: write?.modified === false ? Math.ceil(cooldownMs / 1000) : 0, key };
    },

    // Gives a claimed slot back (the request it was claimed for didn't go through).
    async release(blobs, key) {
      try {
        if (typeof blobs.delete === 'function') await blobs.delete(key);
        else await blobs.setJSON(key, { t: 0 });
      } catch (err) {
        log?.warn?.('[rate-limit] could not release a slot', err);
      }
    },

    // Deletes windows older than the previous one, and pre-window keys. Once per window per instance;
    // resolves the number removed (a failure is logged and retried next window).
    async sweep(blobs, t) {
      const bucket = bucketOf(t);
      if (sweptBucket === bucket || typeof blobs.list !== 'function' || typeof blobs.delete !== 'function') return 0;
      sweptBucket = bucket;
      let removed = 0;
      try {
        for await (const key of listKeys(blobs, prefix)) {
          if (removed >= sweepMaxDeletes) break;
          const rest = key.slice(prefix.length);
          const slash = rest.indexOf('/');
          const keyBucket = slash === -1 ? -Infinity : Number(rest.slice(0, slash));
          if (!(keyBucket >= bucket - 1)) {
            await blobs.delete(key);
            removed++;
          }
        }
      } catch (err) {
        log?.warn?.('[rate-limit] sweep failed', err);
      }
      return removed;
    },

    // Runs the sweep after the response when the platform allows (context.waitUntil), else inline.
    async sweepSoon(blobs, t, context) {
      const done = this.sweep(blobs, t);
      if (typeof context?.waitUntil === 'function') context.waitUntil(done);
      else await done;
    }
  };
}
