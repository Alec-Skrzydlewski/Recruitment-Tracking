const AUTO_LINK_SCORE = 0.85;
const AUTO_LINK_MARGIN = 0.1;
const REVIEW_SCORE = 0.6;
const MAX_SUGGESTIONS = 3;

export function normalizeName(filename) {
  let name = String(filename == null ? '' : filename).trim();
  name = name.replace(/\.[A-Za-z0-9]{1,8}$/, '');
  let previous = name;
  do {
    previous = name;
    name = name.replace(/\s*\(\d+\)\s*$/, '');
    name = name.replace(/\s*-\s*copy\s*$/i, '');
  } while (name !== previous);
  const comma = name.match(/^\s*([^,]+),\s*([^,]+?)\s*$/);
  if (comma) name = (comma[2] + ' ' + comma[1]).trim();
  name = name.toLowerCase();
  name = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  name = name.replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  return name;
}

// Adjacent transposition counts as one edit so "Smtih" stays within the auto-link band.
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const rows = new Array(m + 1);
  for (let i = 0; i <= m; i++) {
    rows[i] = new Array(n + 1);
    rows[i][0] = i;
  }
  for (let j = 0; j <= n; j++) rows[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      let best = rows[i - 1][j] + 1;
      const del = rows[i][j - 1] + 1;
      if (del < best) best = del;
      const sub = rows[i - 1][j - 1] + cost;
      if (sub < best) best = sub;
      if (
        i > 1 && j > 1 &&
        a.charCodeAt(i - 1) === b.charCodeAt(j - 2) &&
        a.charCodeAt(i - 2) === b.charCodeAt(j - 1)
      ) {
        const swap = rows[i - 2][j - 2] + 1;
        if (swap < best) best = swap;
      }
      rows[i][j] = best;
    }
  }
  return rows[m][n];
}

function tokenKey(normalized) {
  return normalized.split(' ').filter(Boolean).sort().join(' ');
}

function ratio(a, b) {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

export function similarity(a, b) {
  const left = normalizeName(a);
  const right = normalizeName(b);
  const direct = ratio(left, right);
  const tokens = ratio(tokenKey(left), tokenKey(right));
  return direct > tokens ? direct : tokens;
}

function fieldText(value) {
  if (value == null) return '';
  return String(value).trim();
}

function hasPhoto(recruit) {
  return !!(fieldText(recruit.photoFileId) || fieldText(recruit.photoSource));
}

export function planPhotoLinks(files, recruits) {
  const people = (recruits || []).map(recruit => ({
    id: fieldText(recruit && recruit.id),
    name: fieldText(recruit && recruit.name),
    photoFileId: fieldText(recruit && recruit.photoFileId),
    photoSource: fieldText(recruit && recruit.photoSource),
  })).filter(recruit => recruit.id);

  const takenFiles = new Set(people.map(recruit => recruit.photoFileId).filter(Boolean));
  const pending = [];
  const seenFiles = new Set();
  (files || []).forEach(file => {
    const fileId = fieldText(file && file.fileId);
    if (!fileId || seenFiles.has(fileId) || takenFiles.has(fileId)) return;
    seenFiles.add(fileId);
    pending.push({
      fileId: fileId,
      fileName: file && file.fileName != null ? String(file.fileName) : '',
    });
  });

  const takenRecruits = new Set(people.filter(hasPhoto).map(recruit => recruit.id));
  const decisions = pending.map(file => {
    const ranked = people.map(recruit => ({
      recruitId: recruit.id,
      name: recruit.name,
      score: similarity(file.fileName, recruit.name),
    })).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.recruitId < b.recruitId) return -1;
      if (a.recruitId > b.recruitId) return 1;
      return 0;
    });
    const suggestions = [];
    for (let i = 0; i < ranked.length && suggestions.length < MAX_SUGGESTIONS; i++) {
      if (ranked[i].score >= REVIEW_SCORE) suggestions.push(ranked[i]);
    }
    const best = ranked[0] || null;
    const secondScore = ranked.length > 1 ? ranked[1].score : 0;
    const margin = best ? best.score - secondScore : 0;
    return { file: file, best: best, margin: margin, suggestions: suggestions };
  });

  const auto = decisions.filter(item => (
    item.best &&
    item.best.score >= AUTO_LINK_SCORE &&
    item.margin >= AUTO_LINK_MARGIN &&
    !takenRecruits.has(item.best.recruitId)
  ));
  auto.sort((a, b) => {
    if (b.best.score !== a.best.score) return b.best.score - a.best.score;
    if (a.file.fileName < b.file.fileName) return -1;
    if (a.file.fileName > b.file.fileName) return 1;
    return 0;
  });

  const linked = [];
  const linkedFiles = new Set();
  auto.forEach(item => {
    const recruitId = item.best.recruitId;
    if (takenRecruits.has(recruitId)) return;
    takenRecruits.add(recruitId);
    linkedFiles.add(item.file.fileId);
    linked.push({
      fileId: item.file.fileId,
      fileName: item.file.fileName,
      recruitId: recruitId,
      name: item.best.name,
      score: item.best.score,
    });
  });

  const unmatched = [];
  decisions.forEach(item => {
    if (linkedFiles.has(item.file.fileId)) return;
    const bestScore = item.best ? item.best.score : 0;
    unmatched.push({
      fileId: item.file.fileId,
      fileName: item.file.fileName,
      suggestions: bestScore >= REVIEW_SCORE ? item.suggestions : [],
    });
  });

  return { linked: linked, unmatched: unmatched };
}
