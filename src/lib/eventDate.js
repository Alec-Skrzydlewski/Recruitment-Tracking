// Event dates are date-only strings, YYYY-MM-DD. They are never parsed with
// new Date(), so no time zone can shift the day.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isValidEventDate(value) {
  if (typeof value !== 'string') return false
  const m = RE.exec(value)
  if (!m) return false
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1) return false
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
  return d <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1]
}

// "2026-09-15" -> "Sep 15, 2026"; anything else -> '' (not recorded).
export function formatEventDate(value) {
  if (!isValidEventDate(value)) return ''
  const [y, mo, d] = value.split('-').map(Number)
  return `${MONTHS[mo - 1]} ${d}, ${y}`
}
