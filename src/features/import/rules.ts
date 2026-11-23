export const MAX_ROWS = 200;
/** One CSV row after checking. `trackId`/`trackName` are the configured DIRA LEARN track the row's programme_track matched. */
export interface ImportRow { rowNo: number; name: string; email: string; programmeTrack: string; trackId: string | null; trackName: string | null; error: string | null }
/** A programme track configured in DIRA LEARN (table tracks). */
export interface TrackOption { id: string; name: string }
/** The exact columns of a learner import file (22 Nov 2026: direct enrolment). */
export const REQUIRED_COLUMNS = ['name', 'email', 'programme_track'] as const;

/** Minimal CSV reader: quoted fields, doubled quotes, CRLF, a leading byte-order mark, comma or semicolon separated. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && src[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

// Header cells are compared without case and surrounding spaces; spaces inside become underscores ("Programme Track" = programme_track).
const normHeader = (h: string) => h.trim().toLowerCase().replace(/\s+/g, '_');
// Track names are compared without case and with repeated spaces collapsed. Nothing else is guessed: an unknown name is an error.
const normTrack = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ');
// Removes control characters (U+0000-U+001F and U+007F) that spreadsheets sometimes leave in cells, then tidies spaces.
// Written as a character filter rather than a regular expression with control characters (ESLint no-control-regex).
const isControl = (ch: string) => { const c = ch.charCodeAt(0); return c <= 0x1f || c === 0x7f; };
export const clean = (s: string) => Array.from(s, (ch) => (isControl(ch) ? '' : ch)).join('').replace(/\s+/g, ' ').trim();
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;

export interface ParsedImport { rows: ImportRow[]; fileError: string | null }

/**
 * Turns CSV text into checked rows. The file must have exactly the columns name, email, programme_track (any order); every
 * programme_track must be one of the tracks configured in DIRA LEARN. Every row keeps its number and its own error so staff can
 * fix the file; rows with an error are never sent.
 */
export function parseLearnerCsv(text: string, tracks: readonly TrackOption[]): ParsedImport {
  const table = parseCsv(text);
  if (!table.length) return { rows: [], fileError: 'The file is empty.' };
  const header = table[0]!.map(normHeader);
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  const extra = header.filter((h) => h !== '' && !(REQUIRED_COLUMNS as readonly string[]).includes(h));
  const repeated = REQUIRED_COLUMNS.filter((c) => header.filter((h) => h === c).length > 1);
  if (missing.length) return { rows: [], fileError: `The first row must name exactly these columns: name, email, programme_track. Missing: ${missing.join(', ')}.` };
  if (extra.length) return { rows: [], fileError: `The file has columns that are not used: ${extra.join(', ')}. Keep only name, email, programme_track.` };
  if (repeated.length) return { rows: [], fileError: `A column appears twice: ${repeated.join(', ')}.` };
  if (!tracks.length) return { rows: [], fileError: 'No programme tracks are configured in DIRA LEARN, so no learner can be checked.' };
  const [ni, ei, ti] = REQUIRED_COLUMNS.map((c) => header.indexOf(c)) as [number, number, number];
  const body = table.slice(1);
  if (!body.length) return { rows: [], fileError: 'The file has a header but no learners.' };
  if (body.length > MAX_ROWS) return { rows: [], fileError: `A file can have at most ${MAX_ROWS} learners. Split it into smaller files.` };
  const byName = new Map(tracks.map((t) => [normTrack(t.name), t]));
  const trackList = tracks.map((t) => t.name).join(', ');
  const seen = new Map<string, number>();
  const rows = body.map((r, idx): ImportRow => {
    const name = clean(r[ni] ?? ''); const email = clean(r[ei] ?? '').toLowerCase(); const programmeTrack = clean(r[ti] ?? '');
    const track = programmeTrack ? byName.get(normTrack(programmeTrack)) ?? null : null;
    let error: string | null = null;
    if (!name) error = 'The name is missing.';
    else if (name.length > 160) error = 'The name is longer than 160 characters.';
    else if (!email) error = 'The email address is missing.';
    else if (!isEmail(email)) error = 'The email address is not valid.';
    else if (seen.has(email)) error = `Same email as row ${seen.get(email)}.`;
    else if (!programmeTrack) error = 'The programme track is missing.';
    else if (!track) error = `"${programmeTrack}" is not a programme track in DIRA LEARN. Use one of: ${trackList}.`;
    if (email && !seen.has(email)) seen.set(email, idx + 2);
    return { rowNo: idx + 2, name, email, programmeTrack, trackId: track?.id ?? null, trackName: track?.name ?? null, error };
  });
  return { rows, fileError: null };
}

/**
 * Checks one learner entered in the Add learner form (22 Nov 2026): same rules as a CSV row, the track chosen from the list of
 * configured tracks. Returns the cleaned learner or the first problem.
 */
export function checkSingleLearner(input: { name: string; email: string; trackId: string }, tracks: readonly TrackOption[]):
  { ok: true; name: string; email: string; track: TrackOption } | { ok: false; error: string } {
  const name = clean(input.name); const email = clean(input.email).toLowerCase(); const track = tracks.find((t) => t.id === input.trackId);
  if (!name) return { ok: false, error: 'Enter the learner\'s name.' };
  if (name.length > 160) return { ok: false, error: 'The name is longer than 160 characters.' };
  if (!email) return { ok: false, error: 'Enter the learner\'s email address.' };
  if (!isEmail(email)) return { ok: false, error: 'The email address is not valid.' };
  if (!track) return { ok: false, error: 'Choose the programme track.' };
  return { ok: true, name, email, track };
}

export const validRows = (rows: readonly ImportRow[]): ImportRow[] => rows.filter((r) => !r.error);

/** Template with the exact columns; the track column is filled with the first configured tracks so it is valid as downloaded. */
export const sampleCsv = (tracks: readonly TrackOption[]): string => {
  const t = (i: number) => { const n = tracks[i % Math.max(tracks.length, 1)]?.name ?? 'Digital Marketing'; return /[",]/.test(n) ? `"${n.replace(/"/g, '""')}"` : n; };
  return `name,email,programme_track\nAmina Wanjiku,amina@example.org,${t(0)}\nJoseph Otieno,joseph@example.org,${t(1)}\n`;
};

export type RowOutcome = 'invited' | 'already_registered' | 'failed';
export const OUTCOME_LABEL: Record<RowOutcome, string> = { invited: 'Invitation sent', already_registered: 'Already has an account', failed: 'Failed' };
