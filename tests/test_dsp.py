import numpy as np

from karasu.engine.dsp import features

SR = 48000


def clicks(bpm, seconds=20, noise=0.0, seed=0):
    rng = np.random.default_rng(seed)
    wave = rng.normal(0, noise, SR * seconds).astype(np.float32) if noise else np.zeros(SR * seconds, np.float32)
    period = int(SR * 60 / bpm)
    click = np.hanning(400).astype(np.float32) * np.sin(np.linspace(0, 400, 400)).astype(np.float32)
    for start in range(0, len(wave) - 400, period):
        wave[start:start + 400] += click
    return wave


def test_tempo_on_click_tracks():
    for bpm in (80, 100, 124, 150, 174):
        got = features(clicks(bpm))["tempo"]
        assert got is not None
        ratio = got / bpm
        assert min(abs(ratio - 1), abs(ratio - 2), abs(ratio - 0.5)) < 0.04, (bpm, got)


def test_brightness_and_energy_order():
    t = np.arange(SR * 10) / SR
    low = (0.3 * np.sin(2 * np.pi * 110 * t)).astype(np.float32)
    high = (0.3 * np.sin(2 * np.pi * 4000 * t)).astype(np.float32)
    quiet = (0.02 * np.sin(2 * np.pi * 110 * t)).astype(np.float32)
    f_low, f_high, f_quiet = features(low), features(high), features(quiet)
    assert f_high["brightness"] > f_low["brightness"] * 5
    assert f_low["energy"] > f_quiet["energy"] + 15


def test_percussive_share():
    drums = clicks(120, seconds=10)
    t = np.arange(SR * 10) / SR
    pad = (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
    assert features(drums)["perc"] > features(pad)["perc"]


def test_too_short():
    assert features(np.zeros(SR, np.float32)) is None
