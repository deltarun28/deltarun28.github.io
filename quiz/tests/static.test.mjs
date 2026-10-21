// Checks that need no browser: every precached file exists, every image and bank
// the quiz uses is precached, cleanup only touches this app's caches, and the
// release values match what the service worker says.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const QUIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const text = name => readFile(join(QUIZ, name), 'utf8');

// The service worker's precache list, as paths relative to the quiz folder.
async function precacheList() {
  const block = (await text('sw.js')).match(/const INSTALL_FILES = \[([\s\S]*?)\];/)[1];
  return [...block.matchAll(/'([^']+)'/g)].map(([, entry]) => posix.normalize(entry));
}

// Every image and bank the catalogue and the banks refer to.
async function referencedFiles() {
  const files = new Set(['catalog.json']);
  for (const name of (await readdir(join(QUIZ, 'banks'))).filter(n => n.endsWith('.json'))) {
    files.add(`banks/${name}`);
    for (const [, ref] of (await text(`banks/${name}`)).matchAll(/"image":\s*"([^"]+)"/g)) files.add(ref);
  }
  for (const [, ref] of (await text('catalog.json')).matchAll(/"file":\s*"([^"]+)"/g)) files.add(ref);
  for (const [, ref] of (await text('catalog.json')).matchAll(/"image":\s*"([^"]+)"/g)) files.add(ref);
  return files;
}

test('every precached file exists', async () => {
  for (const file of await precacheList()) {
    if (file === '.') continue;
    assert.ok(existsSync(join(QUIZ, file)), `precache lists a missing file: ${file}`);
  }
});

test('every image and bank the quiz uses is precached', async () => {
  const precache = new Set(await precacheList());
  for (const file of await referencedFiles()) {
    assert.ok(precache.has(file), `${file} is used by the quiz but not precached`);
  }
});

test('cleanup deletes only this app\'s older caches', async () => {
  const sw = await text('sw.js');
  assert.match(sw, /k\.startsWith\(CACHE_PREFIX\) && k !== CACHE/,
    'activate must only delete caches with this app\'s prefix');
});

test('the release values match the service worker', async () => {
  const sw = await text('sw.js');
  const version = sw.match(/\$\{CACHE_PREFIX\}(v\d+)`/)[1];

  const hash = createHash('sha256');
  const files = [...new Set((await precacheList()).map(f => (f === './' ? 'index.html' : f)))].sort();
  for (const file of files) {
    hash.update(file);
    hash.update(await readFile(join(QUIZ, file)));
  }

  const release = JSON.parse(await text('tests/release.json'));
  assert.deepEqual({ cacheVersion: version, precacheSha256: hash.digest('hex') }, release,
    'precached files or the cache version changed. Bump CACHE_VERSION, then record the new values in tests/release.json');
});
