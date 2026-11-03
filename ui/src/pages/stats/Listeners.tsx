import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { motion } from "motion/react";
import { Globe as GlobeIcon, Loader2, RotateCw, Search } from "lucide-react";
import { api } from "../../lib/api";
import { EASE } from "../../lib/motion";
import { compact } from "../../lib/format";
import type { Art, Listeners } from "../../lib/types";
import { AlbumArt } from "../../components/music/AlbumArt";
import { Globe, type GlobePoint } from "../../components/globe/Globe";
import { cityKey, countryName, toGlobePoints } from "../../components/globe/points";
import { Button } from "../../components/ui/Button";
import { Skeleton } from "../../components/ui/states";
import { cn } from "../../components/ui/cn";
import { useListenerMap } from "../settings/Connections";

type Pick = { kind: "artist"; name: string; sp?: string } | { kind: "track"; id: string; title: string; artist: string };

function ago(iso: string | null) {
  if (!iso) return "";
  const hours = (Date.now() - new Date(iso).getTime()) / 3_600_000;
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (hours < 1) return "just now";
  if (hours < 24) return rtf.format(-Math.round(hours), "hour");
  return rtf.format(-Math.round(hours / 24), "day");
}

function useSettled(value: string, ms: number) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return settled;
}

function ListenerSearch({ onPick }: { onPick: (pick: Pick) => void }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(-1);
  const settled = useSettled(text.trim(), 180);
  const { data } = useQuery({
    queryKey: ["live", settled, "remote"],
    queryFn: ({ signal }) => api.live(settled, true, signal),
    enabled: settled.length >= 2,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
  const rows = (text.trim().length >= 2 ? (data?.items ?? []) : []).filter((r) => r.kind !== "album").slice(0, 7);
  const choose = (i: number) => {
    const row = rows[i];
    if (!row) return;
    if (row.kind === "artist") onPick({ kind: "artist", name: row.item.name });
    else if (row.kind === "track") onPick({ kind: "track", id: row.item.id, title: row.item.title, artist: row.item.artist.name });
    setText("");
    setOpen(false);
    setIndex(-1);
  };
  return (
    <div className="relative w-full sm:w-72">
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-3" />
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
          setIndex(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!rows.length) return;
            const step = e.key === "ArrowDown" ? 1 : -1;
            setIndex((i) => (i < 0 ? (step > 0 ? 0 : rows.length - 1) : (i + step + rows.length) % rows.length));
          } else if (e.key === "Enter") {
            e.preventDefault();
            choose(index >= 0 ? index : 0);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="any artist or song…"
        aria-label="Pick an artist or song for the globe"
        className="h-9 w-full rounded-md bg-bg-3/70 pl-9 pr-3 font-mono text-[12.5px] text-fg-0 outline-none hairline placeholder:text-fg-3 focus:bg-bg-3"
      />
      {open && rows.length > 0 && (
        <ul role="listbox" className="absolute right-0 top-full z-30 mt-1.5 w-full overflow-hidden rounded-xl bg-bg-2 p-1 elevated">
          {rows.map((row, i) => {
            const name = row.kind === "artist" ? row.item.name : row.kind === "track" ? row.item.title : "";
            const sub = row.kind === "artist" ? "Artist" : row.kind === "track" ? `Song · ${row.item.artist.name}` : "";
            const art = row.item.art as Art | null;
            return (
              <li
                key={`${row.kind}:${name}:${i}`}
                role="option"
                aria-selected={i === index}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setIndex(i)}
                onClick={() => choose(i)}
                className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5", i === index ? "bg-fg-0/[0.08]" : "")}
              >
                <AlbumArt art={art} seed={name} size={32} className="h-8 w-8 shrink-0" rounded={row.kind === "artist" ? "rounded-full" : "rounded-md"} />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-fg-0">{name}</span>
                  <span className="block truncate text-2xs text-fg-3">{sub}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CityList({
  data,
  active,
  onHover,
  onPick,
}: {
  data: Listeners;
  active: string | null;
  onHover: (key: string | null) => void;
  onPick: (key: string) => void;
}) {
  const top = Math.max(1, ...data.cities.map((c) => c.listeners));
  const countries = useMemo(() => {
    const totals = new Map<string, { name: string; listeners: number; cities: number }>();
    for (const c of data.cities) {
      const code = c.country ?? "?";
      const entry = totals.get(code) ?? { name: countryName(c.country), listeners: 0, cities: 0 };
      entry.listeners += c.listeners;
      entry.cities += 1;
      totals.set(code, entry);
    }
    return [...totals.values()].sort((a, b) => b.listeners - a.listeners);
  }, [data.cities]);
  return (
    <>
      <ol className="mt-5 space-y-0.5" onMouseLeave={() => onHover(null)}>
        {data.cities.map((c, i) => {
          const key = cityKey(c);
          return (
            <motion.li key={key} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05, ease: EASE }}>
              <button
                onMouseEnter={() => onHover(key)}
                onFocus={() => onHover(key)}
                onClick={() => onPick(key)}
                className={cn(
                  "grid w-full grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors",
                  active === key ? "bg-fg-0/[0.07]" : "hover:bg-fg-0/[0.04]",
                )}
              >
                <span className="text-right text-sm text-fg-3 tabular">{i + 1}</span>
                <span className="min-w-0">
                  <span className="flex items-baseline gap-2">
                    <span className="truncate text-[14px] font-medium text-fg-0">{c.city}</span>
                    <span className="truncate text-xs text-fg-3">
                      {c.country === "US" && c.region ? `${c.region}, ` : ""}
                      {countryName(c.country)}
                    </span>
                  </span>
                  <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-fg-0/[0.07]">
                    <motion.span
                      className="block h-full rounded-full bg-accent"
                      initial={{ width: 0 }}
                      animate={{ width: `${(c.listeners / top) * 100}%` }}
                      transition={{ duration: 0.7, ease: EASE, delay: 0.1 + i * 0.05 }}
                    />
                  </span>
                </span>
                <span className="text-sm text-fg-1 tabular">{c.listeners.toLocaleString()}</span>
              </button>
            </motion.li>
          );
        })}
      </ol>
      {countries.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5 px-2">
          <span className="mr-1 text-2xs uppercase tracking-[0.14em] text-fg-3">By country</span>
          {countries.map((c) => (
            <span key={c.name} className="rounded-full bg-fg-0/[0.06] px-2.5 py-1 text-xs text-fg-1">
              {c.name} <span className="text-fg-3">· {compact(c.listeners)}</span>
            </span>
          ))}
        </div>
      )}
    </>
  );
}

export function WhereTheyListen({ seeds }: { seeds: { name: string; art: Art | null }[] }) {
  const [pick, setPick] = useState<Pick | null>(null);
  const current: Pick | null = pick ?? (seeds[0] ? { kind: "artist", name: seeds[0].name } : null);
  const params = current
    ? current.kind === "artist"
      ? current.sp
        ? { sp: current.sp }
        : { artist: current.name }
      : { track: current.id }
    : null;
  const { data, error, refetch, isFetching } = useQuery({
    queryKey: ["listeners", params],
    queryFn: () => api.listeners(params!),
    enabled: !!params,
    staleTime: 15 * 60_000,
    refetchInterval: (q) => (q.state.data?.status === "pending" ? 1500 : false),
  });
  const map = useListenerMap();
  const names = seeds.slice(0, 6).map((s) => s.name).join("\n");
  useEffect(() => {
    if (names && map.enabled) api.prefetchListeners(names.split("\n")).catch(() => undefined);
  }, [names, map.enabled]);

  const ready = data?.status === "ok";
  const points: GlobePoint[] = useMemo(() => toGlobePoints(data), [data]);
  const [active, setActive] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ key: string; at: number } | null>(null);
  const lead = points[0]?.key ?? null;
  useEffect(() => {
    setActive(lead);
    setFocus(lead ? { key: lead, at: Date.now() } : null);
  }, [lead, data?.artist.sp_id]);

  const pending = !!params && (!data || data.status === "pending");
  const artistName = data?.artist.name ?? (current?.kind === "artist" ? current.name : current?.artist) ?? "";
  const summary = ready && points.length
    ? `Globe of ${artistName}'s top cities on Spotify: ${data.cities.map((c) => `${c.city} ${c.listeners.toLocaleString()}`).join(", ")}`
    : "Globe of Spotify listeners";
  const choose = (key: string) => {
    setActive(key);
    setFocus({ key, at: Date.now() });
  };
  const selectedName = current?.kind === "artist" ? current.name.toLowerCase() : null;

  return (
    <section className="relative mt-6 overflow-hidden rounded-2xl bg-bg-2/60 hairline">
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 pt-5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-semibold">
            <GlobeIcon size={16} className="text-fg-2" /> Where they listen
          </h2>
          <p className="mt-0.5 text-sm text-fg-2">The cities where an artist or song is played most on Spotify. Drag the globe to spin it.</p>
        </div>
        <ListenerSearch onPick={setPick} />
      </div>
      {seeds.length > 0 && (
        <div className="no-scrollbar mt-4 flex gap-1.5 overflow-x-auto px-5">
          {seeds.slice(0, 8).map((s) => {
            const on = selectedName === s.name.toLowerCase();
            return (
              <button
                key={s.name}
                onClick={() => setPick({ kind: "artist", name: s.name })}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-full py-1 pl-1 pr-3 text-[12.5px] transition-colors",
                  on ? "bg-fg-0 text-bg-0" : "bg-fg-0/[0.06] text-fg-1 hover:bg-fg-0/[0.1]",
                )}
              >
                <AlbumArt art={s.art} seed={s.name} size={24} className="h-6 w-6" rounded="rounded-full" />
                {s.name}
              </button>
            );
          })}
        </div>
      )}
      <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-center">
        <div className="relative mx-auto w-full max-w-[560px]">
          <Globe points={points} active={hover ?? active} onActive={choose} focus={focus} label={summary} />
          {pending && (
            <div className="pointer-events-none absolute inset-x-0 bottom-2 flex items-center justify-center gap-2 font-mono text-[11.5px] text-fg-2">
              <Loader2 size={13} className="animate-spin" /> reading Spotify…
            </div>
          )}
        </div>
        <div className="min-w-0">
          {map.enabled === false || data?.status === "off" ? (
            <div className="space-y-3" data-listener-map="off">
              <p className="text-sm font-medium text-fg-0">The listener map is off</p>
              <p className="text-sm leading-relaxed text-fg-2">
                Spotify's API doesn't share listener cities, so Karasu reads each artist's public Spotify page in a hidden browser to draw this
                map. Turn it on if you're fine with that. You can turn it off again in Settings.
              </p>
              <Button size="sm" variant="primary" icon={<GlobeIcon size={14} />} onClick={() => void map.set(true)}>
                Turn on the listener map
              </Button>
            </div>
          ) : !current ? (
            <p className="text-sm text-fg-2">Search for an artist or a song to see where people play it.</p>
          ) : error ? (
            <div className="space-y-3">
              <p className="text-sm text-fg-2">Couldn't reach the Karasu engine.</p>
              <Button size="sm" variant="secondary" icon={<RotateCw size={14} />} onClick={() => refetch()}>
                Try again
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3">
                {data ? (
                  <AlbumArt art={data.artist.art} seed={artistName} size={56} className="h-14 w-14 shrink-0" rounded="rounded-full" />
                ) : (
                  <Skeleton className="h-14 w-14 shrink-0 rounded-full" />
                )}
                <div className="min-w-0">
                  <div className="text-2xs font-semibold uppercase tracking-[0.14em] text-fg-3">{current.kind === "track" ? "Song" : "Artist"}</div>
                  {current.kind === "track" ? (
                    <div className="truncate text-lg font-semibold text-fg-0">{data?.track ?? current.title}</div>
                  ) : data?.artist.dz_id ? (
                    <Link to={`/artist/${data.artist.dz_id}`} className="block truncate text-lg font-semibold text-fg-0 hover:underline">
                      {artistName}
                    </Link>
                  ) : (
                    <div className="truncate text-lg font-semibold text-fg-0">{artistName}</div>
                  )}
                  <div className="truncate text-sm text-fg-2 tabular">
                    {current.kind === "track" && `${artistName} · `}
                    {data?.monthly != null ? `${compact(data.monthly)} monthly listeners` : pending ? "Looking them up…" : ""}
                    {data?.followers != null ? ` · ${compact(data.followers)} followers` : ""}
                  </div>
                </div>
              </div>
              {current.kind === "track" && data && data.status !== "missing" && (
                <div className="mt-3 text-xs leading-relaxed text-fg-3">
                  Spotify shares listener cities per artist, not per song, so this shows {artistName}'s listeners.
                  {data.credits.length > 1 && (
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      {data.credits.map((c) => (
                        <button
                          key={c.sp_id}
                          onClick={() => setPick({ kind: "artist", name: c.name, sp: c.sp_id })}
                          className="rounded-full bg-fg-0/[0.06] px-2.5 py-1 text-xs text-fg-1 hover:bg-fg-0/[0.1]"
                        >
                          {c.name}
                        </button>
                      ))}
                    </span>
                  )}
                </div>
              )}
              {pending ? (
                <div className="mt-5 space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-11 rounded-lg" />
                  ))}
                  <p className="pt-1 text-xs text-fg-3">Reading Spotify's artist page. The first look at an artist takes a few seconds.</p>
                </div>
              ) : data?.status === "missing" ? (
                <p className="mt-5 text-sm text-fg-2">Couldn't find {artistName || "that"} on Spotify.</p>
              ) : data?.status === "error" ? (
                <div className="mt-5 space-y-3">
                  <p className="text-sm text-fg-2">Couldn't read Spotify's page{data.error ? `: ${data.error}` : "."}</p>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<RotateCw size={14} className={isFetching ? "animate-spin" : ""} />}
                    onClick={() => params && api.listeners({ ...params, retry: "1" }).then(() => refetch())}
                  >
                    Try again
                  </Button>
                </div>
              ) : data && data.cities.length === 0 ? (
                <p className="mt-5 text-sm text-fg-2">Spotify doesn't list top cities for {artistName} yet. Artists need more listeners before it does.</p>
              ) : data ? (
                <>
                  <CityList data={data} active={hover ?? active} onHover={setHover} onPick={choose} />
                  <p className="mt-4 px-2 text-2xs text-fg-3">From Spotify's artist page · top 5 cities · updated {ago(data.fetched_at)}</p>
                </>
              ) : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
