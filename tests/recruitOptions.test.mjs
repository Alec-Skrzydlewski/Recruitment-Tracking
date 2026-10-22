import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAJORS,
  OTHER,
  optionValue,
  gradYears,
} from '../src/lib/recruitOptions.js';

test('major lists match the Daniels programs', () => {
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
  const allMajors = MAJORS.undergraduate.concat(MAJORS.graduate);
  assert.equal(new Set(allMajors).size, allMajors.length);
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

test('graduation years run from the injected date through eight years later', () => {
  const fall = new Date(2026, 9, 22);
  assert.deepEqual(gradYears(fall, 8), [2026, 2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034]);
  assert.deepEqual(gradYears(new Date(2026, 0, 1)), gradYears(new Date(2026, 11, 31)));
  assert.equal(fall.getMonth(), 9);

  const now = new Date();
  const live = gradYears(now);
  assert.equal(live[0], now.getFullYear());
  assert.equal(live[live.length - 1], now.getFullYear() + 8);
  assert.equal(live.length, 9);
  assert.equal(new Set(live).size, live.length);
});
