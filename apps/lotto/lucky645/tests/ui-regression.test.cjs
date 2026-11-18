'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'assets/app.css'), 'utf8');

test('all seven app sections are reachable from the mobile navigation', () => {
  const navStart = html.indexOf('<nav class="mobile-nav"');
  assert.notEqual(navStart, -1, 'mobile navigation must exist');
  const navEnd = html.indexOf('</nav>', navStart);
  assert.notEqual(navEnd, -1, 'mobile navigation must be closed');
  const nav = html.slice(navStart, navEnd);
  const pages = [...nav.matchAll(/data-page="([^"]+)"/g)].map(match => match[1]);

  assert.equal(pages.length, 7, 'all seven sections should be represented');
  assert.equal(new Set(pages).size, 7, 'navigation targets should be unique');
  for (const page of pages) {
    assert.ok(html.includes(`id="page-${page}"`), `missing page container for ${page}`);
  }
  assert.match(nav, /aria-label="주요 메뉴"/, 'mobile navigation needs an accessible label');
});

test('mobile navigation stays visible and respects device safe areas', () => {
  assert.match(css, /@media\s*\(max-width:\s*760px\)/);
  assert.match(css, /\.mobile-nav\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /\.mobile-nav button\.active/);
});

test('interactive controls have a visible keyboard focus state', () => {
  assert.match(css, /:focus-visible/);
  assert.match(css, /outline:\s*2px solid var\(--lime\)/);
});

test('layout includes reduced-motion and compact-phone adaptations', () => {
  assert.match(css, /@media\s*\(max-width:\s*420px\)/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test('status updates are announced to assistive technology', () => {
  assert.match(html, /id="dataStatus"[^>]*role="status"[^>]*aria-live="polite"/);
});

test('HTML element IDs are unique and every app.js DOM lookup exists', () => {
  const app = fs.readFileSync(path.join(root, 'assets/app.js'), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
  assert.equal(new Set(ids).size, ids.length, 'HTML IDs must be unique');
  const idSet = new Set(ids);
  const lookups = [...app.matchAll(/\$\(['"]([^'"]+)['"]\)/g)].map(match=>match[1]);
  const missing = [...new Set(lookups.filter(id=>!idSet.has(id)))];
  assert.deepEqual(missing, [], 'all literal app.js DOM lookups must exist in index.html');
});

test('static JavaScript uses an explicit cache-busting version', () => {
  assert.match(html, /<script defer src="\/assets\/app\.js\?v=20261118-integrity-audit-1"><\/script>/);
});

test('deployment adds clickjacking and cross-domain policy protection', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
  const globalHeaders = config.headers.find(item=>item.source==='/(.*)')?.headers || [];
  const values = Object.fromEntries(globalHeaders.map(item=>[item.key.toLowerCase(),item.value]));
  assert.equal(values['x-frame-options'],'DENY');
  assert.equal(values['x-permitted-cross-domain-policies'],'none');
});
