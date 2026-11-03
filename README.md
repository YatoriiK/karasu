# Karasu 烏

A music discovery app for Windows that finds songs you'll like but have never heard: new niche artists
and older records almost nobody found. It listens to music with an audio model that runs on your own PC,
learns your taste from what you play, and explains why it picked each song.

Everything runs locally. There is no Karasu server and no account.

## What it does

- **Feed and Discover**: a daily song, artist and album, plus ten discovery modes (similar sounds, hidden
  gems, deep cuts, by mood, by era, instrumental, underground and more). Every pick says why it's there.
- **Playlists studio**: build a playlist from a song, artist, mood or decade, shape its energy curve, and
  save it locally or push it to Spotify.
- **Explore**: genres and filters for year, popularity, mood, energy, tempo and instruments.
- **Stats and Profile**: listening recaps, streaks, a map of your taste, and how it changed over time.
- **A desk you arrange yourself**: widgets, wallpapers, themes, cursors and your own images.
- **Player**: plays full songs through your Spotify app in the background, or 30-second previews without it.
  Synced lyrics, queue, global media keys that work in games.

## Before you start

- **Windows 10 or 11**, 64-bit.
- **3 to 7 GB of free space** for the engine (Python, PyTorch and the audio model). An NVIDIA graphics card
  makes the first scan much faster but isn't required.
- **Spotify is optional.** Without it, you pick a few artists you love and Karasu learns from there, with
  30-second previews.
- **With Spotify you need Premium** and your own free Spotify developer app, because of Spotify's rules for
  apps like this one. The setup guide inside Karasu walks you through it in about two minutes. A developer
  app works for up to 5 Spotify accounts.

## Install

1. Download `Karasu_x.y.z_x64-setup.exe` from the [Releases](../../releases) page and run it.
2. On first launch, choose where Karasu keeps its engine and library (any drive works), then press
   **Install engine**. It downloads everything it needs into that one folder. This takes a few minutes.
3. The setup guide opens. Choose **Spotify Premium** or **No Premium** and follow the steps.
4. Optional: ask Spotify for your full listening history (the last step of the guide). It arrives by email
   within a few days and gives Karasu years of history instead of your last 50 plays.

To uninstall, remove Karasu in Windows Settings, then delete the engine folder you chose.

## Optional extras (Settings → Connections)

- **Last.fm API key**: adds listener counts and genre tags. Free at last.fm/api/account/create.
- **Discogs token**: helps Lost & Found find forgotten records. Free at discogs.com/settings/developers.
- **Listener map**: a globe of the cities where an artist is played most. Spotify's API doesn't share this,
  so Karasu reads the artist's public Spotify page in a hidden browser (Chrome or Edge). It's off until you
  turn it on.

## Privacy

Your library, history, taste model and images stay in the folder you chose. Karasu sends song and artist
names to the music services it uses (Spotify, Deezer, MusicBrainz, LRCLIB, and Last.fm or Discogs if you
add a key) to look things up. `THIRD_PARTY_NOTICES.md` lists every service and download.

MusicBrainz asks apps to include contact details. If you run Karasu a lot, add an email or URL under
`[app] contact` in `config.toml` in your Karasu folder.

## Build from source

You need Windows, Python 3.12, Node.js 22 or newer, and Rust with the `x86_64-pc-windows-gnu` target
(plus MSYS2 MinGW-w64).

```bat
git clone <this repo> Karasu
cd Karasu
setup.cmd                      :: Python environment (picks the GPU build of PyTorch if it finds an NVIDIA card)
cd ui && npm install && npm run build && cd ..
digger.cmd serve               :: engine + UI at http://127.0.0.1:8765
```

Desktop app and installer:

```bat
cd desktop && npm install && npm run build
```

The installer lands in `cache\cargo-target\x86_64-pc-windows-gnu\release\bundle\nsis\`. A checkout that
contains the `digger` folder runs the engine straight from source, so the desktop app built here uses your
working copy. Point it there once by setting the `KARASU_HOME` environment variable to the checkout.

Tests: `digger.cmd` sets up the environment, so run `.venv\Scripts\python -m pytest` for the engine and
`npm run typecheck` in `ui`. The scripts in `ui\scripts` are Playwright checks that drive a running engine.

### Command line

| Command | What it does |
|---|---|
| `digger.cmd serve` | Starts the engine and serves the UI at http://127.0.0.1:8765 |
| `digger.cmd doctor` | Checks Python, PyTorch, keys and connections |
| `digger.cmd auth` | Logs in to Spotify |
| `digger.cmd run` | Weekly run: sync, discover, update the two Spotify playlists |
| `digger.cmd recommend` | Same, but only writes an HTML report |
| `digger.cmd snapshot` | Logs recent plays (Spotify only keeps your last 50) |
| `digger.cmd history <files>` | Imports Spotify's extended streaming history (ZIP or JSON) |
| `digger.cmd schedule` | Weekly run and daily snapshot in Task Scheduler; `--remove` undoes it |

## Support

Karasu is free. If it found you something good, you can [buy me a coffee](https://buymeacoffee.com/karasuwrld).

## License

GPL-3.0-or-later. See `LICENSE`. Karasu isn't affiliated with Spotify, Deezer, Last.fm, Discogs or
MusicBrainz.
