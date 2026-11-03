import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../lib/api";
import { openExternal } from "../../lib/tauri";
import { Button } from "../../components/ui/Button";
import { Toggle } from "../../components/ui/controls";
import { Row } from "./ui";

type Service = "lastfm" | "discogs";

const SERVICES: Record<Service, { name: string; noun: string; link: string; linkLabel: string; off: string; on: string }> = {
  lastfm: {
    name: "Last.fm",
    noun: "API key",
    link: "https://www.last.fm/api/account/create",
    linkLabel: "Get a key",
    off: "Adds listener counts and genre tags. Free: make an API account, then paste the API key here.",
    on: "Key saved. Listener counts and genre tags are on.",
  },
  discogs: {
    name: "Discogs",
    noun: "token",
    link: "https://www.discogs.com/settings/developers",
    linkLabel: "Get a token",
    off: "Helps Lost & Found find forgotten records. Free: press “Generate new token” on Discogs, then paste it here.",
    on: "Token saved. Deeper crate digging for Lost & Found is on.",
  },
};

function On({ children = "On" }: { children?: ReactNode }) {
  return <span className="rounded-full bg-good/15 px-2.5 py-1 text-xs font-semibold text-good">{children}</span>;
}

export function KeyRow({ service, set }: { service: Service; set: boolean | undefined }) {
  const qc = useQueryClient();
  const info = SERVICES[service];
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (next: string) => {
    setBusy(true);
    setError(null);
    try {
      await api.setKey(service, next);
      await qc.invalidateQueries({ queryKey: ["health"] });
      setOpen(false);
      setValue("");
      toast(next ? `${info.name} is on` : `${info.name} ${info.noun} removed`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-key-row={service}>
      <Row label={info.name} hint={set ? info.on : info.off}>
        {set ? (
          <>
            <On />
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save("")}>
              Remove
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="ghost" icon={<ExternalLink size={14} />} onClick={() => openExternal(info.link)}>
              {info.linkLabel}
            </Button>
            {!open && (
              <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
                Paste {info.noun}
              </Button>
            )}
          </>
        )}
      </Row>
      {open && !set && (
        <form
          className="-mt-1 px-5 pb-4"
          onSubmit={(e) => {
            e.preventDefault();
            const clean = value.trim();
            if (clean) void save(clean);
          }}
        >
          <div className="flex flex-wrap gap-2">
            <div className="flex h-10 min-w-0 flex-1 basis-[260px] items-center rounded-xl bg-bg-1 px-3.5 hairline focus-within:shadow-[inset_0_0_0_1px_var(--accent)]">
              <input
                autoFocus
                aria-label={`${info.name} ${info.noun}`}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setError(null);
                }}
                placeholder={`Paste your ${info.name} ${info.noun}`}
                spellCheck={false}
                autoComplete="off"
                className="h-full min-w-0 flex-1 bg-transparent font-mono text-[13px] text-fg-0 outline-none placeholder:font-sans placeholder:text-fg-3"
              />
            </div>
            <Button type="submit" size="sm" variant="primary" disabled={busy || !value.trim()} icon={busy ? <Loader2 size={14} className="animate-spin" /> : undefined}>
              {busy ? "Checking…" : "Save"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
          {error && <p className="mt-2 text-[12.5px] text-bad">{error}</p>}
        </form>
      )}
    </div>
  );
}

export function useListenerMap() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["listener-map"], queryFn: api.listenerMap });
  const set = async (enabled: boolean) => {
    qc.setQueryData(["listener-map"], await api.setListenerMap(enabled));
    qc.invalidateQueries({ queryKey: ["listeners"] });
  };
  return { enabled: data?.enabled, set };
}

export function ListenerMapRow() {
  const map = useListenerMap();
  return (
    <Row
      label="Listener map"
      hint="Shows the cities where an artist is played most. Spotify's API doesn't share this, so Karasu reads the artist's public Spotify page in a hidden browser. Off by default."
    >
      <Toggle checked={!!map.enabled} onChange={(on) => void map.set(on)} label="Listener map" />
    </Row>
  );
}
