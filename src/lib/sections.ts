import { Banknote, Calculator, CalendarClock, ClipboardCheck, FileText, FolderTree, Handshake, Info, UserCheck } from 'lucide-react'

/** The programme page's sections: one icon each, shared by the section's heading and its line in the contents
    list. The three fact groups also carry a hue (global.css .tone-*); the rest stay neutral (.tone-plain). */
export const sections = {
  overview: { icon: Info, tone: 'tone-plain' },
  partners: { icon: Handshake, tone: 'tone-plain' },
  money: { icon: Banknote, tone: 'tone-money' },
  who: { icon: UserCheck, tone: 'tone-who' },
  apply: { icon: ClipboardCheck, tone: 'tone-apply' },
  worth: { icon: Calculator, tone: 'tone-plain' },
  calls: { icon: CalendarClock, tone: 'tone-plain' },
  reporting: { icon: FileText, tone: 'tone-plain' },
  related: { icon: FolderTree, tone: 'tone-plain' },
} as const

export type SectionKind = keyof typeof sections
