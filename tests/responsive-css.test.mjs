// Static regression guard for the phone layout (360–390px). jsdom has no
// layout engine, so this asserts the rules that fixed the measured defects;
// the visual check was done in headless Chrome at 360x1021 and 390x1021.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8').replace(/\s+/g, ' ');
const phone = (css.match(/@media \(max-width: 560px\) \{(.*?)\} \s*$/s) || [])[1] || '';

test('file pickers cannot widen the page (Recruits horizontal overflow)', () => {
  assert.match(css, /input\[type='file'\] \{[^}]*max-width: 100%/);
  assert.match(css, /\.form-grid > \* \{ min-width: 0; \}/);
});

test('header wraps into explicit rows on phones and Sign out stays one line', () => {
  assert.match(css, /\.btn-sm, \.header-nav a \{ white-space: nowrap; \}/);
  assert.match(phone, /\.app-header-inner \{[^}]*flex-wrap: wrap/);
  assert.match(phone, /\.header-nav \{[^}]*order: 3;[^}]*flex: 1 0 100%/);
  assert.match(phone, /\.brand \{ flex: 1 1 0; \}/);
  assert.match(css, /\.brand-name \{[^}]*text-overflow: ellipsis/);
});

test('admin tabs wrap on phones instead of hiding the tail offscreen', () => {
  assert.match(phone, /\.tabs \{[^}]*flex-wrap: wrap/);
});

test('voting scale keeps the 2x5 phone grid', () => {
  assert.match(css, /@media \(min-width: 480px\) \{ \.rating-options \{ grid-template-columns: repeat\(10, 1fr\); \} \}/);
});

test('ratings chart spans the full card width with 10 equal columns', () => {
  assert.match(css, /\.chart-grid \{[^}]*display: grid;[^}]*grid-template-columns: repeat\(10, minmax\(0, 1fr\)\);[^}]*width: 100%;/);
  assert.match(css, /\.chart-col \{[^}]*min-width: 0;/);
  assert.match(css, /\.chart-bar \{[^}]*width: 100%;/);
  assert.doesNotMatch(css, /\.ratings-chart[^{]*\{[^}]*max-width/, 'chart is not capped to a fixed width');
});

test('Analytics headline stats are large and responsive, scoped to .stats-simple only', () => {
  assert.match(css, /\.stats-simple \.stat-value \{[^}]*font-size: clamp\(1\.75rem, 7vw, 3\.25rem\);[^}]*line-height: 1\.05;/);
  assert.match(css, /\.stats-simple \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}/);
  assert.match(css, /\.stats-simple \.stat \{[^}]*min-width: 0;/);
  assert.match(css, /\.stat-unit \{[^}]*font-size: 0\.45em;/, '/10 stays subordinate');
  assert.match(css, /\.stat-value \{ font-size: 1\.5rem;/, 'other app stats unchanged');
});

test('Analytics portrait is oversized: full width on phones, ~320–440px column on desktop, face-framed', () => {
  assert.match(css, /\.an-hero \{ display: grid; grid-template-columns: 1fr;/);
  assert.match(css, /@media \(min-width: 720px\) \{ \.an-hero \{ grid-template-columns: minmax\(0, clamp\(320px, 45%, 440px\)\) minmax\(0, 1fr\);/);
  assert.match(css, /\.an-portrait \{ width: 100%; aspect-ratio: 1 \/ 1;/);
  assert.match(css, /\.an-portrait img \{[^}]*object-fit: cover; object-position: 50% 20%;/);
});

test('Analytics recruit name and degree are large, responsive and wrap', () => {
  assert.match(css, /\.an-name \{ font-size: clamp\(2rem, 6vw, 3rem\);[^}]*overflow-wrap: anywhere;/);
  assert.match(css, /\.an-degree \{ font-size: clamp\(1\.25rem, 3\.5vw, 1\.65rem\);[^}]*overflow-wrap: anywhere;/);
  assert.match(css, /\.an-year \{ font-size: clamp\(1\.05rem, 2\.5vw, 1\.25rem\);/);
});
