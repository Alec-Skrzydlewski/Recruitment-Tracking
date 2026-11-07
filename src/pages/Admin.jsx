import { useEffect, useMemo, useRef, useState } from 'react'
import { useRuntime } from '../runtime'
import {
  apply, rollback, replaceId, replaceIdInMap, nextTempId, isTempId, createInflightGuard,
} from '../lib/adminState'
import { buildTally } from '../lib/tally'
import { photoCacheSet } from '../lib/photoCache'
import { usePhotoMap } from '../lib/usePhotoMap'
import { Banner, ErrorState, LoadingState, errorText } from '../components/ui'
import DashboardTab from './admin/DashboardTab'
import RecruitsTab from './admin/RecruitsTab'
import EventsTab from './admin/EventsTab'
import UsersTab from './admin/UsersTab'
import SettingsTab from './admin/SettingsTab'

const TABS = [
  ['dashboard', 'Dashboard'],
  ['recruits', 'Recruits'],
  ['events', 'Events'],
  ['users', 'Members'],
  ['settings', 'Settings'],
]

function draftsFrom(d) {
  const drafts = {}
  ;(d.notes || []).forEach(n => { drafts[n.recruitId] = n.content || '' })
  return drafts
}

function requestId() {
  return 'req-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
}

export default function Admin() {
  const runtime = useRuntime()
  const { api, me, loadPhotos, mode } = runtime
  const [tab, setTab] = useState('dashboard')
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [saving, setSaving] = useState({})
  const [noteDrafts, setNoteDrafts] = useState({})
  const [savedNotes, setSavedNotes] = useState({})
  const [noteStatus, setNoteStatus] = useState({})
  const [previews, setPreviews] = useState({})
  const [unmatched, setUnmatched] = useState(null)
  const [photoWarning, setPhotoWarning] = useState(null)

  const dataRef = useRef(null)
  // Fingerprint of the cycle data as last loaded from the server. The wipe
  // sends it back; any change since (anyone's, including this admin's own
  // edits) makes the server refuse, and the page reloads for review.
  const fingerprintRef = useRef('')
  const inflight = useRef(createInflightGuard())

  function commit(next) {
    dataRef.current = next
    setData(next)
  }

  // Loading admin data never touches Drive. Photo folder sync is a separate,
  // explicit action on the Recruits tab.
  useEffect(() => {
    let cancelled = false
    setLoadError(null)
    api('getAdminData').then(d => {
      if (cancelled) return
      fingerprintRef.current = d.cycleFingerprint || ''
      commit(d)
      const drafts = draftsFrom(d)
      setNoteDrafts(drafts)
      setSavedNotes(drafts)
    }).catch(err => {
      if (!cancelled) setLoadError(errorText(err))
    })
    return () => { cancelled = true }
  }, [api, attempt])

  const wiping = !!saving.wipe

  function begin(key) {
    if (key !== 'wipe' && inflight.current.has('wipe')) return false
    if (key === 'wipe' && Object.keys(saving).length) return false
    if (!inflight.current.begin(key)) return false
    setSaving(s => ({ ...s, [key]: true }))
    return true
  }

  function end(key) {
    inflight.current.end(key)
    setSaving(s => {
      if (!s[key]) return s
      const next = { ...s }
      delete next[key]
      return next
    })
  }

  function fail(err) {
    setError(errorText(err))
  }

  async function optimistic(key, action, call) {
    if (!begin(key)) return false
    const result = apply(dataRef.current, action)
    commit(result.data)
    try {
      await call()
      return true
    } catch (err) {
      if (result.inverse && dataRef.current) commit(rollback(dataRef.current, result.inverse))
      fail(err)
      return false
    } finally {
      end(key)
    }
  }

  const ctl = {
    mode, me, saving, wiping, isTempId,
    async addRecruit(fields, prepared) {
      if (!begin('add-recruit')) return false
      const tempId = nextTempId()
      const preview = prepared ? 'data:image/jpeg;base64,' + prepared.dataBase64 : ''
      if (preview) setPreviews(p => ({ ...p, [tempId]: preview }))
      const result = apply(dataRef.current, { type: 'addTemp', collection: 'recruits', tempId, item: { ...fields, photoFileId: '', photoSource: '' } })
      commit(result.data)
      try {
        const payload = { ...fields, requestId: requestId() }
        if (prepared) {
          payload.photoDataBase64 = prepared.dataBase64
          payload.photoMimeType = prepared.mimeType
        }
        const res = await api('addRecruit', payload)
        if (res && res.id && dataRef.current) {
          let next = replaceId(dataRef.current, tempId, res.id)
          if (res.photoFileId) {
            if (preview) photoCacheSet(res.photoFileId, preview)
            next = { ...next, recruits: next.recruits.map(r => (r.id === res.id ? { ...r, photoFileId: res.photoFileId, photoSource: 'upload' } : r)) }
          }
          commit(next)
          setNoteDrafts(d => replaceIdInMap(d, tempId, res.id))
        }
        return true
      } catch (err) {
        if (dataRef.current) commit(rollback(dataRef.current, result.inverse))
        fail(err)
        return false
      } finally {
        setPreviews(p => { const n = { ...p }; delete n[tempId]; return n })
        end('add-recruit')
      }
    },
    deleteRecruit(r) {
      if (isTempId(r.id) || !confirm(`Remove ${r.name}? Their past votes and notes stay in the Sheet as history.`)) return
      optimistic(`del-recruit:${r.id}`, { type: 'removeById', collection: 'recruits', id: r.id }, () => api('deleteRecruit', { id: r.id }))
    },
    async uploadPhoto(recruitId, prepared) {
      const key = 'photo:' + recruitId
      if (!begin(key)) return
      try {
        const res = await api('uploadPhoto', { recruitId, dataBase64: prepared.dataBase64, mimeType: prepared.mimeType })
        if (res && res.photoFileId) {
          photoCacheSet(res.photoFileId, 'data:image/jpeg;base64,' + prepared.dataBase64)
          commit({ ...dataRef.current, recruits: dataRef.current.recruits.map(r => (String(r.id) === String(recruitId) ? { ...r, photoFileId: res.photoFileId, photoSource: 'upload' } : r)) })
        }
      } catch (err) {
        if (err && err.code === 'PHOTO_UNAVAILABLE') setPhotoWarning(errorText(err))
        else fail(err)
      } finally {
        end(key)
      }
    },
    async syncPhotos() {
      if (!begin('sync-photos')) return
      setPhotoWarning(null)
      try {
        const res = await api('syncPhotoFolder')
        const linked = (res && res.linked) || []
        if (linked.length && dataRef.current) {
          const byId = {}
          linked.forEach(item => { byId[String(item.recruitId)] = item })
          commit({ ...dataRef.current, recruits: dataRef.current.recruits.map(r => {
            const hit = byId[String(r.id)]
            return hit && !r.photoFileId ? { ...r, photoFileId: hit.fileId, photoSource: 'folder' } : r
          }) })
        }
        setUnmatched((res && res.unmatched) || [])
        setNotice(linked.length ? `Linked ${linked.length} photo${linked.length === 1 ? '' : 's'} from the folder.` : 'Photo folder checked. Nothing new to link automatically.')
      } catch (err) {
        setPhotoWarning(errorText(err))
      } finally {
        end('sync-photos')
      }
    },
    async linkPhoto(fileId, recruitId) {
      const key = 'link:' + fileId
      if (!fileId || !recruitId || !begin(key)) return
      try {
        await api('linkPhoto', { fileId, recruitId })
        commit({ ...dataRef.current, recruits: dataRef.current.recruits.map(r => (String(r.id) === String(recruitId) ? { ...r, photoFileId: fileId, photoSource: 'folder' } : r)) })
        setUnmatched(list => (list || []).filter(item => item.fileId !== fileId))
      } catch (err) {
        fail(err)
      } finally {
        end(key)
      }
    },
    async addEvent(name) {
      if (!begin('add-event')) return false
      const tempId = nextTempId()
      const result = apply(dataRef.current, { type: 'addTemp', collection: 'events', tempId, item: { name } })
      commit(result.data)
      try {
        const res = await api('addEvent', { name, requestId: requestId() })
        if (res && res.id && dataRef.current) commit(replaceId(dataRef.current, tempId, res.id))
        return true
      } catch (err) {
        if (dataRef.current) commit(rollback(dataRef.current, result.inverse))
        fail(err)
        return false
      } finally {
        end('add-event')
      }
    },
    deleteEvent(ev) {
      if (isTempId(ev.id) || !confirm(`Delete ${ev.name}? Votes cast at this event stay in the Sheet but no longer count toward averages.`)) return
      optimistic(`del-event:${ev.id}`, { type: 'removeById', collection: 'events', id: ev.id }, () => api('deleteEvent', { id: ev.id }))
    },
    setAttendance(eventId, recruitId, present) {
      if (isTempId(eventId) || isTempId(recruitId)) return
      optimistic(`att:${eventId}:${recruitId}`, { type: 'toggleAttendance', eventId, recruitId }, () => api('setAttendance', { eventId, recruitId, present }))
    },
    noteDrafts, savedNotes, noteStatus,
    editNote(recruitId, value) {
      setNoteDrafts(d => ({ ...d, [recruitId]: value }))
      setNoteStatus(s => ({ ...s, [recruitId]: null }))
    },
    async saveNote(recruitId) {
      const key = 'note:' + recruitId
      if (isTempId(recruitId) || !begin(key)) return
      const content = noteDrafts[recruitId] || ''
      setNoteStatus(s => ({ ...s, [recruitId]: 'saving' }))
      try {
        await api('saveNote', { recruitId, content })
        setSavedNotes(s => ({ ...s, [recruitId]: content }))
        setNoteStatus(s => ({ ...s, [recruitId]: 'saved' }))
      } catch (err) {
        // The draft stays in the textarea so nothing typed is lost.
        setNoteStatus(s => ({ ...s, [recruitId]: 'error:' + errorText(err) }))
      } finally {
        end(key)
      }
    },
    addUser(email, name) {
      return optimistic('add-user', { type: 'addUser', email, name: name || email, role: 'brother' }, () => api('manageUser', { op: 'add', email, name, role: 'brother' }))
    },
    setRole(email, role) {
      optimistic(`role:${email}`, { type: 'setUserRole', email, role }, () => api('manageUser', { op: 'setRole', email, role }))
    },
    removeUser(email) {
      if (!confirm('Remove ' + email + ' from the member list?')) return
      optimistic(`user-remove:${email}`, { type: 'removeUser', email }, () => api('manageUser', { op: 'remove', email }))
    },
    async wipe(confirmText) {
      if (!begin('wipe')) {
        setError('Finish the changes that are still saving, then try again.')
        return false
      }
      const reload = async () => {
        const fresh = await api('getAdminData')
        fingerprintRef.current = fresh.cycleFingerprint || ''
        commit(fresh)
        const drafts = draftsFrom(fresh)
        setNoteDrafts(drafts)
        setSavedNotes(drafts)
      }
      try {
        await api('wipeCycle', { confirm: confirmText, expectedFingerprint: fingerprintRef.current })
        await reload()
        setUnmatched(null)
        setNotice('Cycle wiped. Members were kept.')
        return true
      } catch (err) {
        if (err && err.code === 'CONFLICT') {
          try {
            await reload()
            setError('Cycle data changed since this page loaded (including any edits you made). Nothing was wiped. The latest data is now shown; review it and confirm again.')
          } catch (reloadErr) {
            fail(reloadErr)
          }
          return false
        }
        fail(err)
        return false
      } finally {
        end('wipe')
      }
    },
    unmatched, photoWarning,
  }

  const tally = useMemo(() => buildTally(data), [data])

  const photoIds = useMemo(() => {
    const ids = []
    ;((data && data.recruits) || []).forEach(r => { if (r.photoFileId) ids.push(r.photoFileId) })
    ;(unmatched || []).forEach(item => { if (item.fileId) ids.push(item.fileId) })
    return ids
  }, [data, unmatched])
  const { photos, failed: photosFailed, retry: retryPhotos } = usePhotoMap(loadPhotos, photoIds)
  ctl.photoFor = recruit => (recruit.photoFileId && photos[recruit.photoFileId]) || previews[recruit.id] || ''
  ctl.photos = photos

  if (loadError) return <ErrorState title="Couldn't load admin data" message={loadError} onRetry={() => setAttempt(n => n + 1)} />
  if (!data) return <LoadingState label="Loading admin data…" />

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Admin</div>
          <h1>Recruitment overview</h1>
        </div>
        {Object.keys(saving).length > 0 && <span className="badge" role="status">Saving changes…</span>}
      </div>

      {error && <Banner onDismiss={() => setError(null)}>{error}</Banner>}
      {notice && <Banner kind="info" onDismiss={() => setNotice(null)}>{notice}</Banner>}
      {(photoWarning || photosFailed) && (
        <Banner
          kind="warn"
          onDismiss={photoWarning ? () => setPhotoWarning(null) : undefined}
          action={photosFailed ? <button type="button" className="btn-sm" onClick={retryPhotos}>Retry photos</button> : null}
        >
          {photoWarning || "Some photos couldn't load. Initials are shown instead; everything else works."}
        </Banner>
      )}

      <div className="tabs" role="tablist" aria-label="Admin sections">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={'tab-' + id}
            aria-selected={tab === id}
            aria-controls={'panel-' + id}
            className="tab"
            onClick={() => setTab(id)}
          >{label}</button>
        ))}
      </div>

      <div role="tabpanel" id={'panel-' + tab} aria-labelledby={'tab-' + tab}>
        {tab === 'dashboard' && <DashboardTab data={data} tally={tally} ctl={ctl} />}
        {tab === 'recruits' && <RecruitsTab data={data} ctl={ctl} />}
        {tab === 'events' && <EventsTab data={data} ctl={ctl} />}
        {tab === 'users' && <UsersTab data={data} ctl={ctl} />}
        {tab === 'settings' && <SettingsTab data={data} ctl={ctl} />}
      </div>
    </div>
  )
}
