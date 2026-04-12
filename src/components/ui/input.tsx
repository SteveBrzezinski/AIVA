import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-[color:var(--input-border)] bg-[var(--input-bg)] px-2.5 py-1 text-base text-[var(--text-primary)] shadow-none transition-[border-color,box-shadow,background-color,color] outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-[var(--text-primary)] placeholder:text-[var(--text-muted)] hover:border-[color:var(--button-secondary-border-hover)] focus-visible:border-[color:var(--input-border-focus)] focus-visible:ring-[3px] focus-visible:ring-[rgba(240,101,37,0.12)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-[var(--input-bg)] disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
