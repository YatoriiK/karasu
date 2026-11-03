import { createContext, useContext, type ReactElement, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { ContextMenu as C, DropdownMenu as D } from "radix-ui";
import { cn } from "./cn";

type Kind = "dropdown" | "context";
const MenuKind = createContext<Kind>("dropdown");

const panel =
  "z-[70] min-w-[220px] rounded-xl bg-bg-3 p-1.5 elevated data-[state=open]:animate-[menu-in_180ms_var(--ease-out)] data-[state=closed]:animate-[menu-out_120ms_ease-in]";
const row = "flex h-9 cursor-default select-none items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium outline-none transition-colors";

export function Menu({
  trigger,
  children,
  align = "end",
  side = "bottom",
}: {
  trigger: ReactElement;
  children: ReactNode;
  align?: "start" | "center" | "end";
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <D.Root modal={false}>
      <D.Trigger asChild>{trigger}</D.Trigger>
      <D.Portal>
        <D.Content
          align={align}
          side={side}
          sideOffset={6}
          collisionPadding={12}
          className={cn(panel, "origin-[var(--radix-dropdown-menu-content-transform-origin)]")}
        >
          <MenuKind.Provider value="dropdown">{children}</MenuKind.Provider>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

export function ContextMenu({ children, content, disabled }: { children: ReactElement; content: ReactNode; disabled?: boolean }) {
  if (disabled) return children;
  return (
    <C.Root modal={false}>
      <C.Trigger asChild onContextMenu={(e) => e.stopPropagation()}>
        {children}
      </C.Trigger>
      <C.Portal>
        <C.Content collisionPadding={12} className={cn(panel, "origin-[var(--radix-context-menu-content-transform-origin)]")}>
          <MenuKind.Provider value="context">{content}</MenuKind.Provider>
        </C.Content>
      </C.Portal>
    </C.Root>
  );
}

export function MenuItem({
  icon,
  children,
  onSelect,
  danger,
  hint,
}: {
  icon?: ReactNode;
  children: ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  hint?: ReactNode;
}) {
  const Item = useContext(MenuKind) === "context" ? C.Item : D.Item;
  return (
    <Item
      onSelect={onSelect}
      className={cn(
        row,
        danger ? "text-bad data-[highlighted]:bg-bad/12" : "text-fg-1 data-[highlighted]:bg-bg-4 data-[highlighted]:text-fg-0",
      )}
    >
      {icon && <span className="grid w-4 place-items-center opacity-80">{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
      {hint && <span className="text-xs text-fg-3">{hint}</span>}
    </Item>
  );
}

export function MenuSub({ icon, label, children }: { icon?: ReactNode; label: ReactNode; children: ReactNode }) {
  const kind = useContext(MenuKind);
  const P = kind === "context" ? C : D;
  return (
    <P.Sub>
      <P.SubTrigger className={cn(row, "text-fg-1 data-[highlighted]:bg-bg-4 data-[highlighted]:text-fg-0 data-[state=open]:bg-bg-4")}>
        {icon && <span className="grid w-4 place-items-center opacity-80">{icon}</span>}
        <span className="flex-1 truncate">{label}</span>
        <ChevronRight size={14} className="text-fg-3" />
      </P.SubTrigger>
      <P.Portal>
        <P.SubContent sideOffset={6} collisionPadding={12} className={panel}>
          {children}
        </P.SubContent>
      </P.Portal>
    </P.Sub>
  );
}

export function MenuSeparator() {
  const Separator = useContext(MenuKind) === "context" ? C.Separator : D.Separator;
  return <Separator className="mx-2 my-1 h-px bg-line" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  const Label = useContext(MenuKind) === "context" ? C.Label : D.Label;
  return <Label className="px-2.5 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-[0.12em] text-fg-3">{children}</Label>;
}
