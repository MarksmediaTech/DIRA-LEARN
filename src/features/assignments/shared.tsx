import { supabase } from '@/lib/supabase';
import { FILE_NOT_AVAILABLE } from '@/lib/files';
import type { Submission } from '@/types/database';
import { STATE_LABEL, type LearnerState } from './rules';

const TONE: Record<LearnerState, string> = {
  to_do: 'bg-purple-50 text-purple-700', overdue: 'bg-danger/10 text-danger', submitted: 'bg-purple-100 text-purple-700',
  late: 'bg-orange-50 text-warn', returned: 'bg-orange-50 text-warn', graded: 'bg-ok/10 text-ok',
};

export function StateBadge({ state }: { state: LearnerState }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE[state]}`}>{STATE_LABEL[state]}</span>;
}

export async function openSubmissionFile(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from('submissions').createSignedUrl(path, 60);
  if (error || !data) return FILE_NOT_AVAILABLE;
  const w = window.open(data.signedUrl, '_blank', 'noopener');
  if (!w) window.location.href = data.signedUrl;
  return null;
}

export function AttemptCard({ s, maxScore }: { s: Submission; maxScore: number | null }) {
  return (
    <div className="grid gap-2 rounded-card border border-purple-100 p-4">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <strong>Attempt {s.attempt}</strong><StateBadge state={s.status} />
        <span className="text-ink/60">{new Date(s.submitted_at).toLocaleString()}</span>
      </p>
      {s.body && <p className="whitespace-pre-wrap text-sm">{s.body}</p>}
      {s.storage_path && (
        <button type="button" className="w-fit text-sm text-purple-700 underline"
          onClick={() => void openSubmissionFile(s.storage_path!).then((m) => m && window.alert(m))}>Open attached file</button>
      )}
      {(s.status === 'graded' || s.status === 'returned') && (
        <div className="rounded-control bg-purple-50 p-3 text-sm">
          {s.status === 'graded' && maxScore !== null && <p className="font-semibold">Score: {s.score} / {maxScore}</p>}
          {s.feedback ? <p className="whitespace-pre-wrap">{s.feedback}</p> : <p className="text-ink/60">No written feedback.</p>}
        </div>
      )}
    </div>
  );
}
