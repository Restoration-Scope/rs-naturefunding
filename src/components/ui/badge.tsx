import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'
import { cn } from '@/lib/utils'

// shadcn/ui Badge on the site's palette. `tape` (the status on flagging tape) and `tag` (the checked
// stamp) keep their look in global.css, because src/lib/finder.ts writes tapes and ages stamps at runtime.
// Their CSS sets their own display, so the shared layout classes go only on the other variants: as
// utilities they would beat the finder's rules that hide a stamp at some widths.
const pill = 'inline-flex w-fit shrink-0 items-center whitespace-nowrap'
const badgeVariants = cva('', {
  variants: {
    variant: {
      tape: 'tape',
      tag: 'tag',
      /** A count on the flagging-tape lime: how many filters are on. */
      count: `${pill} rounded-xs bg-tape-open px-[0.4rem] font-mono text-xs text-tape-ink tabular-nums`,
      /** A count on a quiet chip. */
      muted: `${pill} rounded-xs bg-sunk px-[0.45rem] font-mono text-sm tabular-nums shadow-[inset_0_0_0_1px_var(--rule)]`,
      /** A route, not a status: outlined, unlike the tape. */
      outline: `${pill} rounded-xs border border-rule-strong px-[0.4rem] text-sm font-semibold`,
    },
  },
  defaultVariants: { variant: 'count' },
})

type Props = React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { state?: string }

function Badge({ className, variant, state, ...props }: Props) {
  return <span data-slot="badge" data-state={state} className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
