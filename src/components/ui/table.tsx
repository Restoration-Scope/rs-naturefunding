import type * as React from 'react'
import { cn } from '@/lib/utils'

// shadcn/ui Table. No scrolling wrapper: the header sticks to the page, and the finder
// reflows to rows on phones instead of scrolling sideways.
function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return <table data-slot="table" className={cn('w-full', className)} {...props} />
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={cn(className) || undefined} {...props} />
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return <tbody data-slot="table-body" className={cn(className) || undefined} {...props} />
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return <tr data-slot="table-row" className={cn(className) || undefined} {...props} />
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return <th data-slot="table-head" className={cn('text-left', className)} {...props} />
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return <td data-slot="table-cell" className={cn('align-top', className)} {...props} />
}

function TableCaption({ className, ...props }: React.ComponentProps<'caption'>) {
  return <caption data-slot="table-caption" className={cn(className) || undefined} {...props} />
}

export { Table, TableHeader, TableBody, TableHead, TableRow, TableCell, TableCaption }
