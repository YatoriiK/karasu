from karasu.util import (is_filler, is_junk, is_variant, norm_artist, norm_title, percentile_ranks, track_key,
                         year_of)


def test_title_strips_versions_and_features():
    assert norm_title("Yellow Submarine (Remastered 2009)") == "yellow submarine"
    assert norm_title("Bohemian Rhapsody - 2011 Remaster") == "bohemian rhapsody"
    assert norm_title("Track (feat. Someone)") == "track"
    assert norm_title("Track feat. Someone") == "track"
    assert norm_title("Song [Live at the BBC]") == "song"
    assert norm_title("Live Forever") == "live forever"


def test_artist_normalization():
    assert norm_artist("The Beatles") == "beatles"
    assert norm_artist("Simon & Garfunkel") == "simon and garfunkel"
    assert norm_artist("Sigur Rós") == "sigur ros"
    assert norm_artist("坂本龍一") == "坂本龍一"
    assert track_key("The Beatles", "Yellow Submarine (Remastered 2009)") == "beatles|yellow submarine"


def test_junk_and_filler():
    assert is_junk("Song (Karaoke Version)")
    assert is_junk("Tribute to Someone")
    assert is_junk("Song (Slowed + Reverb)")
    assert not is_junk("Heaven or Las Vegas")
    assert is_filler("Deep Sleep Music 432 Hz")
    assert is_filler("Lofi Beats to Study To")
    assert is_filler("Relaxing Piano for Sleeping")
    assert not is_filler("Sleepwalk")
    assert not is_filler("Dragonaut", "Sleep")
    assert not is_filler("Meditation", "Antônio Carlos Jobim")
    assert is_variant("Song - Live")
    assert not is_variant("Song")


def test_year_and_ranks():
    assert year_of("1966-08-05") == 1966
    assert year_of("1981") == 1981
    assert year_of("0000") is None
    assert year_of(None) is None
    assert percentile_ranks([3, None, 1, 2]) == [1.0, None, 0.0, 0.5]
    assert percentile_ranks([5, 5]) == [0.5, 0.5]
    assert percentile_ranks([None]) == [None]
