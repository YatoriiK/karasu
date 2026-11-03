import type { ReactElement, ReactNode } from "react";
import { Tooltip as T } from "radix-ui";

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <T.Provider delayDuration={450} skipDelayDuration={250}>
      {children}
    </T.Provider>
  );
}

export function Tooltip({
  label,
  children,
  side = "top",
}: {
  label: ReactNode;
  children: ReactElement;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={8}
          className="z-[80] rounded-md bg-bg-4 px-2.5 py-1.5 text-xs font-medium text-fg-0 elevated data-[state=delayed-open]:animate-[tip_160ms_var(--ease-out)]"
        >
          {label}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
