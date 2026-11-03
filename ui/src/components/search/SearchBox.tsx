import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Popover } from "radix-ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { Clock3, Play, Search, Sparkles, X } from "lucide-react";
import { api } from "../../lib/api";
import type { AlbumRef, Artist, LiveSearch, PlaylistSummary, Track } from "../../lib/types";
import { usePlayer } from "../../store/player";
import { useUi } from "../../store/ui";
import { Skin } from "../../theme/skins";
import { AlbumArt } from "../music/AlbumArt";
import { cn } from "../ui/cn";

type Row =
  | { key: string; kind: "query"; text: string }
  | { key: string; kind: "recent"; text: string }
  | { key: string; kind: "vibe"; text: string }
  | { key: string; kind: "artist"; item: Artist }
  | { key: string; kind: "track"; item: Track }
  | { key: string; kind: "album"; item: AlbumRef }
  | { key: string; kind: "playlist"; item: PlaylistSummary };

const fold = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

function matchScore(name: string, text: string) {
  const n = fold(name);
  const t = fold(text);
  if (!n || !t) return 0;
  if (n === t) return 3;
  if (n.startsWith(t)) return 2 + (0.5 * t.length) / n.length;
  if (` ${n}`.includes(` ${t}`)) return 1.5;
  return n.includes(t) ? 1 : 0;
}

function label(e: LiveSearch["items"][number]) {
  if (e.kind === "artist") return e.item.name;
  if (e.kind === "track") return `${e.item.artist.name} ${e.item.title}`;
  return `${e.item.artist} ${e.item.title}`;
}

function narrow(data: LiveSearch, q: string): LiveSearch {
  const want = fold(q);
  return {
    ...data,
    query: q,
    queries: data.queries.filter((s) => fold(s).startsWith(want)),
    items: data.items.filter((e) => matchScore(label(e), q) > 0 || matchScore(e.kind === "artist" ? e.item.name : e.item.title, q) > 0),
  };
}

function useSettled<T>(value: T, ms: number) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return settled;
}

function Typed({ text, q }: { text: string; q: string }) {
  if (!text.toLowerCase().startsWith(q.toLowerCase())) return <span className="text-fg-1">{text}</span>;
  return (
    <>
      <span className="font-semibold text-fg-0">{text.slice(0, q.length)}</span>
      <span className="text-fg-2">{text.slice(q.length)}</span>
    </>
  );
}

function Key({ children }: { children: ReactNode }) {
  return <kbd className="grid h-[18px] min-w-[18px] place-items-center rounded-[4px] px-1 shadow-[inset_0_0_0_1px_var(--line-strong)]">{children}</kbd>;
}

function Entity({ art, title, sub }: { art: ReactNode; title: string; sub: string }) {
  return (
    <>
      {art}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-semibold text-fg-0">{title}</span>
        <span className="block truncate text-xs text-fg-2">{sub}</span>
      </span>
    </>
  );
}

function RowBody({ row, q, active }: { row: Row; q: string; active: boolean }) {
  switch (row.kind) {
    case "query":
    case "recent":
      return (
        <>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-bg-4 text-fg-2">
            {row.kind === "query" ? <Search size={16} /> : <Clock3 size={16} />}
          </span>
          <span className="min-w-0 flex-1 truncate text-[14px]">
            <Typed text={row.text} q={q} />
          </span>
        </>
      );
    case "vibe":
      return (
        <>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
            <Sparkles size={16} />
          </span>
          <span className="min-w-0 flex-1 truncate text-[14px] text-fg-1">
            Songs that sound like <span className="font-semibold text-fg-0">“{row.text}”</span>
          </span>
        </>
      );
    case "artist":
      return (
        <Entity
          art={<AlbumArt art={row.item.art} seed={row.item.name} size={44} className="h-11 w-11" rounded="rounded-full" />}
          title={row.item.name}
          sub={row.item.tier ? `Artist · ${row.item.tier}` : "Artist"}
        />
      );
    case "track":
      return (
        <>
          <Entity
            art={<AlbumArt art={row.item.art} seed={row.item.id} size={44} className="h-11 w-11" rounded="rounded-md" />}
            title={row.item.title}
            sub={`Song · ${row.item.artist.name}`}
          />
          <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full bg-fg-0 text-bg-0 transition-opacity", active ? "opacity-100" : "opacity-0")}>
            <Play size={14} fill="currentColor" />
          </span>
        </>
      );
    case "album":
      return (
        <Entity
          art={<AlbumArt art={row.item.art} seed={row.item.title} size={44} className="h-11 w-11" rounded="rounded-md" />}
          title={row.item.title}
          sub={`Album · ${row.item.artist}`}
        />
      );
    case "playlist":
      return (
        <Entity
          art={<AlbumArt art={row.item.art?.find(Boolean)} seed={row.item.name} size={44} className="h-11 w-11" rounded="rounded-md" />}
          title={row.item.name}
          sub={`Playlist · ${row.item.owner ?? "Karasu"}`}
        />
      );
  }
}

export function SearchBox() {
  const navigate = useNavigate();
  const id = useId();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const anchor = useRef<HTMLFormElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const q = text.trim();
  const settled = useSettled(q, 140);

  const quick = useQuery({
    queryKey: ["live", q],
    queryFn: ({ signal }) => api.live(q, false, signal),
    enabled: open,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  const full = useQuery({
    queryKey: ["live", settled, "remote"],
    queryFn: ({ signal }) => api.live(settled, true, signal),
    enabled: open && settled.length >= 2,
    staleTime: 5 * 60_000,
    placeholderData: (prev) => prev,
    refetchInterval: (query) => (query.state.data?.partial ? 900 : false),
  });
  const playlists = useQuery({ queryKey: ["playlists"], queryFn: api.playlists, enabled: open, staleTime: 60_000 });

  const data = useMemo(() => {
    const remote = full.data;
    if (remote && remote.query === q) return remote;
    if (remote && q.length > remote.query.length && fold(q).startsWith(fold(remote.query))) return narrow(remote, q);
    return quick.data;
  }, [full.data, quick.data, q]);

  const rows = useMemo<Row[]>(() => {
    if (!q) return (data?.recent ?? []).slice(0, 6).map((text) => ({ key: `r:${text}`, kind: "recent" as const, text }));
    const typed = fold(q);
    const suggestions = data?.queries ?? [];
    const queries = suggestions.some((s) => fold(s) === typed) ? suggestions : [q, ...suggestions].slice(0, 4);
    const lists = (playlists.data ?? [])
      .map((p) => ({ score: matchScore(p.name, q) + 0.4, row: { key: `p:${p.id}`, kind: "playlist" as const, item: p } }))
      .filter((x) => x.score > 1.4)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2);
    const found = (data?.items ?? []).map((e) => ({
      score: e.score,
      row: { key: `${e.kind}:${e.kind === "track" ? e.item.id : e.item.dz_id}`, kind: e.kind, item: e.item } as Row,
    }));
    const entities = [...found.slice(0, 8 - lists.length), ...lists].sort((a, b) => b.score - a.score).map((x) => x.row);
    return [...queries.map((text) => ({ key: `q:${text}`, kind: "query" as const, text })), ...entities, { key: "vibe", kind: "vibe" as const, text: q }];
  }, [data, playlists.data, q]);

  useEffect(() => setActive(-1), [q]);

  useEffect(() => {
    const box = list.current;
    const el = box?.querySelector<HTMLElement>(`[data-row="${active}"]`);
    if (!box || !el) return;
    if (el.offsetTop < box.scrollTop) box.scrollTop = el.offsetTop - 6;
    else if (el.offsetTop + el.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = el.offsetTop + el.offsetHeight - box.clientHeight + 6;
  }, [active]);

  const close = () => {
    setOpen(false);
    input.current?.blur();
  };
  const searchFor = (value: string, vibe = false) => {
    setText(value);
    close();
    navigate(`/search?q=${encodeURIComponent(value)}${vibe ? "&vibe=1" : ""}`);
  };
  const pick = (row: Row) => {
    if (row.kind === "query" || row.kind === "recent") return searchFor(row.text);
    if (row.kind === "vibe") return searchFor(row.text, true);
    close();
    if (row.kind === "track") usePlayer.getState().playTrack(row.item, { label: "Search" });
    else if (row.kind === "artist") navigate(`/artist/${row.item.dz_id}`);
    else if (row.kind === "album") navigate(`/album/${row.item.dz_id}`);
    else navigate(`/playlist/${encodeURIComponent(row.item.id)}`);
  };

  const shown = open && rows.length > 0;
  const fetching = quick.isFetching || full.isFetching;

  return (
    <Popover.Root open={shown} onOpenChange={(v) => !v && setOpen(false)}>
      <Popover.Anchor asChild>
        <form
          ref={anchor}
          onSubmit={(e) => {
            e.preventDefault();
            if (q) searchFor(q);
          }}
          className="flex h-full items-center gap-[0.75em] px-[0.5em]"
        >
          <Skin slot="bar.search" size={16}>
            <Search size={16} className={cn("shrink-0 transition-colors", fetching ? "text-fg-0" : "text-fg-2")} />
          </Skin>
          <input
            ref={input}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                setOpen(true);
                const step = e.key === "ArrowDown" ? 1 : -1;
                setActive((i) => {
                  if (!rows.length) return -1;
                  if (i < 0) return step > 0 ? 0 : rows.length - 1;
                  return (i + step + rows.length) % rows.length;
                });
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (shown && rows[active]) pick(rows[active]);
                else if (q) searchFor(q);
              } else if (e.key === "Escape") {
                e.preventDefault();
                if (shown) setOpen(false);
                else input.current?.blur();
              }
            }}
            placeholder="search, or describe a sound…"
            aria-label="Search"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={shown}
            aria-controls={`${id}-list`}
            aria-activedescendant={shown && active >= 0 ? `${id}-${active}` : undefined}
            className="min-w-0 flex-1 bg-transparent font-mono text-[1em] text-fg-0 outline-none placeholder:text-fg-3"
          />
          {text ? (
            <button
              type="button"
              aria-label="Clear search"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setText("");
                input.current?.focus();
              }}
              className="grid h-[1.6em] w-[1.6em] shrink-0 place-items-center rounded-full text-fg-2 hover:text-fg-0"
            >
              <X size={15} />
            </button>
          ) : (
            <button type="button" onClick={() => useUi.getState().set({ searchOpen: true })} className="shrink-0 rounded-sm px-[0.5em] py-[0.15em] font-mono text-[0.75em] text-fg-3 shadow-[inset_0_0_0_1px_var(--line-strong)] hover:text-fg-0">
              ctrl k
            </button>
          )}
        </form>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          side="bottom"
          sideOffset={8}
          collisionPadding={12}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => {
            if (anchor.current?.contains(e.target as Node)) e.preventDefault();
          }}
          onMouseDown={(e) => e.preventDefault()}
          className="z-[70] w-[var(--radix-popover-trigger-width)] min-w-[380px] max-w-[calc(100vw-24px)] overflow-hidden rounded-2xl bg-bg-2 elevated data-[state=open]:animate-[menu-in_160ms_var(--ease-out)]"
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-2 font-mono text-2xs text-fg-3">
            <span className="flex items-center gap-1.5">
              <Key>↑</Key>
              <Key>↓</Key>
              <span className="ml-1">navigate</span>
            </span>
            <span className="flex items-center gap-1.5">
              <Key>enter</Key>
              <span className="ml-1">{q ? "search" : "open"}</span>
            </span>
          </div>
          {!q && <div className="px-4 pb-1 pt-3 text-2xs font-semibold uppercase tracking-[0.14em] text-fg-3">Recent searches</div>}
          <div ref={list} id={`${id}-list`} role="listbox" aria-label="Search suggestions" className="scroll-area relative max-h-[min(62vh,560px)] p-1.5">
            {rows.map((row, i) => (
              <div
                key={row.key}
                id={`${id}-${i}`}
                role="option"
                aria-selected={i === active}
                data-row={i}
                onMouseMove={() => i !== active && setActive(i)}
                onClick={() => pick(row)}
                className={cn(
                  "flex cursor-default select-none items-center gap-3 rounded-lg px-2.5 transition-colors duration-100",
                  row.kind === "query" || row.kind === "recent" || row.kind === "vibe" ? "h-12" : "h-[60px]",
                  i === active ? "bg-bg-4" : "",
                )}
              >
                <RowBody row={row} q={q} active={i === active} />
              </div>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
