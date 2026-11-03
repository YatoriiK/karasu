import { AudioWaveform, CalendarClock, Gem, Network, Sparkles, Tag, ThumbsUp, Wand2 } from "lucide-react";
import type { Reason } from "../../lib/types";
import { cn } from "../ui/cn";

const ICONS: Record<string, typeof Sparkles> = {
  sound: AudioWaveform,
  graph: Network,
  tag: Tag,
  era: CalendarClock,
  facet: Sparkles,
  popularity: Gem,
  feedback: ThumbsUp,
  vibe: Wand2,
  engine: Sparkles,
};

export function ReasonLine({ reasons, className }: { reasons: Reason[]; className?: string }) {
  const first = reasons[0];
  if (!first) return null;
  const Icon = ICONS[first.kind] ?? Sparkles;
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5 text-xs text-fg-2", className)}>
      <Icon size={12} className="shrink-0 text-accent/90" />
      <span className="truncate">{first.text}</span>
    </span>
  );
}

export function ReasonList({ reasons, className }: { reasons: Reason[]; className?: string }) {
  if (!reasons.length) return null;
  return (
    <ul className={cn("flex flex-wrap gap-1.5", className)}>
      {reasons.map((r, i) => {
        const Icon = ICONS[r.kind] ?? Sparkles;
        return (
          <li
            key={i}
            className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-bg-3/80 px-2.5 py-1 text-xs text-fg-1 hairline"
          >
            <Icon size={12} className="shrink-0 text-accent" />
            <span className="truncate">{r.text}</span>
          </li>
        );
      })}
    </ul>
  );
}
