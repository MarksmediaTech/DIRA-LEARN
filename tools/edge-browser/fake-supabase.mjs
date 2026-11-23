// SIMULATED supabase-js for running the real Edge Function code in Node (tools/edge-browser). Not a database:
// it answers the few calls the functions make, from fixtures in globalThis.__fx, and records every call in globalThis.__calls.
const fx = () => globalThis.__fx; const rec = (c) => globalThis.__calls.push(c);
function builder(client, table) {
  const q = { table, op: 'select', filters: {}, payload: null };
  const run = async () => {
    rec({ key: client.key, kind: 'from', ...q });
    if (q.op === 'select' && table === 'profiles') { const p = fx().profiles[q.filters.id]; return p ? { data: p, error: null } : { data: null, error: { code: 'PGRST116', message: 'none' } }; }
    if (q.op === 'select' && table === 'applications') return { data: fx().application, error: null };
    // direct CSV enrolment (22 Nov 2026): tracks, participants and portfolios kept in fixtures so repeated calls can be checked
    if (q.op === 'select' && table === 'tracks') { const all = fx().tracks ?? []; return q.filters.id ? { data: all.find((t) => t.id === q.filters.id) ?? null, error: null } : { data: all, error: null }; }
    if (q.op === 'select' && table === 'participants') { const pp = fx().participants ?? []; return { data: q.filters.profile_id ? pp.find((x) => x.profile_id === q.filters.profile_id) ?? null : null, error: null }; }
    if (q.op === 'insert' && table === 'participants') { const pp = (fx().participants ??= []);
      if (pp.some((x) => x.profile_id === q.payload.profile_id)) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "participants_profile_id_key"' } };
      const row = { id: 'part-' + (pp.length + 1), ...q.payload }; pp.push(row); return { data: row, error: null }; }
    if (q.op === 'select' && table === 'portfolios') return { data: (fx().portfolios ?? []).find((x) => x.participant_id === q.filters.participant_id) ?? null, error: null };
    if (q.op === 'insert' && table === 'portfolios') { (fx().portfolios ??= []).push(q.payload); return { data: q.payload, error: null }; }
    if (q.op === 'update' && table === 'profiles' && q.filters.id && fx().profiles[q.filters.id]) { Object.assign(fx().profiles[q.filters.id], q.payload); return { data: null, error: null }; }
    if (q.op === 'insert') return { data: { id: table + '-new' }, error: null };
    return { data: null, error: null };
  };
  const b = {
    select() { return b; }, eq(k, v) { q.filters[k] = v; return b; }, in(k, v) { q.filters[k] = v; return b; },
    insert(p) { q.op = 'insert'; q.payload = p; return b; }, update(p) { q.op = 'update'; q.payload = p; return b; },
    single: run, maybeSingle: run, then(ok, bad) { return run().then(ok, bad); },
  };
  return b;
}
export function createClient(url, key, opts = {}) {
  const auth = (opts.global?.headers?.Authorization ?? '').replace(/^Bearer /, '');
  const client = { key: key === 'service-role-key' ? 'service' : 'caller' };
  return {
    auth: {
      getUser: async () => { const id = fx().tokens[auth]; return { data: { user: id ? { id, email: (fx().emails ?? {})[id], app_metadata: (fx().appMeta ?? {})[id] ?? {} } : null }, error: null }; },
      admin: {
        inviteUserByEmail: async (email, o) => { rec({ kind: 'invite', email, o });
          if ((fx().confirmedEmails ?? []).includes(email)) return { data: { user: null }, error: { code: 'email_exists', message: 'A user with this email address has already been registered' } };
          if ((fx().failEmails ?? []).includes(email)) return { data: { user: null }, error: { code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' } };
          const id = 'invited-' + email; fx().profiles[id] ??= { role: 'applicant', status: 'active' };
          return { data: { user: { id, email, app_metadata: (fx().appMeta ?? {})[id] ?? {} } }, error: null }; },
        updateUserById: async (id, attrs) => { rec({ kind: 'updateUserById', id, attrs });
          if (attrs.app_metadata) { const m = (fx().appMeta ??= {}); m[id] = { ...(m[id] ?? {}), ...attrs.app_metadata }; }
          return { data: { user: { id } }, error: null }; },
        listUsers: async ({ page = 1, perPage = 50 } = {}) => { rec({ kind: 'listUsers', page, perPage }); const all = fx().authUsers ?? [];
          return { data: { users: all.slice((page - 1) * perPage, page * perPage) }, error: null }; },
        createUser: async (attrs) => { rec({ kind: 'createUser', attrs }); const id = 'created-' + attrs.email;
          (fx().authUsers ??= []).push({ id, email: attrs.email }); fx().profiles[id] = { role: 'applicant', status: 'active' }; return { data: { user: { id, email: attrs.email } }, error: null }; },
      },
    },
    from: (t) => builder(client, t),
    rpc: async (name, args) => {
      rec({ key: client.key, kind: 'rpc', name, args });
      if (name === 'admin_set_account_status') {   // emulates the database rule: active super administrator, not self
        const me = fx().profiles[fx().tokens[auth]];
        if (!me || me.status !== 'active' || me.role !== 'super_admin') return { data: null, error: { code: '42501', message: 'Only a super administrator can deactivate or reactivate accounts' } };
        if (args.p_profile === fx().tokens[auth]) return { data: null, error: { code: 'P0001', message: 'You cannot change the status of your own account' } };
        return { data: 'event-1', error: null };
      }
      if (name === 'claim_file_scans') return { data: fx().fileQueue ?? [], error: null };
      if (name === 'connect_claim_scans') return { data: [], error: null };
      if (name === 'first_admin_needed') return { data: fx().firstAdminNeeded ?? true, error: null };
      if (name === 'claim_first_admin') { const p = fx().profiles[args.p_user]; if (!(fx().firstAdminNeeded ?? true) || !p || p.role !== 'applicant') return { data: false, error: null };
        p.role = 'super_admin'; fx().firstAdminNeeded = false; return { data: true, error: null }; }
      if (name === 'gcal_claim') { const q = fx().gcalQueue ?? []; fx().gcalQueue = []; return { data: q, error: null }; }
      if (name === 'gcal_record') return { data: null, error: null };
      if (name === 'next_participant_no') { fx().partSeq = (fx().partSeq ?? 0) + 1; return { data: 'DL-2026-' + String(fx().partSeq).padStart(4, '0'), error: null }; }
      const answers = { next_participant_no: 'DL-0001', sg_overdue_check: 0, connect_retention_purge: [] };
      return { data: answers[name] ?? null, error: null };
    },
    storage: { from: (bucket) => ({ remove: async () => ({ data: [] }),
      download: async (name) => { rec({ kind: 'download', bucket, name }); const c = (fx().fileContent ?? {})[bucket + '/' + name];
        return c === undefined ? { data: null, error: { message: 'not found' } } : { data: new Blob([c]), error: null }; } }) },
  };
}
