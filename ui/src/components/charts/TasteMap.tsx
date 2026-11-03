import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { useNavigate } from "react-router";
import type { Taste } from "../../lib/types";
import { useLook } from "../../theme/look";

export type Box = { x: number; y: number; w: number; h: number; label: string; i: number };

export function placeLabels(boxes: Box[], width: number, height: number) {
  const out = boxes.map((b) => ({ ...b }));
  for (let pass = 0; pass < 80; pass++) {
    let moved = false;
    for (let a = 0; a < out.length; a++) {
      for (let b = a + 1; b < out.length; b++) {
        const A = out[a];
        const B = out[b];
        const ox = (A.w + B.w) / 2 + 6 - Math.abs(A.x - B.x);
        const oy = (A.h + B.h) / 2 + 4 - Math.abs(A.y - B.y);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        if (oy < ox) {
          const push = oy / 2 + 0.5;
          const dir = A.y <= B.y ? -1 : 1;
          A.y += dir * push;
          B.y -= dir * push;
        } else {
          const push = ox / 2 + 0.5;
          const dir = A.x <= B.x ? -1 : 1;
          A.x += dir * push;
          B.x -= dir * push;
        }
      }
    }
    for (const box of out) {
      box.x = Math.min(width - box.w / 2 - 4, Math.max(box.w / 2 + 4, box.x));
      box.y = Math.min(height - box.h / 2 - 4, Math.max(box.h / 2 + 4, box.y));
    }
    if (!moved) break;
  }
  return out;
}

const tone = (i: number, n: number, mono: boolean) =>
  mono ? `oklch(${(0.48 + (0.48 * (i % Math.max(n, 1))) / Math.max(n - 1, 1)).toFixed(3)} 0 0)` : `oklch(0.74 0.12 ${Math.round((i * 360) / Math.max(n, 1) + 20) % 360})`;

export function TasteMap({ map }: { map: Taste["map"] }) {
  const mono = !useLook((s) => s.look.artAccent);
  const hue = (i: number, n: number) => tone(i, n, mono);
  const navigate = useNavigate();
  const [hover, setHover] = useState<{ x: number; y: number; title: string; artist: string } | null>(null);
  const W = 1000;
  const H = 560;
  const px = (x: number) => W / 2 + x * (W / 2 - 40);
  const py = (y: number) => H / 2 - y * (H / 2 - 36);
  const n = map.modes.length;
  const labels = useMemo(
    () =>
      placeLabels(
        map.modes
          .map((m, i) => ({ x: px(m.x), y: py(m.y), w: m.label.length * 8.6 + 24, h: 28, label: m.label, i }))
          .filter((b) => b.label),
        W,
        H,
      ),
    [map.modes],
  );
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" onMouseLeave={() => setHover(null)}>
        <defs>
          <radialGradient id="map-glow">
            <stop offset="0" stopColor="white" stopOpacity="0.08" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </radialGradient>
        </defs>
        {map.modes.map((m, i) => (
          <circle key={`g${i}`} cx={px(m.x)} cy={py(m.y)} r={40 + Math.sqrt(m.size) * 4} fill={hue(i, n)} opacity={0.07} />
        ))}
        <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1 }}>
          {map.points.map((p) => (
            <circle
              key={p.id}
              cx={px(p.x)}
              cy={py(p.y)}
              r={2.2 + Math.min(p.weight, 3) * 0.9}
              fill={hue(p.mode, n)}
              opacity={0.75}
              className="cursor-pointer transition-[r,opacity] duration-150 hover:opacity-100"
              onMouseEnter={() => setHover({ x: px(p.x), y: py(p.y), title: p.title, artist: p.artist })}
              onClick={() => navigate(`/track/${encodeURIComponent(p.id)}`)}
            />
          ))}
        </motion.g>
        <motion.g initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.5, duration: 0.6 }}>
          {map.discovered.map((d) => (
            <circle
              key={d.id}
              cx={px(d.x)}
              cy={py(d.y)}
              r={5}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={1.8}
              className="cursor-pointer"
              onClick={() => navigate(`/track/${encodeURIComponent(d.id)}`)}
            />
          ))}
        </motion.g>
        {labels.map((b) => (
          <motion.g key={`l${b.i}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 + b.i * 0.05 }} className="pointer-events-none">
            <rect x={b.x - b.w / 2} y={b.y - b.h / 2} width={b.w} height={b.h} rx={14} fill="rgb(0 0 0 / 0.6)" stroke={hue(b.i, n)} strokeOpacity={0.55} />
            <text x={b.x} y={b.y + 5} textAnchor="middle" fontSize={14} fontWeight={600} fill="white">
              {b.label}
            </text>
          </motion.g>
        ))}
      </svg>
      {hover && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg bg-bg-4 px-2.5 py-1.5 text-xs shadow-xl"
          style={{ left: `${(hover.x / W) * 100}%`, top: `${(hover.y / H) * 100}%`, marginTop: -8 }}
        >
          <div className="font-semibold text-fg-0">{hover.title}</div>
          <div className="text-fg-2">{hover.artist}</div>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-fg-2">
        <span>Each dot is a song from your library, placed by how it sounds.</span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full border-2 border-accent" /> Karasu discoveries
        </span>
      </div>
    </div>
  );
}
