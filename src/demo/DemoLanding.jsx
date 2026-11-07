import { BrandMark } from '../components/ui'

const FEATURES = [
  ['Server-side authorization', 'Every request is checked against the member list inside a lock. Votes must reference a real event and a recruit marked present.'],
  ['Google identity, bound to this app', 'The backend verifies Google ID tokens and rejects tokens issued to any other app. The first admin is a configured owner, never the first visitor.'],
  ['Spreadsheet-safe writes', 'All writes go through name-indexed columns and store formula-like text (=, +, -, @) as literal text.'],
  ['Transparent tallies', 'Averages count only active votes; votes for deleted events or removed attendance stay as history and are reported, not silently dropped.'],
  ['Resilient UI', 'Per-recruit write serialization (last tap wins), optimistic updates with rollback, timeouts without blind retries, and optional photos that never block core work.'],
  ['Tested and isolated', 'Node test suites cover the authorization matrix and regressions; this demo build is checked to contain no Google or backend endpoints.'],
]

export default function DemoLanding({ personas, onChoose }) {
  return (
    <main className="page">
      <section className="hero">
        <div className="row" style={{ marginBottom: 16 }}><BrandMark /><span className="eyebrow">Recruitment Tracker · case study</span></div>
        <h1>Fair, auditable recruitment voting <em>on a spreadsheet budget</em>.</h1>
        <p className="lede" style={{ maxWidth: 640, marginTop: 12 }}>
          A React app on a Google Sheets + Apps Script backend that a student organization can run for free.
          Members rate recruits after each event; admins manage attendance and see live averages.
          This demo runs entirely in your browser with fictional people and data.
        </p>
      </section>

      <h2>Try it as…</h2>
      <div className="persona-grid">
        {personas.map(p => (
          <button key={p.email} type="button" className="card persona" onClick={() => onChoose(p)}>
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>{p.name}</span>
              <span className={p.role === 'admin' ? 'badge badge-gold' : 'badge badge-purple'}>{p.label}</span>
            </div>
            <span className="small muted" style={{ fontWeight: 400 }}>{p.blurb}</span>
          </button>
        ))}
      </div>

      <h2 style={{ marginTop: 28, marginBottom: 12 }}>What to look for</h2>
      <ul className="feature-list">
        {FEATURES.map(([title, body]) => (
          <li key={title} className="card">
            <h3 style={{ marginBottom: 4 }}>{title}</h3>
            <p className="small muted">{body}</p>
          </li>
        ))}
      </ul>

      <p className="footer-note">
        Independent personal project. Names, emails and scores are invented; avatars are generated shapes.
        Not affiliated with or endorsed by any employer or national organization.
      </p>
    </main>
  )
}
