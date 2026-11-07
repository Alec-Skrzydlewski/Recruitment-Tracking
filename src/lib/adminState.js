// Pure admin data transitions. No React, no I/O — apply a change and keep
// an inverse so one failed write can roll back without wiping later successes.

let tempSeq = 0

export function nextTempId() {
  tempSeq += 1
  return `tmp-${tempSeq}-${Math.random().toString(36).slice(2, 8)}`
}

export function isTempId(id) {
  return typeof id === 'string' && id.startsWith('tmp-')
}

export function addTemp(list, item, tempId) {
  return (list || []).concat([{ ...item, id: tempId }])
}

export function removeById(list, id) {
  const src = list || []
  const index = src.findIndex(item => item && item.id === id)
  if (index === -1) return { list: src, removed: null, index: -1 }
  return {
    list: src.slice(0, index).concat(src.slice(index + 1)),
    removed: src[index],
    index,
  }
}

export function insertAt(list, index, item) {
  const src = (list || []).slice()
  const i = Math.max(0, Math.min(index == null ? src.length : index, src.length))
  src.splice(i, 0, item)
  return src
}

function swapId(value, tempId, realId) {
  return value === tempId ? realId : value
}

export function replaceId(data, tempId, realId) {
  if (!data || tempId == null || realId == null || tempId === realId) return data
  return {
    ...data,
    recruits: (data.recruits || []).map(r => (r.id === tempId ? { ...r, id: realId } : r)),
    events: (data.events || []).map(e => (e.id === tempId ? { ...e, id: realId } : e)),
    attendance: (data.attendance || []).map(a => ({
      ...a,
      eventId: swapId(a.eventId, tempId, realId),
      recruitId: swapId(a.recruitId, tempId, realId),
    })),
    votes: (data.votes || []).map(v => ({
      ...v,
      eventId: swapId(v.eventId, tempId, realId),
      recruitId: swapId(v.recruitId, tempId, realId),
    })),
    notes: (data.notes || []).map(n => ({
      ...n,
      recruitId: swapId(n.recruitId, tempId, realId),
    })),
  }
}

export function replaceIdInMap(map, tempId, realId) {
  if (!map || !(tempId in map)) return map || {}
  const next = { ...map }
  next[realId] = next[tempId]
  delete next[tempId]
  return next
}

export function toggleAttendance(attendance, eventId, recruitId) {
  const list = attendance || []
  const kept = list.filter(a => !(a.eventId === eventId && a.recruitId === recruitId))
  if (kept.length !== list.length) return kept
  return list.concat([{ eventId, recruitId }])
}

function emailKey(email) {
  return String(email || '').toLowerCase()
}

export function setUserRole(users, email, role) {
  const key = emailKey(email)
  const src = users || []
  let previousRole
  const next = src.map(u => {
    if (emailKey(u.email) !== key) return u
    previousRole = u.role
    return { ...u, role }
  })
  return { users: next, previousRole }
}

export function addUser(users, email, extras = {}) {
  const entry = {
    email,
    name: extras.name != null ? extras.name : email,
    role: extras.role || 'brother',
  }
  return (users || []).concat([entry])
}

export function removeUser(users, email) {
  const key = emailKey(email)
  const src = users || []
  const index = src.findIndex(u => emailKey(u.email) === key)
  if (index === -1) return { users: src, removed: null, index: -1 }
  return {
    users: src.slice(0, index).concat(src.slice(index + 1)),
    removed: src[index],
    index,
  }
}

// Cascading deletes mirror the server: deleting a recruit removes its votes,
// attendance and note; deleting an event removes its votes and attendance;
// marking a recruit absent removes their votes at that event. The inverse
// re-inserts exactly the removed rows at their original positions.
const CASCADES = {
  recruit: id => ({
    recruits: r => String(r.id) === String(id),
    votes: v => String(v.recruitId) === String(id),
    attendance: a => String(a.recruitId) === String(id),
    notes: n => String(n.recruitId) === String(id),
  }),
  event: id => ({
    events: e => String(e.id) === String(id),
    votes: v => String(v.eventId) === String(id),
    attendance: a => String(a.eventId) === String(id),
  }),
  absent: (eventId, recruitId) => ({
    attendance: a => String(a.eventId) === String(eventId) && String(a.recruitId) === String(recruitId),
    votes: v => String(v.eventId) === String(eventId) && String(v.recruitId) === String(recruitId),
  }),
}

export function cascadeRemove(data, preds) {
  const next = { ...data }
  const removed = {}
  Object.keys(preds).forEach(collection => {
    const src = data[collection] || []
    const kept = []
    const gone = []
    src.forEach((item, index) => {
      if (preds[collection](item)) gone.push({ index, item })
      else kept.push(item)
    })
    next[collection] = kept
    if (gone.length) removed[collection] = gone
  })
  return { data: next, removed }
}

export function restoreRows(data, removed) {
  const next = { ...data }
  Object.keys(removed || {}).forEach(collection => {
    let list = (next[collection] || []).slice()
    removed[collection].forEach(({ index, item }) => { list = insertAt(list, index, item) })
    next[collection] = list
  })
  return next
}

export function cascadeFor(action) {
  if (action.type === 'deleteRecruit') return CASCADES.recruit(action.id)
  if (action.type === 'deleteEvent') return CASCADES.event(action.id)
  return CASCADES.absent(action.eventId, action.recruitId)
}

export function createInflightGuard() {
  const keys = new Set()
  return {
    begin(key) {
      if (keys.has(key)) return false
      keys.add(key)
      return true
    },
    end(key) {
      keys.delete(key)
    },
    has(key) {
      return keys.has(key)
    },
  }
}

export function apply(data, action) {
  const d = data || {}
  if (!action || !action.type) return { data: d, inverse: null }

  switch (action.type) {
    case 'addTemp': {
      const collection = action.collection
      const list = addTemp(d[collection], action.item || {}, action.tempId)
      return {
        data: { ...d, [collection]: list },
        inverse: { type: 'removeById', collection, id: action.tempId },
      }
    }
    case 'removeById': {
      const collection = action.collection
      const { list, removed, index } = removeById(d[collection], action.id)
      if (!removed) return { data: d, inverse: null }
      return {
        data: { ...d, [collection]: list },
        inverse: { type: 'insertAt', collection, index, item: removed },
      }
    }
    case 'insertAt': {
      const collection = action.collection
      const list = insertAt(d[collection], action.index, action.item)
      return {
        data: { ...d, [collection]: list },
        inverse: action.item && action.item.id != null
          ? { type: 'removeById', collection, id: action.item.id }
          : null,
      }
    }
    case 'deleteRecruit':
    case 'deleteEvent':
    case 'markAbsent': {
      const { data: next, removed } = cascadeRemove(d, cascadeFor(action))
      return { data: next, inverse: { type: 'restoreRows', removed } }
    }
    case 'restoreRows': {
      return { data: restoreRows(d, action.removed), inverse: null }
    }
    case 'toggleAttendance': {
      return {
        data: { ...d, attendance: toggleAttendance(d.attendance, action.eventId, action.recruitId) },
        inverse: { type: 'toggleAttendance', eventId: action.eventId, recruitId: action.recruitId },
      }
    }
    case 'addUser': {
      const email = String(action.email || '').trim()
      const users = addUser(d.users, email, { name: action.name, role: action.role })
      return {
        data: { ...d, users },
        inverse: { type: 'removeUser', email },
      }
    }
    case 'removeUser': {
      const { users, removed, index } = removeUser(d.users, action.email)
      if (!removed) return { data: d, inverse: null }
      return {
        data: { ...d, users },
        inverse: { type: 'insertUserAt', index, user: removed },
      }
    }
    case 'insertUserAt': {
      return {
        data: { ...d, users: insertAt(d.users, action.index, action.user) },
        inverse: { type: 'removeUser', email: action.user && action.user.email },
      }
    }
    case 'setUserRole': {
      const { users, previousRole } = setUserRole(d.users, action.email, action.role)
      return {
        data: { ...d, users },
        inverse: { type: 'setUserRole', email: action.email, role: previousRole },
      }
    }
    default:
      return { data: d, inverse: null }
  }
}

export function rollback(data, inverse) {
  if (!inverse) return data
  return apply(data, inverse).data
}
