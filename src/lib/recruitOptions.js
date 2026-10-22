// Daniels majors for the Add Recruit form. Graduation is a year, computed at runtime.

export const MAJORS = {
  undergraduate: [
    'Accounting (BSAcc)',
    'Business Information and Analytics (BSBA)',
    'Finance (BSBA)',
    'Hospitality Management (BSBA)',
    'International Business (BSBA)',
    'Management (BSBA)',
    'Marketing (BSBA)',
    'Real Estate and the Built Environment (BSBA)',
    'Economics (BA)',
  ],
  graduate: [
    'Denver MBA (Full-time)',
    'Professional MBA (Part-time)',
    'Executive MBA',
    'Online MBA',
    'Master of Accountancy (MAcc)',
    'MS in Accounting, Technology and Analytics',
    'MS in Business Analytics',
    'MS in Applied Quantitative Finance',
    'MS in Marketing',
    'MS in Real Estate and the Built Environment',
    'MS in Real Estate and Construction Management',
  ],
}

// Select value that opens a text field. The stored recruit value is the typed text.
export const OTHER = 'Other'

export function optionValue(selection, typed = '') {
  if (selection === OTHER) return String(typed == null ? '' : typed).trim()
  if (selection == null) return ''
  return String(selection).trim()
}

// Inclusive: current calendar year through currentYear + span.
export function gradYears(now = new Date(), span = 8) {
  const start = now.getFullYear()
  const count = Number.isFinite(Number(span)) ? Number(span) : 8
  const years = []
  for (let i = 0; i <= count; i++) years.push(start + i)
  return years
}
