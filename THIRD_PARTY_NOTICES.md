# Third-party notices

Karasu is licensed under the GNU General Public License v3.0 or later (see `LICENSE`). It builds on the
work below. Each project keeps its own license.

## Downloaded on first run (not shipped in the installer)

| What | Where it comes from | License |
|---|---|---|
| uv (Python installer), pinned to 0.13.1 and checked against its SHA-256 | github.com/astral-sh/uv | MIT or Apache-2.0 |
| CPython 3.12 (python-build-standalone, installed by uv) | github.com/astral-sh/python-build-standalone | PSF License |
| PyTorch | download.pytorch.org | BSD-3-Clause |
| LAION CLAP audio model `laion/larger_clap_music_and_speech` | huggingface.co | Apache-2.0 |
| Python packages in `requirements.txt` (FastAPI, Uvicorn, httpx, NumPy, SciPy, scikit-learn, Transformers, Pillow, soundfile, SoundCard, RapidFuzz, keyring, websockets) | pypi.org | Each package's own license (MIT, BSD or Apache-2.0) |

## Bundled in the app

The desktop shell uses Tauri and its plugins (MIT or Apache-2.0). The interface uses React, Radix UI,
motion, TanStack Query, Zustand, React Router, lucide-react, cmdk, sonner, d3, topojson and world-atlas
(MIT or ISC), and the Inter, JetBrains Mono, DotGothic16, Shippori Mincho, Yuji Syuku and Zen Kaku Gothic
New typefaces (SIL Open Font License 1.1). The full list with versions is in `ui/package.json` and
`desktop/src-tauri/Cargo.toml`.

`digger/discogs_styles.json` is a list of genre and style names as used on Discogs.

## Services Karasu talks to

Karasu is not affiliated with or endorsed by any of these services. You use them under their own terms.

- **Spotify Web API**: your library, playback and playlists. Needs your own developer app (see README).
- **Deezer API**: song search, 30-second previews, artwork and fan counts.
- **MusicBrainz**: release years and genres.
- **LRCLIB**: lyrics.
- **Open-Meteo geocoding**: city positions for the listener map.
- **Last.fm** and **Discogs**: only if you add your own key.
- **open.spotify.com** artist pages: only if you turn on the listener map.
