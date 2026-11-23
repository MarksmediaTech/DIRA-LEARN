export const MAX_ROWS = 200;
export interface ImportRow { rowNo: number; firstName: string; lastName: string; email: string; error: string | null }

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

const norm = (h: string) => h.toLowerCase().replace(/[^a-z]/g, '');
const ALIASES: Record<'first' | 'last' | 'email', string[]> = { first: ['firstname', 'givenname', 'forename'], last: ['lastname', 'surname', 'familyname'], email: ['email', 'emailaddress'] };
// Removes control characters (U+0000-U+001F and U+007F) that spreadsheets sometimes leave in cells, then tidies spaces.
// Written as a character filter rather than a regular expression with control characters (ESLint no-control-regex).
const isControl = (ch: string) => { const c = ch.charCodeAt(0); return c <= 0x1f || c === 0x7f; };
export const clean = (s: string) => Array.from(s, (ch) => (isControl(ch) ? '' : ch)).join('').replace(/\s+/g, ' ').trim();
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;

export interface ParsedImport { rows: ImportRow[]; fileError: string | null }

/** Turns CSV text into checked rows. Every row keeps its number and its own error so staff can fix the file. */
export function parseLearnerCsv(text: string): ParsedImport {
  const table = parseCsv(text);
  if (!table.length) return { rows: [], fileError: 'The file is empty.' };
  const header = table[0]!.map(norm);
  const col = (k: keyof typeof ALIASES) => header.findIndex((h) => ALIASES[k].includes(h));
  const [fi, li, ei] = [col('first'), col('last'), col('email')];
  if (fi < 0 || li < 0 || ei < 0) return { rows: [], fileError: 'The first row must name the columns: first_name, last_name, email.' };
  const body = table.slice(1);
  if (!body.length) return { rows: [], fileError: 'The file has a header but no learners.' };
  if (body.length > MAX_ROWS) return { rows: [], fileError: `A file can have at most ${MAX_ROWS} learners. Split it into smaller files.` };
  const seen = new Map<string, number>();
  const rows = body.map((r, idx): ImportRow => {
    const firstName = clean(r[fi] ?? ''); const lastName = clean(r[li] ?? ''); const email = clean(r[ei] ?? '').toLowerCase();
    let error: string | null = null;
    if (!firstName || !lastName) error = 'First and last name are both required.';
    else if (firstName.length > 80 || lastName.length > 80) error = 'A name is longer than 80 characters.';
    else if (!isEmail(email)) error = 'The email address is not valid.';
    else if (seen.has(email)) error = `Same email as row ${seen.get(email)}.`;
    if (!seen.has(email) && email) seen.set(email, idx + 2);
    return { rowNo: idx + 2, firstName, lastName, email, error };
  });
  return { rows, fileError: null };
}

export const validRows = (rows: readonly ImportRow[]): ImportRow[] => rows.filter((r) => !r.error);

export const SAMPLE_CSV = 'first_name,last_name,email\nAmina,Wanjiku,amina@example.org\nJoseph,Otieno,joseph@example.org\n';

export type RowOutcome = 'invited' | 'already_registered' | 'failed';
export const OUTCOME_LABEL: Record<RowOutcome, string> = { invited: 'Invitation sent', already_registered: 'Already has an account', failed: 'Failed' };
