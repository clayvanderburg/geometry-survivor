// Game version + changelog: one source of truth (js/version.js), patch notes newest first (js/changelog.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GAME_VERSION, VERSIONED_SINCE, LEGACY_VERSION_LABEL, compareVersions, isVersionString, parseVersion, versionLabel
} from '../js/version.js';
import { CHANGELOG, NOTE_TYPES, KNOWN_VERSIONS, changelogEntry } from '../js/changelog.js';
import { BOARD_VERSIONS, isBoardVersion } from '../js/leaderboard-rules.js';

test('GAME_VERSION is the newest changelog entry', () => {
  assert.ok(isVersionString(GAME_VERSION), GAME_VERSION);
  assert.equal(GAME_VERSION, CHANGELOG[0].version, 'bump GAME_VERSION and add its CHANGELOG entry together');
});

test('changelog versions are unique, valid semver and strictly descending; dates newest first', () => {
  const versions = CHANGELOG.map(e => e.version);
  assert.equal(new Set(versions).size, versions.length, 'duplicate version');
  for (const v of versions) assert.ok(isVersionString(v), `not x.y.z: ${v}`);
  for (let i = 1; i < CHANGELOG.length; i++) {
    const [newer, older] = [CHANGELOG[i - 1], CHANGELOG[i]];
    assert.ok(compareVersions(newer.version, older.version) > 0, `${newer.version} must come before ${older.version}`);
    assert.ok(newer.date >= older.date, `${newer.version} is dated before ${older.version}`);
  }
  assert.deepEqual(KNOWN_VERSIONS, versions);
  assert.equal(changelogEntry(GAME_VERSION), CHANGELOG[0]);
  assert.equal(changelogEntry('9.9.9'), null);
});

test('every entry has a date, a title and a handful of typed, player-facing notes', () => {
  for (const entry of CHANGELOG) {
    assert.match(entry.date, /^\d{4}-\d{2}-\d{2}$/, entry.version);
    assert.ok(!Number.isNaN(Date.parse(entry.date)), entry.version);
    assert.ok(typeof entry.title === 'string' && entry.title.trim().length > 0, entry.version);
    assert.ok(Array.isArray(entry.notes) && entry.notes.length >= 1 && entry.notes.length <= 8, `${entry.version}: 1-8 notes`);
    for (const note of entry.notes) {
      assert.ok(NOTE_TYPES.includes(note.type), `${entry.version}: unknown note type ${note.type}`);
      assert.ok(typeof note.text === 'string' && note.text.length >= 10 && note.text.length <= 180, `${entry.version}: ${note.text}`);
      // Written for players: no file names or code identifiers.
      assert.doesNotMatch(note.text, /\.(js|mjs|css|html)\b|TUNING|\w+\(\)|_[a-z]/, `${entry.version}: dev jargon in "${note.text}"`);
    }
  }
});

test('versioned leaderboards start at VERSIONED_SINCE and always include the current version', () => {
  assert.ok(KNOWN_VERSIONS.includes(VERSIONED_SINCE));
  assert.ok(BOARD_VERSIONS.includes(GAME_VERSION));
  assert.ok(BOARD_VERSIONS.every(v => compareVersions(v, VERSIONED_SINCE) >= 0));
  assert.ok(isBoardVersion(GAME_VERSION));
  assert.ok(!isBoardVersion(CHANGELOG.at(-1).version), 'the prototype never had a board');
  assert.equal(LEGACY_VERSION_LABEL, `pre-${VERSIONED_SINCE.split('.').slice(0, 2).join('.')}`);
});

test('version helpers: semver compare, parse and labels', () => {
  assert.deepEqual(parseVersion('0.10.2'), [0, 10, 2]);
  assert.equal(parseVersion('1.0'), null);
  assert.equal(parseVersion('01.0.0'), null);
  assert.ok(compareVersions('0.10.0', '0.9.9') > 0, 'numeric, not string, order');
  assert.ok(compareVersions('1.0.0', '0.99.99') > 0);
  assert.equal(compareVersions('0.9.0', '0.9.0'), 0);
  assert.ok(compareVersions('junk', '0.0.1') < 0, 'junk sorts last');
  assert.equal(versionLabel('0.9.0'), 'v0.9.0');
  assert.equal(versionLabel(null), LEGACY_VERSION_LABEL);
  assert.equal(versionLabel(undefined), LEGACY_VERSION_LABEL);
});

test('README documents the version bump rule', () => {
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /GAME_VERSION/);
  assert.match(readme, /js\/changelog\.js/);
});
