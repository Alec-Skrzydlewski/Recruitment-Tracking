// Real player names/photos, fictional example education and demo events.
// Members, attendance and votes are fictional sample data (reserved example.test
// domain, in-memory only). No real credentials, accounts or ballots are represented.
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
  { email: 'morgan.member@example.test', name: 'Morgan Hale', role: 'brother' },
  { email: 'casey.member@example.test', name: 'Casey Dunn', role: 'brother' },
  { email: 'taylor.member@example.test', name: 'Taylor Reyes', role: 'brother' },
  { email: 'avery.member@example.test', name: 'Avery Lin', role: 'brother' },
  { email: 'quinn.member@example.test', name: 'Quinn Patel', role: 'brother' },
];

// Fictional sample voters (the fixed demo admin casts no seed votes, so a visitor can vote).
export const SAMPLE_VOTERS = DEMO_PERSONAS.filter(p => p.role !== 'admin');

// Recruit indices (roster order) absent from each later event.
const ABSENT = { 'e-case': [3, 7, 10], 'e-pro': [1, 5] };

function sampleAttendance(recruits, events) {
  return events.flatMap(e => recruits
    .filter((r, i) => !(ABSENT[e.id] || []).includes(i))
    .map(r => ({ eventId: e.id, recruitId: r.id })));
}

// Deterministic, varied neutral sample scores (5–10); each voter skips some pairs.
function sampleVotes(attendance, events) {
  const votes = [];
  attendance.forEach((a, ai) => {
    const ei = events.findIndex(e => e.id === a.eventId);
    SAMPLE_VOTERS.forEach((v, vi) => {
      const h = (ai * 7 + vi * 13 + ei * 5) % 17;
      if (h % 6 === 0) return; // not every voter rates every recruit
      const score = 5 + ((ai * 3 + vi * 5 + ei) % 6);
      const timestamp = new Date(Date.UTC(2026, 8, 8 + ei * 7, 23, vi, ai % 60)).toISOString();
      votes.push({ eventId: a.eventId, recruitId: a.recruitId, userEmail: v.email, score, timestamp });
    });
  });
  return votes;
}

// Fixed identity the showcase opens as (admin, so Admin and Vote are both reachable).
export const DEMO_USER = DEMO_PERSONAS[0];

export function demoSeed() {
  const recruits = JAGUARS_RECRUITS.map(r => ({ ...r,
    photoFileId: 'demo-photo-' + r.id, photoSource: 'upload',
  }));
  const events = [
    { id: 'e-info', name: 'Info Session', date: '2026-09-08' },
    { id: 'e-case', name: 'Case Competition Social', date: '2026-09-15' },
    { id: 'e-pro', name: 'Professional Night' },
  ];
  const attendance = sampleAttendance(recruits, events);
  return {
    recruits, events, attendance,
    votes: sampleVotes(attendance, events), notes: [],
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
