import { Check } from 'lucide-react'
import type * as React from 'react'
import { cn } from '@/lib/utils'

// shadcn/ui Checkbox (base-nova) as a native <input type="checkbox">, so forms and src/lib/finder.ts read it
// without JS. The box and the check share one grid cell; the check shows while the input is checked.
function Checkbox({ className, ...props }: Omit<React.ComponentProps<'input'>, 'type'>) {
  return (
    <span data-slot="checkbox-wrapper" className="relative grid size-4 shrink-0 place-items-center">
      <input
        type="checkbox"
        data-slot="checkbox"
        className={cn(
          'peer col-start-1 row-start-1 m-0 size-4 shrink-0 cursor-pointer appearance-none rounded-[4px] border border-input bg-card shadow-xs transition-colors outline-hidden checked:border-primary checked:bg-primary focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20',
          className,
        )}
        {...props}
      />
      <Check
        data-slot="checkbox-indicator"
        className="pointer-events-none invisible col-start-1 row-start-1 size-3.5 text-primary-foreground peer-checked:visible"
        strokeWidth={3}
        aria-hidden="true"
      />
    </span>
  )
}

export { Checkbox }
