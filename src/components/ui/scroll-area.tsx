import type * as React from 'react'
import { cn } from '@/lib/utils'

// shadcn/ui ScrollArea (base-nova) as static markup: the viewport scrolls natively with its own bar hidden, and
// src/lib/scroll-area.ts draws the thumb (sized, placed, draggable), as Base UI's would. Without JavaScript the
// viewport still scrolls, with no bar shown. The bar hides itself while nothing overflows.
function ScrollArea({
  className,
  viewportClassName,
  scrollbarClassName,
  children,
  ...props
}: React.ComponentProps<'div'> & { viewportClassName?: string; scrollbarClassName?: string }) {
  return (
    <div data-slot="scroll-area" className={cn('relative', className)} {...props}>
      <div
        data-slot="scroll-area-viewport"
        className={cn(
          'size-full rounded-[inherit] [scrollbar-width:none] transition-[color,box-shadow] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 [&::-webkit-scrollbar]:hidden',
          viewportClassName,
        )}
      >
        {children}
      </div>
      <div
        data-slot="scroll-area-scrollbar"
        data-orientation="vertical"
        aria-hidden="true"
        hidden
        className={cn('absolute inset-y-0 right-0 flex w-2.5 touch-none flex-col border-l border-l-transparent p-px select-none', scrollbarClassName)}
      >
        <div data-slot="scroll-area-thumb" className="relative w-full rounded-full bg-border hover:bg-ink-2/40" />
      </div>
    </div>
  )
}

export { ScrollArea }
