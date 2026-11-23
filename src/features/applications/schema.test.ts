import { applicationSchema, ageOn, validateDocument, MAX_DOC_BYTES } from './schema';

const yearsAgo = (y: number, extraDays = 0) => {
  const d = new Date(); d.setFullYear(d.getFullYear() - y); d.setDate(d.getDate() + extraDays);
  return d.toISOString().slice(0, 10);
};
const valid = {
  firstName: 'Amina', lastName: 'Otieno', dateOfBirth: yearsAgo(21), phone: '+254 700 000 000', location: 'Nairobi',
  educationLevel: 'diploma' as const, skills: 'Graphic design, Excel', motivation: 'x'.repeat(60), consent: true as const,
};

describe('ageOn', () => {
  it('handles birthdays not yet reached', () => {
    expect(ageOn(new Date('2000-06-15'), new Date('2020-06-14'))).toBe(19);
    expect(ageOn(new Date('2000-06-15'), new Date('2020-06-15'))).toBe(20);
  });
});

describe('applicationSchema', () => {
  it('accepts a valid application', () => { expect(applicationSchema.safeParse(valid).success).toBe(true); });
  it('rejects applicants under 18 and over 25', () => {
    expect(applicationSchema.safeParse({ ...valid, dateOfBirth: yearsAgo(17) }).success).toBe(false);
    expect(applicationSchema.safeParse({ ...valid, dateOfBirth: yearsAgo(27) }).success).toBe(false);
  });
  it('accepts exactly 18 and 25', () => {
    expect(applicationSchema.safeParse({ ...valid, dateOfBirth: yearsAgo(18) }).success).toBe(true);
    expect(applicationSchema.safeParse({ ...valid, dateOfBirth: yearsAgo(25) }).success).toBe(true);
  });
  it('requires consent and a motivation of at least 50 characters', () => {
    expect(applicationSchema.safeParse({ ...valid, consent: false }).success).toBe(false);
    expect(applicationSchema.safeParse({ ...valid, motivation: 'too short' }).success).toBe(false);
  });
  it('rejects missing required fields and bad phone numbers', () => {
    expect(applicationSchema.safeParse({ ...valid, firstName: '  ' }).success).toBe(false);
    expect(applicationSchema.safeParse({ ...valid, phone: 'abc' }).success).toBe(false);
  });
  it('rejects an invalid date', () => { expect(applicationSchema.safeParse({ ...valid, dateOfBirth: 'not-a-date' }).success).toBe(false); });
});

describe('validateDocument', () => {
  it('accepts pdf/jpg/png within size', () => { expect(validateDocument({ type: 'application/pdf', size: 1000 })).toBeNull(); });
  it('rejects other types, oversize and empty files', () => {
    expect(validateDocument({ type: 'application/x-msdownload', size: 1000 })).not.toBeNull();
    expect(validateDocument({ type: 'image/png', size: MAX_DOC_BYTES + 1 })).not.toBeNull();
    expect(validateDocument({ type: 'image/png', size: 0 })).not.toBeNull();
  });
});
