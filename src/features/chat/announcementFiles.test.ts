// Shared materials list: the file -> announcement relationship (23 Nov 2026).
// 1. The database: a file belongs to exactly ONE announcement (many files : one announcement), so the embed is a single object.
// 2. The TypeScript type: the untyped Supabase client reports that embed as a list; the row type must accept what the client reports
//    AND what PostgREST really sends, without a cast (a cast here broke the Cloudflare build with TS2352).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { embeddedAnnouncementTitle, type AnnouncementFileRow } from './rules';

/** Every SQL file the project ships (applied migrations and pending ones), so the test keeps working when a pending file is moved. */
function allSql(): string {
  return ['migrations', 'pending']
    .map((d) => join(process.cwd(), 'supabase', d))
    .filter((d) => existsSync(d))
    .flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.sql') && !f.includes('rollback')).map((f) => readFileSync(join(d, f), 'utf8')))
    .join('\n');
}

describe('announcement_attachments -> announcements (database)', () => {
  const sql = allSql();
  const ddl = /create table (?:if not exists )?public\.announcement_attachments\s*\(([\s\S]*?)\n\);/i.exec(sql)?.[1] ?? '';

  it('the table is defined in the project SQL', () => {
    expect(ddl).toMatch(/announcement_id/);
  });
  it('every file has exactly one parent announcement (not null foreign key)', () => {
    expect(ddl).toMatch(/announcement_id\s+uuid\s+not null\s+references\s+public\.announcements\s*\(\s*id\s*\)/i);
  });
  it('an announcement may have many files (announcement_id is not unique)', () => {
    expect(/announcement_id[^,\n]*\b(unique|primary key)\b/i.test(ddl)).toBe(false);
    expect(/unique\s*\(\s*announcement_id\s*\)/i.test(ddl)).toBe(false);
    expect(/create unique index[^;]*on\s+public\.announcement_attachments\s*\(\s*announcement_id\s*\)/i.test(sql)).toBe(false);
  });
});

describe('announcement title from an embedded file row', () => {
  it('reads the single object PostgREST returns for a many-to-one embed', () => {
    expect(embeddedAnnouncementTitle({ title: 'Week 1 slides' })).toBe('Week 1 slides');
  });
  it('is empty when the announcement is not visible', () => {
    expect(embeddedAnnouncementTitle(null)).toBe('');
    expect(embeddedAnnouncementTitle(undefined)).toBe('');
  });
  it('also copes with the list the untyped client reports', () => {
    expect(embeddedAnnouncementTitle([{ title: 'Week 2' }])).toBe('Week 2');
    expect(embeddedAnnouncementTitle([])).toBe('');
  });
});

describe('row type accepts what the client reports and what the database sends (compile-time)', () => {
  // The type the compiler inferred for the query in the failing build: loose columns and an embedded LIST.
  /* eslint-disable @typescript-eslint/no-explicit-any -- models the untyped client's inferred result */
  type ClientInferred = { id: any; storage_path: any; file_name: any; mime_type: any; size_bytes: any; created_at: any; announcement_id: any; announcements: { title: any }[] }[];
  /* eslint-enable @typescript-eslint/no-explicit-any */
  const base = { id: 'f1', storage_path: 'a1/x-slides.pdf', file_name: 'slides.pdf', mime_type: 'application/pdf', size_bytes: 10, created_at: '2026-11-23T08:00:00Z', announcement_id: 'a1' };

  it('assigns without a cast (a type error here fails npm run typecheck and the build)', () => {
    const fromClientTypes: ClientInferred = [{ ...base, announcements: [{ title: 'Week 3' }] }];
    const rows: AnnouncementFileRow[] = fromClientTypes;          // what the compiler sees
    const fromDatabase: AnnouncementFileRow[] = [{ ...base, announcements: { title: 'Week 3' } }, { ...base, announcements: null }]; // what PostgREST sends
    expect(embeddedAnnouncementTitle(rows[0]!.announcements)).toBe('Week 3');
    expect(fromDatabase.map((r) => embeddedAnnouncementTitle(r.announcements))).toEqual(['Week 3', '']);
  });
});
