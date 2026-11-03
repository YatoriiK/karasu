import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { motion } from "motion/react";
import { cn } from "./cn";
import { Tooltip } from "./Tooltip";

type Variant = "primary" | "secondary" | "ghost" | "glass" | "danger";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-fg hover:brightness-110 shadow-[0_8px_24px_-10px_var(--accent)] disabled:opacity-50",
  secondary: "bg-bg-3 text-fg-0 hover:bg-bg-4 hairline disabled:opacity-50",
  ghost: "text-fg-1 hover:text-fg-0 hover:bg-bg-3/70 disabled:opacity-40",
  glass: "surface text-fg-0 hover:bg-bg-3/80 disabled:opacity-50",
  danger: "bg-bad/15 text-bad hover:bg-bad/25 disabled:opacity-50",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-md",
  md: "h-10 px-4 text-sm gap-2 rounded-lg",
  lg: "h-12 px-6 text-[15px] gap-2.5 rounded-xl",
};

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onAnimationStart" | "onDrag" | "onDragStart" | "onDragEnd"> & {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "secondary", size = "md", icon, className, children, ...rest },
  ref,
) {
  return (
    <motion.button
      ref={ref}
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 600, damping: 30 }}
      className={cn(
        "inline-flex items-center justify-center font-medium whitespace-nowrap transition-[background,color,filter,box-shadow] duration-200 select-none",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </motion.button>
  );
});

type IconProps = Omit<Props, "icon" | "size"> & {
  label: string;
  size?: "sm" | "md" | "lg";
  active?: boolean;
  tooltip?: boolean;
  round?: boolean;
};

const iconSizes = { sm: "h-8 w-8", md: "h-9 w-9", lg: "h-11 w-11" };

export const IconButton = forwardRef<HTMLButtonElement, IconProps>(function IconButton(
  { label, size = "md", active, tooltip = true, round, className, children, variant = "ghost", ...rest },
  ref,
) {
  const button = (
    <motion.button
      ref={ref}
      aria-label={label}
      whileTap={{ scale: 0.9 }}
      transition={{ type: "spring", stiffness: 700, damping: 28 }}
      className={cn(
        "inline-flex items-center justify-center transition-[background,color,opacity] duration-200",
        iconSizes[size],
        round ? "rounded-full" : "rounded-lg",
        variants[variant],
        active && "text-accent hover:text-accent",
        className,
      )}
      {...rest}
    >
      {children}
    </motion.button>
  );
  return tooltip ? <Tooltip label={label}>{button}</Tooltip> : button;
});
