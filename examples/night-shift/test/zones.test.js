// Task 1: zone primitives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidZone, localParts, offsetAt, formatOffset, formatDate, formatTime } from '../src/zones.js';

const utc = (y, m, d, hh, mm) => Date.UTC(y, m - 1, d, hh, mm);

test('offsetAt tracks New York across the 2026-03-08 spring change', () => {
  // Before 07:00Z New York is EST (-300); at/after it is EDT (-240).
  assert.equal(offsetAt(utc(2026, 3, 8, 6, 59), 'America/New_York'), -300);
  assert.equal(offsetAt(utc(2026, 3, 8, 7, 0), 'America/New_York'), -240);
});

test('offsetAt tracks New York across the 2026-11-01 fall change', () => {
  assert.equal(offsetAt(utc(2026, 11, 1, 5, 59), 'America/New_York'), -240);
  assert.equal(offsetAt(utc(2026, 11, 1, 6, 0), 'America/New_York'), -300);
});

test('offsetAt handles Lord Howe +630/+660', () => {
  assert.equal(offsetAt(utc(2026, 7, 1, 0, 0), 'Australia/Lord_Howe'), 630);
  assert.equal(offsetAt(utc(2026, 1, 1, 0, 0), 'Australia/Lord_Howe'), 660);
});

test('offsetAt handles Kathmandu +345 and Kolkata +330', () => {
  assert.equal(offsetAt(utc(2026, 6, 1, 0, 0), 'Asia/Kathmandu'), 345);
  assert.equal(offsetAt(utc(2026, 6, 1, 0, 0), 'Asia/Kolkata'), 330);
});

test('localParts at midnight returns hour 0, not 24', () => {
  const parts = localParts(utc(2026, 6, 15, 0, 0), 'UTC');
  assert.equal(parts.hour, 0);
  assert.equal(parts.minute, 0);
  assert.equal(parts.year, 2026);
  assert.equal(parts.month, 6);
  assert.equal(parts.day, 15);
});

test('formatOffset formats minutes east of UTC', () => {
  assert.equal(formatOffset(330), '+05:30');
  assert.equal(formatOffset(-240), '-04:00');
  assert.equal(formatOffset(345), '+05:45');
  assert.equal(formatOffset(0), '+00:00');
});

test('isValidZone accepts IANA names and rejects junk and offset strings', () => {
  assert.equal(isValidZone('America/New_York'), true);
  assert.equal(isValidZone('UTC'), true);
  assert.equal(isValidZone('Nope/Zone'), false);
  assert.equal(isValidZone(''), false);
  assert.equal(isValidZone('+05:30'), false);
});

test('formatDate and formatTime zero-pad', () => {
  assert.equal(formatDate({ year: 2026, month: 3, day: 8 }), '2026-03-08');
  assert.equal(formatTime({ hour: 2, minute: 5 }), '02:05');
  assert.equal(formatTime({ hour: 0, minute: 0 }), '00:00');
});
