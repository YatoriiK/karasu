import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { motion } from "motion/react";
import { BarChart3, Copy, ExternalLink, MoreHorizontal, Sparkles, UserRound } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import { EASE } from "../lib/motion";
import { openExternal } from "../lib/tauri";
import { plural } from "../lib/format";
import type { Artist, ProfileArtist } from "../lib/types";
import { reconnectSpotify } from "../hooks/useSpotifyBackground";
import { ArtistCard, PlaylistCard } from "../components/music/Cards";
import { TrackList } from "../components/music/TrackRow";
import { DetailHero } from "../components/ui/DetailHero";
import { Button, IconButton } from "../components/ui/Button";
import { Menu, MenuItem } from "../components/ui/Menu";
import { Carousel, Section } from "../components/ui/Section";
import { EmptyState, ErrorState, Skeleton } from "../components/ui/states";

function ArtistRow({ artists }: { artists: ProfileArtist[] }) {
  return (
    <Carousel gap={20}>
      {artists.map((a) => (
        <div key={a.sp_id ?? a.name} className="flex w-[156px] shrink-0 snap-start flex-col">
          <ArtistCard artist={{ dz_id: a.dz_id, name: a.name, key: a.name, art: a.art, fans: null, tier: null } as Artist} width={156} />
          <div className="mt-0.5 text-center text-xs text-fg-3">Artist</div>
        </div>
      ))}
    </Carousel>
  );
}

function ProfileSkeleton() {
  return (
    <div className="pt-6">
      <div className="flex flex-col gap-7 md:flex-row md:items-end">
        <Skeleton className="h-[232px] w-[232px] rounded-full" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-14 w-72 max-w-full rounded-lg" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
      </div>
      <div className="mt-12 flex gap-5">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[156px] w-[156px] shrink-0 rounded-full" />
        ))}
      </div>
    </div>
  );
}

export function ProfilePage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: 120_000 });
  const [allTracks, setAllTracks] = useState(false);
  if (isLoading) return <ProfileSkeleton />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!data.connected)
    return (
      <EmptyState
        icon={<UserRound size={22} />}
        title="Connect Spotify to see your profile"
        body="Your profile shows your top artists and tracks this month, your public playlists and your followers."
        action={
          <Button variant="primary" onClick={() => navigate("/settings#connections")}>
            Open connections
          </Button>
        }
      />
    );
  const { user, following } = data;
  const tracks = allTracks ? data.top_tracks : data.top_tracks.slice(0, 4);
  const copyLink = async () => {
    if (!user.url) return;
    try {
      await navigator.clipboard.writeText(user.url);
      toast("Copied link to your profile");
    } catch {
      toast("Couldn't copy the link");
    }
  };
  return (
    <div>
      <DetailHero
        art={user.art}
        palette={user.art?.palette}
        round
        seed={user.name ?? "you"}
        eyebrow="Profile"
        title={user.name ?? "You"}
        meta={
          <>
            <span>{plural(data.playlists.length, "public playlist")}</span>
            {user.followers != null && (
              <>
                <span className="text-fg-3">·</span>
                <span>{plural(user.followers, "follower")}</span>
              </>
            )}
            {following.available && following.total != null ? (
              <>
                <span className="text-fg-3">·</span>
                <span>{following.total.toLocaleString()} following</span>
              </>
            ) : (
              !following.granted && (
                <>
                  <span className="text-fg-3">·</span>
                  <button
                    onClick={() => reconnectSpotify(() => qc.invalidateQueries({ queryKey: ["me"] }))}
                    className="text-fg-2 underline decoration-dotted underline-offset-4 transition-colors hover:text-fg-0"
                    title="Spotify needs one more permission to share who you follow"
                  >
                    show following
                  </button>
                </>
              )
            )}
            {!data.online && <span className="ml-1 rounded-full bg-fg-0/[0.08] px-2 py-0.5 text-2xs text-fg-2">offline · showing saved data</span>}
          </>
        }
        actions={
          <>
            {user.url && (
              <Button variant="secondary" icon={<ExternalLink size={16} />} onClick={() => openExternal(user.url!)}>
                Open in Spotify
              </Button>
            )}
            <Menu
              align="start"
              trigger={
                <IconButton label="More" round tooltip={false}>
                  <MoreHorizontal size={18} />
                </IconButton>
              }
            >
              <MenuItem icon={<Copy size={15} />} onSelect={copyLink}>
                Copy link to profile
              </MenuItem>
              {user.url && (
                <MenuItem icon={<ExternalLink size={15} />} onSelect={() => openExternal(user.url!)}>
                  Edit profile on Spotify
                </MenuItem>
              )}
            </Menu>
          </>
        }
      />

      {data.top_artists.length > 0 && (
        <Section title="Top artists this month" subtitle="Only visible to you">
          <ArtistRow artists={data.top_artists} />
        </Section>
      )}

      {data.top_tracks.length > 0 && (
        <Section
          title="Top tracks this month"
          subtitle="Only visible to you"
          action={
            data.top_tracks.length > 4 && (
              <button onClick={() => setAllTracks((v) => !v)} className="rounded-md px-2 py-1 text-[13px] font-semibold text-fg-2 transition-colors hover:text-fg-0">
                {allTracks ? "Show less" : "Show all"}
              </button>
            )
          }
        >
          <TrackList tracks={tracks} context={{ label: "Top tracks this month", href: "/profile" }} showReason={false} />
        </Section>
      )}

      {data.playlists.length > 0 && (
        <Section title="Public playlists" href="/playlists">
          <Carousel gap={18}>
            {data.playlists.map((p) => (
              <PlaylistCard key={p.id} playlist={p} arts={p.art ?? []} />
            ))}
          </Carousel>
        </Section>
      )}

      {following.available && following.artists.length > 0 && (
        <Section title="Following">
          <ArtistRow artists={following.artists} />
        </Section>
      )}

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, ease: EASE }}
        className="flex flex-wrap items-center justify-between gap-4 rounded-2xl bg-bg-2/60 p-5 hairline"
      >
        <div className="min-w-0">
          <div className="font-semibold text-fg-0">Your numbers moved to Stats</div>
          <p className="mt-1 text-sm text-fg-2">Listening stats, your music personality, the taste map and the listener globe all live there now.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={<BarChart3 size={16} />} onClick={() => navigate("/stats")}>
            Listening
          </Button>
          <Button variant="secondary" icon={<Sparkles size={16} />} onClick={() => navigate("/stats?tab=taste")}>
            Taste
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
