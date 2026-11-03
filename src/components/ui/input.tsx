import type * as React from 'react'
import { cn } from '@/lib/utils'

// shadcn/ui Input (base-nova) as a native <input>, on the site's control tokens. It sits on white rather than
// shadcn's transparent, since the page is paper; touch screens get a 40px target.
const inputClasses =
  'h-8 w-full min-w-0 rounded-lg border border-input bg-card px-2.5 shadow-xs py-1 text-base text-foreground transition-colors outline-none pointer-coarse:h-10 placeholder:text-muted-foreground placeholder:opacity-100 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm'

function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return <input data-slot="input" className={cn(inputClasses, className)} {...props} />
}

export { Input, inputClasses }
