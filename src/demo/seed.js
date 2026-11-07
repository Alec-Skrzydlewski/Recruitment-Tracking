// Entirely fictional demo data. Names are invented; emails use the reserved
// example.test domain; there are no real people, chapters or photos here.

export const DEMO_PERSONAS = [
  {
    email: 'jordan.admin@example.test',
    name: 'Jordan Vale',
    role: 'admin',
    label: 'Recruitment chair',
    blurb: 'Manage recruits, events, attendance, members and the live tally.',
  },
  {
    email: 'riley.member@example.test',
    name: 'Riley Brooks',
    role: 'brother',
    label: 'Voting member',
    blurb: 'Pick an event and rate the recruits who attended it.',
  },
];

const recruits = [
  ['r-avery', 'Avery Quill', 'Accounting (BSAcc)', 'Business Information and Analytics (BSBA)', '2028', true],
  ['r-blake', 'Blake Ember', 'Finance (BSBA)', '', '2027', true],
  ['r-casey', 'Casey Lark', 'Business Information and Analytics (BSBA)', 'Accounting (BSAcc)', '2029', true],
  ['r-dakota', 'Dakota Reyes', 'Marketing (BSBA)', '', '2028', false],
  ['r-emerson', 'Emerson Hale', 'Accounting (BSAcc)', 'Finance (BSBA)', '2027', true],
  ['r-finley', 'Finley Moss', 'Management (BSBA)', '', '2029', false],
];

const members = [
  ['jordan.admin@example.test', 'Jordan Vale', 'admin'],
  ['riley.member@example.test', 'Riley Brooks', 'brother'],
  ['sam.member@example.test', 'Sam Ortega', 'brother'],
  ['morgan.member@example.test', 'Morgan Pike', 'brother'],
  ['taylor.admin@example.test', 'Taylor Shore', 'admin'],
  ['avery.k.member@example.test', 'Kai Avery', 'brother'],
  ['drew.member@example.test', 'Drew Lin', 'brother'],
  // Former member: their earlier ballots stay valid and counted.
  ['quinn.former@example.test', 'Quinn Hart', 'brother', 'no'],
];

export function demoSeed() {
  const events = [
    { id: 'e-info', name: 'Info Night' },
    { id: 'e-case', name: 'Case Competition Social' },
    { id: 'e-pro', name: 'Professional Night' },
  ];
  const attendance = [
    ['e-info', 'r-avery'], ['e-info', 'r-blake'], ['e-info', 'r-casey'], ['e-info', 'r-dakota'], ['e-info', 'r-emerson'],
    ['e-case', 'r-avery'], ['e-case', 'r-casey'], ['e-case', 'r-emerson'], ['e-case', 'r-finley'],
    ['e-pro', 'r-avery'], ['e-pro', 'r-blake'], ['e-pro', 'r-casey'], ['e-pro', 'r-emerson'], ['e-pro', 'r-finley'],
  ].map(([eventId, recruitId]) => ({ eventId, recruitId }));
  const scores = {
    'sam.member@example.test': { 'e-info': { 'r-avery': 9, 'r-blake': 6, 'r-casey': 8, 'r-dakota': 5, 'r-emerson': 7 }, 'e-case': { 'r-avery': 8, 'r-casey': 9, 'r-finley': 6 } },
    'morgan.member@example.test': { 'e-info': { 'r-avery': 8, 'r-blake': 7, 'r-casey': 7, 'r-emerson': 8 }, 'e-case': { 'r-emerson': 9, 'r-finley': 5 } },
    'taylor.admin@example.test': { 'e-info': { 'r-avery': 9, 'r-casey': 8, 'r-dakota': 6 }, 'e-case': { 'r-avery': 9, 'r-casey': 8, 'r-emerson': 8 } },
    'riley.member@example.test': { 'e-info': { 'r-blake': 7 } },
    // Professional Night: fuller synthetic results for the Analytics tab,
    // including a tie on the overall mean and a split-opinion recruit.
    'avery.k.member@example.test': { 'e-info': { 'r-avery': 7, 'r-dakota': 4 }, 'e-pro': { 'r-avery': 8, 'r-blake': 9, 'r-casey': 6, 'r-emerson': 7, 'r-finley': 3 } },
    'drew.member@example.test': { 'e-case': { 'r-avery': 7, 'r-finley': 9 }, 'e-pro': { 'r-avery': 9, 'r-blake': 4, 'r-casey': 8, 'r-emerson': 9, 'r-finley': 10 } },
    'quinn.former@example.test': { 'e-info': { 'r-blake': 8, 'r-emerson': 6 }, 'e-pro': { 'r-blake': 10, 'r-finley': 4 } },
  };
  const votes = [];
  Object.keys(scores).forEach(userEmail => {
    Object.keys(scores[userEmail]).forEach(eventId => {
      Object.keys(scores[userEmail][eventId]).forEach(recruitId => {
        votes.push({ eventId, recruitId, userEmail, score: scores[userEmail][eventId][recruitId], timestamp: '2026-09-15T19:00:00.000Z' });
      });
    });
  });
  // One stale vote for an event that no longer exists (as if written before
  // deletes cascaded), so the Settings invalid-vote cleanup can be tried.
  votes.push({ eventId: 'e-retired', recruitId: 'r-blake', userEmail: 'sam.member@example.test', score: 3, timestamp: '2026-09-01T19:00:00.000Z' });
  return {
    recruits: recruits.map(([id, name, major, secondMajor, gradYear, hasPhoto]) => ({
      id, name, major, secondMajor, gradYear, photoFileId: hasPhoto ? 'demo-photo-' + id : '', photoSource: hasPhoto ? 'upload' : '',
    })),
    events,
    attendance,
    votes,
    notes: [
      { recruitId: 'r-avery', content: 'Strong questions about the audit rotation panel. Follow up about the analytics workshop.', updatedAt: '2026-09-16T02:00:00.000Z' },
    ],
    users: members.map(([email, name, role, active]) => ({ email, name, role, active: active || 'yes' })),
  };
}

// Abstract local avatar: a generated SVG with a deterministic gradient and
// geometric shape. No real photos and no network requests.
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
