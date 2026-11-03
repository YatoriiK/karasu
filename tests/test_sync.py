from digger.sync import import_history, known_sets, snapshot_recent, sync_all


def track(tid, name, artist, aid, isrc=None):
    return {"id": tid, "name": name, "type": "track", "uri": f"spotify:track:{tid}",
            "artists": [{"id": aid, "name": artist}],
            "album": {"name": "Album", "album_type": "album", "release_date": "2020-01-01"},
            "external_ids": {"isrc": isrc or f"ISRC{tid}"}, "duration_ms": 200000}


class FakeSp:
    def __init__(self):
        self.after = []

    def me(self):
        return {"id": "u1", "display_name": "Tester"}

    def top(self, kind, time_range, max_items=100):
        if kind == "tracks":
            return [track("t1", "Song One", "Band A", "a1"), track("t2", "Song Two", "Band B", "a2")]
        return [{"id": "a3", "name": "The Band C", "genres": ["dream pop"]}]

    def saved_tracks(self, max_items=None):
        return [{"added_at": "2026-10-01T00:00:00Z", "track": track("t3", "Saved Song (Remastered 2011)", "Band D", "a4")}]

    def recently_played(self, after_ms=None):
        self.after.append(after_ms)
        if after_ms:
            return []
        return [{"track": track("t1", "Song One", "Band A", "a1"), "played_at": "2026-10-31T10:00:00Z"},
                {"track": track("t5", "Fresh Play", "Band E", "a5"), "played_at": "2026-10-31T11:00:00.123Z"}]

    def playlists(self):
        return [{"id": "p1", "owner": {"id": "u1"}, "collaborative": False},
                {"id": "p2", "owner": {"id": "someone"}, "collaborative": False}]

    def playlist_items(self, pid):
        assert pid == "p1"
        t = track("t6", "Playlist Song", "Band F", "a6")
        return [{"added_at": None, "item": t, "track": t}, {"added_at": None, "item": None, "track": None}]


def test_sync_and_known_sets(ctx):
    sp = FakeSp()
    counts = sync_all(sp, ctx.db, log=lambda m: None)
    assert counts["saved"] == 1 and counts["recent"] == 2 and counts["playlist_tracks"] == 1
    known = known_sets(ctx.db)
    assert {"band a", "band b", "band d", "band e", "band f", "band c"} <= known["artist_norms"]
    assert "band d|saved song" in known["keys"]
    assert {"t1", "t2", "t3", "t5", "t6"} <= known["track_ids"]
    weights = {r["kind"]: r["weight"] for r in ctx.db.q("select kind, weight from seeds where ref='t1'")}
    assert weights["track:top_short_term"] == 3.0 and "track:recent" in weights
    assert snapshot_recent(sp, ctx.db) == 0
    assert sp.after[-1] is not None


def test_history_import(ctx, tmp_path):
    path = tmp_path / "Streaming_History_Audio_2025.json"
    path.write_text(
        '[{"ts":"2025-01-01T00:00:00Z","ms_played":200000,"master_metadata_track_name":"Old Love",'
        '"master_metadata_album_artist_name":"Band X","skipped":false},'
        '{"ts":"2025-01-02T00:00:00Z","ms_played":5000,"master_metadata_track_name":"Old Love",'
        '"master_metadata_album_artist_name":"Band X","skipped":true},'
        '{"ts":"2025-01-03T00:00:00Z","ms_played":180000,"master_metadata_track_name":"Old Love",'
        '"master_metadata_album_artist_name":"Band X","skipped":null},'
        '{"ts":"2025-01-03T00:00:00Z","ms_played":1000,"master_metadata_track_name":null,'
        '"master_metadata_album_artist_name":null}]', encoding="utf-8")
    assert import_history(ctx.db, [path], log=lambda m: None) == 1
    row = ctx.db.one("select * from history")
    assert (row["plays"], row["skips"]) == (2, 1)
    assert "band x" in known_sets(ctx.db)["artist_norms"]


def test_history_import_reads_the_zip_spotify_sends(ctx, tmp_path):
    import zipfile

    path = tmp_path / "my_spotify_data.zip"
    folder = "Spotify Extended Streaming History/"
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr(folder + "Streaming_History_Audio_2023-2024_0.json",
                    '[{"ts":"2023-05-01T10:00:00Z","ms_played":180000,"master_metadata_track_name":"Song A",'
                    '"master_metadata_album_artist_name":"Band Y","spotify_track_uri":"spotify:track:aaa"}]')
        zf.writestr(folder + "Streaming_History_Audio_2024_1.json",
                    '﻿[{"ts":"2024-02-01T10:00:00Z","ms_played":5000,"master_metadata_track_name":"Song B",'
                    '"master_metadata_album_artist_name":"Band Y","skipped":true}]')
        zf.writestr(folder + "Streaming_History_Video_2024.json", '[{"ts":"2024-01-01T00:00:00Z"}]')
        zf.writestr("Spotify Account Data/Userdata.json", '{"email":"someone@example.com"}')
    assert import_history(ctx.db, [path], log=lambda m: None) == 2
    events = ctx.db.q("select sp_id, title, skipped from listen_events order by played_at")
    assert [(e["sp_id"], e["title"], e["skipped"]) for e in events] == [("aaa", "Song A", 0), (None, "Song B", 1)]
