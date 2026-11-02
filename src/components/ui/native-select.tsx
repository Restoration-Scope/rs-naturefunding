import type * as React from 'react'
import { cn } from '@/lib/utils'
import { inputClasses } from './input'

// shadcn/ui Native Select: a real <select>, styled like Input.
function NativeSelect({ className, ...props }: React.ComponentProps<'select'>) {
  return <select data-slot="native-select" className={cn(inputClasses, className)} {...props} />
}

export { NativeSelect }
