// Wires the SAVE screen and the cloud save into the game (kept out of main.js): the 💾 SAVE buttons,
// automatic backups (after a run, after an Armory change, at launch when one is still pending), the
// one-time recovery-code card, and the one request for persistent storage after the first run.
import { CloudSave } from './cloud-save.js';
import { SaveUI, renderCodeCallout } from './save-ui.js';
import { buildBundle, readSettings, sanitizeSettings } from './save-transfer.js';
import { GAME_VERSION } from './version.js';

export const PERSIST_ASKED_KEY = 'vexolith_persist_asked';

const storage = () => { try { return globalThis.localStorage || null; } catch { return null; } };

// Asks the browser once (after the first finished run) to keep this site's data when it clears storage
// under pressure (Safari's 7-day eviction, a full disk). Never asked again, whatever the answer.
export function requestPersistentStorage(store = storage(), nav = globalThis.navigator) {
  try {
    if (!nav?.storage?.persist || store?.getItem(PERSIST_ASKED_KEY)) return false;
    store?.setItem(PERSIST_ASKED_KEY, '1');
    nav.storage.persist().catch(() => {});
    return true;
  } catch { return false; }
}

export function attachSaves(game) {
  const doc = globalThis.document;
  const prog = game.progression;
  const bundle = () => buildBundle({ save: prog.data, settings: readSettings(storage()), version: GAME_VERSION });
  const cloud = new CloudSave({
    getBundle: bundle,
    applyMerged: (save) => { prog.replaceData(save); game.renderHubUI?.(); },
    onChange: () => { renderCallouts(); if (ui.isOpen) ui.render(); }
  });
  const apply = ({ save, settings }) => {
    prog.onSave = null; // a replaced save is backed up after the reload, under the code it now belongs to
    prog.replaceData(save);
    const s = storage();
    for (const [k, v] of Object.entries(sanitizeSettings(settings))) { try { s?.setItem(k, v); } catch { /* blocked */ } }
    globalThis.location?.reload?.();
  };
  const root = doc?.getElementById('save-modal');
  const ui = new SaveUI({
    root, cloud, version: GAME_VERSION, apply,
    getSave: () => prog.data,
    getSettings: () => readSettings(storage()),
    onClose: () => game.onSaveClosed?.()
  });
  const renderCallouts = () => {
    for (const id of ['cloud-code-title', 'cloud-code-go']) renderCodeCallout(doc?.getElementById(id), cloud);
  };
  prog.onSave = () => cloud.noteChange();
  for (const btn of doc?.querySelectorAll?.('[data-open-save]') || []) btn.addEventListener('click', () => game.openSave?.());
  if (cloud.state.dirty) cloud.backupSoon();
  renderCallouts();

  return {
    cloud,
    ui,
    renderCallouts,
    // After a finished run: persistent storage (once) and a backup.
    afterRun() {
      requestPersistentStorage();
      cloud.backupSoon();
    },
    afterArmoryChange() {
      cloud.backupSoon();
    }
  };
}
