export const KIND_LABEL = { document: 'Document', presentation: 'Presentation', video: 'Video', link: 'Link' } as const;
export type Kind = keyof typeof KIND_LABEL;

export interface ResourceRow {
  id: string; title: string; kind: Kind; storage_path: string | null; external_url: string | null; created_at: string;
  curriculum_sessions: { week_no: number; session_no: number; title: string; track_id: string | null } | null;
}
export interface Group { key: string; heading: string; items: ResourceRow[] }

/** Only plain http(s) links are ever opened. Mirrors chk_resource_url in migration 7 (the database is the authority). */
export function safeExternalUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch { return null; }
}

export function filterResources(rows: readonly ResourceRow[], f: { query: string; kind: Kind | '' }): ResourceRow[] {
  const q = f.query.trim().toLowerCase();
  return rows.filter((r) => (!f.kind || r.kind === f.kind)
    && (!q || r.title.toLowerCase().includes(q) || (r.curriculum_sessions?.title.toLowerCase().includes(q) ?? false)));
}

/** Groups by programme week, then session number. Resources not tied to a session go last under "General". */
export function groupResources(rows: readonly ResourceRow[]): Group[] {
  const sorted = [...rows].sort((a, b) => {
    const x = a.curriculum_sessions, y = b.curriculum_sessions;
    if (!x && !y) return a.title.localeCompare(b.title);
    if (!x) return 1;
    if (!y) return -1;
    return x.week_no - y.week_no || x.session_no - y.session_no || a.title.localeCompare(b.title);
  });
  const groups: Group[] = [];
  for (const r of sorted) {
    const s = r.curriculum_sessions;
    const key = s ? `${s.week_no}-${s.session_no}-${s.track_id ?? 'core'}` : 'general';
    const heading = s ? `Week ${s.week_no} · Session ${s.session_no}: ${s.title}` : 'General';
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(r);
    else groups.push({ key, heading, items: [r] });
  }
  return groups;
}
