import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import type { Asset } from "../lib/types";
import { assetUrl } from "../theme/look";
import { cn } from "../components/ui/cn";

export function useAssets() {
  return useQuery({ queryKey: ["assets"], queryFn: api.assets, staleTime: 60_000 });
}

export function useAssetMeta(id: string | null | undefined): Asset | null | undefined {
  const { data, isPending } = useQuery({
    queryKey: ["assets"],
    queryFn: api.assets,
    staleTime: 60_000,
    enabled: !!id,
    select: (list: Asset[]) => list.find((a) => a.id === id) ?? null,
  });
  if (!id) return null;
  return isPending ? undefined : (data ?? null);
}

function badge(a: Asset) {
  if (a.video) return "video";
  if (a.animated) return a.mime === "image/gif" ? "gif" : "anim";
  return null;
}

export function AssetLibrary({
  onPick,
  selected,
  columns = 3,
  allowDelete = true,
  videos = false,
}: {
  onPick?: (asset: Asset) => void;
  selected?: string | null;
  columns?: number;
  allowDelete?: boolean;
  videos?: boolean;
}) {
  const qc = useQueryClient();
  const { data: all = [], isLoading } = useAssets();
  const assets = videos ? all : all.filter((a) => !a.video);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState<string | null>(null);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    let last: Asset | null = null;
    for (const file of Array.from(files)) {
      try {
        last = await api.uploadAsset(file, file.name);
      } catch (error) {
        toast(`Couldn't import ${file.name}`, { description: (error as Error).message });
      }
    }
    setBusy(false);
    await qc.invalidateQueries({ queryKey: ["assets"] });
    if (last) onPick?.(last);
  };

  return (
    <div>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        <button
          onClick={() => input.current?.click()}
          className="grid aspect-square place-items-center rounded-sm border border-dashed border-line-strong text-fg-2 transition-colors hover:border-fg-1 hover:text-fg-0"
        >
          <span className="flex flex-col items-center gap-1 text-[11px]">
            {busy ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
            import
          </span>
        </button>
        {isLoading &&
          Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton aspect-square rounded-sm" />)}
        {assets.map((a) => (
          <div
            key={a.id}
            className={cn("checker group relative aspect-square overflow-hidden rounded-sm", selected === a.id && "outline outline-2 outline-offset-1 outline-fg-0")}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData("text/karasu-asset", a.id);
              e.dataTransfer.setData("text/karasu-ratio", String((a.w ?? 1) / (a.h ?? 1)));
              e.dataTransfer.effectAllowed = "copy";
            }}
          >
            <button className="h-full w-full" onClick={() => onPick?.(a)} title={a.name}>
              {a.video ? (
                <video
                  src={`${assetUrl(a.id)}#t=0.1`}
                  muted
                  loop
                  playsInline
                  preload="metadata"
                  className="h-full w-full object-cover"
                  onMouseEnter={(e) => void e.currentTarget.play().catch(() => undefined)}
                  onMouseLeave={(e) => e.currentTarget.pause()}
                />
              ) : (
                <img src={assetUrl(a.id, 160)} alt={a.name} loading="lazy" className="h-full w-full object-cover" draggable={false} />
              )}
            </button>
            {badge(a) && (
              <span className="pointer-events-none absolute bottom-1 left-1 rounded-[3px] bg-black/65 px-1 py-px font-mono text-[9px] uppercase tracking-wider text-white">
                {badge(a)}
              </span>
            )}
            {allowDelete && (
              <button
                aria-label={armed === a.id ? "Click again to delete" : "Delete image"}
                title={armed === a.id ? "Click again to delete" : "Delete image"}
                onClick={async () => {
                  if (armed !== a.id) {
                    setArmed(a.id);
                    window.setTimeout(() => setArmed((v) => (v === a.id ? null : v)), 3000);
                    return;
                  }
                  await api.deleteAsset(a.id);
                  setArmed(null);
                  qc.invalidateQueries({ queryKey: ["assets"] });
                }}
                className={cn(
                  "absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-sm text-white transition-opacity",
                  armed === a.id ? "bg-bad opacity-100" : "bg-black/60 opacity-0 group-hover:opacity-100",
                )}
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}
      </div>
      {!isLoading && !assets.length && (
        <p className="mt-2 text-[11px] leading-relaxed text-fg-3">
          Import pictures you love: wallpapers, ink art, stickers, GIFs{videos ? ", short MP4 or WebM loops" : ""}. You can also drag files straight onto the desk.
        </p>
      )}
      <input ref={input} type="file" accept={videos ? "image/*,video/mp4,video/webm" : "image/*"} multiple hidden onChange={(e) => upload(e.target.files)} />
    </div>
  );
}
