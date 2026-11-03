export type Palette = {
  accent: string;
  glow: string;
  base: string;
  deep: string;
  swatches: string[];
  light: boolean;
};

export type Art = {
  kind: "cover" | "artist" | "sp";
  ref: string;
  src: string;
  palette: Palette | null;
};

export type Reason = {
  kind: "sound" | "graph" | "tag" | "era" | "facet" | "popularity" | "feedback" | "vibe" | "engine" | string;
  text: string;
  strength?: number;
  ref?: string;
};

export type Track = {
  id: string;
  dz_id: number | null;
  sp_id: string | null;
  sp_uri: string | null;
  title: string;
  artist: { name: string; key: string; dz_id: number | null };
  album: { title: string | null; dz_id: number | null };
  year: number | null;
  year_source: string | null;
  duration_s: number | null;
  art: Art | null;
  has_preview: boolean;
  facets: { energy: number | null; tempo: number | null; top: string[]; genres: string[] };
  popularity: { fans: number | null; tier: Tier | null };
  state: { liked: boolean; disliked: boolean; hidden: boolean; saved: boolean };
  reasons: Reason[];
  score: number | null;
};

export type Tier = "underground" | "niche" | "known" | "popular";

export type Artist = {
  dz_id: number;
  name: string;
  key: string;
  fans: number | null;
  tier: Tier | null;
  art: Art | null;
  first_year?: number | null;
};

export type AlbumRef = {
  dz_id: number;
  title: string;
  artist: string;
  art: Art | null;
  tracks?: number;
};

export type PlaylistSummary = {
  id: string;
  kind: "lane" | "playlist" | "spotify";
  lane?: "fresh" | "lost";
  name: string;
  description?: string;
  sp_id: string | null;
  count: number;
  track_ids: string[];
  art?: (Art | null)[];
  owner?: string;
  own?: boolean;
  public?: boolean;
  editable?: boolean;
};

export type PlaylistDetail = {
  id: string;
  kind: "lane" | "playlist" | "daily" | "spotify";
  owner?: string;
  blocked?: boolean;
  art?: (Art | null)[];
  date?: string;
  name: string;
  description?: string;
  sp_id: string | null;
  editable: boolean;
  tracks: Track[];
  params?: Record<string, unknown>;
};

export type Home = {
  greeting: { name: string | null; part: "morning" | "afternoon" | "evening" | "night" };
  mood: { moods: string[]; energy: number | null; genres: string[]; based_on: number } | null;
  song_of_day?: SongOfDay;
  discover: Track[];
  because?: { artist: { dz_id: number; name: string | null }; tracks: Track[] };
  recent: Track[];
  made_for_you: PlaylistSummary[];
  made_for_you_art: Record<string, Art | null>;
  top_artists: (Artist | { dz_id: null; name: string; key: string; art: null })[];
  activity: { plays_week: number; artists_week: number; top_week: string[] };
};

export type SongOfDay = { track: Track | null; similar: Track[]; date: string; another?: number };

export type Challenge = {
  kind: string;
  title: string;
  body: string;
  goal: number;
  progress: number;
  done: boolean;
  streak: number;
  action: { label: string; to: string };
};

export type Daily = {
  date: string;
  artist?: Artist & { tracks: Track[]; like: string[]; reason: string | null };
  album?: {
    dz_id: number;
    title: string;
    artist: string;
    artist_id: number | null;
    year: number | null;
    art: Art | null;
    label: string | null;
    type: string | null;
    total: number | null;
    genres: string[];
    tracks: Track[];
    reason: string;
  };
  gem?: Track | null;
  mix?: { title: string; tracks: Track[]; known: number; new: number };
  challenge: Challenge | null;
};

export type Job = {
  id: string;
  kind: string;
  status: "queued" | "running" | "done" | "error" | "cancelled" | "interrupted";
  stage?: string;
  label?: string;
  done?: number;
  total?: number;
  eta_s?: number | null;
  error?: string;
  finished?: boolean;
  has_result?: boolean;
  result?: unknown;
};

export type SpotifyUser = { id?: string; name?: string; product?: string | null };

export type SetupPath = "premium" | "free" | "skip";

export type SetupState = {
  done: boolean;
  needed: boolean;
  path: SetupPath | null;
  history_requested: boolean;
  redirect_uri: string;
  client_id: string;
  spotify: { configured: boolean; logged_in: boolean; user: SpotifyUser };
  library: boolean;
  synced: boolean;
  picks: Artist[];
  job: Pick<Job, "id" | "status" | "stage" | "done" | "total" | "error"> | null;
};

export type Health = {
  ok: boolean;
  starting?: boolean;
  version: string;
  spotify?: { configured: boolean; logged_in: boolean; user: SpotifyUser };
  backfill?: { steps: string[]; running: Job[] };
  keys?: { lastfm: boolean; discogs: boolean };
  corpus?: number;
};

export type SearchSuggest = {
  tracks: Track[];
  artists: Artist[];
  albums: AlbumRef[];
  recent: string[];
};

export type LiveSearch = {
  query: string;
  recent: string[];
  queries: string[];
  items: (
    | { kind: "artist"; score: number; item: Artist }
    | { kind: "track"; score: number; item: Track }
    | { kind: "album"; score: number; item: AlbumRef }
  )[];
  partial: boolean;
};

export type SearchResult = {
  query: string;
  top: { kind: "artist"; item: Artist } | { kind: "track"; item: Track } | null;
  tracks: Track[];
  artists: Artist[];
  albums: AlbumRef[];
};

export type Lyrics = {
  status?: "ok" | "missing" | "busy";
  instrumental: boolean;
  plain: string | null;
  synced: { t: number; text: string }[] | null;
  source: string | null;
};

export type Option = { id: string; label: string };

export type DiscoverMode = {
  id: string;
  title: string;
  tagline: string;
  seed: "track" | "artist" | "artist?" | "genre" | "mood" | "decade" | "instrument" | null;
  icon: string;
};

export type DiscoverOptions = {
  modes: DiscoverMode[];
  genres: Option[];
  moods: Option[];
  instruments: Option[];
  decades: Option[];
  activities: Option[];
};

export type DiscoverResult = {
  items: Track[];
  artists?: Artist[];
  meta: {
    title?: string;
    subtitle?: string;
    seed?: string;
    aspect?: string | null;
    needs_embedding?: boolean;
    needs_seed?: string;
  };
};

export type Seed = { type: "track" | "artist" | "album" | "genre" | "mood" | "instrument" | "decade" | "activity" | "history"; value: string; label: string; art?: Art | null };

export type GenerateParams = {
  seeds: { type: string; value: string }[];
  count: number;
  familiarity: number;
  discovery: number;
  energy: number | null;
  shape: "steady" | "build" | "wave" | "winddown";
  popularity: "any" | "underground" | "niche" | "known";
  moods: string[];
  genres: string[];
  include_artists: string[];
  exclude_artists: string[];
  name?: string | null;
};

export type GenerateResult = {
  draft: string;
  name: string;
  labels: string[];
  tracks: Track[];
  stats: { new: number; known: number; energy: (number | null)[] };
};

export type SpotifyDevice = { id: string; name: string; type: string; is_active: boolean; volume_percent: number | null };

export type ConnectState = {
  active: boolean;
  is_playing?: boolean;
  progress_ms?: number;
  shuffle?: boolean;
  repeat?: string;
  device?: { id: string; name: string; type: string; volume: number | null };
  track?: { sp_id: string; uri: string; title: string; artist: string; album: string; duration_ms: number; image: string | null } | null;
};

export type GenreCard = {
  id: string;
  label: string;
  count: number;
  songs: number;
  affinity: number;
  arts: Art[];
  family?: string;
  artists?: number;
  library?: number;
  new?: number;
};

export type SoundCard = { id: string; label: string; blurb: string; songs: number; new: number; arts: Art[] };

export type ExploreOverview = {
  genres: GenreCard[];
  families: { id: string; label: string; genres: GenreCard[] }[];
  sounds: SoundCard[];
  coverage: number;
  decades: { id: string; label: string; count: number; arts: Art[] }[];
  underrated: (AlbumRef & { year: string | number | null })[];
};

export type GenreArtist = (Artist | { dz_id: number; name: string; key: string; fans: null; tier: null; art: Art | null }) & {
  songs: number;
  known: boolean;
};

export type GenrePage = {
  id: string;
  kind: "genre" | "sound";
  label: string;
  family: string;
  family_label: string;
  blurb: string | null;
  stats: { songs: number; artists: number; library: number; new: number; share: number };
  arts: Art[];
  for_you: Track[];
  shelves: { id: string; title: string; tracks: Track[] }[];
  library: Track[];
  artists: GenreArtist[];
  related: { id: string; label: string; overlap: number }[];
  decades: { decade: number; count: number }[];
  source: { tagged: number } | null;
};

export type ExploreFilters = {
  genre?: string | null;
  mood?: string | null;
  instrument?: string | null;
  decade?: string | null;
  year_from?: number | null;
  year_to?: number | null;
  popularity?: string | null;
  energy?: [number, number] | null;
  tempo?: [number, number] | null;
  sort?: string;
};

export type RankedArtist = (Artist | { dz_id: null; name: string; art: null }) & { plays: number };

export type Stats = {
  range: string;
  plays: number;
  plays_prev: number;
  minutes: number;
  artists: number;
  tracks: number;
  new_pct: number;
  diversity: number;
  streak: number;
  series: { date: string; plays: number }[];
  hours: number[];
  genres: { label: string; plays: number }[];
  top_artists: RankedArtist[];
  top_tracks: (Track & { plays: number })[];
  discovery: { picks: number; saved: number; heard: number };
  history: { events: number; since: string | null };
};

export type Traits = { energy: number; obscurity: number; era_range: number; brightness: number; adventurous: number };

export type Taste = {
  empty?: boolean;
  personality: { name: string; description: string };
  traits: Traits;
  range_genres?: number;
  genres: { label: string; score: number }[];
  moods: { label: string; score: number }[];
  decades: { decade: number; count: number }[];
  map: {
    points: { x: number; y: number; mode: number; id: string; title: string; artist: string; weight: number }[];
    modes: { x: number; y: number; label: string; size: number }[];
    discovered: { x: number; y: number; id: string }[];
  };
  evolution: { dims: string[]; series: { period: string; count: number; values: Record<string, number> }[] };
  favorite_artists: (Artist | { dz_id: null; name: string; art: null })[];
  top_tracks: Track[];
  discovered: Track[];
  library: { tracks: number; artists: number };
};

export type Compare = {
  score: number;
  them: { name: string; personality: { name: string; description: string }; traits: Traits };
  you: { name: string; personality: { name: string; description: string }; traits: Traits };
  shared_artists: string[];
  shared_genres: string[];
  both_like: Track[];
};

export type ProfileArtist = { sp_id: string | null; name: string; dz_id: number | null; art: Art | null };

export type UserProfile =
  | { connected: false }
  | {
      connected: true;
      online: boolean;
      user: { id: string | null; name: string | null; art: Art | null; followers: number | null; product: string | null; url: string | null };
      playlists: PlaylistSummary[];
      top_artists: ProfileArtist[];
      top_tracks: Track[];
      following: { granted: boolean; available: boolean; total: number | null; artists: ProfileArtist[] };
      since: string | null;
    };

export type ListenerCity = { city: string; country: string | null; region: string | null; listeners: number; lat?: number; lon?: number };

export type Listeners = {
  status: "ok" | "pending" | "missing" | "error" | "off";
  artist: { sp_id: string | null; name: string | null; dz_id: number | null; art: Art | null };
  credits: { sp_id: string; name: string }[];
  track: string | null;
  monthly: number | null;
  followers: number | null;
  world_rank: number | null;
  cities: ListenerCity[];
  fetched_at: string | null;
  error: string | null;
};

export type HistoryItem = { played_at: string; source: string; track: Track | null; artist: string | null; title: string | null };

export type EngineSetting = {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
};

export type Asset = {
  id: string;
  name: string;
  mime: string;
  w: number | null;
  h: number | null;
  bytes: number;
  created: string;
  url: string;
  frames: number | null;
  animated: boolean;
  video: boolean;
};

export type FetchInfo = {
  user: string;
  host: string;
  library: number;
  artists: number;
  analyzed: number;
  discovered: number;
  kept: number;
  plays_week: number;
  genres: string[];
  moods: string[];
  streak: number;
  since: string | null;
};
