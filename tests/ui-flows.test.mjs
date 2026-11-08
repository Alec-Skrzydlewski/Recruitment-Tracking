// Integration tests: real React components in jsdom against the in-memory
// demo backend. All network APIs are replaced with tripwires; any request
// fails the test, which demonstrates that the demo runtime is isolated.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build, stop } from 'esbuild';
import { JSDOM } from 'jsdom';

const network = [];
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage', 'sessionStorage', 'location', 'history']) {
  Object.defineProperty(globalThis, key, { value: window[key], configurable: true, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// React's scheduler opens MessageChannel ports; track them so they can be
// closed after the tests and the process can exit.
const channels = [];
const NativeChannel = globalThis.MessageChannel;
globalThis.MessageChannel = class extends NativeChannel {
  constructor() { super(); channels.push(this); }
};
const trip = name => function () { network.push(name); throw new Error('network access in test: ' + name); };
globalThis.fetch = trip('fetch');
window.fetch = globalThis.fetch;
window.XMLHttpRequest = trip('XMLHttpRequest');
window.WebSocket = trip('WebSocket');
window.EventSource = trip('EventSource');
window.navigator.sendBeacon = trip('sendBeacon');
window.confirm = () => true;
const origAppend = window.HTMLHeadElement.prototype.appendChild;
window.HTMLHeadElement.prototype.appendChild = function (el) {
  if (el && el.tagName === 'SCRIPT') network.push('script:' + el.src);
  return origAppend.call(this, el);
};

const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rt-ui-')), 'bundle.mjs');
async function loadBundle(mode) {
  await build({
    entryPoints: [new URL('./ui/entry.jsx', import.meta.url).pathname],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    outfile,
    jsx: 'automatic',
    loader: { '.js': 'jsx', '.jpg': 'dataurl' },
    define: {
      'import.meta.env.VITE_APP_MODE': JSON.stringify(mode),
      'import.meta.env.VITE_GOOGLE_CLIENT_ID': 'undefined',
      'import.meta.env.VITE_APPS_SCRIPT_URL': 'undefined',
      'process.env.NODE_ENV': '"test"',
    },
    logLevel: 'silent',
  });
  return import(pathToFileURL(outfile).href + '?' + Date.now());
}

const ui = await loadBundle('demo');
after(() => { stop(); window.close(); channels.forEach(c => { c.port1.close(); c.port2.close(); }); fs.rmSync(path.dirname(outfile), { recursive: true, force: true }); });
const { act, createElement, createRoot } = ui;

async function settle(ms = 0) {
  await act(async () => { await new Promise(r => setTimeout(r, ms)); });
}

async function until(fn, label, tries = 60) {
  for (let i = 0; i < tries; i++) {
    const v = fn();
    if (v) return v;
    await settle(5);
  }
  throw new Error('timed out waiting for ' + label + '\n' + document.body.textContent.slice(0, 600));
}

function byText(selector, text) {
  return [...document.querySelectorAll(selector)].find(el => el.textContent.includes(text));
}

async function click(el) {
  await act(async () => { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
}

async function type(el, value) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
}

function mount(element) {
  window.history.replaceState(null, '', '/');
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.getElementById('root'));
  act(() => root.render(element));
  return root;
}

test('demo opens directly on the admin dashboard: no landing, no persona chooser, no sign-in', async () => {
  const backend = ui.createDemoBackend({ latencyMs: 0 });
  const root = mount(createElement(ui.DemoApp, { backend }));
  await until(() => byText('h1', 'Recruitment overview'), 'admin dashboard first');
  assert.equal(window.location.pathname, '/admin');
  assert.equal(document.querySelector('.persona, .persona-grid'), null);
  assert.equal(/Try it as|Switch persona|persona/i.test(document.body.textContent), false);
  assert.equal(/Sign in|Sign out/i.test(document.body.textContent), false);
  assert.ok(byText('.demo-ribbon', 'Demo'));
  assert.ok(byText('.header-nav a', 'Vote'));
  act(() => root.unmount());
  assert.deepEqual(network, []);
});

const VOTER = { email: 'riley.member@example.test', name: 'Riley Brooks', role: 'brother' };

test('demo: voter → vote saves → admin sees it → wipe guard → reset; zero network', async () => {
  const backend = ui.createDemoBackend({ latencyMs: 0 });
  let root = mount(createElement(ui.DemoApp, { backend, user: VOTER }));
  await until(() => byText('h1', 'Rate recruits'), 'vote page');
  assert.equal(window.location.pathname, '/vote');
  const select = document.getElementById('vote-event');
  assert.ok(document.querySelector('label[for="vote-event"]'));
  assert.equal(select.value, 'e-pro', 'defaults to the latest event');
  assert.match(select.querySelector('option[value="e-info"]').textContent, /Info Night — Sep 8, 2026/);
  assert.equal(select.querySelector('option[value="e-pro"]').textContent, 'Professional Night', 'undated option unchanged');

  const radio = document.querySelector('input[aria-label="8 for Avery Quill"]');
  assert.ok(radio, 'rating options are labelled per recruit');
  await click(radio);
  await until(() => byText('.status-saved', 'Saved'), 'vote saved');
  const stored = backend.snapshot().votes.find(v => v.userEmail === 'riley.member@example.test' && v.recruitId === 'r-avery' && v.eventId === 'e-pro');
  assert.equal(stored.score, 8);
  assert.equal(document.querySelectorAll('fieldset.rating').length, 5, 'only attendees of the selected event are shown');

  act(() => root.unmount());
  root = mount(createElement(ui.DemoApp, { backend }));
  await until(() => byText('h1', 'Recruitment overview'), 'admin dashboard');
  assert.equal(/exclud/i.test(document.body.textContent), false, 'no excluded-vote category in the UI');

  await click(byText('button[role="tab"]', 'Settings'));
  assert.equal(/exclud|as history/i.test(document.body.textContent), false);
  const votesBefore = backend.snapshot().votes.length;
  await click(byText('button', 'Check for invalid votes'));
  await until(() => byText('[role="status"] p', '1 invalid vote'), 'cleanup preview');
  assert.equal(backend.snapshot().votes.length, votesBefore, 'checking does not delete');
  await click(byText('button', 'Permanently delete 1 invalid vote'));
  await until(() => byText('.banner', 'Permanently deleted 1 invalid vote'), 'cleanup done');
  assert.equal(backend.snapshot().votes.length, votesBefore - 1);
  assert.equal(backend.snapshot().votes.some(v => v.eventId === 'e-retired'), false);

  await click(byText('button[role="tab"]', 'Events'));
  assert.equal(document.getElementById('event-name').placeholder, 'e.g. Info Session', 'new-event example');
  const dateInput = document.getElementById('event-date');
  assert.equal(dateInput.type, 'date', 'native calendar date picker');
  assert.match(document.querySelector('label[for="event-date"]').textContent, /Date \(optional\)/);
  assert.ok(byText('.event-date', 'Date not set'), 'legacy undated event reads safely');
  assert.ok(byText('.event-date', 'Sep 8, 2026'), 'dated seed event shows its date');
  await type(document.getElementById('event-name'), 'Leap Mixer');
  await type(dateInput, '2028-02-29');
  await click(byText('button', 'Add event'));
  await until(() => backend.snapshot().events.some(e => e.name === 'Leap Mixer' && !String(e.id).startsWith('tmp')), 'dated event saved');
  assert.equal(backend.snapshot().events.find(e => e.name === 'Leap Mixer').date, '2028-02-29');
  await until(() => byText('.event-date', 'Feb 29, 2028'), 'date rendered from parts');
  assert.equal(dateInput.value, '', 'picker cleared after add');
  const firstEvent = backend.snapshot().events[0];
  const eventVotes = backend.snapshot().votes.filter(v => v.eventId === firstEvent.id).length;
  const prompts = [];
  const savedConfirm = globalThis.confirm;
  window.confirm = globalThis.confirm = msg => { prompts.push(msg); return true; };
  await click(document.querySelector(`button[aria-label="Delete event ${firstEvent.name}"]`));
  await until(() => !backend.snapshot().events.some(e => e.id === firstEvent.id), 'event deleted');
  window.confirm = globalThis.confirm = savedConfirm;
  assert.match(prompts[0], new RegExp(`permanently deletes ${eventVotes} vote`));
  assert.equal(backend.snapshot().votes.some(v => v.eventId === firstEvent.id), false);

  await click(byText('button[role="tab"]', 'Settings'));
  const wipeButton = byText('button', 'Wipe cycle data');
  assert.equal(wipeButton.disabled, true, 'wipe requires typed confirmation');
  await type(document.getElementById('wipe-confirm'), 'WIPE CYCLE');
  assert.equal(byText('button', 'Wipe cycle data').disabled, false);
  // The event delete above changed cycle data since load: first attempt is
  // refused and the page reloads; the second attempt uses the fresh state.
  await click(byText('button', 'Wipe cycle data'));
  await until(() => byText('.banner', 'Nothing was wiped'), 'stale wipe refused');
  assert.ok(backend.snapshot().recruits.length > 0);
  await click(byText('button', 'Wipe cycle data'));
  await until(() => byText('.banner', 'Cycle wiped'), 'wipe done');
  assert.equal(backend.snapshot().recruits.length, 0);
  assert.equal(backend.snapshot().users.length, 8);

  await click(byText('.demo-ribbon button', 'Reset'));
  await until(() => backend.snapshot().recruits.length === 6 && byText('h1', 'Recruitment overview'), 'reset');

  act(() => root.unmount());
  assert.deepEqual(network, []);
});

test('demo: a failed vote rolls back, explains, and retries on request', async () => {
  const backend = ui.createDemoBackend({ latencyMs: 0 });
  let failNext = true;
  const flaky = {
    ...backend,
    call(email, action, extra) {
      if (action === 'castVote' && failNext) {
        failNext = false;
        return Promise.reject(new Error('Could not reach the server. Check your connection and try again.'));
      }
      return backend.call(email, action, extra);
    },
  };
  const root = mount(createElement(ui.DemoApp, { backend: flaky, user: VOTER }));
  await until(() => byText('h1', 'Rate recruits'), 'vote page');
  await click(document.querySelector('input[aria-label="6 for Casey Lark"]'));
  const alert = await until(() => byText('[role="alert"]', 'Not saved'), 'failure message');
  assert.match(alert.textContent, /Could not reach the server/);
  assert.equal(document.querySelector('input[aria-label="6 for Casey Lark"]').checked, false, 'optimistic choice rolled back');
  await click(byText('button', 'Retry 6'));
  await until(() => byText('.status-saved', 'Saved'), 'retry saved');
  assert.equal(document.querySelector('input[aria-label="6 for Casey Lark"]').checked, true);
  act(() => root.unmount());
  assert.deepEqual(network, []);
});

test('demo: admin note save failure keeps the draft', async () => {
  const backend = ui.createDemoBackend({ latencyMs: 0 });
  const flaky = { ...backend, call(email, action, extra) { return action === 'saveNote' ? Promise.reject(new Error('The server is busy. Try again in a moment.')) : backend.call(email, action, extra); } };
  const root = mount(createElement(ui.DemoApp, { backend: flaky }));
  await choose(await until(() => document.getElementById('an-recruit'), 'analytics first'), 'r-blake');
  await until(() => document.getElementById('note-r-blake'), 'notes on analytics');
  await type(document.getElementById('note-r-blake'), 'Great follow-up questions');
  const save = [...document.querySelectorAll('button')].filter(b => b.textContent === 'Save note').find(b => !b.disabled);
  await click(save);
  await until(() => byText('[role="alert"]', 'Note not saved'), 'note error');
  assert.equal(document.getElementById('note-r-blake').value, 'Great follow-up questions');
  act(() => root.unmount());
  assert.deepEqual(network, []);
});

test('live build without configuration fails closed and makes no requests', async () => {
  const root = mount(createElement(ui.LiveApp));
  await until(() => byText('h2', 'App not configured'), 'config screen');
  act(() => root.unmount());
  assert.deepEqual(network, []);
});

async function choose(el, value) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
}

async function go(url) {
  await act(async () => {
    window.history.pushState(null, '', url);
    window.dispatchEvent(new window.PopStateEvent('popstate'));
  });
}

test('analytics: one recruit dropdown, individual results, switching changes every detail', async () => {
  const backend = ui.createDemoBackend({ latencyMs: 0 });
  const root = mount(createElement(ui.DemoApp, { backend }));
  const select = await until(() => document.getElementById('an-recruit'), 'analytics is the default admin tab');
  assert.equal(byText('button[role="tab"]', 'Dashboard'), undefined, 'no Dashboard tab');
  assert.equal(document.querySelector('button[role="tab"]').textContent, 'Analytics');
  await click(byText('button[role="tab"]', 'Analytics'));
  assert.equal(new URLSearchParams(window.location.search).get('tab'), 'analytics', 'tab is linkable');

  // Exactly one control: the recruit dropdown. No cohort tables or filters.
  const panel = document.querySelector('.analytics');
  assert.equal(panel.querySelectorAll('select').length, 1);
  assert.equal(panel.querySelectorAll('input').length, 0);
  for (const gone of ['Recruit comparison', 'Event comparison', 'Voter participation', 'Reset filters', 'Completion', 'Rank']) {
    assert.equal(panel.textContent.includes(gone), false, gone);
  }
  assert.equal(/exclud/i.test(document.body.textContent), false);

  const labels = [...select.options].map(o => o.textContent);
  assert.deepEqual(labels, [...labels].sort((x, y) => x.localeCompare(y)), 'alphabetical');
  assert.equal(labels.length, 6);
  assert.equal(select.value, 'r-avery', 'defaults to the first recruit, never empty');
  assert.equal(document.getElementById('an-detail').textContent, 'Avery Quill');

  const snapshot = () => ({
    stats: [...panel.querySelectorAll('.stat')].map(s => s.textContent).join('|'),
    events: document.querySelector('[aria-label^="Event results"]').textContent,
    note: document.querySelector('textarea[id^="note-"]').value,
    meta: panel.querySelector('#an-detail + p, .row + p').textContent,
  });
  const avery = snapshot();
  assert.match(avery.stats, /8\.2 \/10Average score\|5Members who voted\|3Events attended/);
  for (const jargon of ['Mean', 'Median', 'SD', 'Ballots', 'Unique voters', 'Equal-event', 'Score distribution', 'Scores 1–10', 'How these numbers']) {
    assert.equal(panel.textContent.includes(jargon), false, 'no ' + jargon);
  }
  assert.equal(panel.querySelectorAll('table, figure.hist').length, 0, 'no dense tables');
  const chart = panel.querySelector('figure.ratings-chart .chart-grid[role="img"]');
  assert.ok(chart, 'simple ratings chart shown');
  assert.equal(chart.querySelectorAll('.chart-col').length, 10, 'all 10 score columns');
  assert.deepEqual([...chart.querySelectorAll('.chart-axis')].map(a => a.textContent), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
  assert.match(avery.note, /audit rotation/);
  assert.equal(document.getElementById('note-r-avery').labels[0].textContent, 'Notes on Avery Quill');
  await choose(select, 'r-finley');
  await until(() => document.getElementById('an-detail').textContent === 'Finley Moss', 'switched');
  const finley = snapshot();
  for (const k of Object.keys(avery)) assert.notEqual(finley[k], avery[k], k + ' changed');
  assert.equal(panel.textContent.includes('Avery Quill'), true, 'only as a dropdown option');
  assert.equal(document.getElementById('note-r-avery'), null, 'previous recruit note not shown');
  assert.equal(document.querySelectorAll('textarea[id^="note-"]').length, 1);
  assert.equal([...document.querySelectorAll('button')].some(b => /export|csv/i.test(b.textContent)), false, 'no Analytics export');
  assert.equal(document.querySelector('.an-name').textContent, 'Finley Moss');
  await type(document.getElementById('note-r-finley'), 'Asked good questions');
  await click(byText('button', 'Save note'));
  await until(() => backend.snapshot().notes.some(n => n.recruitId === 'r-finley' && n.content === 'Asked good questions'), 'note saved');
  assert.match(backend.snapshot().notes.find(n => n.recruitId === 'r-avery').content, /audit rotation/, 'other note untouched');
  await go('/admin?tab=dashboard');
  await until(() => document.getElementById('an-recruit'), 'legacy dashboard link lands on Analytics');

  // Deleting the selected recruit falls back to the first remaining recruit.
  await click(byText('button[role="tab"]', 'Recruits'));
  window.confirm = globalThis.confirm = () => true;
  await click(document.querySelector('button[aria-label="Remove Finley Moss"]'));
  await until(() => !backend.snapshot().recruits.some(r => r.id === 'r-finley'), 'deleted');
  await click(byText('button[role="tab"]', 'Analytics'));
  await until(() => document.getElementById('an-recruit') && document.getElementById('an-recruit').value === 'r-avery', 'fallback');
  act(() => root.unmount());
  assert.deepEqual(network, []);
});

test('analytics: with no recruits it explains instead of showing an empty select', async () => {
  const backend = ui.createDemoBackend({ latencyMs: 0 });
  const empty = { ...backend, call(email, action, extra) {
    return backend.call(email, action, extra).then(r => (action === 'getAdminData' ? { ...r, recruits: [], attendance: [], votes: [], notes: [] } : r));
  } };
  const root = mount(createElement(ui.DemoApp, { backend: empty }));
  await until(() => byText('button[role="tab"]', 'Analytics'), 'admin tabs');
  await click(byText('button[role="tab"]', 'Analytics'));
  await until(() => byText('p', 'No recruits yet'), 'empty state');
  assert.equal(document.getElementById('an-recruit'), null);
  act(() => root.unmount());
  assert.deepEqual(network, []);
});

test('analytics: voters cannot reach it; an admin read failure shows an error, not empty stats', async () => {
  const backend = ui.createDemoBackend({ latencyMs: 0 });
  let root = mount(createElement(ui.DemoApp, { backend, user: VOTER }));
  await until(() => byText('h1', 'Rate recruits'), 'vote page');
  await go('/admin?tab=analytics');
  await until(() => window.location.pathname === '/vote', 'voter redirected');
  assert.equal(document.body.textContent.includes('Recruit comparison'), false);
  act(() => root.unmount());

  const failing = { ...backend, call(email, action, extra) { return action === 'getAdminData' ? Promise.reject(new Error('The server is busy. Try again in a moment.')) : backend.call(email, action, extra); } };
  root = mount(createElement(ui.DemoApp, { backend: failing }));
  await until(() => byText('h2, h1', "Couldn't load admin data") || byText('*', "Couldn't load admin data"), 'read failure');
  assert.equal(document.body.textContent.includes('Recruit comparison'), false);
  act(() => root.unmount());
  assert.deepEqual(network, []);
});

test('add recruit requires a graduation year: labelled, required, nothing written without it', async () => {
  const backend = ui.createDemoBackend({ latencyMs: 0 });
  const root = mount(createElement(ui.DemoApp, { backend }));
  await until(() => byText('button[role="tab"]', 'Recruits'), 'admin');
  await click(byText('button[role="tab"]', 'Recruits'));
  const year = await until(() => document.getElementById('recruit-year'), 'form');
  assert.equal(year.required, true);
  assert.equal(document.querySelector('label[for="recruit-year"]').textContent, 'Graduation year');
  assert.equal(/optional/i.test(document.querySelector('label[for="recruit-year"]').textContent), false);
  await type(document.getElementById('recruit-name'), 'Harper Vance');
  await choose(document.getElementById('recruit-major'), document.querySelector('#recruit-major option:not([value=""])').value);
  const before = backend.snapshot().recruits.length;
  const form = year.closest('form');
  await act(async () => { form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
  await until(() => byText('[role="alert"]', 'Graduation year is required'), 'year error');
  assert.equal(backend.snapshot().recruits.length, before, 'nothing written');
  const y = year.querySelector('option:not([value=""])').value;
  await choose(year, y);
  await act(async () => { form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); });
  await until(() => backend.snapshot().recruits.length === before + 1, 'added');
  assert.equal(backend.snapshot().recruits.at(-1).gradYear, y);
  act(() => root.unmount());
  assert.deepEqual(network, []);
});

test('showcase seed: default vote event has checked-in recruits and the dashboard shows sample votes', async () => {
  const backend = ui.createShowcaseBackend({ latencyMs: 0 });
  const root = mount(createElement(ui.DemoApp, { backend }));
  await until(() => byText('h1', 'Recruitment overview'), 'admin dashboard');
  assert.ok(byText('*', 'Bhayshul Tuten'));
  assert.equal(/0\s*Votes/.test(document.body.textContent), false, 'sample votes are counted');
  await go('/vote');
  await until(() => byText('h1', 'Rate recruits'), 'vote page');
  const sel = document.getElementById('vote-event');
  assert.equal(sel.value, 'e-case');
  assert.deepEqual([...sel.options].map(o => o.textContent), ['Info Session — Sep 8, 2026', 'Case Comp — Sep 15, 2026']);
  assert.equal(/Professional Night|Case Competition/.test(document.body.textContent), false);
  assert.equal(document.querySelectorAll('fieldset.rating').length, 8, 'checked-in recruits at the default event');
  assert.equal(document.querySelectorAll('fieldset.rating input:checked').length, 0, 'demo admin ballot starts empty');
  await click(document.querySelector('fieldset.rating input[aria-label^="9 for"]'));
  await until(() => byText('.status-saved', 'Saved'), 'admin vote saved');
  act(() => root.unmount());
  assert.deepEqual(network, []);
});

test('showcase analytics: simple per-recruit stats, Absent events, and no fabricated numbers without ratings', async () => {
  const backend = ui.createShowcaseBackend({ latencyMs: 0 });
  let root = mount(createElement(ui.DemoApp, { backend }));
  const select = await until(() => document.getElementById('an-recruit'), 'analytics first');
  await choose(select, 'r-jax-jakobi-meyers');
  await until(() => document.getElementById('an-detail').textContent === 'Jakobi Meyers', 'switched');
  const db = backend.snapshot();
  const votes = db.votes.filter(v => v.recruitId === 'r-jax-jakobi-meyers');
  const avg = (votes.reduce((a, v) => a + v.score, 0) / votes.length).toFixed(1);
  const stats = [...document.querySelectorAll('.stat')].map(s => s.textContent);
  assert.deepEqual(stats, [avg + ' /10Average score', new Set(votes.map(v => v.userEmail)).size + 'Members who voted', '1Events attended']);
  const items = [...document.querySelectorAll('.event-result')].map(li => li.textContent);
  assert.equal(items.length, 2);
  assert.match(items[0], new RegExp('^Info SessionSep 8, 2026Attended' + avg.replace('.', '\\.') + '/10 · ' + votes.length + ' ratings$'));
  assert.equal(items[1], 'Case CompSep 15, 2026Absent—');
  const counts = Array(10).fill(0); votes.forEach(v => counts[v.score - 1]++);
  const chart = document.querySelector('figure.ratings-chart .chart-grid[role="img"]');
  assert.equal(chart.getAttribute('aria-label'), 'Number of ratings for each score from 1 to 10. ' + counts.map((c, i) => (i + 1) + ': ' + c).join(', '));
  assert.deepEqual([...chart.querySelectorAll('.chart-count')].map(t => t.textContent), counts.map(c => (c ? String(c) : '')));
  assert.match(document.querySelector('figure.ratings-chart figcaption').textContent, new RegExp('How members rated Jakobi Meyers \\(' + votes.length + ' ratings\\)'));
  assert.equal(document.getElementById('note-r-jax-jakobi-meyers').value, '', 'no seeded notes about real players');
  const portrait = await until(() => document.querySelector('.an-portrait img'), 'large portrait');
  assert.equal(portrait.getAttribute('alt'), 'Photo of Jakobi Meyers');
  assert.match(portrait.getAttribute('src'), /jakobi-meyers/);
  await choose(select, 'r-jax-bhayshul-tuten');
  await until(() => /bhayshul-tuten/.test((document.querySelector('.an-portrait img') || {}).src || ''), 'portrait follows selection');
  assert.equal(document.querySelector('.an-portrait img').getAttribute('alt'), 'Photo of Bhayshul Tuten');
  assert.equal(document.querySelector('h2.an-name').textContent, 'Bhayshul Tuten');
  assert.equal(document.querySelector('.an-degree').textContent, 'Marketing (BSBA) (example)');
  assert.equal(document.querySelector('.an-year').textContent, 'Class of 2027');
  assert.equal(document.querySelectorAll('.an-portrait').length, 1);
  act(() => document.querySelector('.an-portrait img').dispatchEvent(new window.Event('error')));
  const fb = await until(() => document.querySelector('.an-portrait-fallback'), 'broken image falls back');
  assert.equal(fb.getAttribute('aria-label'), 'No photo for Bhayshul Tuten');
  assert.equal(fb.textContent, 'BT');
  act(() => root.unmount());

  const noVotes = { ...backend, call(email, action, extra) {
    return backend.call(email, action, extra).then(r => (action === 'getAdminData' ? { ...r, votes: [] } : r));
  } };
  root = mount(createElement(ui.DemoApp, { backend: noVotes }));
  await until(() => document.getElementById('an-detail'), 'analytics');
  const text = document.querySelector('.analytics').textContent;
  assert.match(text, /—Average score0Members who voted/);
  assert.match(text, /No ratings for .* yet/);
  assert.match(text, /No ratings yet/);
  assert.equal(document.querySelector('figure.ratings-chart'), null, 'no empty chart without ratings');
  assert.ok(document.querySelector('.an-portrait'), 'portrait area present');
  assert.equal(/NaN|0\.0 \/10/.test(text), false);
  act(() => root.unmount());
  assert.deepEqual(network, []);
});
