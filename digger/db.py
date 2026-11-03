import json
import sqlite3
import threading
from contextlib import contextmanager

import numpy as np

from . import DATA

SCHEMA = """
create table if not exists meta(key text primary key, value text);
create table if not exists settings(key text primary key, value text);
create table if not exists sp_tracks(
    id text primary key, name text, artists text, artist_ids text, album text, album_type text,
    release_date text, isrc text, duration_ms int, key text);
create table if not exists sp_artists(id text primary key, name text, norm text, genres text);
create table if not exists seeds(kind text, ref text, weight real, primary key(kind, ref));
create table if not exists saved(track_id text primary key, added_at text);
create table if not exists plays(track_id text, played_at text, primary key(track_id, played_at));
create table if not exists playlist_tracks(playlist_id text, track_id text, primary key(playlist_id, track_id));
create table if not exists history(
    key text primary key, artist text, title text, plays int, skips int, ms_played int, last_ts text);
create table if not exists dz_tracks(
    id int primary key, title text, artist_id int, artist text, album_id int, album text, isrc text,
    duration int, rank int, release_date text, key text, original_year int, year_source text);
create table if not exists dz_artists(
    id int primary key, name text, norm text, fans int, nb_album int, earliest text, latest text,
    pace_6m int, mb_earliest text, checked_at text);
create table if not exists lfm_artists(
    norm text primary key, name text, listeners int, playcount int, tags text, checked_at text);
create table if not exists sp_dz(sp_id text primary key, dz_id int);
create table if not exists embeddings(dz_id int primary key, vec blob, model text);
create table if not exists runs(id integer primary key, started_at text, kind text, stats text);
create table if not exists recs(
    id integer primary key, run_id int, lane text, source text, dz_id int, sp_uri text, sp_id text,
    artist text, artist_key text, title text, year int, label text, score real, features text,
    reason text, added_at text, removed_at text, outcome text, outcome_at text);
create index if not exists recs_sp on recs(sp_id);
create table if not exists feedback(
    id integer primary key, dz_id int, sp_id text, artist_key text, kind text, at text);
create table if not exists playlists(lane text primary key, sp_id text);
"""

MIGRATIONS = [
    """
    alter table dz_tracks add column md5 text;
    alter table dz_tracks add column bpm real;
    alter table dz_tracks add column gain real;
    alter table dz_tracks add column explicit int;
    alter table sp_tracks add column image text;
    alter table dz_artists add column picture text;
    create index if not exists dz_tracks_artist on dz_tracks(artist_id);
    create index if not exists dz_tracks_album on dz_tracks(album_id);
    create index if not exists sp_dz_dz on sp_dz(dz_id);
    create index if not exists feedback_dz on feedback(dz_id);
    create table if not exists jobs(
        id text primary key, kind text, params text, status text, stage text, done int, total int,
        error text, result text, created text, updated text);
    create table if not exists results_cache(key text primary key, value text, created real, expires real);
    create table if not exists listen_events(
        id integer primary key, source text, sp_id text, dz_id int, artist text, title text,
        played_at text, ms_played int, skipped int, unique(source, sp_id, dz_id, played_at));
    create index if not exists listen_events_at on listen_events(played_at);
    create table if not exists dsp(
        dz_id int primary key, tempo real, energy real, dyn real, brightness real, onset_rate real,
        perc real, version int);
    create table if not exists facets(dz_id int primary key, vec blob, version int);
    create table if not exists artist_tags(norm text primary key, tags text, source text, checked_at text);
    create table if not exists art_palette(key text primary key, palette text);
    create table if not exists app_playlists(
        id integer primary key, name text, description text, cover text, params text, sp_id text,
        created text, updated text);
    create table if not exists app_playlist_items(
        playlist_id int, pos int, dz_id int, sp_id text, added_at text, primary key(playlist_id, pos));
    create table if not exists search_history(q text primary key, last_at text, count int);
    create table if not exists daily(date text primary key, picks text);
    create table if not exists fans_history(artist_id int, date text, fans int, primary key(artist_id, date));
    create table if not exists exclusions(kind text, value text, label text, created text, primary key(kind, value));
    create table if not exists prefs(key text primary key, value text);
    """,
    """
    create table if not exists dz_sp(dz_id int primary key, sp_id text, checked_at text);
    create virtual table if not exists search_index using fts5(
        kind unindexed, ref unindexed, title, artist, album, tokenize='unicode61 remove_diacritics 2');
    """,
    """
    create table if not exists layouts(id integer primary key, name text, data text, pos int, created text, updated text);
    create table if not exists assets(
        id text primary key, name text, file text, mime text, w int, h int, bytes int, created text);
    """,
    """
    create table if not exists sp_playlists(
        id text primary key, name text, description text, owner_id text, owner_name text, image text, total int,
        snapshot_id text, collaborative int, public int, pos int, synced_at text, items_snapshot text, items_at text);
    create table if not exists sp_playlist_items(
        playlist_id text, pos int, track_id text, added_at text, primary key(playlist_id, pos));
    create index if not exists sp_playlist_items_track on sp_playlist_items(track_id);
    """,
    """
    create table if not exists artist_listeners(
        sp_id text primary key, name text, monthly int, followers int, world_rank int, cities text, image text,
        status text, error text, fetched_at text);
    """,
    """
    create table if not exists artist_genres(
        artist_id int primary key, mbid text, genres text, method text, area text, origin text, checked_at text);
    """,
    """
    create table if not exists artist_genre_guess(artist_id int primary key, genres text);
    """,
    """
    alter table assets add column frames int;
    """,
]


class DB:
    def __init__(self, path=None):
        DATA.mkdir(parents=True, exist_ok=True)
        self.path = path or DATA / "music.db"
        self._local = threading.local()
        self._all = []
        self._all_lock = threading.Lock()
        self.lock = threading.RLock()
        conn = self.conn
        conn.executescript(SCHEMA)
        self._migrate(conn)

    @property
    def conn(self):
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(self.path, isolation_level=None, timeout=60, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            conn.execute("pragma journal_mode=wal")
            conn.execute("pragma synchronous=normal")
            conn.execute("pragma busy_timeout=60000")
            self._local.conn = conn
            self._local.depth = 0
            with self._all_lock:
                self._all.append(conn)
        return conn

    def _migrate(self, conn):
        row = conn.execute("select value from meta where key='schema_version'").fetchone()
        version = int(json.loads(row[0])) if row else 1
        for index, script in enumerate(MIGRATIONS, start=2):
            if version >= index:
                continue
            for statement in (s.strip() for s in script.split(";")):
                if not statement:
                    continue
                try:
                    conn.execute(statement)
                except sqlite3.OperationalError as exc:
                    if "duplicate column" not in str(exc):
                        raise
            conn.execute("insert or replace into meta(key, value) values('schema_version', ?)", (json.dumps(index),))
            version = index

    def q(self, sql, args=()):
        return self.conn.execute(sql, args).fetchall()

    def one(self, sql, args=()):
        return self.conn.execute(sql, args).fetchone()

    def x(self, sql, args=()):
        return self.conn.execute(sql, args)

    def many(self, sql, rows):
        with self.tx():
            self.conn.executemany(sql, rows)

    @contextmanager
    def tx(self):
        conn = self.conn
        depth = getattr(self._local, "depth", 0)
        if depth:
            self._local.depth = depth + 1
            try:
                yield self
            finally:
                self._local.depth = depth
            return
        conn.execute("begin immediate")
        self._local.depth = 1
        try:
            yield self
            conn.execute("commit")
        except Exception:
            conn.execute("rollback")
            raise
        finally:
            self._local.depth = 0

    def meta(self, key, default=None):
        row = self.one("select value from meta where key=?", (key,))
        return json.loads(row[0]) if row else default

    def set_meta(self, key, value):
        self.x("insert or replace into meta(key, value) values(?, ?)", (key, json.dumps(value)))

    def settings(self):
        return {row["key"]: row["value"] for row in self.q("select key, value from settings")}

    def set_setting(self, key, value):
        self.x("insert or replace into settings(key, value) values(?, ?)", (key, json.dumps(value)))

    def prefs(self):
        return {row["key"]: json.loads(row["value"]) for row in self.q("select key, value from prefs")}

    def set_pref(self, key, value):
        self.x("insert or replace into prefs(key, value) values(?, ?)", (key, json.dumps(value)))

    def put_vec(self, dz_id, vec, model):
        blob = np.asarray(vec, dtype=np.float32).tobytes()
        self.x("insert or replace into embeddings(dz_id, vec, model) values(?, ?, ?)", (dz_id, blob, model))

    def vecs(self, ids=None, model=None):
        model_sql = " and model=?" if model else ""
        model_arg = [model] if model else []
        if ids is None:
            rows = self.q(f"select dz_id, vec from embeddings where 1=1{model_sql}", model_arg)
        else:
            ids = list(ids)
            rows = []
            for i in range(0, len(ids), 900):
                part = ids[i:i + 900]
                rows += self.q(
                    f"select dz_id, vec from embeddings where dz_id in ({','.join('?' * len(part))}){model_sql}",
                    part + model_arg)
        return {row["dz_id"]: np.frombuffer(row["vec"], dtype=np.float32) for row in rows}

    def close(self):
        with self._all_lock:
            for conn in self._all:
                try:
                    conn.close()
                except sqlite3.Error:
                    pass
            self._all.clear()
        self._local = threading.local()
