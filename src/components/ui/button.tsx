import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'
import { cn } from '@/lib/utils'

// shadcn/ui Button, as a plain <button> or <a> (no Radix or Base UI): it renders at build time and ships no JS.
const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center gap-2 rounded-md font-bold no-underline',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-action-hover',
        outline: 'bg-transparent text-ink shadow-[inset_0_0_0_1.5px_var(--rule-strong)] hover:bg-sunk',
      },
      size: {
        default: 'min-h-11 px-[1.1rem] py-[0.55rem]',
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
