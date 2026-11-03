import sys
import time
import types

import numpy as np

from karasu.engine import listen
from karasu.engine.listen import RATE, Levels


def tone(freq, seconds=0.05, amp=0.3):
    t = np.arange(int(RATE * seconds)) / RATE
    return (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def test_silence_gives_flat_bars():
    levels = Levels()
    bands, rms = levels.push(np.zeros(1024, dtype=np.float32))
    assert rms == 0.0 and not bands.any()


def test_low_and_high_tones_light_up_their_own_bands():
    low, _ = Levels().push(tone(80))
    high, _ = Levels().push(tone(6000))
    assert int(np.argmax(low)) < 16
    assert int(np.argmax(high)) > 40
    assert low.max() > 0.5 and high.max() > 0.5


def test_loud_and_quiet_music_both_fill_the_meter():
    loud, _ = Levels().push(tone(440, amp=0.8))
    quiet, _ = Levels().push(tone(440, amp=0.02))
    assert loud.max() > 0.9 and quiet.max() > 0.9


def test_hiss_below_the_gate_stays_dark():
    noise = (np.random.default_rng(1).standard_normal(4096) * 1e-4).astype(np.float32)
    bands, rms = Levels().push(noise)
    assert rms == 0.0 and not bands.any()


def test_meter_recovers_after_a_loud_song_then_silence():
    levels = Levels()
    for _ in range(20):
        levels.push(tone(440, amp=0.9, seconds=1024 / RATE))
    for _ in range(200):
        levels.push(np.zeros(1024, dtype=np.float32))
    quiet = None
    for _ in range(4):
        quiet, _ = levels.push(tone(440, amp=0.01, seconds=1024 / RATE))
    assert quiet.max() > 0.8


class FakeRecorder:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def record(self, numframes):
        time.sleep(0.005)
        return np.full((numframes, 2), 0.1, dtype=np.float32)


def fake_soundcard():
    speaker = types.SimpleNamespace(name="Speakers")
    mic = types.SimpleNamespace(recorder=lambda **kw: FakeRecorder())
    return types.SimpleNamespace(default_speaker=lambda: speaker, get_microphone=lambda **kw: mic)


def wait(check, seconds=2.0):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if check():
            return True
        time.sleep(0.01)
    return False


def test_capture_restarts_after_everyone_leaves(monkeypatch):
    monkeypatch.setitem(sys.modules, "soundcard", fake_soundcard())
    audio = listen.SystemAudio()
    for _ in range(2):
        audio.subscribe()
        start = audio.frame[0]
        assert wait(lambda: audio.frame[0] != start and audio.frame[2] > 0)
        audio.unsubscribe()
        assert wait(lambda: audio.thread is None)
    audio.subscribe()
    audio.unsubscribe()
    audio.subscribe()
    time.sleep(0.1)
    start = audio.frame[0]
    assert wait(lambda: audio.frame[0] != start)
    audio.unsubscribe()
    assert wait(lambda: audio.thread is None)
