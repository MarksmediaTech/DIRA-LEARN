import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import type { AdminUser, RoleCode } from '@/types/database';
import { ASSIGNABLE_ROLES, ROLE_LABEL, STATUS_LABEL, isEmail, statusReasonProblem } from './rules';

const field = 'rounded-control border border-purple-200 px-3 py-2 font-normal';

export function UsersPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState(''); const [inviteRole, setInviteRole] = useState<RoleCode>('trainer'); const [inviteMsg, setInviteMsg] = useState<string | null>(null);

  const users = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => { const { data, error: e } = await supabase.rpc('admin_list_users'); if (e) throw e; return data as AdminUser[]; },
  });
  // Founder and Co-Founder can see every account, but only a super administrator may change roles or status or invite staff (enforced in the database and the invite function).
  const canAssign = profile?.role === 'super_admin';
  const change = useMutation({
    mutationFn: async (v: { id: string; patch: { role: RoleCode } }) => { const { error: e } = await supabase.from('profiles').update(v.patch).eq('id', v.id); if (e) throw e; },
    onSuccess: () => { setError(null); void qc.invalidateQueries({ queryKey: ['admin-users'] }); },
    onError: (e: Error) => setError(e.message),
  });
  // Deactivate / reactivate: through the set-account-status Edge Function (database check + reason + sign-in block, migration 34).
  const [statusFor, setStatusFor] = useState<{ id: string; email: string; to: 'active' | 'deactivated' } | null>(null);
  const [statusReason, setStatusReason] = useState(''); const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const setStatus = useMutation({
    mutationFn: async (v: { id: string; to: 'active' | 'deactivated'; reason: string }) => {
      const problem = statusReasonProblem(v.reason); if (problem) throw new Error(problem);
      const { data, error: e } = await supabase.functions.invoke('set-account-status', { body: { userId: v.id, status: v.to, reason: v.reason.trim() } });
      if (e) throw new Error(e.message);
      if (data && typeof data === 'object' && 'error' in data) throw new Error(String((data as { error: unknown }).error));
      return data as { warning?: string };
    },
    onSuccess: (d, v) => { setStatusMsg(d?.warning ?? (v.to === 'deactivated' ? 'Account deactivated. The person can no longer sign in or use DIRA LEARN.' : 'Account reactivated.'));
      setStatusFor(null); setStatusReason(''); void qc.invalidateQueries({ queryKey: ['admin-users'] }); },
    onError: (e: Error) => setStatusMsg(e.message),
  });
  const invite = useMutation({
    mutationFn: async () => {
      if (!isEmail(inviteEmail)) throw new Error('Enter a valid email address.');
      const { data, error: e } = await supabase.functions.invoke('invite-user', { body: { email: inviteEmail.trim(), role: inviteRole } });
      if (e) throw new Error(e.message);
      if (data && typeof data === 'object' && 'error' in data) throw new Error(String((data as { error: unknown }).error));
    },
    onSuccess: () => { setInviteMsg(`Invitation sent to ${inviteEmail.trim()}.`); setInviteEmail(''); void qc.invalidateQueries({ queryKey: ['admin-users'] }); },
    onError: (e: Error) => setInviteMsg(e.message),
  });

  if (users.isLoading) return <p role="status">Loading…</p>;
  if (users.isError) return <p role="alert" className="text-danger">Could not load accounts.</p>;
  const term = search.trim().toLowerCase();
  const rows = (users.data ?? []).filter((u) => !term || `${u.first_name} ${u.last_name} ${u.email}`.toLowerCase().includes(term));

  return (
    <section className="grid max-w-5xl gap-5">
      <h1 className="text-2xl font-bold text-purple-700">Users</h1>
      {canAssign ? <form className="grid gap-3 rounded-card border border-purple-100 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); setInviteMsg(null); invite.mutate(); }}>
        <label className="grid gap-1 text-sm font-medium">Invite a staff member by email<input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} className={field} /></label>
        <label className="grid gap-1 text-sm font-medium">Role
          <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as RoleCode)} className={field}>{ASSIGNABLE_ROLES.filter((r) => r !== 'applicant').map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
        </label>
        <Button type="submit" disabled={invite.isPending}>Send invitation</Button>
        {inviteMsg && <p role="status" className="text-sm sm:col-span-3">{inviteMsg}</p>}
      </form> : <p className="rounded-card border border-purple-100 p-4 text-sm text-ink/70">You can view accounts. Only a super administrator can invite staff or change roles and account status.</p>}
      <p className="text-sm text-ink/70">Participants are created by converting an accepted application, so they cannot be given the participant role here. People who sign up themselves start as applicants.</p>
      <label className="grid max-w-xs gap-1 text-sm font-medium">Search<input value={search} onChange={(e) => setSearch(e.target.value)} className={field} /></label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {statusMsg && <p role="status" className="text-sm">{statusMsg}</p>}
      {statusFor && (
        <form className="grid gap-2 rounded-card border border-orange-500 p-4" onSubmit={(e) => { e.preventDefault(); setStatus.mutate({ id: statusFor.id, to: statusFor.to, reason: statusReason }); }}>
          <p className="font-medium">{statusFor.to === 'deactivated' ? `Deactivate ${statusFor.email}` : `Reactivate ${statusFor.email}`}</p>
          <p className="text-sm text-ink/70">{statusFor.to === 'deactivated'
            ? 'The person is signed out of everything at once and cannot sign in. Nothing is deleted: their records, messages and history stay, and you can reactivate them later.'
            : 'The person can sign in again with their existing password and gets the access of their current role.'}</p>
          <label className="grid gap-1 text-sm font-medium">Reason (kept in the account history, 10 to 500 characters)
            <textarea rows={2} maxLength={500} value={statusReason} onChange={(e) => setStatusReason(e.target.value)} className={field} />
          </label>
          <div className="flex gap-2"><Button type="submit" disabled={setStatus.isPending}>{statusFor.to === 'deactivated' ? 'Deactivate account' : 'Reactivate account'}</Button>
            <Button type="button" variant="quiet" onClick={() => setStatusFor(null)}>Cancel</Button></div>
        </form>
      )}
      {!rows.length ? <EmptyState title="No accounts match">Try a different search.</EmptyState> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm"><caption className="sr-only">Accounts</caption>
            <thead><tr className="border-b border-purple-200"><th scope="col" className="p-2">Person</th><th scope="col" className="p-2">Role</th><th scope="col" className="p-2">Status</th><th scope="col" className="p-2">Last sign-in</th></tr></thead>
            <tbody>{rows.map((u) => {
              const self = u.id === profile?.id; const isParticipant = u.role === 'participant';
              return (
                <tr key={u.id} className="border-b border-purple-100 align-top">
                  <th scope="row" className="p-2 font-medium">{`${u.first_name} ${u.last_name}`.trim() || 'No name yet'}<div className="text-xs font-normal text-ink/60">{u.email}</div></th>
                  <td className="p-2">
                    <label><span className="sr-only">Role for {u.email}</span>
                      <select value={u.role} disabled={!canAssign || self || isParticipant || change.isPending} onChange={(e) => change.mutate({ id: u.id, patch: { role: e.target.value as RoleCode } })} className="rounded-control border border-purple-200 px-2 py-1">
                        {isParticipant && <option value="participant">{ROLE_LABEL.participant}</option>}
                        {ASSIGNABLE_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    </label>
                    {(self || isParticipant) && <div className="text-xs text-ink/60">{self ? 'Your own account' : 'Managed through the participant record'}</div>}
                  </td>
                  <td className="p-2">
                    <span className={u.status === 'active' ? 'text-ink' : 'font-semibold text-danger'}>{STATUS_LABEL[u.status]}</span>
                    {canAssign && !self && (u.status === 'active'
                      ? <div><Button variant="quiet" disabled={setStatus.isPending} onClick={() => { setStatusMsg(null); setStatusReason(''); setStatusFor({ id: u.id, email: u.email, to: 'deactivated' }); }}>Deactivate</Button></div>
                      : <div><Button variant="quiet" disabled={setStatus.isPending} onClick={() => { setStatusMsg(null); setStatusReason(''); setStatusFor({ id: u.id, email: u.email, to: 'active' }); }}>Reactivate</Button></div>)}
                  </td>
                  <td className="p-2">{u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString() : 'Never'}</td>
                </tr>);
            })}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
