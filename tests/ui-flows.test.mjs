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
  assert.ok(byText('.stat', 'Excluded votes'));
  assert.ok(byText('p', 'from deleted events'), 'excluded history is explained');

  await click(byText('button[role="tab"]', 'Settings'));
  const wipeButton = byText('button', 'Wipe cycle data');
  assert.equal(wipeButton.disabled, true, 'wipe requires typed confirmation');
  await type(document.getElementById('wipe-confirm'), 'WIPE CYCLE');
  assert.equal(byText('button', 'Wipe cycle data').disabled, false);
  await click(byText('button', 'Wipe cycle data'));
  await until(() => byText('.banner', 'Cycle wiped'), 'wipe done');
  assert.equal(backend.snapshot().recruits.length, 0);
  assert.equal(backend.snapshot().users.length, 5);

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
