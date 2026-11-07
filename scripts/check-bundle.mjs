// Fails if the demo build contains any live endpoint or Google sign-in code,
// or if the live build contains demo seed data. Run after both builds.
import fs from 'node:fs';
import path from 'node:path';

function read(dir) {
  if (!fs.existsSync(dir)) throw new Error(`${dir} not found; run the build first`);
  return fs.readdirSync(dir, { recursive: true })
    .map(f => path.join(dir, f))
    .filter(f => fs.statSync(f).isFile() && /\.(js|html|css)$/.test(f))
    .map(f => [f, fs.readFileSync(f, 'utf8')]);
}

const DEMO_FORBIDDEN = [/script\.google(usercontent)?\.com/, /accounts\.google\.com/, /googleapis\.com/, /gsi\/client/, /VITE_APPS_SCRIPT_URL/, /apiVersion/];
const LIVE_FORBIDDEN = [/example\.test/, /Avery Quill/, /Portfolio demo/];

let failed = false;
for (const [file, text] of read('dist-demo')) {
  for (const re of DEMO_FORBIDDEN) {
    if (re.test(text)) { console.error(`demo bundle ${file} contains ${re}`); failed = true; }
  }
}
for (const [file, text] of read('dist')) {
  for (const re of LIVE_FORBIDDEN) {
    if (re.test(text)) { console.error(`live bundle ${file} contains ${re}`); failed = true; }
  }
}
if (failed) process.exit(1);
console.log('bundle isolation ok: demo has no live endpoints; live has no demo data');
