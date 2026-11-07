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
    loader: { '.js': 'jsx' },
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

test('demo: landing → voter persona → vote saves → admin sees it → wipe guard → reset; zero network', async () => {
  const backend = ui.createDemoBackend({ latencyMs: 0 });
  const root = mount(createElement(ui.DemoApp, { backend }));
  await until(() => byText('h2', 'Try it as'), 'landing');
  assert.ok(byText('.demo-ribbon', 'Portfolio demo'));

  await click(byText('button.persona', 'Riley Brooks'));
  await until(() => byText('h1', 'Rate recruits'), 'vote page');
  assert.equal(window.location.pathname, '/vote');
  const select = document.getElementById('vote-event');
  assert.ok(document.querySelector('label[for="vote-event"]'));
  assert.equal(select.value, 'e-pro', 'defaults to the latest event');

  const radio = document.querySelector('input[aria-label="8 for Avery Quill"]');
  assert.ok(radio, 'rating options are labelled per recruit');
  await click(radio);
  await until(() => byText('.status-saved', 'Saved'), 'vote saved');
  const stored = backend.snapshot().votes.find(v => v.userEmail === 'riley.member@example.test' && v.recruitId === 'r-avery' && v.eventId === 'e-pro');
  assert.equal(stored.score, 8);
  assert.equal(document.querySelectorAll('fieldset.rating').length, 5, 'only attendees of the selected event are shown');

  await click(byText('.demo-ribbon button', 'Switch persona'));
  await click(byText('button.persona', 'Jordan Vale'));
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

  await click(byText('.demo-ribbon button', 'Reset demo data'));
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
  const root = mount(createElement(ui.DemoApp, { backend: flaky }));
  await until(() => byText('button.persona', 'Riley Brooks'), 'landing');
  await click(byText('button.persona', 'Riley Brooks'));
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
  await until(() => byText('button.persona', 'Jordan Vale'), 'landing');
  await click(byText('button.persona', 'Jordan Vale'));
  await until(() => document.getElementById('note-r-blake'), 'dashboard notes');
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
  await until(() => byText('button.persona', 'Jordan Vale'), 'landing');
  await click(byText('button.persona', 'Jordan Vale'));
  await until(() => byText('button[role="tab"]', 'Analytics'), 'admin tabs');
  await click(byText('button[role="tab"]', 'Analytics'));
  const select = await until(() => document.getElementById('an-recruit'), 'recruit select');
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
    events: document.querySelector('[aria-label^="Per-event results"] tbody').textContent,
    hist: document.querySelector('figure.hist table').textContent,
    meta: panel.querySelector('#an-detail + p, .row + p').textContent,
  });
  const avery = snapshot();
  assert.match(avery.stats, /8\.22.*Mean/);
  await choose(select, 'r-finley');
  await until(() => document.getElementById('an-detail').textContent === 'Finley Moss', 'switched');
  const finley = snapshot();
  for (const k of Object.keys(avery)) assert.notEqual(finley[k], avery[k], k + ' changed');
  assert.equal(panel.textContent.includes('Avery Quill'), true, 'only as a dropdown option');
  assert.equal(document.querySelector('[aria-label^="Per-event results"]').textContent.includes('Avery'), false);
  assert.ok(byText('button', 'Export Finley Moss’s results (CSV)'));
  assert.ok(byText('summary', 'How these numbers are calculated'));

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
  await until(() => byText('button.persona', 'Jordan Vale'), 'landing');
  await click(byText('button.persona', 'Jordan Vale'));
  await until(() => byText('button[role="tab"]', 'Analytics'), 'admin tabs');
  await click(byText('button[role="tab"]', 'Analytics'));
  await until(() => byText('p', 'No recruits yet'), 'empty state');
  assert.equal(document.getElementById('an-recruit'), null);
  act(() => root.unmount());
  assert.deepEqual(network, []);
});

test('analytics: voters cannot reach it; an admin read failure shows an error, not empty stats', async () => {
  const backend = ui.createDemoBackend({ latencyMs: 0 });
  let root = mount(createElement(ui.DemoApp, { backend }));
  await until(() => byText('button.persona', 'Riley Brooks'), 'landing');
  await click(byText('button.persona', 'Riley Brooks'));
  await until(() => byText('h1', 'Rate recruits'), 'vote page');
  await go('/admin?tab=analytics');
  await until(() => window.location.pathname === '/vote', 'voter redirected');
  assert.equal(document.body.textContent.includes('Recruit comparison'), false);
  act(() => root.unmount());

  const failing = { ...backend, call(email, action, extra) { return action === 'getAdminData' ? Promise.reject(new Error('The server is busy. Try again in a moment.')) : backend.call(email, action, extra); } };
  root = mount(createElement(ui.DemoApp, { backend: failing }));
  await until(() => byText('button.persona', 'Jordan Vale'), 'landing');
  await click(byText('button.persona', 'Jordan Vale'));
  await until(() => byText('h2, h1', "Couldn't load admin data") || byText('*', "Couldn't load admin data"), 'read failure');
  assert.equal(document.body.textContent.includes('Recruit comparison'), false);
  act(() => root.unmount());
  assert.deepEqual(network, []);
});

test('add recruit requires a graduation year: labelled, required, nothing written without it', async () => {
  const backend = ui.createDemoBackend({ latencyMs: 0 });
  const root = mount(createElement(ui.DemoApp, { backend }));
  await until(() => byText('button.persona', 'Jordan Vale'), 'landing');
  await click(byText('button.persona', 'Jordan Vale'));
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
