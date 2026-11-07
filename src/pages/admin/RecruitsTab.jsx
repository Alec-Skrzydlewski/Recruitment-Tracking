import { useEffect, useRef, useState } from 'react'
import { MAJORS, OTHER, gradYears, optionValue } from '../../lib/recruitOptions'
import { preparePhoto } from '../../lib/preparePhoto'
import RecruitAvatar from '../../components/RecruitAvatar'
import { EmptyState, SavingPill } from '../../components/ui'

function MajorOptions() {
  return (
    <>
      <optgroup label="Undergraduate">
        {MAJORS.undergraduate.map(m => <option key={m} value={m}>{m}</option>)}
      </optgroup>
      <optgroup label="Graduate">
        {MAJORS.graduate.map(m => <option key={m} value={m}>{m}</option>)}
      </optgroup>
      <option value={OTHER}>Other</option>
    </>
  )
}

function hasPhoto(r) {
  return !!(r && (String(r.photoFileId || '').trim() || String(r.photoSource || '').trim()))
}

export default function RecruitsTab({ data, ctl }) {
  const [name, setName] = useState('')
  const [majorChoice, setMajorChoice] = useState('')
  const [majorCustom, setMajorCustom] = useState('')
  const [secondChoice, setSecondChoice] = useState('')
  const [secondCustom, setSecondCustom] = useState('')
  const [gradYear, setGradYear] = useState('')
  const [photoFile, setPhotoFile] = useState(null)
  const [photoUrl, setPhotoUrl] = useState('')
  const [formError, setFormError] = useState('')
  const [linkChoice, setLinkChoice] = useState({})
  const fileRef = useRef(null)
  const years = gradYears()

  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl) }, [photoUrl])

  function pick(e) {
    const file = e.target.files && e.target.files[0]
    setFormError('')
    setPhotoFile(file || null)
    setPhotoUrl(current => {
      if (current) URL.revokeObjectURL(current)
      return file ? URL.createObjectURL(file) : ''
    })
  }

  async function submit(e) {
    e.preventDefault()
    const major = optionValue(majorChoice, majorCustom)
    const secondMajor = optionValue(secondChoice, secondCustom)
    if (!name.trim()) return setFormError('Name is required.')
    if (!major) return setFormError('Major is required.')
    if (!/^\d{4}$/.test(gradYear.trim())) return setFormError('Graduation year is required.')
    if (secondMajor && secondMajor.toLowerCase() === major.toLowerCase()) return setFormError('Second major must be different from the major.')
    let prepared = null
    try {
      if (photoFile) prepared = await preparePhoto(photoFile)
    } catch (err) {
      return setFormError(err && err.message ? err.message : 'Could not read that image')
    }
    const ok = await ctl.addRecruit({ name: name.trim(), major, secondMajor, gradYear: gradYear.trim() }, prepared)
    if (ok) {
      setName(''); setMajorChoice(''); setMajorCustom(''); setSecondChoice(''); setSecondCustom(''); setGradYear('')
      setPhotoFile(null); setPhotoUrl('')
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function upload(recruitId, input) {
    const file = input.files && input.files[0]
    if (!file) return
    try {
      const prepared = await preparePhoto(file)
      await ctl.uploadPhoto(recruitId, prepared)
    } catch (err) {
      setFormError(err && err.message ? err.message : 'Could not read that image')
    } finally {
      input.value = ''
    }
  }

  const disabled = ctl.wiping
  return (
    <div className="stack">
      <form className="card" onSubmit={submit} aria-labelledby="add-recruit-title">
        <h2 id="add-recruit-title" style={{ marginBottom: 12 }}>Add a recruit</h2>
        <div className="form-grid two">
          <div>
            <label className="field-label" htmlFor="recruit-name">Name</label>
            <input id="recruit-name" value={name} onChange={e => { setFormError(''); setName(e.target.value) }} required maxLength={120} autoComplete="off" />
          </div>
          <div>
            <label className="field-label" htmlFor="recruit-year">Graduation year</label>
            <select id="recruit-year" value={gradYear} onChange={e => { setFormError(''); setGradYear(e.target.value) }} required aria-required="true">
              <option value="" disabled>Select year</option>
              {years.map(y => <option key={y} value={String(y)}>{y}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="recruit-major">Major</label>
            <select id="recruit-major" value={majorChoice} onChange={e => { setFormError(''); setMajorChoice(e.target.value) }} required>
              <option value="">Select major</option>
              <MajorOptions />
            </select>
            {majorChoice === OTHER && (
              <input style={{ marginTop: 8 }} value={majorCustom} onChange={e => setMajorCustom(e.target.value)} aria-label="Other major" required maxLength={120} />
            )}
          </div>
          <div>
            <label className="field-label" htmlFor="recruit-second">Second major <span className="muted">(optional)</span></label>
            <select id="recruit-second" value={secondChoice} onChange={e => { setFormError(''); setSecondChoice(e.target.value) }}>
              <option value="">None</option>
              <MajorOptions />
            </select>
            {secondChoice === OTHER && (
              <input style={{ marginTop: 8 }} value={secondCustom} onChange={e => setSecondCustom(e.target.value)} aria-label="Other second major" maxLength={120} />
            )}
          </div>
          <div>
            <label className="field-label" htmlFor="recruit-photo">Photo <span className="muted">(optional, resized before upload)</span></label>
            <div className="row">
              <input id="recruit-photo" ref={fileRef} type="file" accept="image/*" onChange={pick} />
              {photoUrl && <img src={photoUrl} alt="Selected photo preview" className="avatar" />}
            </div>
          </div>
        </div>
        {formError && <p className="status status-error" role="alert" style={{ marginTop: 10 }}>{formError}</p>}
        <div className="row" style={{ marginTop: 12 }}>
          <button type="submit" className="btn-primary" disabled={!!ctl.saving['add-recruit'] || disabled}>Add recruit</button>
          {ctl.saving['add-recruit'] && <SavingPill />}
        </div>
      </form>

      {data.recruits.length === 0 ? (
        <EmptyState title="No recruits yet">Recruits you add appear here.</EmptyState>
      ) : data.recruits.map(r => {
        const meta = [[r.major, r.secondMajor].filter(Boolean).join(' / '), r.gradYear ? 'Class of ' + r.gradYear : ''].filter(Boolean).join(' · ')
        const pending = ctl.isTempId(r.id)
        return (
          <div key={r.id} className="card recruit">
            <RecruitAvatar name={r.name} src={ctl.photoFor(r)} />
            <div className="grow">
              <div className="recruit-name">{r.name} {pending && <SavingPill />}</div>
              {meta && <div className="recruit-meta">{meta}</div>}
              {!hasPhoto(r) && !pending && (
                <label className="small muted" style={{ display: 'block', marginTop: 6 }}>
                  Add photo for {r.name}
                  <input type="file" accept="image/*" style={{ display: 'block', marginTop: 4 }} disabled={!!ctl.saving['photo:' + r.id] || disabled} onChange={e => upload(r.id, e.target)} />
                </label>
              )}
              {ctl.saving['photo:' + r.id] && <SavingPill label="Uploading…" />}
            </div>
            <button type="button" className="icon-btn" onClick={() => ctl.deleteRecruit(r)} disabled={pending || disabled || !!ctl.saving['del-recruit:' + r.id]} aria-label={'Remove ' + r.name} title={'Remove ' + r.name}>×</button>
          </div>
        )
      })}

      <section className="card" aria-labelledby="photo-folder-title">
        <h2 id="photo-folder-title">Photo folder</h2>
        <p className="small muted" style={{ margin: '4px 0 12px' }}>
          {ctl.mode === 'demo'
            ? 'In the live app, officers drop images into a private "Recruit Photos" Drive folder and sync here. The demo has no Drive folder, so syncing is a no-op.'
            : 'Drop images into the private "Recruit Photos" folder next to the Sheet, then sync. Clear name matches link automatically; uncertain ones wait for review below. Opening this page never touches Drive.'}
        </p>
        <div className="row">
          <button type="button" onClick={ctl.syncPhotos} disabled={!!ctl.saving['sync-photos'] || disabled}>Sync photo folder</button>
          {ctl.saving['sync-photos'] && <SavingPill label="Checking folder…" />}
        </div>
        {ctl.unmatched && (
          <div className="stack" style={{ marginTop: 12 }}>
            {ctl.unmatched.length === 0 ? <p className="small muted">No unmatched photos.</p> : ctl.unmatched.map(item => (
              <div key={item.fileId} className="recruit" style={{ alignItems: 'flex-start' }}>
                {ctl.photos[item.fileId]
                  ? <img src={ctl.photos[item.fileId]} alt={'Unmatched photo ' + item.fileName} className="avatar" style={{ width: 64, height: 64, borderRadius: 8 }} />
                  : <span className="avatar" style={{ width: 64, height: 64, borderRadius: 8 }} aria-hidden="true">…</span>}
                <div className="grow">
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>{item.fileName}</div>
                  {(item.suggestions || []).length > 0 && (
                    <div className="row" style={{ marginBottom: 8 }}>
                      {item.suggestions.map(s => {
                        const target = data.recruits.find(r => String(r.id) === String(s.recruitId))
                        return (
                          <button key={s.recruitId} type="button" className="btn-sm" disabled={hasPhoto(target) || !!ctl.saving['link:' + item.fileId]} onClick={() => ctl.linkPhoto(item.fileId, s.recruitId)}>
                            Link to {s.name} ({Math.round(Number(s.score) * 100)}% match)
                          </button>
                        )
                      })}
                    </div>
                  )}
                  <div className="row">
                    <select aria-label={'Link ' + item.fileName + ' to a recruit'} value={linkChoice[item.fileId] || ''} onChange={e => setLinkChoice(d => ({ ...d, [item.fileId]: e.target.value }))} style={{ flex: 1, minWidth: 160 }}>
                      <option value="">Choose a recruit…</option>
                      {data.recruits.map(r => (
                        <option key={r.id} value={r.id} disabled={hasPhoto(r) || ctl.isTempId(r.id)}>{r.name}{hasPhoto(r) ? ' (has photo)' : ''}</option>
                      ))}
                    </select>
                    <button type="button" className="btn-sm" disabled={!linkChoice[item.fileId] || !!ctl.saving['link:' + item.fileId]} onClick={() => ctl.linkPhoto(item.fileId, linkChoice[item.fileId])}>Link</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
