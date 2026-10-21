// Browser checks for the offline quiz. Skipped unless PLAYWRIGHT_CORE points at a
// playwright-core install:
//   PLAYWRIGHT_CORE=/path/to/node_modules/playwright-core \
//   CHROME_PATH=/usr/bin/chromium node --test "tests/*.test.mjs"

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const QUIZ = resolve(here, '..');
const SITE = resolve(QUIZ, '..');       // the repo root that GitHub Pages publishes
const PW = process.env.PLAYWRIGHT_CORE;
const skip = PW ? false : 'set PLAYWRIGHT_CORE to run the browser checks';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };

let server, browser, base;

before(async () => {
  if (skip) return;
  server = createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    let file = normalize(join(SITE, decodeURIComponent(pathname)));
    if (!file.startsWith(SITE)) return void res.writeHead(403).end();
    if (pathname.endsWith('/')) file = join(file, 'index.html');
    let body;
    try {
      body = await readFile(file);
    } catch {
      return void res.writeHead(404).end();
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  });
  await new Promise(ready => server.listen(0, '127.0.0.1', ready));
  base = `http://127.0.0.1:${server.address().port}/quiz/`;
  const { chromium } = createRequire(import.meta.url)(PW);
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH,
    args: ['--disable-gpu', '--disable-renderer-backgrounding',
           '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'],
  });
});

after(async () => {
  await browser?.close();
  server?.close();
});

// Opens a page online, waits until its service worker controls it, then cuts the network.
async function onlineThenOffline(path) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + path);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30000 });
  await context.setOffline(true);
  return { context, page, errors };
}

test('the app home page loads and renders with the network off', { skip }, async () => {
  const { context, page, errors } = await onlineThenOffline('home.html');
  await page.reload();
  assert.ok((await page.locator('body').innerText()).trim().length > 0, 'the home page rendered nothing offline');
  assert.deepEqual(errors, []);
  await context.close();
});

test('the directory URL /quiz/ loads with the network off', { skip }, async () => {
  const { context, page, errors } = await onlineThenOffline('');
  const response = await page.reload();
  assert.equal(response.status(), 200);
  assert.ok((await page.locator('body').innerText()).trim().length > 0, '/quiz/ rendered nothing offline');
  assert.deepEqual(errors, []);
  await context.close();
});

test('every bank image and question bank is served from the cache offline', { skip }, async () => {
  const { context, page, errors } = await onlineThenOffline('home.html');
  const catalog = JSON.parse(await readFile(join(QUIZ, 'catalog.json'), 'utf8'));
  const banks = [...new Set([...JSON.stringify(catalog).matchAll(/"file":"([^"]+)"/g)].map(m => m[1]))];
  const images = [];
  for (const bank of banks) {
    images.push(...[...(await readFile(join(QUIZ, bank), 'utf8')).matchAll(/"image":\s*"([^"]+)"/g)].map(m => m[1]));
  }
  const urls = [...new Set([...banks, ...images])];
  const statuses = await page.evaluate(async list => Promise.all(list.map(u => fetch(u).then(r => r.status, () => 0))), urls);
  const missing = urls.filter((_, i) => statuses[i] !== 200);
  assert.deepEqual(missing, [], 'these files were not available offline');
  assert.deepEqual(errors, []);
  await context.close();
});

test('the quiz does not delete another app\'s cache when it activates', { skip }, async () => {
  // Stands in for Minesweeper's cache, on the same origin. Created before the quiz's
  // worker exists, so the only thing that can remove it is the quiz's own cleanup.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(base + 'manifest.json');
  await page.evaluate(async () => (await caches.open('minesweeper-v2')).put('/kept', new Response('x')));

  await page.goto(base + 'home.html');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30000 });
  const names = await page.evaluate(async () => (await caches.keys()).sort());
  assert.ok(names.includes('minesweeper-v2'), `the quiz deleted another app's cache. Caches now: ${names.join(', ')}`);
  await context.close();
});
