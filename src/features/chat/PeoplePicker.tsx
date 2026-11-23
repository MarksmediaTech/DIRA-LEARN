import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import * as api from './api';
import { Avatar } from './parts';

/** Search the people the signed-in user may talk to (the database decides who is listed: chat_contacts). */
export function PeoplePicker({ picked, onChange, multiple, onPickOne }: { picked: api.Contact[]; onChange?: (p: api.Contact[]) => void; multiple?: boolean; onPickOne?: (c: api.Contact) => void }) {
  const [q, setQ] = useState('');
  const people = useQuery({ queryKey: ['chat-contacts', q], queryFn: () => api.contacts(q.trim()), staleTime: 30_000 });
  const chosen = new Set(picked.map((p) => p.profile_id));
  return (
    <div className="grid gap-2">
      <label className="grid gap-1 text-xs font-medium">Find people
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a name…" className="rounded-full border border-purple-200 px-4 py-1.5 text-sm font-normal dark:border-gray-600 dark:bg-gray-800" />
      </label>
      {multiple && picked.length > 0 && (
        <ul className="flex flex-wrap gap-1" aria-label="Chosen people">
          {picked.map((p) => (
            <li key={p.profile_id} className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs dark:bg-gray-800">{p.display_name}
              <button type="button" aria-label={`Remove ${p.display_name}`} onClick={() => onChange?.(picked.filter((x) => x.profile_id !== p.profile_id))}><X size={12} aria-hidden /></button></li>
          ))}
        </ul>
      )}
      {people.isLoading && <p role="status" className="text-xs">Searching…</p>}
      {people.isError && <p role="alert" className="text-xs text-danger">Could not load people.</p>}
      {people.data && !people.data.length && <p className="text-xs text-ink/60">Nobody found. You can message learners of your cohort, your trainers and the programme team.</p>}
      <ul className="grid max-h-60 gap-1 overflow-y-auto" aria-label="People">
        {(people.data ?? []).map((c) => (
          <li key={c.profile_id}>
            <button type="button" aria-pressed={multiple ? chosen.has(c.profile_id) : undefined}
              onClick={() => (multiple ? onChange?.(chosen.has(c.profile_id) ? picked.filter((x) => x.profile_id !== c.profile_id) : [...picked, c]) : onPickOne?.(c))}
              className={`flex w-full items-center gap-2 rounded-xl px-2 py-1.5 text-left text-sm hover:bg-purple-50 dark:hover:bg-gray-800 ${chosen.has(c.profile_id) ? 'bg-purple-50 dark:bg-gray-800' : ''}`}>
              <Avatar id={c.profile_id} name={c.display_name} size="sm" />
              <span className="min-w-0 flex-1"><span className="block truncate font-medium">{c.display_name}</span><span className="block text-xs text-ink/60 dark:text-gray-400">{c.role_label}</span></span>
              {multiple && chosen.has(c.profile_id) && <span className="text-xs font-semibold text-purple-700">Added</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
