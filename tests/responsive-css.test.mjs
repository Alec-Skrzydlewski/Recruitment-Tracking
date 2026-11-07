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
