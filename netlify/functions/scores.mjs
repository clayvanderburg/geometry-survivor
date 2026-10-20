// Netlify Function (v2): the shared VEXOLITH // SURVIVOR leaderboard at /api/scores.
//   GET  /api/scores?version=<v>   -> that game version's board: { version, current, versions, entries: top 50, total, boardSize }
//   GET  /api/scores?version=all   -> the all-time board (also the default without ?version)
//   GET  ...&mode=hardcore|blitz   -> the same board of that game mode (NORMAL without ?mode)
//   POST /api/scores -> submit one run (JSON, with the game's `version` and the run's `mode`, NORMAL when
//                       absent); 201 with { rank, allTimeRank, mode, entries, ... } or 400/413/415/422/429/503
// Boards and rate-limit state live in the "leaderboard" Netlify Blobs store (zero-config on Netlify);
// Deploy Previews and branch deploys use "leaderboard-preview" instead (../lib/deploy-context.mjs).
// The logic lives in ../lib/leaderboard.mjs so tests can run it against an in-memory store; the known
// game versions come from js/changelog.js, which esbuild bundles in alongside js/leaderboard-rules.js.
import { getStore } from '@netlify/blobs';
import { createScoresHandler, STORE_NAME } from '../lib/leaderboard.mjs';
import { deployContext, storeNameFor } from '../lib/deploy-context.mjs';

const env = (key) => globalThis.Netlify?.env?.get?.(key) ?? process.env[key];

export default createScoresHandler({
  store: (context) => getStore({ name: storeNameFor(STORE_NAME, deployContext(context, env)), consistency: 'strong' }),
  // Optional: set LEADERBOARD_SALT in the Netlify UI so IP hashes can't be brute-forced from this repo.
  salt: env('LEADERBOARD_SALT') || 'vexolith-survivor'
});

export const config = { path: '/api/scores' };
