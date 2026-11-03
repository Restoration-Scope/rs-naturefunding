import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'
import { cn } from '@/lib/utils'

// shadcn/ui Button, as a plain <button> or <a> (no Radix or Base UI): it renders at build time and ships no JS.
const buttonVariants = cva(
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap no-underline disabled:cursor-default disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-action-hover',
        outline: 'border border-border bg-card text-foreground shadow-xs hover:bg-muted',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/70',
        ghost: 'text-foreground hover:bg-muted',
      },
      size: {
        default: 'min-h-11 px-[1.1rem] py-[0.55rem] [&_svg]:size-4',
        sm: 'h-8 gap-1.5 px-3 text-sm [&_svg]:size-4',
        icon: 'size-11 [&_svg]:size-5',
      },
      width: {
        auto: '',
        /** Full width on phones, where buttons stack. */
        phone: 'max-md:w-full max-md:text-center',
      },
    },
    defaultVariants: { variant: 'default', size: 'default', width: 'auto' },
  },
)

type Props = VariantProps<typeof buttonVariants> &
  (({ href: string } & React.ComponentProps<'a'>) | ({ href?: undefined } & React.ComponentProps<'button'>))

function Button({ className, variant, size, width, ...props }: Props) {
  const classes = cn(buttonVariants({ variant, size, width }), className)
  if (props.href !== undefined) return <a data-slot="button" className={classes} {...(props as React.ComponentProps<'a'>)} />
  return <button data-slot="button" type="button" className={classes} {...(props as React.ComponentProps<'button'>)} />
}

export { Button, buttonVariants }
