// Edge Function: receives Resend delivery events and updates the outbox. NOT deployed or tested.
// Deploy with --no-verify-jwt (Resend cannot send a Supabase JWT); the Svix signature is the authentication.
// Secret: RESEND_WEBHOOK_SECRET (the whsec_... value shown when you create the webhook in Resend).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { verifySvix } from '../_shared/svix.ts';

const MAP: Record<string, string> = { 'email.delivered': 'delivered', 'email.bounced': 'bounced', 'email.complained': 'complained', 'email.failed': 'failed' };
// Never move an email backwards (for example from bounced back to delivered).
const FROM_STATES: Record<string, string[]> = { delivered: ['sent'], bounced: ['sent', 'delivered'], complained: ['sent', 'delivered'], failed: ['sent', 'sending'] };

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET');
  if (!secret) return new Response('Webhook secret not configured', { status: 503 });
  const raw = await req.text();
  const ok = await verifySvix(secret, { id: req.headers.get('svix-id'), timestamp: req.headers.get('svix-timestamp'), signature: req.headers.get('svix-signature') }, raw);
  if (!ok) return new Response('Invalid signature', { status: 401 });

  const event = JSON.parse(raw) as { type: string; data?: { email_id?: string; bounce?: { message?: string } } };
  const status = MAP[event.type]; const providerId = event.data?.email_id;
  if (!status || !providerId) return new Response('Ignored', { status: 200 });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { error } = await admin.from('email_outbox').update({ status, error: event.data?.bounce?.message ?? null }).eq('provider_id', providerId).in('status', FROM_STATES[status]!);
  return error ? new Response('Update failed', { status: 500 }) : new Response('OK', { status: 200 });
});
