// Save smoke: cloud backup and restore across fresh browser profiles, plus EXPORT / IMPORT SAVE, in the real
// game. /api/save is served by the real handler (netlify/lib/cloud-save.mjs) over an in-memory store; the
// leaderboard and stats APIs are offline.
//   1. Pilot A (fresh profile) earns progress; the first backup makes a recovery code, shown once on the
//      title ("write this down" card) and in the SAVE screen (masked until SHOW); EXPORT SAVE gives a code.
//   2. Pilot B (another fresh profile) restores A's code: the SAVE screen shows what it holds, USE replaces
//      the save (reload), B now has A's cores, Armory and unlocks, and backs up under A's code.
//   3. Pilot C (has progress of its own) imports A's export and MERGEs: the best of both, cores not doubled.
//   4. Cloud save off: nothing is sent.
// Screenshots: save-callout-smoke.png, save-modal-smoke.png, save-restore-smoke.png (current directory).
// Usage: node tools/save-smoke.cjs <playwright-module-path>   (set BROWSER_EXECUTABLE to choose Chromium)
const { chromium } = require(process.argv[2] || 'playwright');
const fs = require('node:fs/promises'), path = require('node:path');
const root = path.resolve(__dirname, '..');

class MemoryStore {
  constructor() { this.blobs = new Map(); this.v = 0; }
  async getWithMetadata(key) { const e = this.blobs.get(key); return e ? { data: JSON.parse(e.body), etag: e.etag } : null; }
  async setJSON(key, value, opts = {}) {
    const cur = this.blobs.get(key);
    if (opts.onlyIfNew && cur) return { modified: false };
    if (opts.onlyIfMatch && (!cur || cur.etag !== opts.onlyIfMatch)) return { modified: false };
    this.blobs.set(key, { body: JSON.stringify(value), etag: `"v${++this.v}"` });
    return { modified: true };
  }
  async delete(key) { this.blobs.delete(key); }
  async list({ prefix = '' } = {}) { return { blobs: [...this.blobs.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; }
}

(async () => {
  const { createSaveHandler } = await import(path.join(root, 'netlify/lib/cloud-save.mjs'));
  const store = new MemoryStore();
  const saveCalls = [];
  const handler = createSaveHandler({ store: () => store, salt: 'smoke', log: null });
  const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : { channel: 'chrome' }) });
  let ipN = 0;

  // A fresh browser profile (its own localStorage) on its own client IP.
  async function profile() {
    const ip = `10.20.0.${++ipN}`;
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await context.route('**/*', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      if (url.hostname !== '127.0.0.1') return route.abort();
      if (url.pathname === '/api/save') {
        const body = req.postData() || '';
        saveCalls.push({ ip, op: JSON.parse(body || '{}').op });
        const res = await handler(new Request('https://game.example/api/save', { method: req.method(), headers: { 'content-type': req.headers()['content-type'] || '' }, body: req.method() === 'POST' ? body : undefined }), { ip });
        return route.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
      }
      if (url.pathname.startsWith('/api/')) return route.abort();
      const file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
      if (path.relative(root, file).startsWith('..')) return route.abort();
      try {
        let body = await fs.readFile(file);
        if (url.pathname === '/js/main.js') body = Buffer.from(body.toString().replace('() => new Game()', '() => (globalThis.__game = new Game())'));
        await route.fulfill({ body, contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.mjs': 'text/javascript' })[path.extname(file)] || 'application/octet-stream' });
      } catch { await route.fulfill({ status: 404, body: 'Not found' }); }
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => {
      try { for (const k of ['vexolith_tutorial_seen', 'vexolith_intro_seen', 'vexolith_slot_tip_seen']) localStorage.setItem(k, '1'); } catch {}
    });
    const boot = async () => {
      await page.goto('http://127.0.0.1:8096');
      await page.locator('#splash-screen').waitFor({ state: 'visible' });
      await page.keyboard.press('Escape');
      await page.locator('#splash-screen').waitFor({ state: 'hidden' });
      await page.waitForFunction(() => globalThis.__game?.saves);
    };
    await boot();
    return { page, errors, context, ip, boot };
  }
  const progress = (page) => page.evaluate(() => {
    const d = __game.progression.data;
    return { cores: d.cores, damage: d.ranks.damage, weapons: [...d.unlocks.weapons].sort(), kills: d.unlocks.stats.kills || 0, runs: d.totalRuns };
  });
  const cloudState = (page) => page.evaluate(() => __game.saves.cloud.status());

  try {
    // 1. Pilot A: progress, first backup, the code card, the SAVE screen, export.
    const A = await profile();
    await A.page.evaluate(() => {
      const p = __game.progression;
      p.replaceData({ ...p.data, cores: 2500, totalRuns: 4, ranks: { ...p.data.ranks, damage: 3 }, paid: { ...p.data.paid, damage: 30 }, unlocks: { stats: { kills: 6000, veins: 40 }, weapons: ['grenades'], fresh: [] } });
      __game.saves.afterRun();
      return __game.saves.cloud.flush();
    });
    await A.page.waitForFunction(() => /^VX-/.test(__game.saves.cloud.status().code || ''));
    const code = (await cloudState(A.page)).code;
    if (!/^VX-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/.test(code)) throw Error('Bad recovery code: ' + code);
    if (!saveCalls.some((c) => c.ip === A.ip && c.op === 'create')) throw Error('The first backup should create the cloud save');
    const callout = A.page.locator('#cloud-code-title');
    await callout.waitFor({ state: 'visible' });
    if (!(await callout.innerText()).includes(code) || !/Write this down/i.test(await callout.innerText())) throw Error('The title should show the new code once, with a write-it-down line');
    await A.page.screenshot({ path: 'save-callout-smoke.png' });
    await callout.locator('[data-callout="ok"]').click();
    await callout.waitFor({ state: 'hidden' });
    await A.boot();
    if (await A.page.locator('#cloud-code-title').isVisible()) throw Error('The code card shows only once');
    await A.page.locator('#btn-title-save').click();
    const modal = A.page.locator('#save-modal');
    await modal.waitFor({ state: 'visible' });
    const shown = await modal.locator('[data-save-code]').innerText();
    if (shown === code || !shown.startsWith('VX-•')) throw Error('The code is masked until SHOW: ' + shown);
    await modal.locator('[data-save-action="show-code"]').click();
    if (await modal.locator('[data-save-code]').innerText() !== code) throw Error('SHOW reveals the code');
    if (!/WEAPONS 9\/20/.test(await A.page.locator('#save-summary').innerText())) throw Error('The SAVE screen should sum this device up: ' + await A.page.locator('#save-summary').innerText());
    await modal.locator('[data-save-action="export"]').click();
    const exported = await modal.locator('#save-export-text').inputValue();
    if (!/^VXSAVE1\./.test(exported)) throw Error('EXPORT SAVE should give a save code');
    const dl = A.page.waitForEvent('download');
    await modal.locator('[data-save-action="download"]').click();
    const file = await dl;
    if (!/^vexolith-save-\d{4}-\d{2}-\d{2}\.json$/.test(file.suggestedFilename())) throw Error('Download name: ' + file.suggestedFilename());
    await A.page.screenshot({ path: 'save-modal-smoke.png' });
    await A.page.keyboard.press('Escape');
    await modal.waitFor({ state: 'hidden' });
    const aProgress = await progress(A.page);

    // 2. Pilot B (fresh profile): restore from A's code.
    const B = await profile();
    await B.page.locator('#btn-title-save').click();
    const bm = B.page.locator('#save-modal');
    await bm.locator('#save-code-input').fill(code.toLowerCase().replace(/-/g, ' '));
    await bm.locator('[data-save-action="restore"]').click();
    await bm.locator('[data-save-action="use-other"]').waitFor();
    const compare = await bm.locator('.save-compare').innerText();
    if (!/2,500/.test(compare) || !/9\/20/.test(compare)) throw Error('The restore should show what the cloud save holds: ' + compare);
    if (await bm.locator('[data-save-action="merge"]').count()) throw Error('A fresh device has nothing to merge');
    await B.page.screenshot({ path: 'save-restore-smoke.png' });
    await Promise.all([B.page.waitForEvent('load'), bm.locator('[data-save-action="use-other"]').click()]);
    await B.page.locator('#splash-screen').waitFor({ state: 'visible' });
    await B.page.keyboard.press('Escape');
    await B.page.waitForFunction(() => globalThis.__game?.saves);
    const bProgress = await progress(B.page);
    if (JSON.stringify(bProgress) !== JSON.stringify(aProgress)) throw Error(`B should now have A's save: ${JSON.stringify(bProgress)} vs ${JSON.stringify(aProgress)}`);
    if ((await cloudState(B.page)).code !== code) throw Error('B now backs up under A\'s code');

    // 3. Pilot C (progress of its own): import A's export and merge.
    const C = await profile();
    await C.page.evaluate(() => {
      const p = __game.progression;
      p.replaceData({ ...p.data, cores: 400, totalRuns: 9, unlocks: { stats: { kills: 9000 }, weapons: ['gas'], fresh: [] } });
    });
    await C.page.locator('#btn-title-save').click();
    const cm = C.page.locator('#save-modal');
    await cm.locator('#save-import-text').fill(exported);
    await cm.locator('[data-save-action="import"]').click();
    await cm.locator('[data-save-action="merge"]').waitFor();
    if (!await cm.locator('[data-save-action="cancel"]').count()) throw Error('Import offers CANCEL');
    await Promise.all([C.page.waitForEvent('load'), cm.locator('[data-save-action="merge"]').click()]);
    await C.page.locator('#splash-screen').waitFor({ state: 'visible' });
    await C.page.keyboard.press('Escape');
    await C.page.waitForFunction(() => globalThis.__game?.saves);
    const merged = await progress(C.page);
    const wealth = await C.page.evaluate(() => { const d = __game.progression.data; return d.cores + Object.values(d.paid).reduce((a, c) => a + c, 0); });
    if (JSON.stringify(merged.weapons) !== JSON.stringify(['gas', 'grenades'])) throw Error('MERGE keeps both unlocks: ' + merged.weapons);
    if (merged.kills !== 9000 || merged.runs !== 9 || merged.damage !== 3) throw Error('MERGE keeps the higher counters and ranks: ' + JSON.stringify(merged));
    if (wealth !== 2530) throw Error(`MERGE keeps the larger wealth (2,530), never the sum: ${wealth}`);
    // A tampered code is turned away.
    await C.page.locator('#btn-title-save').click();
    await cm.locator('#save-import-text').fill(exported.slice(0, 40) + 'XX' + exported.slice(42));
    await cm.locator('[data-save-action="import"]').click();
    await cm.locator('.save-msg.tone-danger').waitFor();
    if (!/damaged/i.test(await cm.locator('.save-msg').innerText())) throw Error('A damaged code should be rejected');
    await C.page.keyboard.press('Escape');

    // 4. Cloud save off: nothing is sent.
    await C.page.locator('#btn-title-save').click();
    await cm.locator('[data-save-action="toggle-cloud"]').uncheck();
    await C.page.keyboard.press('Escape');
    const before = saveCalls.filter((c) => c.ip === C.ip).length;
    await C.page.evaluate(() => { __game.progression.addCores(5); __game.saves.afterRun(); return __game.saves.cloud.flush(); });
    await C.page.waitForTimeout(500);
    if (saveCalls.filter((c) => c.ip === C.ip).length !== before) throw Error('Cloud save off: no request');

    for (const p of [A, B, C]) if (p.errors.length) throw Error(p.errors.join('\n'));
    console.log('Save smoke PASS: first backup makes a recovery code (shown once, masked until SHOW), export code + .json download, restore on a fresh profile (summary, then USE: same cores, Armory and unlocks; backs up under that code), import + MERGE (both unlocks, higher counters, larger wealth, cores not doubled), a damaged code rejected, cloud save off sends nothing; no page errors.');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
