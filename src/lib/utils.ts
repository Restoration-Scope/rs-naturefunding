import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// tailwind-merge has to know the site's own type steps and colours (src/styles/global.css),
// or it reads `text-md` as a colour and drops it next to `text-ink`.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['xs', 'sm', 'md', 'base', 'lg', 'xl', '2xl', '3xl'],
      color: [
        'background', 'foreground', 'card', 'card-foreground', 'primary', 'primary-foreground', 'secondary',
        'secondary-foreground', 'muted', 'muted-foreground', 'accent', 'accent-foreground', 'destructive', 'border',
        'input', 'ring', 'ground', 'surface', 'sunk', 'ink', 'ink-2', 'rule', 'rule-strong', 'control-edge', 'link',
        'focus', 'shell', 'shell-ink', 'shell-ink-2', 'tape-open', 'tape-rolling', 'tape-upcoming', 'tape-closed',
        'tape-ink', 'tag', 'tag-edge', 'tag-ink', 'aging', 'aging-ink', 'aging-text', 'action-hover', 'backdrop',
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
