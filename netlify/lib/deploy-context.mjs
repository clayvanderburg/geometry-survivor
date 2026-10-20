// Which Netlify Blobs store a request may write. getStore() stores are site-wide and shared by every deploy
// context, so a Deploy Preview or branch deploy used to post its runs (unreleased versions included) to the
// live boards. Only production uses the real stores; every other context gets a "-preview" twin, one shared
// test board per store for all previews. Production keys and data are untouched.
export const PRODUCTION = 'production';
export const PREVIEW_SUFFIX = '-preview';

// The deploy context of a request: Functions v2 context.deploy.context ('production', 'deploy-preview',
// 'branch-deploy', 'dev'), else the CONTEXT env var. Neither (an older runtime) counts as production,
// which is where every run went before.
export function deployContext(context, env = () => undefined) {
  const value = context?.deploy?.context || env('CONTEXT');
  return typeof value === 'string' && value ? value : PRODUCTION;
}

export const isPreviewContext = (ctx) => ctx !== PRODUCTION;

export function storeNameFor(base, ctx) {
  return isPreviewContext(ctx) ? base + PREVIEW_SUFFIX : base;
}
