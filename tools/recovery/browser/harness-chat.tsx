// Browser test harness for Chat and the notification bell: the REAL application (App.tsx with all its routes, AppShell,
// NotificationBell, ChatPage) running against the simulated client in fake-chat-supabase.ts. CSS: build-css.mjs.
import { createRoot } from 'react-dom/client';
import { App } from '@/App';
createRoot(document.getElementById('root')!).render(<App />);
