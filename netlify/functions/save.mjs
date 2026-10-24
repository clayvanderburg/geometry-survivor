// Netlify Function (v2): cloud save under a recovery code at /api/save (no accounts, nothing personal).
// Saves live in the "saves" Netlify Blobs store ("saves-preview" on Deploy Previews and branch deploys,
// ../lib/deploy-context.mjs), keyed by a salted hash of the code; see ../lib/cloud-save.mjs.
import { getStore } from '@netlify/blobs';
import { createSaveHandler, SAVE_STORE } from '../lib/cloud-save.mjs';
import { deployContext, storeNameFor } from '../lib/deploy-context.mjs';

const env = (key) => globalThis.Netlify?.env?.get?.(key) ?? process.env[key];

export default createSaveHandler({
  store: (context) => getStore({ name: storeNameFor(SAVE_STORE, deployContext(context, env)), consistency: 'strong' }),
  // Set SAVE_SALT (or LEADERBOARD_SALT) in the Netlify UI so code hashes can't be checked offline from this repo.
  salt: env('SAVE_SALT') || env('LEADERBOARD_SALT') || 'vexolith-survivor'
});

export const config = { path: '/api/save' };
