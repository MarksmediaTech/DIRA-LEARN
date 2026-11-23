import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Who is online right now (Supabase Realtime Presence). Each signed-in user announces only their own id on one shared channel;
 * nothing is stored. Shown as a green dot next to people the user can already see in Chat.
 */
export function usePresence(myId: string | null | undefined): Set<string> {
  const [online, setOnline] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!myId) return;
    const channel = supabase.channel('dira-online', { config: { presence: { key: myId } } });
    channel
      .on('presence', { event: 'sync' }, () => setOnline(new Set(Object.keys(channel.presenceState()))))
      .subscribe((status: string) => { if (status === 'SUBSCRIBED') void channel.track({ at: new Date().toISOString() }); });
    return () => { void supabase.removeChannel(channel); };
  }, [myId]);
  return online;
}
