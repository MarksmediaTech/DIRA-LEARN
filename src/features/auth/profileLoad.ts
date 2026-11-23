// Loading the signed-in person's DIRA LEARN profile (fix for the endless "Loading your account…" screen, 20 Nov 2026).
// Previously every failure (no profile row, a database or network error, a refused request) left the profile empty, and the
// screen waited for it for ever. Every outcome is now one of these states, and only 'loading' shows the waiting text.
import type { Profile } from '@/types/database';
import { inactiveProfile, isInactiveAccountError } from './accountStatus';

export type ProfileLoad =
  | { state: 'idle' }                                     // nobody signed in
  | { state: 'loading' }
  | { state: 'ready'; profile: Profile }
  | { state: 'missing' }                                  // signed in, but no profile row exists for this user
  | { state: 'error'; code: string };                     // the request failed (code is shown so support can find the cause)

/** Longest time the account screen waits for the profile before offering "Try again". */
export const PROFILE_TIMEOUT_MS = 15_000;

interface QueryError { code?: string; message?: string; status?: number }

/** Turns the result of `profiles.select(...).eq('id', uid).maybeSingle()` into a state. Never throws. */
export function classifyProfileResult(userId: string, data: unknown, error: QueryError | null): ProfileLoad {
  if (isInactiveAccountError(error)) return { state: 'ready', profile: inactiveProfile(userId) };   // shown as "not active"
  if (error) return { state: 'error', code: errorCode(error) };
  if (!data) return { state: 'missing' };
  const p = data as Partial<Profile>;
  if (p.id !== userId || typeof p.role !== 'string' || typeof p.status !== 'string') return { state: 'error', code: 'PROFILE_INVALID' };
  return { state: 'ready', profile: data as Profile };
}

/** A short code for people and support, without any token or personal data. */
export function errorCode(e: unknown): string {
  if (e && typeof e === 'object') {
    const x = e as QueryError & { name?: string };
    if (x.code) return String(x.code).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || 'UNKNOWN';
    if (x.name === 'TypeError' || /fetch|network/i.test(x.message ?? '')) return 'NETWORK';
    if (typeof x.status === 'number') return 'HTTP_' + x.status;
  }
  return 'UNKNOWN';
}

/** Rejects with code TIMEOUT when the promise takes longer than ms. */
export function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })), ms);
    Promise.resolve(p).then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export type ProblemKind = 'missing' | 'session' | 'permission' | 'not-initialised' | 'connection' | 'other';

/** Groups an error code into what the person can do about it (21 Nov 2026: the production 403 on profiles was shown as
 *  "check your internet connection", which sent people the wrong way). */
export function problemKind(load: ProfileLoad): ProblemKind | null {
  if (load.state === 'missing') return 'missing';
  if (load.state !== 'error') return null;
  const c = load.code.toUpperCase();
  if (['PGRST301', 'PGRST302', 'PGRST303', 'HTTP_401', '401'].includes(c) || /JWT/.test(c)) return 'session';      // expired or invalid sign-in
  if (['42501', 'HTTP_403', '403'].includes(c)) return 'permission';                                                  // refused by the database
  if (['PGRST205', '42P01', 'PGRST202', '42883'].includes(c)) return 'not-initialised';                              // table or function missing
  if (['NETWORK', 'TIMEOUT'].includes(c) || c.startsWith('HTTP_5')) return 'connection';
  return 'other';
}

/** Text for each problem state (never the raw database message). `action` is the first button offered. */
export function profileProblemText(load: ProfileLoad): { title: string; body: string; action: 'retry' | 'signin' } | null {
  const kind = problemKind(load);
  const code = load.state === 'error' ? load.code : 'PROFILE_MISSING';
  switch (kind) {
    case null: return null;
    case 'missing': return { action: 'retry', title: 'Your account is not set up yet',
      body: 'You are signed in, but your DIRA LEARN account record was not found. Try again in a moment. If this keeps happening, contact the DIRA Foundation programme team and quote PROFILE_MISSING.' };
    case 'session': return { action: 'signin', title: 'Your sign-in has expired',
      body: `For your security, please sign in again. Your work is saved. (Code ${code}.)` };
    case 'permission': return { action: 'retry', title: 'DIRA LEARN could not open your account',
      body: `The server refused access to your account record. This is a set-up problem on the DIRA LEARN server, not something you did, and signing in again will not fix it. Please tell the DIRA Foundation programme team and quote ${code}. (For administrators: run supabase/production_init/02_verify_readonly.sql; check 16 shows whether the database permissions are in place.)` };
    case 'not-initialised': return { action: 'retry', title: 'DIRA LEARN is not set up yet',
      body: `The DIRA LEARN database has not been fully prepared. Please tell the DIRA Foundation programme team and quote ${code}. (For administrators: follow docs/deployment/PRODUCTION_DB_INITIALIZATION.md.)` };
    case 'connection': return { action: 'retry', title: 'We could not reach DIRA LEARN',
      body: `Check your internet connection and try again. If this keeps happening, contact the DIRA Foundation programme team and quote ${code}.` };
    default: return { action: 'retry', title: 'We could not load your account',
      body: `Try again in a moment. If this keeps happening, contact the DIRA Foundation programme team and quote ${code}.` };
  }
}
