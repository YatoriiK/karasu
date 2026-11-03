import type { ReactNode, RefObject } from "react";
import { useLocation, useNavigate } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useLook } from "../../theme/look";
import { useUi } from "../../store/ui";
import { Tooltip } from "../ui/Tooltip";
import { cn } from "../ui/cn";

const TITLES: Record<string, [string, string]> = {
  feed: ["feed", "今日"],
  discover: ["discover", "探す"],
  explore: ["explore", "見る"],
  library: ["library", "書庫"],
  playlists: ["playlists", "曲集"],
  playlist: ["playlist", "曲集"],
  studio: ["studio", "工房"],
  history: ["history", "履歴"],
  stats: ["statistics", "統計"],
  profile: ["profile", "私"],
  settings: ["settings", "設定"],
  welcome: ["welcome", "ようこそ"],
  search: ["search", "検索"],
  track: ["song", "曲"],
  artist: ["artist", "人"],
  album: ["album", "盤"],
};

export function PageWindow({ children, scroller, onScroll }: { children: ReactNode; scroller: RefObject<HTMLDivElement | null>; onScroll?: () => void }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const titlebar = useLook((s) => s.look.titlebar);
  const wide = useUi((s) => s.wide);
  const seg = pathname.split("/")[1] || "feed";
  const [en, jp] = TITLES[seg] ?? [seg, ""];
  const squares = [
    { label: "Back to the desk", run: () => navigate("/") },
    { label: wide ? "Show the dock" : "Hide the dock", run: () => useUi.getState().set({ wide: !wide }) },
    { label: "Close", run: () => navigate("/") },
  ];
  const bar = titlebar === "bar";
  return (
    <section className="glass relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl">
      <div
        className={cn("flex h-10 shrink-0 items-center gap-2 px-2", bar ? "bg-fg-0 text-bg-0" : "border-b border-line")}
        data-tauri-drag-region
      >
        <div className="flex">
          <button aria-label="Back" onClick={() => navigate(-1)} className={cn("grid h-7 w-7 place-items-center rounded-sm", bar ? "hover:bg-bg-0/15" : "text-fg-2 hover:text-fg-0")}>
            <ChevronLeft size={16} />
          </button>
          <button aria-label="Forward" onClick={() => navigate(1)} className={cn("grid h-7 w-7 place-items-center rounded-sm", bar ? "hover:bg-bg-0/15" : "text-fg-2 hover:text-fg-0")}>
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="pointer-events-none flex flex-1 items-baseline justify-center gap-2 font-mono text-[12px]" data-tauri-drag-region>
          <span className={bar ? "" : "text-fg-1"}>~/{en}</span>
          {jp && <span className={bar ? "opacity-60" : "text-fg-3"}>{jp}</span>}
        </div>
        <div className="flex items-center gap-[6px] pr-1.5">
          {squares.map((s) => (
            <Tooltip key={s.label} label={s.label}>
              <button
                aria-label={s.label}
                onClick={s.run}
                className={cn("block h-[11px] w-[11px] transition-transform hover:scale-125", bar ? "bg-bg-0" : "border border-fg-2 hover:bg-fg-0")}
              />
            </Tooltip>
          ))}
        </div>
      </div>
      <div ref={scroller} onScroll={onScroll} className="scroll-area relative min-h-0 flex-1">
        {children}
      </div>
    </section>
  );
}
