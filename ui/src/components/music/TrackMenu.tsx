import type { ReactElement } from "react";
import { usePlaylistEdit } from "./playlistEdit";
import {
  Ban,
  Copy,
  Disc3,
  ExternalLink,
  LibraryBig,
  Link2,
  ListEnd,
  ListPlus,
  ListMinus,
  ListStart,
  Play,
  Radar,
  Share2,
  ThumbsDown,
  Type,
  User,
} from "lucide-react";
import type { Track } from "../../lib/types";
import { ContextMenu, Menu, MenuItem, MenuSeparator, MenuSub } from "../ui/Menu";
import { useTrackActions } from "./useTrackActions";

function TrackMenuItems({ track, withPlay }: { track: Track; withPlay?: boolean }) {
  const a = useTrackActions();
  const edit = usePlaylistEdit();
  return (
    <>
      {withPlay && (
        <MenuItem icon={<Play size={15} />} onSelect={() => a.play(track)}>
          Play
        </MenuItem>
      )}
      <MenuItem icon={<ListStart size={15} />} onSelect={() => a.playNext(track)}>
        Play next
      </MenuItem>
      <MenuItem icon={<ListEnd size={15} />} onSelect={() => a.enqueue(track)}>
        Add to queue
      </MenuItem>
      <MenuItem icon={<ListPlus size={15} />} onSelect={() => a.addToPlaylist([track])}>
        Add to playlist…
      </MenuItem>
      {edit && (
        <MenuItem icon={<ListMinus size={15} />} onSelect={() => edit.remove(track)}>
          Remove from this playlist
        </MenuItem>
      )}
      <MenuSeparator />
      <MenuItem icon={<Link2 size={15} />} onSelect={() => a.copyLink(track)}>
        Copy song link
      </MenuItem>
      <MenuSub icon={<Share2 size={15} />} label="Share">
        <MenuItem icon={<Type size={15} />} onSelect={() => a.copy(`${track.title} — ${track.artist.name}`, "song name")}>
          Copy song and artist
        </MenuItem>
        {track.dz_id && (
          <MenuItem icon={<Copy size={15} />} onSelect={() => a.copy(`https://www.deezer.com/track/${track.dz_id}`, "Deezer link")}>
            Copy Deezer link
          </MenuItem>
        )}
        {track.artist.dz_id && (
          <MenuItem icon={<User size={15} />} onSelect={() => a.copy(`https://www.deezer.com/artist/${track.artist.dz_id}`, "artist link")}>
            Copy artist link
          </MenuItem>
        )}
        {track.album.dz_id && (
          <MenuItem icon={<Disc3 size={15} />} onSelect={() => a.copy(`https://www.deezer.com/album/${track.album.dz_id}`, "album link")}>
            Copy album link
          </MenuItem>
        )}
      </MenuSub>
      <MenuSeparator />
      {track.dz_id && (
        <MenuItem icon={<Radar size={15} />} onSelect={() => a.goTrack(track)}>
          Find similar sounds
        </MenuItem>
      )}
      <MenuItem icon={<User size={15} />} onSelect={() => a.goArtist(track)}>
        Go to artist
      </MenuItem>
      {track.album.dz_id && (
        <MenuItem icon={<Disc3 size={15} />} onSelect={() => a.goAlbum(track)}>
          Go to album
        </MenuItem>
      )}
      <MenuItem icon={<ExternalLink size={15} />} onSelect={() => a.openSpotify(track)}>
        {track.sp_id ? "Open in Spotify" : "Find in Spotify"}
      </MenuItem>
      {!track.state.saved && (
        <MenuItem icon={<LibraryBig size={15} />} onSelect={() => a.saveToSpotify(track)}>
          Add to Liked Songs
        </MenuItem>
      )}
      <MenuSeparator />
      <MenuItem icon={<ThumbsDown size={15} />} onSelect={() => a.dislike(track)}>
        {track.state.disliked ? "Undo not for me" : "Not for me"}
      </MenuItem>
      <MenuItem icon={<Ban size={15} />} onSelect={() => a.hideArtist(track)} danger>
        Never show {track.artist.name}
      </MenuItem>
      {track.album.title && (
        <>
          <MenuSeparator />
          <div className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-fg-3">
            <Disc3 size={13} />
            <span className="truncate">{track.album.title}</span>
          </div>
        </>
      )}
    </>
  );
}

export function TrackMenu({ track, trigger }: { track: Track; trigger: ReactElement }) {
  return (
    <Menu trigger={trigger}>
      <TrackMenuItems track={track} />
    </Menu>
  );
}

export function TrackContextMenu({ track, children }: { track: Track | null | undefined; children: ReactElement }) {
  return (
    <ContextMenu disabled={!track} content={track ? <TrackMenuItems track={track} withPlay /> : null}>
      {children}
    </ContextMenu>
  );
}
