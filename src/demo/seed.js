// Real player names/photos, fictional example education and demo events.
// No real credentials, member identities, attendance or ballots are represented.
import { JAGUARS_RECRUITS } from './jaguarsRoster.js';

export const DEMO_PERSONAS = [
  {
    email: 'jordan.admin@example.test',
    name: 'Jordan Vale',
    role: 'admin',
  },
  {
    email: 'riley.member@example.test',
    name: 'Riley Brooks',
    role: 'brother',
  },
];

// Fixed identity the showcase opens as (admin, so Admin and Vote are both reachable).
export const DEMO_USER = DEMO_PERSONAS[0];

export function demoSeed() {
  const recruits = JAGUARS_RECRUITS.map(r => ({ ...r,
    photoFileId: 'demo-photo-' + r.id, photoSource: 'upload',
  }));
  return {
    recruits,
    events: [
      { id: 'e-info', name: 'Info Session', date: '2026-09-08' },
      { id: 'e-case', name: 'Case Competition Social', date: '2026-09-15' },
      { id: 'e-pro', name: 'Professional Night' },
    ],
    // Example attendance makes the voting flow immediately usable. No seed votes.
    attendance: recruits.map(r => ({ eventId: 'e-info', recruitId: r.id })),
    votes: [], notes: [],
    users: DEMO_PERSONAS.map(p => ({ email: p.email, name: p.name, role: p.role, active: 'yes' })),
  };
}

// Abstract fallback for visitor-created local recruits.
const PALETTE = [['#4B2A7B', '#8E6CC4'], ['#3E2463', '#C9A54C'], ['#5B3A8E', '#E2C77A'], ['#2F1E4E', '#7C5BB3']];

export function abstractAvatar(seedText) {
  let h = 0;
  for (const ch of String(seedText)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const [a, b] = PALETTE[h % PALETTE.length];
  const cx = 20 + (h % 60);
  const cy = 20 + ((h >> 4) % 60);
  const r = 18 + ((h >> 8) % 20);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="#ffffff" fill-opacity="0.18"/><rect x="${100 - cx}" y="${100 - cy}" width="${r}" height="${r}" rx="6" fill="#ffffff" fill-opacity="0.12" transform="rotate(${h % 90} 50 50)"/></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}
