// Pure rules of the Google Calendar sync panel (22 Nov 2026); the panel itself is GoogleSyncPanel.tsx.
const SYNCERS = ['super_admin', 'founder', 'co_founder', 'programme_director', 'programme_coordinator', 'trainer'];
export const QUEUE_ALL = ['super_admin', 'founder', 'co_founder', 'programme_director', 'programme_coordinator'];
export const canSeeGoogleSync = (role: string | null | undefined): boolean => SYNCERS.includes(role ?? '');

export interface SyncRow { state: 'pending' | 'syncing' | 'synced' | 'failed' | 'deleted'; last_error: string | null; synced_at: string | null; attempts: number }
export interface SyncSummary { waiting: number; synced: number; failed: number; lastSynced: string | null; errors: string[] }
/** Counts for the panel: waiting = pending or being sent; synced includes cancellations removed from Google. */
export function summarise(rows: readonly SyncRow[]): SyncSummary {
  const errors = [...new Set(rows.filter((r) => r.state === 'failed' && r.last_error).map((r) => r.last_error!))].slice(0, 3);
  const lastSynced = rows.map((r) => r.synced_at).filter(Boolean).sort().at(-1) ?? null;
  return { waiting: rows.filter((r) => r.state === 'pending' || r.state === 'syncing').length, synced: rows.filter((r) => r.state === 'synced' || r.state === 'deleted').length,
    failed: rows.filter((r) => r.state === 'failed').length, lastSynced, errors };
}

