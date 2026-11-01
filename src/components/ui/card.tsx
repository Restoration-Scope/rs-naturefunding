import type * as React from 'react'
import { cn } from '@/lib/utils'

// shadcn/ui Card on the site's surface: a ruled box, square-ish corners, no shadow.
function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card" className={cn('rounded-md border border-border bg-card text-card-foreground', className)} {...props} />
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-header" className={cn('flex flex-wrap items-center gap-x-[0.85rem] gap-y-2', className)} {...props} />
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn(className)} {...props} />
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-footer" className={cn('flex flex-wrap items-center', className)} {...props} />
}

export { Card, CardHeader, CardContent, CardFooter }
