from karasu.web.routers.library import is_liked


def test_a_like_on_any_copy_of_a_song_counts(ctx):
    db = ctx.db
    # Spotify keeps the like on the remaster, Karasu plays the original id. Same song.
    db.x("insert into sp_dz(sp_id, dz_id) values('remaster', 7)")
    db.x("insert into dz_sp(dz_id, sp_id, checked_at) values(7, 'original', 'now')")
    db.x("insert into saved(track_id, added_at) values('remaster', 'now')")
    assert is_liked(db, "dz:7")
    assert is_liked(db, "sp:remaster")
    db.x("insert into sp_dz(sp_id, dz_id) values('original', 7)")
    assert is_liked(db, "sp:original")


def test_spotify_only_songs_and_karasu_likes(ctx):
    db = ctx.db
    db.x("insert into saved(track_id, added_at) values('loner', 'now')")
    assert is_liked(db, "sp:loner")
    assert not is_liked(db, "sp:stranger")
    db.x("insert into feedback(dz_id, kind, at) values(9, 'up', 'a')")
    assert is_liked(db, "dz:9")
    db.x("insert into feedback(dz_id, kind, at) values(9, 'clear', 'b')")
    assert not is_liked(db, "dz:9")
