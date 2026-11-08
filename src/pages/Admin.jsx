import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useRuntime } from '../runtime'
import {
  apply, rollback, replaceId, replaceIdInMap, nextTempId, isTempId, createInflightGuard,
} from '../lib/adminState'
import { photoCacheSet } from '../lib/photoCache'
import { usePhotoMap } from '../lib/usePhotoMap'
import { Banner, ErrorState, LoadingState, errorText } from '../components/ui'
import RecruitsTab from './admin/RecruitsTab'
import EventsTab from './admin/EventsTab'
import UsersTab from './admin/UsersTab'
import SettingsTab from './admin/SettingsTab'
import AnalyticsTab from './admin/AnalyticsTab'

const TABS = [
  ['analytics', 'Analytics'],
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

function photoText(err) {
  return errorText(err) + (err && err.diagnostic ? ` (Diagnostic: ${err.diagnostic})` : '')
}

export default function Admin() {
  const runtime = useRuntime()
  const { api, me, loadPhotos, mode } = runtime
  // The selected tab lives in the URL (?tab=analytics), so every tab is
  // linkable. The whole page is already admin-only (routes.jsx).
  const [params, setParams] = useSearchParams()
  const tab = TABS.some(([id]) => id === params.get('tab')) ? params.get('tab') : 'analytics'
  // Analytics (with notes) is the first tab; old ?tab=dashboard links land here.
  const setTab = id => setParams({ tab: id }, { replace: false })
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
  const [cleanup, setCleanup] = useState(null)

  async function reloadAll() {
    const fresh = await api('getAdminData')
    fingerprintRef.current = fresh.cycleFingerprint || ''
    commit(fresh)
    const drafts = draftsFrom(fresh)
    setNoteDrafts(drafts)
    setSavedNotes(drafts)
  }

  // Wipe and invalid-vote cleanup are exclusive: they never overlap other writes.
  const EXCLUSIVE = ['wipe', 'cleanup']
  function begin(key) {
    if (EXCLUSIVE.some(k => k !== key && inflight.current.has(k))) return false
    if (EXCLUSIVE.includes(key) && Object.keys(saving).length) return false
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
      if (isTempId(r.id)) return
      const votes = (dataRef.current.votes || []).filter(v => String(v.recruitId) === String(r.id)).length
      if (!confirm(`Remove ${r.name}? This permanently deletes ${votes} vote${votes === 1 ? '' : 's'} for them, their attendance and their note. Their Drive photo file is kept. This cannot be undone.`)) return
      optimistic(`del-recruit:${r.id}`, { type: 'deleteRecruit', id: r.id }, () => api('deleteRecruit', { id: r.id }))
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
        if (err && err.code === 'PHOTO_UNAVAILABLE') setPhotoWarning(photoText(err))
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
        setPhotoWarning(photoText(err))
      } finally {
        end('sync-photos')
      }
    },
    async checkPhotoAccess() {
      if (!begin('check-photos')) return
      setPhotoWarning(null)
      try {
        const res = await api('checkPhotoAccess')
        setNotice(!res || !res.parentFolder ? 'Drive access works, but the Sheet has no parent folder for photos.'
          : res.photoFolder ? `Drive access works. Photo folder found with ${res.imageCount} image${res.imageCount === 1 ? '' : 's'}.`
          : 'Drive access works. The "Recruit Photos" folder does not exist yet; Sync photo folder will create it.')
      } catch (err) {
        setPhotoWarning(photoText(err))
      } finally {
        end('check-photos')
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
    async addEvent(name, date = '') {
      if (!begin('add-event')) return false
      const tempId = nextTempId()
      const result = apply(dataRef.current, { type: 'addTemp', collection: 'events', tempId, item: { name, date } })
      commit(result.data)
      try {
        const res = await api('addEvent', date ? { name, date, requestId: requestId() } : { name, requestId: requestId() })
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
      if (isTempId(ev.id)) return
      const votes = (dataRef.current.votes || []).filter(v => String(v.eventId) === String(ev.id)).length
      if (!confirm(`Delete ${ev.name}? This permanently deletes ${votes} vote${votes === 1 ? '' : 's'} cast at this event and its attendance list. This cannot be undone.`)) return
      optimistic(`del-event:${ev.id}`, { type: 'deleteEvent', id: ev.id }, () => api('deleteEvent', { id: ev.id }))
    },
    setAttendance(eventId, recruitId, present) {
      if (isTempId(eventId) || isTempId(recruitId)) return
      if (present) {
        optimistic(`att:${eventId}:${recruitId}`, { type: 'toggleAttendance', eventId, recruitId }, () => api('setAttendance', { eventId, recruitId, present }))
        return
      }
      const votes = (dataRef.current.votes || []).filter(v => String(v.eventId) === String(eventId) && String(v.recruitId) === String(recruitId)).length
      if (votes && !confirm(`Mark absent? This permanently deletes ${votes} vote${votes === 1 ? '' : 's'} for this recruit at this event. This cannot be undone.`)) return
      optimistic(`att:${eventId}:${recruitId}`, { type: 'markAbsent', eventId, recruitId }, () => api('setAttendance', { eventId, recruitId, present }))
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
      const reload = reloadAll
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
    cleanup,
    // Read-only: asks the server which stored votes are invalid. Never writes.
    async previewCleanup() {
      try {
        setCleanup(await api('getVoteCleanup'))
      } catch (err) {
        fail(err)
      }
    },
    async runCleanup() {
      const preview = cleanup
      if (!preview || !preview.count) return false
      if (!begin('cleanup')) {
        setError('Finish the changes that are still saving, then try again.')
        return false
      }
      try {
        const res = await api('cleanupInvalidVotes', {
          confirm: 'DELETE INVALID VOTES', expectedFingerprint: preview.cycleFingerprint, expectedCount: preview.count,
        })
        await reloadAll()
        setCleanup(null)
        setNotice(`Permanently deleted ${res.deleted} invalid vote${res.deleted === 1 ? '' : 's'}.`)
        return true
      } catch (err) {
        if (err && err.code === 'CONFLICT') {
          setCleanup(null)
          setError('Vote data changed since the check. Nothing was deleted. Check again.')
        } else {
          fail(err)
        }
        return false
      } finally {
        end('cleanup')
      }
    },
    unmatched, photoWarning,
  }

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
        {tab === 'analytics' && <AnalyticsTab data={data} ctl={ctl} />}
        {tab === 'recruits' && <RecruitsTab data={data} ctl={ctl} />}
        {tab === 'events' && <EventsTab data={data} ctl={ctl} />}
        {tab === 'users' && <UsersTab data={data} ctl={ctl} />}
        {tab === 'settings' && <SettingsTab data={data} ctl={ctl} />}
      </div>
    </div>
  )
}
