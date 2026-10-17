// Netlify Function (v2): the shared VEXOLITH // SURVIVOR leaderboard at /api/scores.
//   GET  /api/scores -> { entries: top 50, total, boardSize }
//   POST /api/scores -> submit one run (JSON); 201 with { rank, entries, ... } or 400/413/415/422/429
// Board and rate-limit state live in the "leaderboard" Netlify Blobs store (zero-config on Netlify).
// The logic lives in ../lib/leaderboard.mjs so tests can run it against an in-memory store.
import { getStore } from '@netlify/blobs';
import { createScoresHandler, STORE_NAME } from '../lib/leaderboard.mjs';

const env = (key) => globalThis.Netlify?.env?.get?.(key) ?? process.env[key];

export default createScoresHandler({
  store: () => getStore({ name: STORE_NAME, consistency: 'strong' }),
  // Optional: set LEADERBOARD_SALT in the Netlify UI so IP hashes can't be brute-forced from this repo.
  salt: env('LEADERBOARD_SALT') || 'vexolith-survivor'
});

export const config = { path: '/api/scores' };
