// Daniels majors, minors, and DU quarter labels for the Add Recruit form.
// Summer starts on June 15 (mid-June). Spring runs through June 14.

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

export const MINORS = [
  'Accounting',
  'Business Administration',
  'Business Analytics',
  'Business Ethics and Legal Studies',
  'Construction Management',
  'Entrepreneurship',
  'Finance',
  'Franchise Business Management',
  'Leadership in the Outdoor Recreation Industry',
  'Management',
  'Marketing',
  'Real Estate Development',
  'Real Estate Finance and Investments',
  'Sales Leadership',
  'Statistics',
]

export const PROGRAM_LEVELS = ['Undergraduate', 'MBA', 'Other Graduate']

// Select value that opens a text field. The stored recruit value is the typed text.
export const OTHER = 'Other'

const TERM_NAMES = ['Winter', 'Spring', 'Summer', 'Fall']

export function optionValue(selection, typed = '') {
  if (selection === OTHER) return String(typed == null ? '' : typed).trim()
  if (selection == null) return ''
  return String(selection).trim()
}

function termParts(date) {
  const month = date.getMonth()
  const day = date.getDate()
  const year = date.getFullYear()
  let name
  if (month <= 2) name = 'Winter'
  else if (month <= 4 || (month === 5 && day < 15)) name = 'Spring'
  else if (month <= 7) name = 'Summer'
  else name = 'Fall'
  return { name, year }
}

export function graduationTerms(now = new Date(), years = 6) {
  const start = termParts(now)
  const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  endDate.setFullYear(endDate.getFullYear() + years)
  const end = termParts(endDate)

  const terms = []
  let year = start.year
  let index = TERM_NAMES.indexOf(start.name)
  const guard = years * 4 + 8
  for (let i = 0; i < guard; i++) {
    const name = TERM_NAMES[index]
    terms.push(`${name} ${year}`)
    if (name === end.name && year === end.year) break
    index += 1
    if (index === 4) {
      index = 0
      year += 1
    }
  }
  return terms
}
