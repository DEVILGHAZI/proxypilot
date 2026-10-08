import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em]", {
  variants: {
    state: {
      up: "text-ok",
      down: "text-down",
      unknown: "text-warn",
    },
  },
  defaultVariants: {
    state: "unknown",
  },
});

type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, state, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ state }), className)} {...props}>
      <span className="inline-block h-1.5 w-1.5 bg-current" />
      {children}
    </span>
  );
}
