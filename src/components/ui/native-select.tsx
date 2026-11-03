import { ChevronDown } from 'lucide-react'
import type * as React from 'react'
import { cn } from '@/lib/utils'
import { inputClasses } from './input'

// shadcn/ui Native Select: a real <select>, styled like Input. The chevron is drawn here rather than by the
// browser, so it keeps the same inset from the edge as the text does on the left.
function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <div data-slot="native-select-wrapper" className="relative">
      <select data-slot="native-select" className={cn(inputClasses, 'cursor-pointer appearance-none pr-8', className)} {...props} />
      <ChevronDown
        data-slot="native-select-icon"
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
    </div>
  )
}

export { NativeSelect }
