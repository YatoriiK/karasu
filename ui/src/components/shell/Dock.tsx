import { motion } from "motion/react";
import { NavLink, useLocation } from "react-router";
import { BarChart3, Compass, History, LayoutDashboard, Library, ListMusic, Newspaper, Settings2, Telescope, UserRound } from "lucide-react";
import { useLook } from "../../theme/look";
import { Skin } from "../../theme/skins";
import { useUi } from "../../store/ui";
import { Tooltip } from "../ui/Tooltip";
import { cn } from "../ui/cn";

export const DOCK = [
  { to: "/", slot: "nav.desk", label: "Desk", jp: "机", icon: LayoutDashboard },
  { to: "/feed", slot: "nav.feed", label: "Feed", jp: "今日", icon: Newspaper },
  { to: "/discover", slot: "nav.discover", label: "Discover", jp: "探す", icon: Compass },
  { to: "/explore", slot: "nav.explore", label: "Explore", jp: "見る", icon: Telescope },
  { to: "/library", slot: "nav.library", label: "Library", jp: "書庫", icon: Library },
  { to: "/playlists", slot: "nav.playlists", label: "Playlists", jp: "曲集", icon: ListMusic },
  { to: "/stats", slot: "nav.stats", label: "Stats", jp: "統計", icon: BarChart3 },
  { to: "/profile", slot: "nav.profile", label: "Profile", jp: "私", icon: UserRound },
  { to: "/history", slot: "nav.history", label: "History", jp: "履歴", icon: History },
];

export function isActive(pathname: string, to: string) {
  if (to === "/") return pathname === "/";
  if (to === "/playlists") return pathname.startsWith("/playlist") || pathname.startsWith("/studio");
  return pathname.startsWith(to);
}

const SIZES = {
  compact: { labelled: "h-[46px] w-[52px]", plain: "h-9 w-9", icon: 16 },
  normal: { labelled: "h-[54px] w-[58px]", plain: "h-11 w-11", icon: 19 },
  large: { labelled: "h-[64px] w-[68px]", plain: "h-[52px] w-[52px]", icon: 23 },
};

function DockItem({ to, slot, label, jp, icon: Icon, labels }: (typeof DOCK)[number] & { labels: boolean }) {
  const { pathname } = useLocation();
  const active = isActive(pathname, to);
  const fx = useLook((s) => s.look.fx);
  const size = SIZES[fx?.dockSize ?? "normal"];
  const side = fx?.dock === "right" ? "left" : "right";
  const link = (
    <NavLink
      to={to}
      aria-label={label}
      className={cn(
        "relative flex flex-col items-center justify-center gap-1 rounded-md transition-colors",
        labels ? size.labelled : size.plain,
        active ? "text-bg-0" : "text-fg-2 hover:text-fg-0",
      )}
    >
      {active && <motion.span layoutId="dock-active" className="absolute inset-0 rounded-md bg-fg-0" transition={{ type: "spring", stiffness: 520, damping: 40 }} />}
      <span className="relative z-[1]">
        <Skin slot={slot} size={size.icon + 1}>
          <Icon size={size.icon} strokeWidth={active ? 2.2 : 1.8} />
        </Skin>
      </span>
      {labels && <span className="relative z-[1] font-mono text-[9.5px] lowercase tracking-wide">{label}</span>}
      <span className="sr-only">{jp}</span>
    </NavLink>
  );
  return labels ? link : <Tooltip label={label} side={side}>{link}</Tooltip>;
}

export function Dock() {
  const labels = useLook((s) => s.look.dockLabels);
  const wide = useUi((s) => s.wide);
  if (wide) return null;
  return (
    <nav aria-label="Main" className="glass z-30 hidden shrink-0 flex-col items-center gap-1 self-start rounded-lg p-1.5 md:flex">
      {DOCK.map((d) => (
        <DockItem key={d.to} {...d} labels={labels} />
      ))}
      <span className="my-1 h-px w-8 bg-line-strong" />
      <DockItem to="/settings" slot="nav.settings" label="Settings" jp="設定" icon={Settings2} labels={labels} />
    </nav>
  );
}
