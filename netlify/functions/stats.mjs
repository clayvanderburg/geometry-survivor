// Netlify Function (v2): anonymous gameplay statistics.
//   POST /api/stats                         one run summary from the game (no callsign, no IP stored)
//   GET  /api/stats/summary?version=<v>|all the aggregate the developer dashboard (stats.html) reads
// Runs and the cached aggregate live in the "stats" Netlify Blobs store ("stats-preview" on Deploy Previews
// and branch deploys, ../lib/deploy-context.mjs); see ../lib/stats.mjs for the
// layout. The known game versions come from js/changelog.js, which esbuild bundles in.
import { getStore } from '@netlify/blobs';
import { createStatsHandler, STATS_STORE } from '../lib/stats.mjs';
import { deployContext, storeNameFor } from '../lib/deploy-context.mjs';

const env = (key) => globalThis.Netlify?.env?.get?.(key) ?? process.env[key];

export default createStatsHandler({
  store: (context) => getStore({ name: storeNameFor(STATS_STORE, deployContext(context, env)), consistency: 'strong' }),
  // Same optional secret as the leaderboard: set LEADERBOARD_SALT in the Netlify UI.
  salt: env('LEADERBOARD_SALT') || 'vexolith-survivor'
});

export const config = { path: ['/api/stats', '/api/stats/summary'] };
