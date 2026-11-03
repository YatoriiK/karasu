import numpy as np
from scipy.ndimage import median_filter
from scipy.signal import find_peaks

VERSION = 1
FRAME = 2048
HOP = 512
BANDS = 64


def _frames(wave):
    if len(wave) < FRAME:
        wave = np.pad(wave, (0, FRAME - len(wave)))
    count = 1 + (len(wave) - FRAME) // HOP
    idx = np.arange(FRAME)[None, :] + HOP * np.arange(count)[:, None]
    return wave[idx] * np.hanning(FRAME)[None, :]


def _band_matrix(sr):
    freqs = np.fft.rfftfreq(FRAME, 1.0 / sr)
    edges = np.geomspace(40.0, min(16000.0, sr / 2 - 1), BANDS + 1)
    matrix = np.zeros((BANDS, len(freqs)), dtype=np.float32)
    for b in range(BANDS):
        mask = (freqs >= edges[b]) & (freqs < edges[b + 1])
        if not mask.any():
            mask[np.argmin(np.abs(freqs - edges[b]))] = True
        matrix[b, mask] = 1.0 / mask.sum()
    return matrix, freqs


def tempo_from_onsets(onset, fps, lo=60.0, hi=200.0):
    env = onset - onset.mean()
    if not np.any(env):
        return None, 0.0
    n = len(env)
    spec = np.fft.rfft(env, 2 * n)
    ac = np.fft.irfft(spec * np.conj(spec))[:n]
    ac /= ac[0] + 1e-9
    lags = np.arange(n)
    with np.errstate(divide="ignore"):
        bpm = 60.0 * fps / np.maximum(lags, 1)
    valid = (bpm >= lo) & (bpm <= hi)
    prior = np.exp(-0.5 * (np.log2(np.maximum(bpm, 1e-6) / 120.0) / 0.9) ** 2)
    score = np.where(valid, ac * prior, -np.inf)
    best = int(np.argmax(score))
    if not np.isfinite(score[best]) or score[best] <= 0:
        return None, 0.0
    confidence = float(ac[best])
    tempo = float(bpm[best])
    for factor in (2.0, 0.5):
        alt = tempo * factor
        if lo <= alt <= hi:
            alt_lag = int(round(60.0 * fps / alt))
            if 0 < alt_lag < n and ac[alt_lag] > 0.9 * ac[best] and abs(alt - 120) < abs(tempo - 120):
                tempo = alt
                confidence = float(ac[alt_lag])
    return round(tempo, 1), confidence


def features(wave, sr=48000):
    wave = np.asarray(wave, dtype=np.float32)
    if len(wave) < sr * 3:
        return None
    frames = _frames(wave)
    mag = np.abs(np.fft.rfft(frames, axis=1)).astype(np.float32)
    bands, freqs = _band_matrix(sr)
    band_energy = mag @ bands.T
    rms = np.sqrt(np.mean(frames ** 2, axis=1) + 1e-12)
    rms_db = 20 * np.log10(rms + 1e-9)
    loud = rms_db > (rms_db.max() - 60)
    energy = float(np.mean(rms_db[loud])) if loud.any() else float(np.mean(rms_db))
    dyn = float(np.percentile(rms_db[loud], 95) - np.percentile(rms_db[loud], 10)) if loud.sum() > 10 else 0.0
    power = mag ** 2
    total = power.sum(axis=1) + 1e-12
    centroid = (power @ freqs) / total
    brightness = float(np.average(centroid, weights=total))
    log_bands = np.log1p(band_energy * 100.0)
    flux = np.maximum(np.diff(log_bands, axis=0), 0).sum(axis=1)
    fps = sr / HOP
    onset = np.concatenate([[0.0], flux])
    smooth = np.convolve(onset, np.ones(3) / 3, mode="same")
    threshold = np.median(smooth) + 0.5 * np.std(smooth)
    peaks, _ = find_peaks(smooth, height=threshold, distance=max(1, int(fps * 0.08)))
    onset_rate = len(peaks) / (len(wave) / sr)
    tempo, confidence = tempo_from_onsets(smooth, fps)
    harmonic = median_filter(band_energy, size=(17, 1))
    percussive = median_filter(band_energy, size=(1, 9))
    perc = float(percussive.sum() / (harmonic.sum() + percussive.sum() + 1e-9))
    return {
        "tempo": tempo,
        "tempo_confidence": round(confidence, 3),
        "energy": round(energy, 2),
        "dyn": round(dyn, 2),
        "brightness": round(brightness, 1),
        "onset_rate": round(onset_rate, 3),
        "perc": round(perc, 4),
    }
