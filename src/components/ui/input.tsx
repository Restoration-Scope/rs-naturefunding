import type * as React from 'react'
import { cn } from '@/lib/utils'

// shadcn/ui Input as a native <input>, on the site's control tokens.
const inputClasses =
  'min-h-10 w-full rounded-md border-[1.5px] border-input bg-surface px-[0.65rem] py-[0.4rem] text-base text-ink placeholder:text-ink-2 placeholder:opacity-100 focus-visible:border-ring focus-visible:outline-offset-0'

function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return <input data-slot="input" className={cn(inputClasses, className)} {...props} />
}

export { Input, inputClasses }
