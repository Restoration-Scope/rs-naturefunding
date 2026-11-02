import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'
import { cn } from '@/lib/utils'

// shadcn/ui Badge on the site's palette. `status` (open, rolling…) and `tag` (the checked date) take their
// look from classes in global.css, because src/lib/finder.ts writes a status and ages tags at runtime. Their
// CSS sets their own display, so the shared layout classes go only on the other variants: as utilities they
// would beat the finder's rules that hide a tag at some widths.
const badge =
  'inline-flex w-fit shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-xs leading-[1.35] font-medium whitespace-nowrap tabular-nums [&>svg]:size-3.5 [&>svg]:shrink-0'
const badgeVariants = cva('', {
  variants: {
    variant: {
      status: 'status',
      tag: 'tag',
      /** How many filters are on. */
      count: `${badge} min-w-5 justify-center rounded-full bg-primary px-1.5 font-medium text-primary-foreground`,
      /** A quiet fill: routes that aren't "apply directly", counts. */
      secondary: `${badge} bg-secondary text-secondary-foreground`,
      /** Amber: a deadline within a week. */
      warn: `${badge} bg-warn text-warn-ink`,
    },
  },
  defaultVariants: { variant: 'secondary' },
})

type Props = React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { state?: string }

function Badge({ className, variant, state, ...props }: Props) {
  return <span data-slot="badge" data-state={state} className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
