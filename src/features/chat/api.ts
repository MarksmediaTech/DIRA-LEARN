// Data access for Chat (22 Nov 2026). Every call goes through Supabase with the signed-in user's session, so Row Level Security
// and the database functions decide what is visible and allowed. Files go to private buckets and open through short-lived links.
import { supabase } from '@/lib/supabase';
import { attachmentPath, safeFileName } from '@/features/connect/rules';
import { baseMime, embeddedAnnouncementTitle, type AnnouncementFileRow } from './rules';

export interface InboxItem {
  conversation_id: string; kind: 'direct' | 'cohort' | 'safeguarding' | 'dm' | 'group'; title: string | null; subtitle: string;
  other_profile_id: string | null; last_message_at: string | null; last_message: string | null; last_sender_id: string | null;
  unread: number | string; locked: boolean; is_owner: boolean; member_count: number | null; can_post: boolean;
}
export interface FileRef { id: string; path: string; name: string; mime: string; size: number; scan?: string }
export interface Reaction { emoji: string; count: number; mine: boolean }
export interface ChatMessage {
  id: string; sender_id: string; sender_name: string; body: string | null; created_at: string; hidden: boolean;
  reply_to: string | null; reply_sender: string | null; reply_body: string | null; attachments: FileRef[]; reactions: Reaction[];
}
export interface AnnouncementItem {
  id: string; title: string; body: string; audience: 'everyone' | 'cohort' | 'track'; audience_label: string; cohort_id: string | null; track_id: string | null;
  pinned: boolean; created_by: string | null; author_name: string; created_at: string; edited_at: string | null; can_edit: boolean;
  attachments: FileRef[]; reactions: Reaction[];
}
export interface Contact { profile_id: string; display_name: string; role_label: string }

const fail = (e: { message?: string } | null): never => { throw new Error(e?.message ?? 'Something went wrong. Please try again.'); };

export async function inbox(): Promise<InboxItem[]> {
  const { data, error } = await supabase.rpc('chat_inbox'); if (error) fail(error); return (data ?? []) as InboxItem[];
}
export async function messages(conversationId: string, before?: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase.rpc('chat_messages', { p_conv: conversationId, p_before: before ?? null, p_limit: 60 }); if (error) fail(error);
  return (data ?? []) as ChatMessage[];
}
export async function markRead(conversationId: string): Promise<void> { await supabase.rpc('connect_mark_read', { p_conversation: conversationId }); }
export async function readState(conversationId: string): Promise<{ profile_id: string; last_read_at: string }[]> {
  const { data, error } = await supabase.rpc('chat_read_state', { p_conv: conversationId }); if (error) return []; return (data ?? []) as { profile_id: string; last_read_at: string }[];
}
export async function search(q: string): Promise<{ conversation_id: string; message_id: string; sender_name: string; body: string; created_at: string }[]> {
  const { data, error } = await supabase.rpc('chat_search', { p_query: q }); if (error) fail(error);
  return (data ?? []) as { conversation_id: string; message_id: string; sender_name: string; body: string; created_at: string }[];
}
export async function contacts(q: string): Promise<Contact[]> {
  const { data, error } = await supabase.rpc('chat_contacts', { p_query: q || null }); if (error) fail(error); return (data ?? []) as Contact[];
}
export async function startDm(profileId: string): Promise<string> {
  const { data, error } = await supabase.rpc('chat_start_dm', { p_other: profileId }); if (error) fail(error); return data as string;
}
export async function startSafeguarding(): Promise<string> {
  const { data, error } = await supabase.rpc('connect_start_safeguarding'); if (error) fail(error); return data as string;
}
export async function createGroup(title: string, members: string[]): Promise<string> {
  const { data, error } = await supabase.rpc('chat_create_group', { p_title: title, p_members: members }); if (error) fail(error); return data as string;
}
export async function addMembers(conversationId: string, members: string[]): Promise<number> {
  const { data, error } = await supabase.rpc('chat_add_members', { p_conv: conversationId, p_members: members }); if (error) fail(error); return Number(data ?? 0);
}
export async function leaveGroup(conversationId: string, me: string): Promise<void> {
  const { error } = await supabase.rpc('chat_remove_member', { p_conv: conversationId, p_member: me }); if (error) fail(error);
}
export async function react(messageId: string, emoji: string): Promise<void> {
  const { error } = await supabase.rpc('chat_react', { p_message: messageId, p_emoji: emoji }); if (error) fail(error);
}
export async function reportMessage(messageId: string, reason: string, note: string | null): Promise<void> {
  const { error } = await supabase.rpc('connect_report_message', { p_message: messageId, p_reason: reason, p_note: note }); if (error) fail(error);
}

/** Send a message: upload the files into the conversation's folder, insert the message, then link the files (the database checks all three). */
export async function sendMessage(conversationId: string, me: string, body: string, replyTo: string | null, files: File[]): Promise<void> {
  const uploaded: { path: string; file: File }[] = [];
  for (const f of files) {
    const path = attachmentPath(conversationId, me, crypto.randomUUID(), f.name);
    const { error } = await supabase.storage.from('connect-attachments').upload(path, f, { contentType: baseMime(f.type), upsert: false });
    if (error) throw new Error(`${f.name} could not be uploaded: ${error.message}`);
    uploaded.push({ path, file: f });
  }
  const { data: msg, error } = await supabase.from('connect_messages').insert({ conversation_id: conversationId, sender_id: me, body, reply_to: replyTo }).select('id').single();
  if (error) fail(error);
  for (const u of uploaded) {
    const { error: aErr } = await supabase.from('connect_attachments').insert({ message_id: (msg as { id: string }).id, conversation_id: conversationId, storage_path: u.path,
      file_name: u.file.name, mime_type: baseMime(u.file.type), size_bytes: u.file.size, uploaded_by: me });
    if (aErr) throw new Error(`${u.file.name} could not be attached: ${aErr.message}`);
  }
}

export async function announcements(): Promise<AnnouncementItem[]> {
  const { data, error } = await supabase.rpc('ann_feed', { p_before: null, p_limit: 50 }); if (error) fail(error); return (data ?? []) as AnnouncementItem[];
}
export interface NewAnnouncement { title: string; body: string; audience: 'everyone' | 'cohort' | 'track'; cohortId: string; trackId: string; pinned: boolean }
/** Publish: the announcement first (so its folder exists for the policy), then its files. Returns the id. */
export async function publishAnnouncement(a: NewAnnouncement, files: File[]): Promise<{ id: string; fileErrors: string[] }> {
  const id = crypto.randomUUID();
  const { error } = await supabase.from('announcements').insert({ id, title: a.title.trim(), body: a.body.trim(), audience: a.audience,
    cohort_id: a.audience === 'cohort' ? a.cohortId : null, track_id: a.audience === 'track' ? a.trackId : null, pinned: a.pinned });
  if (error) fail(error);
  const fileErrors: string[] = [];
  for (const f of files) {
    const path = `${id}/${crypto.randomUUID()}-${safeFileName(f.name)}`;
    const { error: upErr } = await supabase.storage.from('announcement-files').upload(path, f, { contentType: baseMime(f.type), upsert: false });
    if (upErr) { fileErrors.push(`${f.name}: ${upErr.message}`); continue; }
    const { error: rowErr } = await supabase.from('announcement_attachments').insert({ announcement_id: id, storage_path: path, file_name: f.name, mime_type: baseMime(f.type), size_bytes: f.size });
    if (rowErr) fileErrors.push(`${f.name}: ${rowErr.message}`);
  }
  return { id, fileErrors };
}
export async function updateAnnouncement(id: string, patch: { title?: string; body?: string; pinned?: boolean }): Promise<void> {
  const { error } = await supabase.from('announcements').update(patch).eq('id', id).select('id').single(); if (error) fail(error);
}
export async function deleteAnnouncement(id: string, files: FileRef[]): Promise<void> {
  if (files.length) await supabase.storage.from('announcement-files').remove(files.map((f) => f.path));
  const { error } = await supabase.from('announcements').delete().eq('id', id).select('id').single(); if (error) fail(error);
}
export async function reactAnnouncement(id: string, emoji: string): Promise<void> {
  const { error } = await supabase.rpc('ann_react', { p_announcement: id, p_emoji: emoji }); if (error) fail(error);
}
export async function audienceChoices(): Promise<{ cohorts: { id: string; name: string }[]; tracks: { id: string; name: string }[] }> {
  const [c, t] = await Promise.all([
    supabase.from('cohorts').select('id, name').eq('archived', false).order('start_date', { ascending: false }),
    supabase.from('tracks').select('id, name, position').order('position'),
  ]);
  return { cohorts: (c.data ?? []) as { id: string; name: string }[], tracks: (t.data ?? []) as { id: string; name: string }[] };
}

/** A short-lived link to a private file (60 s). The bucket's policies and the virus-scan rule decide whether it is allowed. */
export async function fileLink(bucket: 'connect-attachments' | 'announcement-files', path: string, downloadName?: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 10, downloadName ? { download: downloadName } : undefined);
  return error || !data ? null : data.signedUrl;
}

export interface LibraryItem { key: string; bucket: 'connect-attachments' | 'announcement-files'; path: string; name: string; mime: string; size: number;
  scan: string | null; created_at: string; where: string; link: string }
/** Files the user may see: from announcements and from their conversations (Row Level Security filters both lists). */
export async function library(): Promise<LibraryItem[]> {
  const [a, c] = await Promise.all([
    supabase.from('announcement_attachments').select('id, storage_path, file_name, mime_type, size_bytes, created_at, announcement_id, announcements(title)').order('created_at', { ascending: false }).limit(200),
    supabase.from('connect_attachments').select('id, storage_path, file_name, mime_type, size_bytes, created_at, scan_status, conversation_id').order('created_at', { ascending: false }).limit(200),
  ]);
  const out: LibraryItem[] = [];
  // Plain assignment, not a cast: the compiler checks that what the client returns fits the row type (see AnnouncementFileRow in ./rules).
  const announcementRows: AnnouncementFileRow[] = a.data ?? [];
  for (const r of announcementRows) {
    out.push({ key: 'a' + r.id, bucket: 'announcement-files', path: r.storage_path, name: r.file_name, mime: r.mime_type, size: r.size_bytes, scan: null, created_at: r.created_at,
      where: `Announcement: ${embeddedAnnouncementTitle(r.announcements)}`, link: `/chat?a=${r.announcement_id}` });
  }
  for (const r of (c.data ?? []) as { id: string; storage_path: string; file_name: string; mime_type: string; size_bytes: number; created_at: string; scan_status: string; conversation_id: string }[]) {
    out.push({ key: 'c' + r.id, bucket: 'connect-attachments', path: r.storage_path, name: r.file_name, mime: r.mime_type, size: r.size_bytes, scan: r.scan_status, created_at: r.created_at,
      where: 'Conversation', link: `/chat?c=${r.conversation_id}` });
  }
  return out.sort((x, y) => y.created_at.localeCompare(x.created_at));
}
