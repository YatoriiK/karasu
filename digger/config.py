import copy
import json
import os
import tomllib
from pathlib import Path

from . import HOME

CONFIG_PATH = Path(os.environ["KARASU_CONFIG"]) if os.environ.get("KARASU_CONFIG") else HOME / "config.toml"

REISSUE_LABELS = [
    "Numero Group", "Light in the Attic", "Analog Africa", "Habibi Funk", "Soundway", "Strut",
    "Music From Memory", "Efficient Space", "Now-Again", "Mississippi Records", "Cultures of Soul",
    "Death Is Not The End", "Trunk Records", "Finders Keepers", "Mr Bongo", "Freedom To Spend",
    "Paradise of Bachelors", "Tompkins Square", "Dust-to-Digital", "Sublime Frequencies",
    "Awesome Tapes From Africa", "Wewantsounds", "Jazzman", "Be With Records", "Athens of the North",
    "Vampisoul", "Dark Entries", "Minimal Wave", "Emotional Rescue", "Soul Jazz Records",
    "Ostinato Records", "Left Ear Records", "Séance Centre", "Cache Cache", "Isle of Jura",
]

ARCHIVAL_LABELS = [
    "Habibi Funk", "Analog Africa", "Numero Group", "Sublime Frequencies", "Awesome Tapes From Africa",
    "Athens of the North", "Trunk Records", "Finders Keepers", "Minimal Wave", "Ostinato Records",
    "Left Ear Records", "Wewantsounds", "Vampisoul", "Death Is Not The End", "Dust-to-Digital",
    "Be With Records", "Emotional Rescue", "Soul Jazz Records", "Freedom To Spend", "Cache Cache",
]

DEFAULTS = {
    "app": {"contact": "", "workers": 8, "download_threads": 16, "clap_model": "laion/larger_clap_music_and_speech"},
    "spotify": {"client_id": "", "redirect_port": 8888},
    "lastfm": {"api_key": ""},
    "discogs": {"token": ""},
    "listenbrainz": {"token": ""},
    "playlists": {
        "fresh_name": "Fresh Underground",
        "lost_name": "Lost & Found",
        "add_per_week": 15,
        "max_size": 40,
        "max_age_days": 21,
        "unsaved_after_play_days": 14,
        "public": False,
    },
    "taste": {"min_modes": 4, "max_modes": 12, "exclude_known_artists": True, "max_seed_tracks": 600},
    "graph": {
        "expand_budget": 350,
        "underground_budget": 150,
        "small_fans": 20000,
        "lastfm_limit": 50,
        "deezer_limit": 25,
        "restart": 0.15,
        "pop_damping": 0.6,
        "iterations": 40,
    },
    "fresh": {
        "debut_max_years": 3,
        "recent_release_months": 18,
        "listeners_floor": 150,
        "fans_floor": 40,
        "listeners_cap": 50000,
        "fans_cap": 10000,
        "tracks_per_artist": 3,
        "artists_to_check": 260,
        "small_artists_to_check": 200,
    },
    "lost": {
        "older_than_years": 20,
        "listeners_cap": 30000,
        "fans_cap": 5000,
        "discogs_have_min": 5,
        "discogs_have_cap": 800,
        "decade_share_cap": 0.4,
        "shortlist": 200,
        "mb_artist_checks": 80,
        "mb_track_checks": 120,
        "labels": REISSUE_LABELS,
        "archival_labels": ARCHIVAL_LABELS,
        "labels_per_run": 10,
        "label_albums_per_label": 40,
        "discogs_styles_max": 8,
        "discogs_years_per_decade": 3,
        "discogs_from_year": 1955,
        "deep_tag_pages": [8, 20],
        "deep_tags_max": 5,
        "tracks_per_album": 2,
    },
    "filters": {"min_duration_s": 90, "max_duration_s": 720, "max_releases_6m": 12},
    "weights": {
        "audio": 0.30,
        "tag": 0.25,
        "graph": 0.20,
        "gem": 0.10,
        "like": 0.30,
        "pop_penalty": 0.15,
        "dislike_penalty": 0.25,
        "slop_penalty": 0.30,
    },
    "selection": {"mmr_lambda": 0.7, "per_artist": 1, "per_label": 2, "shortlist": 90, "min_score": 0.35},
    "quotas": {
        "fresh": {"graph": 0.5, "new_releases": 0.15, "deep_tags": 0.2, "wildcard": 0.15},
        "lost": {"labels": 0.4, "discogs": 0.35, "graph": 0.25},
    },
}

TEMPLATE = """[app]
contact = ""

[spotify]
client_id = ""
redirect_port = 8888

[lastfm]
api_key = ""

[discogs]
token = ""

[playlists]
fresh_name = "Fresh Underground"
lost_name = "Lost & Found"
add_per_week = 15
max_size = 40

[fresh]
debut_max_years = 3
listeners_cap = 50000

[lost]
older_than_years = 20
listeners_cap = 30000
"""


def _merge(base, extra):
    for key, value in extra.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            _merge(base[key], value)
        else:
            base[key] = value
    return base


def ensure_file():
    if not CONFIG_PATH.exists():
        CONFIG_PATH.write_text(TEMPLATE, encoding="utf-8")


def load(overrides=None):
    cfg = copy.deepcopy(DEFAULTS)
    if CONFIG_PATH.exists():
        with open(CONFIG_PATH, "rb") as fh:
            _merge(cfg, tomllib.load(fh))
    for dotted, raw in (overrides or {}).items():
        value = json.loads(raw) if isinstance(raw, str) else raw
        node = cfg
        parts = dotted.split(".")
        for part in parts[:-1]:
            node = node.setdefault(part, {})
        node[parts[-1]] = value
    return cfg


def user_agent(cfg):
    contact = (cfg["app"].get("contact") or "").strip()
    from . import __version__
    return f"Karasu/{__version__} ( {contact} )" if contact else f"Karasu/{__version__}"
