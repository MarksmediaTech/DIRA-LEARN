// SIMULATED Supabase client for the Chat and notification-bell screen tests (tools/recovery/browser/chat_flow.mjs).
// It answers the calls the screens make (rpc, tables, private storage, Realtime with Presence) from an in-memory model and
// applies simplified versions of the database rules so that the screens' reactions to "allowed" and "refused" answers can be
// checked in Chrome. The real rules (Row Level Security, chat_can_dm, storage policies, notifications) are tested against
// PostgreSQL by supabase/tests-pending/chat_notifications_calendar.test.sql (tools/chat/chat_db_check.sh), not here.
type Role = 'super_admin' | 'founder' | 'programme_director' | 'trainer' | 'mentor' | 'me_officer' | 'participant';
type Profile = { id: string; role: Role; status: 'active'; first_name: string; last_name: string; organization_id: null; cohort?: string; track?: string };
type Conv = { id: string; kind: 'dm' | 'group' | 'cohort' | 'safeguarding' | 'direct'; title: string | null; locked: boolean; cohort_id?: string };
type Member = { conv: string; profile: string; is_owner: boolean; last_read_at: string | null };
type Msg = { id: string; conversation_id: string; sender_id: string; body: string; created_at: string; hidden: boolean; reply_to: string | null };
type Att = { id: string; message_id: string; conversation_id: string; storage_path: string; file_name: string; mime_type: string; size_bytes: number; scan_status: string; created_at: string };
type Ann = { id: string; title: string; body: string; audience: 'everyone' | 'cohort' | 'track'; cohort_id: string | null; track_id: string | null; pinned: boolean; created_by: string; created_at: string; edited_at: string | null };
type AnnAtt = { id: string; announcement_id: string; storage_path: string; file_name: string; mime_type: string; size_bytes: number; created_at: string };
type Notif = { id: string; user_id: string; kind: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string; dedupe_key: string | null };
type Stored = { bucket: string; path: string; blob: Blob; type: string };
type State = {
  me: string; profiles: Profile[]; cohorts: { id: string; name: string }[]; tracks: { id: string; name: string; position: number }[];
  convs: Conv[]; members: Member[]; msgs: Msg[]; atts: Att[]; reactions: { message_id: string; profile: string; emoji: string }[];
  anns: Ann[]; annAtts: AnnAtt[]; annReactions: { announcement_id: string; profile: string; emoji: string }[]; notifs: Notif[];
  files: Stored[]; online: string[]; log: string[]; signedUrls: number;
  gcal: { schedule_id: string; state: string; last_error: string | null; synced_at: string | null; attempts: number }[]; gcalMode: 'unset' | 'ok' | 'google-down';
};
const W = window as unknown as { __chat: State; __chatSeed?: Partial<State>; __chatServer: Record<string, unknown> };
const iso = (ms = Date.now()) => new Date(ms).toISOString();
const uid = () => crypto.randomUUID();
const STAFF: Role[] = ['super_admin', 'founder', 'programme_director', 'trainer', 'mentor', 'me_officer'];
const EXEC: Role[] = ['super_admin', 'founder'];
// mirrors public.chat_file_rules (supabase/pending/20261122000002_chat_notifications_calendar.sql)
const SERVER_MIME: Record<string, number> = {
  'application/pdf': 10485760, 'application/msword': 10485760, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 10485760,
  'application/vnd.ms-excel': 10485760, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 10485760, 'application/vnd.ms-powerpoint': 26214400,
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 26214400, 'application/vnd.oasis.opendocument.text': 10485760,
  'application/vnd.oasis.opendocument.spreadsheet': 10485760, 'application/vnd.oasis.opendocument.presentation': 26214400, 'text/plain': 2097152, 'text/csv': 2097152,
  'image/jpeg': 10485760, 'image/png': 10485760, 'image/webp': 10485760, 'image/gif': 10485760, 'audio/webm': 20971520, 'audio/ogg': 20971520, 'audio/mpeg': 20971520,
  'audio/mp4': 20971520, 'audio/wav': 20971520, 'video/mp4': 52428800, 'video/webm': 52428800, 'video/quicktime': 52428800,
};

function seed(): State {
  const p = (id: string, role: Role, first: string, last: string, cohort?: string, track?: string): Profile => ({ id, role, status: 'active', first_name: first, last_name: last, organization_id: null, cohort, track });
  return {
    me: 'p-l1',
    profiles: [p('p-admin', 'programme_director', 'Grace', 'Director'), p('p-trainer', 'trainer', 'Tom', 'Trainer', 'c-1'), p('p-l1', 'participant', 'Lucy', 'Learner', 'c-1', 't-1'),
               p('p-l2', 'participant', 'Liam', 'Learner', 'c-1', 't-1'), p('p-l3', 'participant', 'Olive', 'Outsider', 'c-2', 't-2'), p('p-me', 'me_officer', 'Mo', 'Evaluator')],
    cohorts: [{ id: 'c-1', name: 'Cohort 1 - Nairobi' }, { id: 'c-2', name: 'Cohort 2 - Kisumu' }],
    tracks: [{ id: 't-1', name: 'Digital Skills', position: 1 }, { id: 't-2', name: 'Entrepreneurship', position: 2 }],
    convs: [{ id: 'conv-cohort1', kind: 'cohort', title: 'Cohort 1 - Nairobi discussion', locked: false, cohort_id: 'c-1' }],
    members: ['p-trainer', 'p-l1', 'p-l2'].map((x) => ({ conv: 'conv-cohort1', profile: x, is_owner: false, last_read_at: null })),
    msgs: [], atts: [], reactions: [], anns: [], annAtts: [], annReactions: [], notifs: [], files: [], online: [], log: [], signedUrls: 0, gcal: [], gcalMode: 'unset',
  };
}
W.__chat = W.__chat ?? Object.assign(seed(), W.__chatSeed ?? {});
const S = () => W.__chat;
const prof = (id: string | null) => S().profiles.find((x) => x.id === id);
const nameOf = (id: string | null) => { const x = prof(id); return x ? `${x.first_name} ${x.last_name}` : 'Someone'; };
const me = () => prof(S().me)!;
const isStaff = (id: string) => STAFF.includes(prof(id)?.role as Role);
const roleLabel = (r: Role) => ({ participant: 'Learner', trainer: 'Trainer', programme_director: 'Programme Director', me_officer: 'M&E Officer', mentor: 'Mentor', founder: 'Founder', super_admin: 'Super Admin' }[r]);
const pgErr = (message: string, code = '42501') => ({ message, code, details: null, hint: null });
// simplified chat_can_dm: staff with staff; learners with learners of their cohort; learners with programme staff and their cohort's trainer; never M&E with learners
function canDm(a: string, b: string): boolean {
  if (a === b) return false; const A = prof(a)!, B = prof(b)!; if (!A || !B) return false;
  const learner = (x: Profile) => x.role === 'participant';
  if (!learner(A) && !learner(B)) return true;
  if (learner(A) && learner(B)) return !!A.cohort && A.cohort === B.cohort;
  const [L, O] = learner(A) ? [A, B] : [B, A];
  if (O.role === 'me_officer') return false;
  if (O.role === 'trainer') return O.cohort === L.cohort;
  return O.role === 'programme_director' || EXEC.includes(O.role);
}
const isMember = (conv: string, who = S().me) => S().members.some((m) => m.conv === conv && m.profile === who);

// ---------- Realtime (postgres_changes delivered only to subscribers allowed to read the row, as Realtime does with RLS) ----------
type Handler = { type: string; filter: { event?: string; table?: string; filter?: string }; cb: (p: unknown) => void };
type Chan = { name: string; handlers: Handler[]; subscribed: boolean; on: (t: string, f: Handler['filter'], cb: (p: unknown) => void) => Chan; subscribe: (cb?: (s: string) => void) => Chan; track: (x: unknown) => Promise<string>; presenceState: () => Record<string, unknown[]>; unsubscribe: () => void };
const channels = new Set<Chan>();
const visibleTo = (table: string, row: Record<string, unknown>): boolean => {
  if (table === 'notifications') return row.user_id === S().me;
  if (table === 'connect_messages' || table === 'connect_attachments') return isMember(String(row.conversation_id));
  return true;
};
function emit(table: string, event: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>) {
  if (!visibleTo(table, row)) return;
  for (const c of [...channels]) for (const h of c.handlers) {
    if (!c.subscribed || h.type !== 'postgres_changes' || h.filter.table !== table || (h.filter.event !== '*' && h.filter.event !== event)) continue;
    const f = h.filter.filter?.match(/^(\w+)=eq\.(.+)$/); if (f && String(row[f[1]!]) !== f[2]) continue;
    setTimeout(() => h.cb({ eventType: event, new: row, old: {} }), 0);
  }
}
function syncPresence() { for (const c of channels) for (const h of c.handlers) if (c.subscribed && h.type === 'presence') setTimeout(() => h.cb({}), 0); }
function channel(name: string): Chan {
  const c: Chan = {
    name, handlers: [], subscribed: false,
    on(type, filter, cb) { c.handlers.push({ type, filter, cb }); return c; },
    subscribe(cb) { c.subscribed = true; channels.add(c); setTimeout(() => { cb?.('SUBSCRIBED'); syncPresence(); }, 0); return c; },
    async track() { if (!S().online.includes(S().me)) S().online.push(S().me); syncPresence(); return 'ok'; },
    presenceState() { return Object.fromEntries(S().online.map((x) => [x, [{}]])); },
    unsubscribe() { c.subscribed = false; channels.delete(c); },
  };
  return c;
}

// ---------- server-side actions (database triggers in the real system) ----------
function notify(user: string, kind: string, title: string, body: string | null, link: string | null, actor: string | null, key: string | null) {
  if (user === actor) return;                                              // chat_notify skips the actor
  if (key && S().notifs.some((n) => n.user_id === user && n.dedupe_key === key && !n.read_at)) return;   // one unread per key
  const n: Notif = { id: uid(), user_id: user, kind, title, body, link, read_at: null, created_at: iso(), dedupe_key: key };
  S().notifs.push(n); emit('notifications', 'INSERT', n as unknown as Record<string, unknown>);
}
function insertMessage(conv: string, sender: string, body: string, replyTo: string | null): Msg {
  const m: Msg = { id: uid(), conversation_id: conv, sender_id: sender, body, created_at: iso(), hidden: false, reply_to: replyTo };
  S().msgs.push(m);
  const c = S().convs.find((x) => x.id === conv)!;
  for (const mem of S().members.filter((x) => x.conv === conv)) {
    notify(mem.profile, c.kind === 'group' || c.kind === 'cohort' ? 'group_message' : 'message', c.kind === 'dm' ? `New message from ${nameOf(sender)}` : `New message in ${c.title}`,
      body.slice(0, 140), `/chat?c=${conv}&m=${m.id}`, sender, `conv:${conv}`);
  }
  emit('connect_messages', 'INSERT', m as unknown as Record<string, unknown>);
  return m;
}
function audienceOf(a: Ann): string[] {
  return S().profiles.filter((p) => a.audience === 'everyone' || isStaff(p.id) || (a.audience === 'cohort' ? p.cohort === a.cohort_id : p.track === a.track_id)).map((p) => p.id);
}
const annVisible = (a: Ann, who = S().me) => audienceOf(a).includes(who);
// helpers the tests call to act as the server or as another person
W.__chatServer = {
  sendAs: (conv: string, sender: string, body: string) => insertMessage(conv, sender, body, null).id,
  notify: (user: string, kind: string, title: string, body: string, link: string | null) => notify(user, kind, title, body, link, null, null),
  setScan: (name: string, status: string) => { for (const a of S().atts) if (a.file_name === name) a.scan_status = status; },
  setOnline: (ids: string[]) => { S().online = ids; syncPresence(); },
  // sign in as someone else in the same page (the in-memory database stays), as a second person on another device would be
  switchUser: (id: string) => { S().me = id; S().online = S().online.filter((x) => x !== id); authListeners.forEach((l) => l('SIGNED_IN', session())); },
  // Realtime may deliver the same event twice (reconnects): the bell must still show it once
  redeliver: (id: string) => { const n = S().notifs.find((x) => x.id === id); if (n) emit('notifications', 'INSERT', n as unknown as Record<string, unknown>); },
  bulkNotify: (user: string, count: number) => { for (let i = 0; i < count; i++) { const n: Notif = { id: uid(), user_id: user, kind: 'course', title: `Older update ${i + 1}`, body: null, link: '/courses', read_at: null, created_at: iso(Date.now() - (count - i) * 60_000), dedupe_key: null }; S().notifs.push(n); } },
  publishAs: (author: string, title: string, audience: Ann['audience'] = 'everyone', cohort: string | null = null) => {
    const a: Ann = { id: uid(), title, body: 'Body of ' + title, audience, cohort_id: cohort, track_id: null, pinned: false, created_by: author, created_at: iso(), edited_at: null };
    S().anns.push(a); for (const u of audienceOf(a)) notify(u, 'announcement', `New announcement: ${title}`, a.body, `/chat?a=${a.id}`, author, `ann:${a.id}`);
    emit('announcements', 'INSERT', a as unknown as Record<string, unknown>); return a.id;
  },
};

// ---------- rpc ----------
const reactionsJson = (rows: { emoji: string; profile: string }[]) => {
  const out: { emoji: string; count: number; mine: boolean }[] = [];
  for (const r of rows) { const x = out.find((o) => o.emoji === r.emoji); if (x) { x.count++; x.mine ||= r.profile === S().me; } else out.push({ emoji: r.emoji, count: 1, mine: r.profile === S().me }); }
  return out;
};
const EMOJI = ['👍', '❤️', '😂', '😮', '😢', '🙏', '🎉', '🔥', '👏', '💯', '🤔', '✅', '👀', '🙌', '💡', '⭐'];
async function rpc(fn: string, a: Record<string, unknown> = {}): Promise<{ data: unknown; error: unknown }> {
  S().log.push('rpc:' + fn);
  const ok = (data: unknown) => ({ data, error: null }); const no = (m: string, code = '42501') => ({ data: null, error: pgErr(m, code) });
  const my = S().me;
  switch (fn) {
    case 'chat_inbox': return ok(S().convs.filter((c) => isMember(c.id)).map((c) => {
      const msgs = S().msgs.filter((m) => m.conversation_id === c.id).sort((x, y) => y.created_at.localeCompare(x.created_at));
      const mem = S().members.find((m) => m.conv === c.id && m.profile === my)!;
      const other = c.kind === 'dm' ? S().members.find((m) => m.conv === c.id && m.profile !== my)?.profile ?? null : null;
      return { conversation_id: c.id, kind: c.kind, title: c.kind === 'dm' ? nameOf(other) : c.title, subtitle: c.kind === 'dm' ? roleLabel(prof(other)!.role) : c.kind === 'cohort' ? 'Cohort discussion' : 'Group',
        other_profile_id: other, last_message_at: msgs[0]?.created_at ?? null, last_message: msgs[0]?.body ?? null, last_sender_id: msgs[0]?.sender_id ?? null,
        unread: msgs.filter((m) => m.sender_id !== my && (!mem.last_read_at || m.created_at > mem.last_read_at)).length, locked: c.locked, is_owner: mem.is_owner,
        member_count: S().members.filter((m) => m.conv === c.id).length, can_post: !c.locked };
    }).sort((x, y) => (y.last_message_at ?? '').localeCompare(x.last_message_at ?? '')));
    case 'chat_messages': {
      if (!isMember(String(a.p_conv))) return ok([]);
      return ok(S().msgs.filter((m) => m.conversation_id === a.p_conv && (!a.p_before || m.created_at < String(a.p_before))).sort((x, y) => y.created_at.localeCompare(x.created_at)).slice(0, Number(a.p_limit ?? 50)).map((m) => {
        const r = m.reply_to ? S().msgs.find((x) => x.id === m.reply_to) : null;
        return { id: m.id, sender_id: m.sender_id, sender_name: nameOf(m.sender_id), body: m.body, created_at: m.created_at, hidden: m.hidden, reply_to: m.reply_to, reply_sender: r ? nameOf(r.sender_id) : null, reply_body: r?.body ?? null,
          attachments: S().atts.filter((x) => x.message_id === m.id).map((x) => ({ id: x.id, path: x.storage_path, name: x.file_name, mime: x.mime_type, size: x.size_bytes, scan: x.scan_status })),
          reactions: reactionsJson(S().reactions.filter((x) => x.message_id === m.id)) };
      }));
    }
    case 'connect_mark_read': { const m = S().members.find((x) => x.conv === a.p_conversation && x.profile === my); if (m) m.last_read_at = iso();
      for (const n of S().notifs) if (n.user_id === my && n.dedupe_key === `conv:${a.p_conversation}` && !n.read_at) { n.read_at = iso(); emit('notifications', 'UPDATE', n as unknown as Record<string, unknown>); }
      return ok(null); }
    case 'chat_read_state': return ok(S().members.filter((m) => m.conv === a.p_conv && m.profile !== my && m.last_read_at).map((m) => ({ profile_id: m.profile, last_read_at: m.last_read_at })));
    case 'chat_search': { const q = String(a.p_query).toLowerCase(); return ok(S().msgs.filter((m) => isMember(m.conversation_id) && m.body.toLowerCase().includes(q)).map((m) => ({ conversation_id: m.conversation_id, message_id: m.id, sender_name: nameOf(m.sender_id), body: m.body, created_at: m.created_at }))); }
    case 'chat_contacts': { const q = String(a.p_query ?? '').toLowerCase();
      return ok(S().profiles.filter((p) => canDm(my, p.id) && nameOf(p.id).toLowerCase().includes(q)).map((p) => ({ profile_id: p.id, display_name: nameOf(p.id), role_label: roleLabel(p.role) }))); }
    case 'chat_start_dm': {
      const other = String(a.p_other); if (!canDm(my, other)) return no('You cannot start a conversation with this person.');
      const existing = S().convs.find((c) => c.kind === 'dm' && isMember(c.id, my) && isMember(c.id, other)); if (existing) return ok(existing.id);
      const c: Conv = { id: uid(), kind: 'dm', title: null, locked: false }; S().convs.push(c);
      S().members.push({ conv: c.id, profile: my, is_owner: false, last_read_at: null }, { conv: c.id, profile: other, is_owner: false, last_read_at: null }); return ok(c.id);
    }
    case 'connect_start_safeguarding': return no('Not simulated in this harness.');
    case 'chat_create_group': {
      if (!isStaff(my)) return no('Only staff can create group conversations.');
      const members = a.p_members as string[]; if (members.some((x) => !canDm(my, x))) return no('You can only add people you may message.');
      const c: Conv = { id: uid(), kind: 'group', title: String(a.p_title), locked: false }; S().convs.push(c);
      S().members.push({ conv: c.id, profile: my, is_owner: true, last_read_at: null }, ...members.map((x) => ({ conv: c.id, profile: x, is_owner: false, last_read_at: null })));
      for (const x of members) notify(x, 'group', `You were added to ${c.title}`, null, `/chat?c=${c.id}`, my, null);
      emit('connect_members', 'INSERT', { conversation_id: c.id }); return ok(c.id);
    }
    case 'chat_add_members': { const m = S().members.find((x) => x.conv === a.p_conv && x.profile === my); if (!m?.is_owner) return no('Only the group owner can add members.');
      const add = (a.p_members as string[]).filter((x) => !isMember(String(a.p_conv), x)); S().members.push(...add.map((x) => ({ conv: String(a.p_conv), profile: x, is_owner: false, last_read_at: null }))); return ok(add.length); }
    case 'chat_remove_member': S().members = S().members.filter((x) => !(x.conv === a.p_conv && x.profile === a.p_member)); return ok(null);
    case 'chat_react': case 'ann_react': {
      if (!EMOJI.includes(String(a.p_emoji))) return no('This reaction is not available.', '22023');
      if (fn === 'chat_react') {
        const m = S().msgs.find((x) => x.id === a.p_message); if (!m || !isMember(m.conversation_id)) return no('Message not found.');
        const i = S().reactions.findIndex((x) => x.message_id === m.id && x.profile === my && x.emoji === a.p_emoji);
        if (i >= 0) S().reactions.splice(i, 1); else { S().reactions.push({ message_id: m.id, profile: my, emoji: String(a.p_emoji) }); notify(m.sender_id, 'reaction', `${nameOf(my)} reacted ${a.p_emoji}`, m.body.slice(0, 80), `/chat?c=${m.conversation_id}&m=${m.id}`, my, null); }
        emit('connect_reactions', 'INSERT', { message_id: m.id });
      } else {
        const an = S().anns.find((x) => x.id === a.p_announcement); if (!an || !annVisible(an)) return no('Announcement not found.');
        const i = S().annReactions.findIndex((x) => x.announcement_id === an.id && x.profile === my && x.emoji === a.p_emoji);
        if (i >= 0) S().annReactions.splice(i, 1); else S().annReactions.push({ announcement_id: an.id, profile: my, emoji: String(a.p_emoji) });
      }
      return ok(null);
    }
    case 'gcal_retry_failed': { if (!isStaff(my)) return no('Not allowed'); let n = 0; for (const g of S().gcal) if (g.state === 'failed') { g.state = 'pending'; g.attempts = 0; n++; } return ok(n); }
    case 'gcal_queue_all_future': return ok(0);
    case 'connect_report_message': S().log.push('report:' + a.p_message); return ok(null);
    case 'ann_feed': return ok(S().anns.filter((x) => annVisible(x)).sort((x, y) => Number(y.pinned) - Number(x.pinned) || y.created_at.localeCompare(x.created_at)).map((x) => ({
      ...x, author_name: nameOf(x.created_by), audience_label: x.audience === 'everyone' ? 'Everyone' : x.audience === 'cohort' ? S().cohorts.find((c) => c.id === x.cohort_id)?.name : S().tracks.find((t) => t.id === x.track_id)?.name,
      can_edit: x.created_by === my || EXEC.includes(me().role),
      attachments: S().annAtts.filter((f) => f.announcement_id === x.id).map((f) => ({ id: f.id, path: f.storage_path, name: f.file_name, mime: f.mime_type, size: f.size_bytes })),
      reactions: reactionsJson(S().annReactions.filter((r) => r.announcement_id === x.id)) })));
    default: return no(`function ${fn} is not simulated`, 'PGRST202');
  }
}

// ---------- tables ----------
type Op = { op: string; args: unknown[] };
class Query {
  ops: Op[] = []; action = 'select'; payload: unknown = null; selectOpts: { count?: string; head?: boolean } = {}; mode: 'many' | 'single' | 'maybe' = 'many';
  constructor(public table: string) {}
  select(_c?: string, o?: { count?: string; head?: boolean }) { if (this.action === 'select') this.selectOpts = o ?? {}; return this; }
  insert(v: unknown) { this.action = 'insert'; this.payload = v; return this; }
  update(v: unknown) { this.action = 'update'; this.payload = v; return this; }
  delete() { this.action = 'delete'; return this; }
  eq(c: string, v: unknown) { this.ops.push({ op: 'eq', args: [c, v] }); return this; }
  is(c: string, v: unknown) { this.ops.push({ op: 'is', args: [c, v] }); return this; }
  in(c: string, v: unknown[]) { this.ops.push({ op: 'in', args: [c, v] }); return this; }
  order(c: string, o?: { ascending?: boolean }) { this.ops.push({ op: 'order', args: [c, o?.ascending ?? true] }); return this; }
  gte() { return this; }
  lt() { return this; }
  or() { return this; }
  range(f: number, t: number) { this.ops.push({ op: 'range', args: [f, t] }); return this; }
  limit(n: number) { this.ops.push({ op: 'range', args: [0, n - 1] }); return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }
  then<R>(ok: (v: { data: unknown; error: unknown; count?: number | null }) => R, bad?: (e: unknown) => R) { return Promise.resolve().then(() => this.run()).then(ok, bad); }
  filter<T extends Record<string, unknown>>(rows: T[]): T[] {
    let out = rows;
    for (const { op, args } of this.ops) {
      if (op === 'eq') out = out.filter((r) => r[args[0] as string] === args[1]);
      if (op === 'is') out = out.filter((r) => (r[args[0] as string] ?? null) === args[1]);
      if (op === 'in') out = out.filter((r) => (args[1] as unknown[]).includes(r[args[0] as string]));
    }
    for (const { op, args } of this.ops) if (op === 'order') { const [c, asc] = args as [string, boolean]; out = [...out].sort((x, y) => (String(x[c]) < String(y[c]) ? -1 : String(x[c]) > String(y[c]) ? 1 : 0) * (asc ? 1 : -1)); }
    for (const { op, args } of this.ops) if (op === 'range') out = out.slice(args[0] as number, (args[1] as number) + 1);
    return out;
  }
  result(rows: unknown[], error: unknown = null) {
    if (error) return { data: null, error, count: null };
    if (this.selectOpts.head) return { data: null, error: null, count: rows.length };
    if (this.mode === 'single') return rows.length === 1 ? { data: rows[0], error: null } : { data: null, error: pgErr('JSON object requested, multiple (or no) rows returned', 'PGRST116') };
    if (this.mode === 'maybe') return { data: rows[0] ?? null, error: null };
    return { data: rows, error: null, count: this.selectOpts.count ? rows.length : null };
  }
  run() {
    const my = S().me; const t = this.table; S().log.push(`${this.action}:${t}`);
    const rls = () => this.result([], pgErr(`new row violates row-level security policy for table "${t}"`));
    if (t === 'profiles') return this.result(this.filter(S().profiles as unknown as Record<string, unknown>[]));
    if (t === 'programmes') return this.result([{ id: 'prog', timezone: 'Africa/Nairobi' }]);
    if (t === 'cohorts') return this.result(this.filter(S().cohorts.map((c) => ({ ...c, archived: false, start_date: '2026-01-01' }))));
    if (t === 'session_schedules' || t === 'assignments') return this.result([]);
    if (t === 'gcal_events') return isStaff(my) && me().role !== 'mentor' && me().role !== 'me_officer' ? this.result(this.filter(S().gcal as unknown as Record<string, unknown>[])) : this.result([]);
    if (t === 'tracks') return this.result(this.filter(S().tracks as unknown as Record<string, unknown>[]));
    if (t === 'notifications') {
      const mine = S().notifs.filter((n) => n.user_id === my) as unknown as Record<string, unknown>[];
      if (this.action === 'select') return this.result(this.filter(mine));
      if (this.action === 'update') { const rows = this.filter(mine); for (const r of rows) { Object.assign(r, this.payload); emit('notifications', 'UPDATE', r); } return this.result(rows); }
    }
    if (t === 'connect_messages' && this.action === 'insert') {
      const v = this.payload as { conversation_id: string; sender_id: string; body: string; reply_to: string | null };
      const c = S().convs.find((x) => x.id === v.conversation_id);
      if (v.sender_id !== my || !c || !isMember(c.id) || c.locked) return rls();
      if (v.reply_to && S().msgs.find((m) => m.id === v.reply_to)?.conversation_id !== c.id) return this.result([], pgErr('The reply must be in the same conversation.', '22023'));
      const m = insertMessage(c.id, my, v.body, v.reply_to);
      if (v.reply_to) { const r = S().msgs.find((x) => x.id === v.reply_to)!; notify(r.sender_id, 'reply', `${nameOf(my)} replied to you`, v.body.slice(0, 140), `/chat?c=${c.id}&m=${m.id}`, my, null); }
      return this.result([{ id: m.id }]);
    }
    if (t === 'connect_attachments') {
      if (this.action === 'select') return this.result(this.filter(S().atts.filter((x) => isMember(x.conversation_id)) as unknown as Record<string, unknown>[]));
      const v = this.payload as Omit<Att, 'id' | 'scan_status' | 'created_at'> & { uploaded_by: string };
      if (!SERVER_MIME[v.mime_type]) return this.result([], pgErr('This file type is not allowed.', '22023'));       // chat_file_problem
      if (v.size_bytes > SERVER_MIME[v.mime_type]!) return this.result([], pgErr('This file is too large.', '22023'));
      if (!S().files.some((f) => f.bucket === 'connect-attachments' && f.path === v.storage_path)) return this.result([], pgErr('The uploaded file was not found.', '22023'));
      const a: Att = { id: uid(), message_id: v.message_id, conversation_id: v.conversation_id, storage_path: v.storage_path, file_name: v.file_name, mime_type: v.mime_type, size_bytes: v.size_bytes, scan_status: 'pending', created_at: iso() };
      S().atts.push(a); emit('connect_attachments', 'INSERT', a as unknown as Record<string, unknown>); return this.result([a]);
    }
    if (t === 'announcements') {
      const visible = S().anns.filter((x) => annVisible(x));
      if (this.action === 'insert') {
        const v = this.payload as Omit<Ann, 'created_by' | 'created_at' | 'edited_at'>;
        if (!isStaff(my) || (me().role === 'trainer' && v.audience === 'cohort' && v.cohort_id !== me().cohort)) return rls();
        const a: Ann = { ...v, created_by: my, created_at: iso(), edited_at: null }; S().anns.push(a);
        for (const u of audienceOf(a)) notify(u, 'announcement', `New announcement: ${a.title}`, a.body.slice(0, 140), `/chat?a=${a.id}`, my, `ann:${a.id}`);
        emit('announcements', 'INSERT', a as unknown as Record<string, unknown>); return this.result([a]);
      }
      const editable = this.filter(visible.filter((x) => x.created_by === my || EXEC.includes(me().role)) as unknown as Record<string, unknown>[]);   // RLS: others' rows are simply not matched
      if (this.action === 'update') { for (const r of editable) Object.assign(r, this.payload, 'title' in (this.payload as object) || 'body' in (this.payload as object) ? { edited_at: iso() } : {}); emit('announcements', 'UPDATE', {}); return this.result(editable.map((r) => ({ id: r.id }))); }
      if (this.action === 'delete') { S().anns = S().anns.filter((x) => !editable.includes(x as unknown as Record<string, unknown>)); emit('announcements', 'DELETE', {}); return this.result(editable.map((r) => ({ id: r.id }))); }
    }
    if (t === 'announcement_attachments') {
      if (this.action === 'select') return this.result(this.filter(S().annAtts.filter((f) => { const a = S().anns.find((x) => x.id === f.announcement_id); return a && annVisible(a); })
        .map((f) => ({ ...f, announcements: { title: S().anns.find((x) => x.id === f.announcement_id)!.title } })) as unknown as Record<string, unknown>[]));
      const v = this.payload as Omit<AnnAtt, 'id' | 'created_at'>; const a = S().anns.find((x) => x.id === v.announcement_id);
      if (!a || a.created_by !== my) return rls();
      if (!SERVER_MIME[v.mime_type]) return this.result([], pgErr('This file type is not allowed.', '22023'));
      const row: AnnAtt = { ...v, id: uid(), created_at: iso() }; S().annAtts.push(row); return this.result([row]);
    }
    return this.result([], pgErr(`table ${t} is not simulated`, 'PGRST205'));
  }
}

// ---------- private storage ----------
function bucket(name: string) {
  return {
    async upload(path: string, file: Blob, o?: { contentType?: string }) {
      if (name === 'connect-attachments') { const conv = path.split('/')[0]!; if (!isMember(conv) || path.split('/')[1] !== S().me) return { data: null, error: { message: 'new row violates row-level security policy', statusCode: '403' } }; }
      if (name === 'announcement-files') { const a = S().anns.find((x) => x.id === path.split('/')[0]); if (!a || a.created_by !== S().me) return { data: null, error: { message: 'new row violates row-level security policy', statusCode: '403' } }; }
      const type = (o?.contentType ?? file.type).split(';')[0]!;
      if (!SERVER_MIME[type]) return { data: null, error: { message: `mime type ${type} is not supported`, statusCode: '415' } };   // bucket allowed_mime_types
      S().files.push({ bucket: name, path, blob: file, type }); return { data: { path }, error: null };
    },
    async createSignedUrl(path: string, _sec: number, _o?: unknown) {
      const f = S().files.find((x) => x.bucket === name && x.path === path);
      let allowed = !!f;
      if (name === 'connect-attachments') { const a = S().atts.find((x) => x.storage_path === path); allowed = allowed && !!a && isMember(a.conversation_id) && a.scan_status === 'clean'; }   // storage policy: members, clean scan only
      if (name === 'announcement-files') { const a = S().annAtts.find((x) => x.storage_path === path); const an = a && S().anns.find((x) => x.id === a.announcement_id); allowed = allowed && !!an && annVisible(an); }
      if (!allowed) return { data: null, error: { message: 'Object not found', statusCode: '400' } };
      S().signedUrls++; return { data: { signedUrl: URL.createObjectURL(f!.blob) }, error: null };
    },
    async remove(paths: string[]) { S().files = S().files.filter((f) => !(f.bucket === name && paths.includes(f.path))); return { data: [], error: null }; },
  };
}

// ---------- auth: the signed-in user is S().me ----------
let authListeners: ((e: string, s: unknown) => void)[] = [];
const session = () => ({ access_token: 'tok-' + S().me, user: { id: S().me, email: `${S().me}@dira-test.local`, app_metadata: {} } });
export const configProblem = null;
export const supabase = {
  auth: {
    async getSession() { return { data: { session: session() }, error: null }; },
    onAuthStateChange(cb: (e: string, s: unknown) => void) { authListeners.push(cb); return { data: { subscription: { unsubscribe() { authListeners = authListeners.filter((l) => l !== cb); } } } }; },
    async signOut() { return { error: null }; },
    async signInWithPassword() { return { data: { session: session() }, error: null }; },
  },
  rpc,
  from: (t: string) => new Query(t),
  storage: { from: bucket },
  channel,
  async removeChannel(c: Chan) { c.unsubscribe(); return 'ok'; },
  // google-calendar-sync, answering as the real function does (tools/edge-browser tests the function itself)
  functions: { async invoke(name: string, o?: { body?: { action?: string } }) {
    if (name !== 'google-calendar-sync') return { data: null, error: { message: 'not simulated' } };
    const httpErr = (status: number, error: string) => ({ data: null, error: Object.assign(new Error('Edge Function returned a non-2xx status code'), { name: 'FunctionsHttpError', context: new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json' } }) }) });
    if (o?.body?.action === 'status') return { data: { configured: S().gcalMode !== 'unset' }, error: null };
    if (S().gcalMode === 'unset') return httpErr(503, 'Google Calendar sync is not set up yet.');
    const due = S().gcal.filter((g) => g.state === 'pending');
    if (S().gcalMode === 'google-down') { for (const g of due) { g.attempts++; g.last_error = 'Google sign-in failed (HTTP 401: invalid_grant)'; if (g.attempts >= 8) g.state = 'failed'; } return httpErr(502, 'Google sign-in failed (HTTP 401: invalid_grant)'); }
    for (const g of due) { g.state = 'synced'; g.synced_at = iso(); g.last_error = null; }
    return { data: { processed: due.length, synced: due.length, failed: 0 }, error: null };
  } },
};
