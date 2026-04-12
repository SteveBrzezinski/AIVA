import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border-[color:var(--button-primary-border)] bg-[var(--button-primary-bg)] !text-[var(--button-primary-text)] shadow-[var(--button-primary-shadow)] hover:-translate-y-0.5 hover:bg-[var(--button-primary-bg-hover)]",
        outline:
          "border-[color:var(--button-secondary-border)] bg-[var(--button-secondary-bg)] text-[var(--text-primary)] hover:-translate-y-0.5 hover:border-[color:var(--button-secondary-border-hover)] hover:bg-[var(--button-secondary-bg-hover)] hover:text-[var(--text-primary)] aria-expanded:border-[color:var(--button-secondary-border-hover)] aria-expanded:bg-[var(--button-secondary-bg-hover)] aria-expanded:text-[var(--text-primary)]",
        secondary:
          "border-[color:var(--button-secondary-border)] bg-[var(--panel-bg-soft)] text-[var(--text-primary)] hover:-translate-y-0.5 hover:border-[color:var(--button-secondary-border-hover)] hover:bg-[var(--button-secondary-bg-hover)] aria-expanded:border-[color:var(--button-secondary-border-hover)] aria-expanded:bg-[var(--button-secondary-bg-hover)] aria-expanded:text-[var(--text-primary)]",
        ghost:
          "text-[var(--text-secondary)] hover:bg-[var(--button-secondary-bg-hover)] hover:text-[var(--text-primary)] aria-expanded:bg-[var(--button-secondary-bg-hover)] aria-expanded:text-[var(--text-primary)]",
        destructive:
          "border-[color:var(--danger-border)] bg-[var(--danger-bg)] text-[color:#8f2d3a] hover:bg-[rgba(186,49,64,0.18)] focus-visible:border-[color:var(--danger-border)] focus-visible:ring-[rgba(186,49,64,0.18)]",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
