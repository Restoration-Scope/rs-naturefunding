import type * as React from 'react'
import { cn } from '@/lib/utils'

// shadcn/ui Label, in the site's small-caps label style.
function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return <label data-slot="label" className={cn('block text-xs font-bold tracking-[0.04em] text-ink-2 uppercase', className)} {...props} />
}

export { Label }
