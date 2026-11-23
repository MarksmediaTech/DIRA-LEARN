import { placeholders, scheduleInstant, summarise, unknownPlaceholders, validateTemplate, BULK_VARS } from './rules';

describe('placeholders', () => {
  it('finds each placeholder once', () => expect(placeholders('Hi {{first_name}}, {{first_name}} of {{cohort_name}}')).toEqual(['first_name', 'cohort_name']));
  it('flags unknown and malformed ones', () => {
    expect(unknownPlaceholders('{{first_name}} {{nope}} {{ spaced }} {{Upper}}', BULK_VARS)).toEqual(['nope', ' spaced ', 'Upper']);
  });
});

describe('validateTemplate', () => {
  const ok = { key: 'welcome_note', name: 'Welcome', subject: 'Hello {{first_name}}', body: 'Welcome to {{cohort_name}}' };
  it('accepts a valid template', () => expect(validateTemplate(ok, BULK_VARS, true)).toBeNull());
  it('rejects a bad key only for new templates', () => {
    expect(validateTemplate({ ...ok, key: 'Bad Key' }, BULK_VARS, true)).toMatch(/key/);
    expect(validateTemplate({ ...ok, key: 'Bad Key' }, BULK_VARS, false)).toBeNull();
  });
  it('rejects unavailable placeholders and short fields', () => {
    expect(validateTemplate({ ...ok, body: 'Due {{due_date}}' }, BULK_VARS, true)).toMatch(/\{\{due_date\}\}/);
    expect(validateTemplate({ ...ok, subject: 'Hi' }, BULK_VARS, true)).toMatch(/subject/);
    expect(validateTemplate({ ...ok, body: '  ' }, BULK_VARS, true)).toMatch(/message/);
  });
});

describe('summarise', () => {
  it('counts each status and keeps sent apart from delivered', () => {
    const s = summarise([{ status: 'sent' }, { status: 'delivered' }, { status: 'delivered' }, { status: 'bounced' }]);
    expect(s.sent).toBe(1); expect(s.delivered).toBe(2); expect(s.bounced).toBe(1); expect(s.failed).toBe(0);
  });
});

describe('scheduleInstant', () => {
  const now = new Date('2026-11-04T10:00:00');
  it('means send now when both are empty', () => expect(scheduleInstant('', '', now)).toEqual({ iso: null, error: null }));
  it('needs both fields', () => expect(scheduleInstant('2026-11-05', '', now).error).toMatch(/both/));
  it('refuses the past but allows the near future', () => {
    expect(scheduleInstant('2026-11-03', '09:00', now).error).toMatch(/past/);
    expect(scheduleInstant('2026-11-05', '09:00', now).iso).toBe(new Date('2026-11-05T09:00').toISOString());
  });
});
