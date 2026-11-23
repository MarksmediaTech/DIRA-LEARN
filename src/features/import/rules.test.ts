import * as rulesModule from './rules';
import { MAX_ROWS, checkSingleLearner, clean, parseCsv, parseLearnerCsv, sampleCsv, validRows } from './rules';

describe('parseCsv', () => {
  it('reads quoted fields, doubled quotes and CRLF', () => {
    expect(parseCsv('a,b\r\n"x, y","he said ""hi"""\r\n')).toEqual([['a', 'b'], ['x, y', 'he said "hi"']]);
  });
  it('detects semicolon separators and strips a byte-order mark', () => expect(parseCsv('\uFEFFa;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]));
  it('drops blank lines and keeps a last line without a newline', () => expect(parseCsv('a,b\n\n1,2')).toEqual([['a', 'b'], ['1', '2']]));
});

const TRACKS = [{ id: 't-dm', name: 'Digital Marketing' }, { id: 't-ai', name: 'AI Tools' }, { id: 't-cc', name: 'Content Creation' }, { id: 't-eb', name: 'Entrepreneurship & Business' }];

describe('parseLearnerCsv (name, email, programme_track)', () => {
  it('accepts a good file, lower-cases emails and matches tracks without case or extra spaces', () => {
    const p = parseLearnerCsv('name,email,programme_track\nMary Wanjiku,MARY@Example.org,ai  tools\nJohn Otieno,john@example.org,Content Creation\n', TRACKS);
    expect(p.fileError).toBeNull();
    expect(p.rows).toEqual([
      { rowNo: 2, name: 'Mary Wanjiku', email: 'mary@example.org', programmeTrack: 'ai tools', trackId: 't-ai', trackName: 'AI Tools', error: null },
      { rowNo: 3, name: 'John Otieno', email: 'john@example.org', programmeTrack: 'Content Creation', trackId: 't-cc', trackName: 'Content Creation', error: null },
    ]);
  });
  it('accepts the columns in any order and with capitals or spaces in the header', () => {
    const p = parseLearnerCsv('Email, Programme Track ,NAME\na@b.org,Digital Marketing,Ann One\n', TRACKS);
    expect(p.fileError).toBeNull(); const r = p.rows[0]!; expect([r.name, r.email, r.trackId, r.error]).toEqual(['Ann One', 'a@b.org', 't-dm', null]);
  });
  it('rejects a file with a missing column, naming it', () => {
    expect(parseLearnerCsv('name,email\nA,a@b.org', TRACKS).fileError).toMatch(/exactly these columns: name, email, programme_track\. Missing: programme_track/);
    expect(parseLearnerCsv('first_name,last_name,email\nA,B,a@b.org', TRACKS).fileError).toMatch(/Missing: name, programme_track/);
  });
  it('rejects extra or repeated columns, and empty / header-only files', () => {
    expect(parseLearnerCsv('name,email,programme_track,phone\nA,a@b.org,AI Tools,1', TRACKS).fileError).toMatch(/not used: phone/);
    expect(parseLearnerCsv('name,email,programme_track,email\nA,a@b.org,AI Tools,x', TRACKS).fileError).toMatch(/appears twice: email/);
    expect(parseLearnerCsv('', TRACKS).fileError).toMatch(/empty/);
    expect(parseLearnerCsv('name,email,programme_track\n', TRACKS).fileError).toMatch(/no learners/);
  });
  it('ignores empty trailing header cells that spreadsheets add', () => expect(parseLearnerCsv('name,email,programme_track,,\nA B,a@b.org,AI Tools,,', TRACKS).fileError).toBeNull());
  it('flags bad rows individually and keeps the good ones', () => {
    const p = parseLearnerCsv('name,email,programme_track\nBrian Njima,brian@example.com,Digital Skills\nMary Wanjiku,mary@example.com,AI Tools\n,x@example.com,AI Tools\nJoy Achieng,not-an-email,AI Tools\nMary Again,MARY@example.com,AI Tools\nNo Track,nt@example.com,\n', TRACKS);
    expect(p.rows.map((r) => r.error)).toEqual([
      '"Digital Skills" is not a programme track in DIRA LEARN. Use one of: Digital Marketing, AI Tools, Content Creation, Entrepreneurship & Business.',
      null, 'The name is missing.', 'The email address is not valid.', 'Same email as row 3.', 'The programme track is missing.']);
    expect(validRows(p.rows).map((r) => r.email)).toEqual(['mary@example.com']);
  });
  it('does not guess tracks (no partial or "and" for "&" matches)', () => {
    const p = parseLearnerCsv('name,email,programme_track\nA B,a@b.org,Entrepreneurship and Business\nC D,c@d.org,Marketing\n', TRACKS);
    expect(p.rows.every((r) => r.error && r.trackId === null)).toBe(true);
  });
  it('refuses a file when no tracks are configured', () => expect(parseLearnerCsv('name,email,programme_track\nA,a@b.org,AI Tools', []).fileError).toMatch(/No programme tracks/));
  it('refuses more than the row limit', () => {
    const body = Array.from({ length: MAX_ROWS + 1 }, (_, i) => `A B,a${i}@b.org,AI Tools`).join('\n');
    expect(parseLearnerCsv('name,email,programme_track\n' + body, TRACKS).fileError).toMatch(/at most 200/);
  });
  it('strips control characters and extra spaces from names', () => expect(parseLearnerCsv('name,email,programme_track\n"  Amina\u0007  Joy ",a@b.org,AI Tools', TRACKS).rows[0]!.name).toBe('Amina Joy'));
  it('the downloadable template is itself a valid file', () => {
    const p = parseLearnerCsv(sampleCsv(TRACKS), TRACKS); expect(p.fileError).toBeNull(); expect(validRows(p.rows)).toHaveLength(2);
  });
});

describe('checkSingleLearner (Add learner form)', () => {
  it('accepts a learner and cleans the values', () => {
    const r = checkSingleLearner({ name: '  Mary   Wanjiku ', email: ' MARY@Example.com ', trackId: 't-ai' }, TRACKS);
    expect(r).toEqual({ ok: true, name: 'Mary Wanjiku', email: 'mary@example.com', track: { id: 't-ai', name: 'AI Tools' } });
  });
  it('names the first problem', () => {
    expect(checkSingleLearner({ name: '', email: 'a@b.org', trackId: 't-ai' }, TRACKS)).toEqual({ ok: false, error: "Enter the learner's name." });
    expect(checkSingleLearner({ name: 'A B', email: '', trackId: 't-ai' }, TRACKS)).toEqual({ ok: false, error: "Enter the learner's email address." });
    expect(checkSingleLearner({ name: 'A B', email: 'nope', trackId: 't-ai' }, TRACKS)).toEqual({ ok: false, error: 'The email address is not valid.' });
    expect(checkSingleLearner({ name: 'A B', email: 'a@b.org', trackId: '' }, TRACKS)).toEqual({ ok: false, error: 'Choose the programme track.' });
    expect(checkSingleLearner({ name: 'A B', email: 'a@b.org', trackId: 'not-a-track' }, TRACKS)).toEqual({ ok: false, error: 'Choose the programme track.' });
  });
});

describe('full name is kept whole', () => {
  it('keeps the name exactly as entered in a CSV row', () => {
    const r = parseLearnerCsv('name,email,programme_track\nBrian Njima Otieno,b@example.org,Digital Marketing\n', [{ id: 't1', name: 'Digital Marketing' }]);
    expect(r.rows[0]?.name).toBe('Brian Njima Otieno');
  });
  it('keeps a single name and the form name unchanged', () => {
    const c = checkSingleLearner({ name: '  Amina  ', email: 'a@example.org', trackId: 't1' }, [{ id: 't1', name: 'Digital Marketing' }]);
    expect(c.ok && c.name).toBe('Amina');
  });
  it('no helper splits names any more', () => { expect('splitName' in (rulesModule as object)).toBe(false); });
});


describe('clean (control characters, ESLint no-control-regex fix)', () => {
  // The previous implementation, kept here only to prove the new one behaves identically.
  // eslint-disable-next-line no-control-regex -- reference implementation used only in this test
  const previous = (s: string) => s.replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();
  it('removes control characters and tidies spaces exactly as before', () => {
    const samples = ['  Wanjiru\u0000 Kamau\t', 'A\u001Fb\u007Fc', '\u0007Otieno\r\n', 'Émilie  😀  Njeri', '\u0085next-line\u00A0nbsp', '', '\u0000\u0001\u0002'];
    for (let c = 0; c < 0x250; c++) samples.push(`x${String.fromCharCode(c)}y`);
    for (const s of samples) expect(clean(s)).toBe(previous(s));
  });
});
