import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { safeFileName } from '@/features/sessions/rules';
import type { Assignment, Submission } from '@/types/database';
import { submissionBlocker, validateSubmission } from './rules';
import { AttemptCard } from './shared';

export function SubmitPanel({ a }: { a: Assignment }) {
  const { session } = useAuth();
  const qc = useQueryClient();
  const [body, setBody] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['my-submissions', a.id],
    queryFn: async () => {
      const [p, s] = await Promise.all([
        supabase.from('participants').select('id').eq('profile_id', session!.user.id).maybeSingle(),
        supabase.from('submissions').select('*').eq('assignment_id', a.id).order('attempt', { ascending: true }),
      ]);
      if (p.error) throw p.error;
      if (s.error) throw s.error;
      return { participantId: (p.data as { id: string } | null)?.id ?? null, attempts: s.data as Submission[] };
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      const err = validateSubmission({ body, file: file ? { size: file.size, type: file.type } : null });
      if (err) throw new Error(err);
      if (!q.data?.participantId) throw new Error('Your participant record was not found. Contact your coordinator.');
      let storage_path: string | null = null;
      if (file) {
        storage_path = `${session!.user.id}/${a.id}/${Date.now()}-${safeFileName(file.name)}`;
        const up = await supabase.storage.from('submissions').upload(storage_path, file);
        if (up.error) throw up.error;
      }
      const { error } = await supabase.from('submissions').insert({
        assignment_id: a.id, participant_id: q.data.participantId, body: body.trim() || null, storage_path,
      });
      if (error) {
        if (storage_path) await supabase.storage.from('submissions').remove([storage_path]);
        throw error;
      }
    },
    onSuccess: () => {
      setBody(''); setFile(null); setMsg('Submitted.');
      void qc.invalidateQueries({ queryKey: ['my-submissions', a.id] });
      void qc.invalidateQueries({ queryKey: ['my-assignments'] });
    },
    onError: (e: Error) => setMsg(e.message),
  });

  if (q.isLoading) return <p role="status">Loading your work…</p>;
  if (q.isError) return <p role="alert" className="text-danger">Could not load your submissions.</p>;
  const attempts = q.data!.attempts;
  const blocker = submissionBlocker({ dueAt: a.due_at, allowResubmission: a.allow_resubmission }, attempts);
  const overdue = a.due_at !== null && new Date() > new Date(a.due_at);

  return (
    <div className="grid gap-6">
      {attempts.length > 0 && (
        <div className="grid gap-3">
          <h2 className="font-display text-xl font-semibold text-purple-900">Your work</h2>
          {attempts.map((s) => <AttemptCard key={s.id} s={s} maxScore={a.max_score} />)}
        </div>
      )}
      <div className="grid gap-3 rounded-card border border-purple-100 p-5">
        <h2 className="font-display text-xl font-semibold text-purple-900">{attempts.length ? 'Submit again' : 'Submit your work'}</h2>
        {blocker ? <p className="text-sm text-ink/70">{blocker}.</p> : (
          <>
            {overdue && <p className="text-sm text-warn">The due date has passed. You can still submit, and it will be marked late.</p>}
            <label className="grid gap-1 text-sm font-medium">Your answer
              <textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} className="rounded-control border border-purple-200 px-3 py-2 font-normal" />
            </label>
            <label className="grid gap-1 text-sm font-medium">Or attach a file (PDF, Word, PowerPoint, Excel, JPG or PNG, up to 10 MB)
              <input type="file" className="text-sm font-normal" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>
            <div><Button disabled={submit.isPending} onClick={() => { setMsg(null); submit.mutate(); }}>{submit.isPending ? 'Submitting…' : 'Submit'}</Button></div>
          </>
        )}
        {msg && <p role="status" className="text-sm">{msg}</p>}
      </div>
    </div>
  );
}
