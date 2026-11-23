import { Link } from 'react-router-dom';
import { useMyAssignments } from './useMyAssignments';
import { GROUP_LABEL, GROUP_ORDER, countGroups, groupAssignments } from './rules';
import { StateBadge } from './shared';

const dueText = (d: string | null) => (d ? new Date(d).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'No due date');

/** Learner dashboard section: counts for each group and the work that needs attention next. */
export function MyAssignmentsCard() {
  const q = useMyAssignments();
  return (
    <section aria-labelledby="my-assignments-heading" className="grid gap-4 rounded-card border border-purple-100 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="my-assignments-heading" className="font-display text-xl font-semibold text-purple-900">My Assignments</h2>
        <Link to="/assignments" className="text-sm font-medium text-purple-700 underline">View all</Link>
      </div>
      {q.isLoading && <p role="status" className="text-sm">Loading your assignments…</p>}
      {q.isError && <p role="alert" className="text-sm text-danger">Could not load your assignments.</p>}
      {q.data && q.data.length === 0 && <p className="text-sm text-ink/70">No assignments yet. Your trainer will add them as the programme goes on.</p>}
      {q.data && q.data.length > 0 && (() => {
        const counts = countGroups(q.data);
        const groups = groupAssignments(q.data);
        const next = [...groups.overdue, ...groups.upcoming].slice(0, 3);
        return (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {GROUP_ORDER.map((g) => (
                <div key={g} className="rounded-control bg-purple-50 p-3 text-center">
                  <dd className={`text-2xl font-bold ${g === 'overdue' && counts[g] > 0 ? 'text-danger' : 'text-purple-900'}`}>{counts[g]}</dd>
                  <dt className="text-xs text-ink/70">{GROUP_LABEL[g]}</dt>
                </div>
              ))}
            </dl>
            {next.length > 0 ? (
              <ul className="grid gap-2">
                {next.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span><Link to={`/assignments/${a.id}`} className="font-semibold text-purple-700 underline">{a.title}</Link><span className="text-ink/70"> · {a.dueAt ? `Due ${dueText(a.dueAt)}` : 'No due date'}</span></span>
                    <StateBadge state={a.state} />
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-ink/70">Nothing is waiting for you right now.</p>}
          </>
        );
      })()}
    </section>
  );
}
