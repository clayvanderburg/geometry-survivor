// PATCH NOTES screen: the changelog (js/changelog.js) in a modal over the title or pause screen.
// HTML is built by pure functions (tested in node); PatchNotesUI wires it into #notes-modal. The newest
// version is expanded at the top, older versions are collapsed below (their headers toggle them).
//
// "Seen" state: the last GAME_VERSION whose notes the player opened, in localStorage. While it differs
// from GAME_VERSION the PATCH NOTES buttons wear a glowing NEW badge; opening the notes clears it, and
// the versions the player hadn't seen yet are marked NEW inside. Storage may be blocked (private
// windows, strict settings): every access is guarded and the game boots without it.
import { CHANGELOG, NOTE_TYPES } from './changelog.js';
import { GAME_VERSION, compareVersions, isVersionString, versionLabel } from './version.js';

export const NOTES_SEEN_KEY = 'vexolith_patch_notes_seen';
export const NOTE_TYPE_LABELS = Object.freeze({ new: 'NEW', balance: 'BALANCE', fix: 'FIXES' });

export function defaultNotesStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

export function readSeenVersion(storage) {
  try {
    const value = storage?.getItem(NOTES_SEEN_KEY);
    return typeof value === 'string' && value ? value : null;
  } catch {
    return null;
  }
}

export function writeSeenVersion(storage, version) {
  try {
    if (!storage) return false;
    storage.setItem(NOTES_SEEN_KEY, version);
    return true;
  } catch {
    return false;
  }
}

// The NEW badge rule: anything other than the current version (including "never opened") is unseen.
export function hasUnseenNotes(seen, current = GAME_VERSION) {
  return seen !== current;
}

// Versions to mark NEW inside the notes: everything newer than the last version seen. A first-time
// player (nothing seen) gets just the newest one marked, not the whole history.
export function freshVersions(seen, changelog = CHANGELOG) {
  if (!changelog.length) return [];
  if (!isVersionString(seen)) return [changelog[0].version];
  return changelog.filter(entry => compareVersions(entry.version, seen) > 0).map(entry => entry.version);
}

// Notes grouped by type in NOTE_TYPES order: [{ type, label, items: [text] }], empty groups dropped.
export function groupNotes(notes) {
  return NOTE_TYPES
    .map(type => ({ type, label: NOTE_TYPE_LABELS[type], items: (notes || []).filter(n => n.type === type).map(n => n.text) }))
    .filter(group => group.items.length);
}

const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const sectionsId = (version) => 'notes-v-' + String(version).replace(/[^0-9a-z]/gi, '-');
const changeCount = (n) => `${n} CHANGE${n === 1 ? '' : 'S'}`;

export function notesEntryHTML(entry, { open = false, fresh = false, latest = false } = {}) {
  const groups = groupNotes(entry.notes);
  const id = sectionsId(entry.version);
  const cls = `notes-entry${open ? ' open' : ''}${fresh ? ' fresh' : ''}${latest ? ' latest' : ''}`;
  const sections = groups.map(g => `<section class="notes-sec notes-sec-${g.type}" data-gp-nav tabindex="0">
      <h4 class="notes-sec-title">${esc(g.label)}</h4><ul>${g.items.map(t => `<li>${esc(t)}</li>`).join('')}</ul></section>`).join('');
  return `<article class="${cls}" data-version="${esc(entry.version)}">
    <button type="button" class="notes-head" data-notes-toggle="${esc(entry.version)}" aria-expanded="${open}" aria-controls="${id}">
      <span class="notes-ver">${esc(versionLabel(entry.version))}</span>
      <span class="notes-name">${esc(entry.title)}</span>
      <span class="notes-flags">${latest ? '<span class="notes-current">CURRENT</span>' : ''}${fresh ? '<span class="notes-new-badge">NEW</span>' : ''}</span>
      <span class="notes-date">${esc(entry.date)}</span>
      <span class="notes-count">${changeCount((entry.notes || []).length)}</span>
      <span class="notes-caret" aria-hidden="true">▾</span>
    </button>
    <div class="notes-sections" id="${id}"${open ? '' : ' hidden'}>${sections}</div></article>`;
}

// The whole list, newest first. `expanded` and `fresh` are sets of versions.
export function patchNotesHTML(changelog = CHANGELOG, { expanded = new Set(), fresh = new Set() } = {}) {
  return changelog.map((entry, i) => notesEntryHTML(entry, {
    open: expanded.has(entry.version),
    fresh: fresh.has(entry.version),
    latest: i === 0
  })).join('');
}

// DOM controller for #notes-modal. Opening marks the current version as seen (in memory even when
// storage is blocked, so the badge still clears for this session).
export class PatchNotesUI {
  constructor({ storage = defaultNotesStorage(), changelog = CHANGELOG, current = GAME_VERSION, onClose = null } = {}) {
    this.storage = storage;
    this.changelog = changelog;
    this.current = current;
    this.onClose = onClose;
    this.seen = readSeenVersion(storage);
    this.isOpen = false;
    this.root = null;
    this.body = null;
  }

  hasNew() {
    return hasUnseenNotes(this.seen, this.current);
  }

  // DOM is looked up on first open, so the badge logic above works without a document.
  bind() {
    if (this.root) return true;
    this.root = document.getElementById('notes-modal');
    this.body = document.getElementById('notes-body');
    if (!this.root || !this.body) return false;
    this.body.addEventListener('click', (e) => {
      const head = e.target.closest?.('[data-notes-toggle]');
      if (head) this.toggle(head.dataset.notesToggle);
    });
    document.getElementById('btn-notes-close')?.addEventListener('click', () => this.close());
    return true;
  }

  open() {
    if (this.isOpen || !this.bind()) return false;
    const fresh = new Set(freshVersions(this.seen, this.changelog));
    const expanded = new Set([this.changelog[0]?.version, ...fresh]);
    this.body.innerHTML = patchNotesHTML(this.changelog, { expanded, fresh });
    this.body.scrollTop = 0;
    this.isOpen = true;
    this.root.classList.remove('hidden');
    this.seen = this.current;
    writeSeenVersion(this.storage, this.current);
    return true;
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.add('hidden');
    this.onClose?.();
  }

  // Expands or collapses one version in place (no re-render, so keyboard/controller focus stays put).
  toggle(version) {
    const article = this.body?.querySelector(`.notes-entry[data-version="${version}"]`);
    if (!article) return false;
    const open = !article.classList.contains('open');
    article.classList.toggle('open', open);
    article.querySelector('.notes-head')?.setAttribute('aria-expanded', String(open));
    const sections = article.querySelector('.notes-sections');
    if (sections) sections.hidden = !open;
    return open;
  }

  firstHead() {
    return this.body?.querySelector('.notes-head') || null;
  }

  scrollBy(dy) {
    if (this.body) this.body.scrollTop += dy;
  }
}
