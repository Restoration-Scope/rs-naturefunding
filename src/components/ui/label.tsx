import type * as React from 'react'
import { cn } from '@/lib/utils'

// shadcn/ui Label: sentence case, medium weight.
function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return <label data-slot="label" className={cn('block text-sm font-semibold text-foreground', className)} {...props} />
}

export { Label }
