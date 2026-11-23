import { DEFAULT_TIME_ZONE, formatInZone, hourInZone, isValidTimeZone, isoToZonedLocal, listTimeZones, todayInZone, zonedLocalToIso } from './timezone';

describe('programme time zone', () => {
  it('defaults to Africa/Nairobi, which matches the existing reminder emails', () => { expect(DEFAULT_TIME_ZONE).toBe('Africa/Nairobi'); });
  it('recognises real and unknown zones', () => {
    expect(isValidTimeZone('Africa/Nairobi')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
  });
  it('reads a time typed in Nairobi (UTC+3, no daylight saving) as the right instant', () => {
    expect(zonedLocalToIso('2027-01-11T08:00', 'Africa/Nairobi')).toBe('2027-01-11T05:00:00.000Z');
    expect(zonedLocalToIso('2027-01-11T00:30', 'Africa/Nairobi')).toBe('2027-01-10T21:30:00.000Z');
  });
  it('handles zones with daylight saving', () => {
    expect(zonedLocalToIso('2027-01-11T08:00', 'America/New_York')).toBe('2027-01-11T13:00:00.000Z');
    expect(zonedLocalToIso('2027-07-11T08:00', 'America/New_York')).toBe('2027-07-11T12:00:00.000Z');
  });
  it('treats empty or malformed input as not set', () => {
    expect(zonedLocalToIso('', 'Africa/Nairobi')).toBeNull();
    expect(zonedLocalToIso('11/01/2027', 'Africa/Nairobi')).toBeNull();
    expect(zonedLocalToIso(null, 'Africa/Nairobi')).toBeNull();
  });
  it('shows an instant as wall-clock time in the programme zone and round-trips', () => {
    expect(isoToZonedLocal('2027-01-11T05:00:00.000Z', 'Africa/Nairobi')).toBe('2027-01-11T08:00');
    expect(isoToZonedLocal(null, 'Africa/Nairobi')).toBe('');
    for (const tz of ['Africa/Nairobi', 'America/New_York', 'UTC']) {
      expect(zonedLocalToIso(isoToZonedLocal('2027-03-05T14:45:00.000Z', tz), tz)).toBe('2027-03-05T14:45:00.000Z');
    }
  });
  it('formats and lists zones', () => {
    expect(formatInZone(null, 'Africa/Nairobi')).toBe('not set');
    expect(formatInZone('2027-01-11T05:00:00.000Z', 'Africa/Nairobi')).toMatch(/2027/);
    expect(listTimeZones()).toContain('UTC');
  });
});

describe('today and hour in the programme zone', () => {
  it('uses the programme calendar day, not the browser day', () => {
    const lateEveningUtc = new Date('2027-01-10T22:30:00.000Z');   // already the next day in Nairobi (UTC+3)
    expect(todayInZone('UTC', lateEveningUtc)).toBe('2027-01-10');
    expect(todayInZone('Africa/Nairobi', lateEveningUtc)).toBe('2027-01-11');
    expect(hourInZone('Africa/Nairobi', lateEveningUtc)).toBe(1);
    expect(hourInZone('UTC', lateEveningUtc)).toBe(22);
  });
});
