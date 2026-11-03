import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { motion } from "motion/react";
import { BarChart3, CalendarRange, FileUp } from "lucide-react";
import { toast } from "sonner";
import { api, IN_TAURI } from "../lib/api";
import { EASE } from "../lib/motion";
import { AlbumArt } from "../components/music/AlbumArt";
import { TrackList } from "../components/music/TrackRow";
import { Bars, HBars, StatTile } from "../components/charts/Charts";
import { Button } from "../components/ui/Button";
import { Segmented } from "../components/ui/controls";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/states";
import { WhereTheyListen } from "./stats/Listeners";
import { TasteView } from "./stats/Taste";

async function pickHistoryFiles(): Promise<string[]> {
  if (IN_TAURI) {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke<string[] | string | null>("plugin:dialog|open", {
      options: { multiple: true, title: "Pick the ZIP Spotify sent you", filters: [{ name: "Spotify history", extensions: ["zip", "json"] }] },
    });
    return Array.isArray(result) ? result : result ? [result] : [];
  }
  const typed = window.prompt("Paste the full path of the ZIP Spotify sent you (or of Streaming_History_Audio_*.json files, separated by ;)");
  return typed ? typed.split(";").map((s) => s.trim()).filter(Boolean) : [];
}

export function ImportHistoryButton() {
  const qc = useQueryClient();
  return (
    <Button
      variant="secondary"
      icon={<FileUp size={16} />}
      onClick={async () => {
        const paths = await pickHistoryFiles();
        if (!paths.length) return;
        try {
          await api.importHistory(paths);
          toast("Importing your listening history", { description: "Stats update when it's done." });
          window.setTimeout(() => qc.invalidateQueries({ queryKey: ["stats"] }), 8000);
        } catch (e) {
          toast("Couldn't import", { description: (e as Error).message });
        }
      }}
    >
      Import Spotify history
    </Button>
  );
}

const dayLabel = (date: string) => new Date(date + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });

type Tab = "listening" | "taste";

export function StatsPage() {
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get("tab") === "taste" ? "taste" : "listening";
  const [range, setRange] = useState("month");
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["stats", range], queryFn: () => api.stats(range), enabled: tab === "listening" });
  const delta = data && data.plays_prev ? Math.round(((data.plays - data.plays_prev) / data.plays_prev) * 100) : null;
  return (
    <div className="pt-4">
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[34px] font-bold tracking-[-0.03em]">Statistics</h1>
          <p className="mt-1 text-sm text-fg-2">
            {tab === "taste"
              ? "What your music says about you, built from your whole library."
              : data?.history.since
                ? `Based on ${data.history.events.toLocaleString()} plays since ${new Date(data.history.since).toLocaleDateString()}.`
                : "Your listening, measured."}
          </p>
          <div className="mt-4">
            <Segmented
              value={tab}
              onChange={(next) => setParams(next === "taste" ? { tab: "taste" } : {}, { replace: true })}
              options={[
                { value: "listening", label: "Listening" },
                { value: "taste", label: "Taste" },
              ]}
            />
          </div>
        </div>
        {tab === "listening" && (
          <Segmented
            value={range}
            onChange={setRange}
            options={[
              { value: "week", label: "Week" },
              { value: "month", label: "Month" },
              { value: "year", label: "Year" },
              { value: "all", label: "All time" },
            ]}
          />
        )}
      </header>
      {tab === "taste" ? (
        <TasteView />
      ) : isLoading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-2xl" />
          ))}
        </div>
      ) : error || !data ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <StatTile label="Plays" value={data.plays.toLocaleString()} sub={delta != null ? `${delta >= 0 ? "+" : ""}${delta}% vs previous` : undefined} accent />
            <StatTile label="Minutes" value={data.minutes.toLocaleString()} />
            <StatTile label="Artists" value={data.artists} />
            <StatTile label="New music" value={`${data.new_pct}%`} sub="from artists new to you" />
            <StatTile label="Diversity" value={data.diversity} sub="how spread out your plays are" />
            <StatTile label="Discovery streak" value={`${data.streak} day${data.streak === 1 ? "" : "s"}`} />
          </div>

          {data.history.events < 300 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative mt-6 flex flex-wrap items-center justify-between gap-4 overflow-hidden rounded-2xl bg-bg-2/60 p-5 hairline">
              <div
                className="pointer-events-none absolute inset-0"
                style={{ background: "radial-gradient(60% 160% at 0% 0%, color-mix(in srgb, var(--accent) 16%, transparent), transparent 70%)" }}
              />
              <div className="relative flex max-w-2xl items-start gap-4">
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
                  <CalendarRange size={19} />
                </div>
                <div>
                  <div className="font-semibold text-fg-0">Get years of stats</div>
                  <p className="mt-1 text-sm leading-relaxed text-fg-2">
                    Spotify only shares your last 50 plays, so stats grow from the day you started using Karasu. Request your “Extended streaming history” at spotify.com/account/privacy (it can take up to 30 days), then import the ZIP Spotify sends you here.
                  </p>
                </div>
              </div>
              <div className="relative">
                <ImportHistoryButton />
              </div>
            </motion.div>
          )}

          <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <section className="rounded-2xl bg-bg-2/60 p-5 hairline">
              <h2 className="mb-4 font-semibold">Plays per day</h2>
              {data.series.length ? (
                <>
                  <Bars values={data.series.map((s) => s.plays)} labels={data.series.map((s) => dayLabel(s.date))} highlightLast format={(v) => `${v} plays`} />
                  <div className="mt-2 flex justify-between text-2xs text-fg-3">
                    <span>{dayLabel(data.series[0].date)}</span>
                    {data.series.length > 8 && <span>{dayLabel(data.series[Math.floor(data.series.length / 2)].date)}</span>}
                    <span>Today</span>
                  </div>
                </>
              ) : (
                <p className="text-sm text-fg-3">No plays in this range yet.</p>
              )}
            </section>
            <section className="rounded-2xl bg-bg-2/60 p-5 hairline">
              <h2 className="mb-4 font-semibold">When you listen</h2>
              <Bars values={data.hours} labels={data.hours.map((_, h) => `${h}:00`)} height={140} format={(v) => `${v} plays`} />
              <div className="mt-2 flex justify-between text-2xs text-fg-3">
                <span>12am</span>
                <span>6am</span>
                <span>12pm</span>
                <span>6pm</span>
                <span>11pm</span>
              </div>
            </section>
          </div>

          <WhereTheyListen seeds={data.top_artists.map((a) => ({ name: a.name, art: a.art }))} />

          <div className="mt-6 grid gap-6 xl:grid-cols-2">
            <section className="rounded-2xl bg-bg-2/60 p-5 hairline">
              <h2 className="mb-4 font-semibold">Top artists</h2>
              {data.top_artists.length ? (
                <ol className="space-y-2.5">
                  {data.top_artists.map((a, i) => (
                    <motion.li key={a.name} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04, ease: EASE }} className="flex items-center gap-3">
                      <span className="w-5 text-right text-sm text-fg-3 tabular">{i + 1}</span>
                      <AlbumArt art={a.art} seed={a.name} size={40} className="h-10 w-10" rounded="rounded-full" />
                      {a.dz_id ? (
                        <Link to={`/artist/${a.dz_id}`} className="flex-1 truncate font-medium hover:underline">
                          {a.name}
                        </Link>
                      ) : (
                        <span className="flex-1 truncate font-medium">{a.name}</span>
                      )}
                      <span className="text-sm text-fg-2 tabular">{a.plays} plays</span>
                    </motion.li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-fg-3">Nothing yet.</p>
              )}
            </section>
            <section className="rounded-2xl bg-bg-2/60 p-5 hairline">
              <h2 className="mb-4 font-semibold">Genres you played</h2>
              {data.genres.length ? <HBars items={data.genres.map((g) => ({ label: g.label, value: g.plays }))} unit="plays" /> : <p className="text-sm text-fg-3">Genres appear once Karasu has heard what you played.</p>}
              <h2 className="mb-3 mt-8 font-semibold">Karasu picks</h2>
              <div className="grid grid-cols-3 gap-3 text-center">
                {[
                  ["Picked for you", data.discovery.picks],
                  ["Heard", data.discovery.heard],
                  ["Saved", data.discovery.saved],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-bg-3/60 p-3">
                    <div className="text-xl font-bold tabular">{value}</div>
                    <div className="text-2xs text-fg-3">{label}</div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="mt-6">
            <h2 className="mb-3 text-xl font-semibold">Most played songs</h2>
            {data.top_tracks.length ? (
              <TrackList tracks={data.top_tracks} context={{ label: "Most played" }} showReason={false} />
            ) : (
              <EmptyState icon={<BarChart3 size={22} />} title="Nothing played in this range" body="Switch the range, or import your Spotify history." />
            )}
          </section>
        </>
      )}
    </div>
  );
}
