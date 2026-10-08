import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 border border-line bg-transparent px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-[#e7e8ea] transition-colors hover:bg-white/5 disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        default: "",
        quiet: "border-transparent text-muted hover:text-[#e7e8ea]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

export function Button({ className, variant, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant }), className)} {...props} />;
}
