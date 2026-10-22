import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAJORS,
  MINORS,
  PROGRAM_LEVELS,
  OTHER,
  optionValue,
  graduationTerms,
} from '../src/lib/recruitOptions.js';

test('major, minor, and program level lists match the Daniels programs', () => {
  assert.deepEqual(MAJORS.undergraduate, [
    'Accounting (BSAcc)',
    'Business Information and Analytics (BSBA)',
    'Finance (BSBA)',
    'Hospitality Management (BSBA)',
    'International Business (BSBA)',
    'Management (BSBA)',
    'Marketing (BSBA)',
    'Real Estate and the Built Environment (BSBA)',
    'Economics (BA)',
  ]);
  assert.deepEqual(MAJORS.graduate, [
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
  ]);
  assert.deepEqual(MINORS, [
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
  ]);
  assert.deepEqual(PROGRAM_LEVELS, ['Undergraduate', 'MBA', 'Other Graduate']);
  const allMajors = MAJORS.undergraduate.concat(MAJORS.graduate);
  assert.equal(new Set(allMajors).size, allMajors.length);
  assert.equal(new Set(MINORS).size, MINORS.length);
});

test('Other sentinel stores the typed text instead of the sentinel', () => {
  assert.equal(OTHER, 'Other');
  assert.equal(optionValue('Finance (BSBA)', 'ignored'), 'Finance (BSBA)');
  assert.equal(optionValue('  Economics (BA)  '), 'Economics (BA)');
  assert.equal(optionValue(OTHER, '  Custom Studies  '), 'Custom Studies');
  assert.equal(optionValue(OTHER, '   '), '');
  assert.equal(optionValue(OTHER, null), '');
  assert.equal(optionValue('', 'Custom Studies'), '');
  assert.equal(optionValue(null, 'Custom Studies'), '');
});

function firstTerm(date) {
  return graduationTerms(date, 0)[0];
}

test('quarter boundaries split on mid-June and the month edges', () => {
  assert.equal(firstTerm(new Date(2026, 0, 1)), 'Winter 2026');
  assert.equal(firstTerm(new Date(2026, 2, 31)), 'Winter 2026');
  assert.equal(firstTerm(new Date(2026, 3, 1)), 'Spring 2026');
  assert.equal(firstTerm(new Date(2026, 4, 31)), 'Spring 2026');
  assert.equal(firstTerm(new Date(2026, 5, 14)), 'Spring 2026');
  assert.equal(firstTerm(new Date(2026, 5, 15)), 'Summer 2026');
  assert.equal(firstTerm(new Date(2026, 7, 31)), 'Summer 2026');
  assert.equal(firstTerm(new Date(2026, 8, 1)), 'Fall 2026');
  assert.equal(firstTerm(new Date(2026, 11, 31)), 'Fall 2026');
  assert.equal(firstTerm(new Date(2027, 0, 1)), 'Winter 2027');
});

test('graduation terms run Winter, Spring, Summer, Fall from the current term', () => {
  const when = new Date(2026, 9, 22);
  const fromFall = graduationTerms(when, 1);
  assert.deepEqual(fromFall, [
    'Fall 2026',
    'Winter 2027',
    'Spring 2027',
    'Summer 2027',
    'Fall 2027',
  ]);
  assert.equal(when.getMonth(), 9);

  assert.deepEqual(graduationTerms(new Date(2027, 0, 15), 1), [
    'Winter 2027',
    'Spring 2027',
    'Summer 2027',
    'Fall 2027',
    'Winter 2028',
  ]);

  const sixYears = graduationTerms(new Date(2026, 9, 22));
  assert.equal(sixYears[0], 'Fall 2026');
  assert.equal(sixYears[1], 'Winter 2027');
  assert.equal(sixYears[2], 'Spring 2027');
  assert.equal(sixYears[sixYears.length - 1], 'Fall 2032');
  assert.equal(sixYears.length, 25);
  assert.equal(new Set(sixYears).size, sixYears.length);

  const springWindow = graduationTerms(new Date(2026, 5, 14), 6);
  assert.equal(springWindow[0], 'Spring 2026');
  assert.equal(springWindow[springWindow.length - 1], 'Spring 2032');

  const summerWindow = graduationTerms(new Date(2026, 5, 15), 6);
  assert.equal(summerWindow[0], 'Summer 2026');
  assert.equal(summerWindow[summerWindow.length - 1], 'Summer 2032');

  const leap = graduationTerms(new Date(2024, 1, 29), 6);
  assert.equal(leap[0], 'Winter 2024');
  assert.equal(leap[leap.length - 1], 'Winter 2030');
});
