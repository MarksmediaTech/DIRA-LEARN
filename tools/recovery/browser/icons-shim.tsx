// Stand-in for lucide-react icons (test harness only): each icon is a small hidden-from-readers glyph named after the icon,
// so screenshots show where icons are; the real app uses lucide-react's SVG icons.
const GLYPH: Record<string, string> = { Bell: '🔔', Search: '⌕', Send: '➤', Paperclip: '📎', Mic: '🎙', X: '✕', Plus: '+', Menu: '☰', SmilePlus: '☺', Pin: '📌', Trash2: '🗑', Pencil: '✎', Check: '✓', CheckCheck: '✓✓', Users: '👥', Megaphone: '📣', MessageCircle: '💬', FileText: '📄', Film: '🎞', Play: '▶', Pause: '⏸', Square: '■', Download: '⬇', ChevronDown: '▾', LogOut: '⇥', KeyRound: '🔑', ArrowLeft: '←', CornerUpLeft: '↩', Flag: '⚑', UserPlus: '+👤', PinOff: '📍', ShieldAlert: '⚠', AtSign: '@', BookOpen: '📖' };
const make = (name: string) => { const I = ({ className, size = 16 }: { className?: string; size?: number }) => <span aria-hidden data-icon={name} className={className} style={{ display: 'inline-block', fontSize: size * 0.8, lineHeight: 1, width: size, textAlign: 'center' }}>{GLYPH[name] ?? '•'}</span>; return I; };
export const HeartHandshake = make('HeartHandshake'), Mic = make('Mic'), Rocket = make('Rocket'), Users = make('Users'), Pause = make('Pause'), Play = make('Play'),
  ArrowLeft = make('ArrowLeft'), Check = make('Check'), CheckCheck = make('CheckCheck'), CornerUpLeft = make('CornerUpLeft'), Flag = make('Flag'), Paperclip = make('Paperclip'),
  Search = make('Search'), Send = make('Send'), UserPlus = make('UserPlus'), LogOut = make('LogOut'), X = make('X'), Bell = make('Bell'), Megaphone = make('Megaphone'),
  MessageCircle = make('MessageCircle'), AtSign = make('AtSign'), SmilePlus = make('SmilePlus'), BookOpen = make('BookOpen'), ChevronDown = make('ChevronDown'),
  KeyRound = make('KeyRound'), Menu = make('Menu'), FileText = make('FileText'), Film = make('Film'), Plus = make('Plus'), ShieldAlert = make('ShieldAlert'),
  Square = make('Square'), Trash2 = make('Trash2'), Download = make('Download'), Pencil = make('Pencil'), Pin = make('Pin'), PinOff = make('PinOff');
export type LucideIcon = ReturnType<typeof make>;
