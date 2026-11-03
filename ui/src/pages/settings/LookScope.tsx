import { Layers } from "lucide-react";
import { toast } from "sonner";
import { useDesk } from "../../desk/store";
import { dropOwnLook, giveOwnLook, shareDeskLook } from "../../theme/deskLook";
import { Button } from "../../components/ui/Button";
import { cn } from "../../components/ui/cn";

export function LookScope() {
  const layouts = useDesk((s) => s.layouts);
  const activeId = useDesk((s) => s.activeId);
  const setActive = useDesk((s) => s.setActive);
  const active = layouts.find((l) => l.id === activeId);
  if (!active) return null;
  const own = !!active.data.look;
  return (
    <div className="border-b border-line px-5 py-4" data-look-scope={own ? "desk" : "shared"}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[13px] font-medium text-fg-0">Desks</span>
        {layouts.map((l) => (
          <button
            key={l.id}
            onClick={() => setActive(l.id)}
            aria-pressed={l.id === activeId}
            className={cn(
              "flex items-center gap-1.5 rounded-pill px-3 py-1 text-[12.5px] transition-colors",
              l.id === activeId ? "bg-fg-0 text-bg-0" : "text-fg-1 hairline hover:bg-bg-3",
            )}
          >
            {l.name}
            <span className={cn("text-[10.5px]", l.id === activeId ? "opacity-60" : "text-fg-3")}>{l.data.look ? "own look" : "shared"}</span>
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-[240px] flex-1 text-[13px] leading-relaxed text-fg-2">
          {own ? (
            <>
              Everything under Look and feel now changes <span className="font-semibold text-fg-0">{active.name}</span> only. Switch desks and the whole look switches
              with it.
            </>
          ) : (
            <>
              You're editing the <span className="font-semibold text-fg-0">shared look</span>, used by every desk that doesn't have its own.
            </>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          {own ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  shareDeskLook();
                  toast("Desks without their own look now use this one");
                }}
              >
                Use for the other desks
              </Button>
              <Button size="sm" variant="ghost" onClick={() => dropOwnLook(active.id)}>
                Back to the shared look
              </Button>
            </>
          ) : (
            <Button size="sm" icon={<Layers size={14} />} onClick={() => giveOwnLook(active.id)}>
              Give “{active.name}” its own look
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
