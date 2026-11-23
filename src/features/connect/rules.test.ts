import { canDownload, scanLabel, MAX_ATTACHMENT_BYTES, MUTE_CHOICES, REPORT_REASONS, URGENCY_CHOICES, attachmentPath, canCompose, canStartPrivate, formatBytes, linkify, safeFileName, validateAttachments, groupByDay, muteUntilIso, totalUnread, validateMessage, validateMuteReason, validateOversightReason, validateReport } from './rules';

describe('messages and reports', () => {
  it('needs some text and at most 2000 characters', () => {
    expect(validateMessage('')).toMatch(/Write a message/);
    expect(validateMessage('   \n ')).toMatch(/Write a message/);
    expect(validateMessage('Hello')).toBeNull();
    expect(validateMessage('x'.repeat(2000))).toBeNull();
    expect(validateMessage('x'.repeat(2001))).toMatch(/2000/);
  });
  it('accepts only the report reasons the database knows', () => {
    expect(REPORT_REASONS.map((r) => r.value)).toEqual(['bullying_or_harassment', 'inappropriate_content', 'personal_information', 'safety_concern', 'spam', 'other']);
    expect(validateReport('spam', '')).toBeNull();
    expect(validateReport('made_up', '')).toMatch(/Choose a reason/);
    expect(validateReport('other', 'x'.repeat(501))).toMatch(/500/);
  });
  it('requires written reasons for oversight and muting', () => {
    expect(validateOversightReason('too short')).toMatch(/at least 10/);
    expect(validateOversightReason('Reviewing a reported safety concern')).toBeNull();
    expect(validateMuteReason('no')).toMatch(/at least 5/);
    expect(validateMuteReason('Cooling off')).toBeNull();
  });
});

describe('who does what', () => {
  it('lets only learners and facilitators start private conversations (19 Nov 2026 decision)', () => {
    expect(canStartPrivate('participant')).toBe(true);
    expect(canStartPrivate('trainer')).toBe(true);
    for (const r of ['founder', 'super_admin', 'programme_director', 'applicant', '', null, undefined]) expect(canStartPrivate(r)).toBe(false);
  });
  it('lets only learners and facilitators write; executives oversee read-only', () => {
    expect(canCompose('participant')).toBe(true);
    expect(canCompose('trainer')).toBe(true);
    for (const r of ['founder', 'co_founder', 'super_admin', 'programme_coordinator', null, undefined]) expect(canCompose(r)).toBe(false);
  });
});

describe('unread and day grouping', () => {
  it('adds up unread counts, including counts that arrive as strings', () => {
    expect(totalUnread([{ unread: 2 }, { unread: '3' }, { unread: null }])).toBe(5);
    expect(totalUnread([])).toBe(0);
  });
  it('shows messages oldest first, grouped by programme day', () => {
    const msgs = [
      { id: 3, created_at: '2027-01-11T22:30:00.000Z' },   // 01:30 on the 12th in Nairobi
      { id: 1, created_at: '2027-01-11T05:00:00.000Z' },
      { id: 2, created_at: '2027-01-11T10:00:00.000Z' },
    ];
    const nairobi = groupByDay(msgs, 'Africa/Nairobi');
    expect(nairobi.map((g) => g.day)).toEqual(['2027-01-11', '2027-01-12']);
    expect(nairobi[0]?.items.map((m) => m.id)).toEqual([1, 2]);
    expect(nairobi[1]?.items.map((m) => m.id)).toEqual([3]);
    expect(groupByDay(msgs, 'UTC').map((g) => g.day)).toEqual(['2027-01-11']);
    expect(groupByDay([], 'UTC')).toEqual([]);
  });
});

describe('mute length', () => {
  it('offers one day or seven and computes a future time', () => {
    expect(MUTE_CHOICES.map((c) => c.days)).toEqual([1, 7]);
    expect(muteUntilIso(1, new Date('2027-01-10T08:00:00.000Z'))).toBe('2027-01-11T08:00:00.000Z');
  });
});

describe('phase 4 completion (19 Nov 2026 decisions)', () => {
  it('lets facilitators start conversations as well as learners', () => {
    expect(canStartPrivate('participant')).toBe(true);
    expect(canStartPrivate('trainer')).toBe(true);
    for (const r of ['founder', 'super_admin', 'programme_director', 'mentor', 'applicant', null]) expect(canStartPrivate(r)).toBe(false);
  });
  it('offers exactly the two urgency levels the database accepts', () => {
    expect(URGENCY_CHOICES.map((u) => u.value)).toEqual(['urgent', 'standard']);
  });
  it('accepts only safe document and image types up to 10 MB, at most 3 files', () => {
    const pdf = { name: 'plan.pdf', size: 2048, type: 'application/pdf' };
    expect(validateAttachments([pdf])).toBeNull();
    expect(validateAttachments([])).toBeNull();
    expect(validateAttachments([{ name: 'tool.exe', size: 10, type: 'application/x-msdownload' }])).toMatch(/only PDF/);
    expect(validateAttachments([{ name: 'page.html', size: 10, type: 'text/html' }])).toMatch(/only PDF/);
    expect(validateAttachments([{ name: 'big.pdf', size: MAX_ATTACHMENT_BYTES + 1, type: 'application/pdf' }])).toMatch(/10 MB/);
    expect(validateAttachments([{ name: 'empty.pdf', size: 0, type: 'application/pdf' }])).toMatch(/empty/);
    expect(validateAttachments([pdf, pdf, pdf, pdf])).toMatch(/at most 3/);
  });
  it('makes storage-safe file names and paths in the folder the database expects', () => {
    expect(safeFileName('My CV (final).docx')).toBe('My_CV_final_.docx');
    expect(safeFileName('../../etc/passwd')).toBe('etc_passwd');
    expect(safeFileName('???')).toBe('file');
    expect(attachmentPath('conv', 'user', 'u1', 'a b.pdf')).toBe('conv/user/u1-a_b.pdf');
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
  it('turns only http and https addresses into links, without trailing punctuation', () => {
    const segs = linkify('See https://dira.org/apply. Thanks!');
    expect(segs).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'link', href: 'https://dira.org/apply', text: 'https://dira.org/apply', host: 'dira.org' },
      { kind: 'text', text: '. Thanks!' },
    ]);
    expect(linkify('javascript:alert(1) and data:text/html,x')).toEqual([{ kind: 'text', text: 'javascript:alert(1) and data:text/html,x' }]);
    expect(linkify('no links here')).toEqual([{ kind: 'text', text: 'no links here' }]);
    expect(linkify('(http://example.com)').filter((s) => s.kind === 'link')).toHaveLength(1);
    expect(linkify('two: http://a.com and https://b.org/x?y=1')).toHaveLength(4);
  });
});

describe('virus checks (migration 29)', () => {
  it('allows downloads only for files scanned clean', () => {
    expect(canDownload('clean')).toBe(true);
    for (const s of ['pending', 'scanning', 'infected', 'scan_failed', 'not_scanned', '']) expect(canDownload(s)).toBe(false);
  });
  it('explains each state in plain words', () => {
    expect(scanLabel('pending')).toMatch(/Waiting for a virus check/);
    expect(scanLabel('scanning')).toMatch(/Waiting for a virus check/);
    expect(scanLabel('scan_failed')).toMatch(/cannot be opened/);
    expect(scanLabel('clean')).toBe('Checked for viruses');
  });
});
