import { createClient } from '@supabase/supabase-js';
import { supabaseConfigProblem } from './supabaseConfig';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anon);
/** Non-null in a production build whose database settings are missing or point at a local address. */
export const configProblem = supabaseConfigProblem(url, anon, Boolean(import.meta.env.PROD));

// Placeholder values keep the app bootable (and testable) without a backend; calls will fail with a clear error.
export const supabase = createClient(url ?? 'http://localhost:54321', anon ?? 'missing-anon-key');
