import { media } from "../lib/api";
import type { Track } from "../lib/types";

type Deck = {
  audio: HTMLAudioElement;
  gain: GainNode | null;
  track: Track | null;
};

export type EngineEvent =
  | { type: "playing"; value: boolean }
  | { type: "loaded"; duration: number; track: Track }
  | { type: "nearEnd" }
  | { type: "ended" }
  | { type: "error"; message: string; track: Track | null }
  | { type: "buffering"; value: boolean };

type Listener = (event: EngineEvent) => void;

function makeDeck(): Deck {
  const audio = new Audio();
  audio.crossOrigin = "anonymous";
  audio.preload = "auto";
  return { audio, gain: null, track: null };
}

const CURVE_STEPS = 64;
const fadeIn = new Float32Array(CURVE_STEPS).map((_, i) => Math.sin(((i / (CURVE_STEPS - 1)) * Math.PI) / 2));
const fadeOut = new Float32Array(CURVE_STEPS).map((_, i) => Math.cos(((i / (CURVE_STEPS - 1)) * Math.PI) / 2));

export class PreviewEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  analyser: AnalyserNode | null = null;
  private decks: [Deck, Deck] = [makeDeck(), makeDeck()];
  private active = 0;
  private listeners = new Set<Listener>();
  private fadeTimer: number | null = null;
  private nearEndFired = false;
  crossfade = 3;
  volume = 0.85;
  muted = false;

  constructor() {
    this.decks.forEach((deck, i) => this.wire(deck, i));
  }

  on(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: EngineEvent) {
    this.listeners.forEach((l) => l(event));
  }

  private wire(deck: Deck, index: number) {
    const a = deck.audio;
    a.addEventListener("playing", () => index === this.active && this.emit({ type: "playing", value: true }));
    a.addEventListener("pause", () => index === this.active && !this.isFading && this.emit({ type: "playing", value: false }));
    a.addEventListener("waiting", () => index === this.active && this.emit({ type: "buffering", value: true }));
    a.addEventListener("canplay", () => index === this.active && this.emit({ type: "buffering", value: false }));
    a.addEventListener("loadedmetadata", () => {
      if (index === this.active && deck.track) this.emit({ type: "loaded", duration: a.duration, track: deck.track });
    });
    a.addEventListener("timeupdate", () => {
      if (index !== this.active || this.nearEndFired || !Number.isFinite(a.duration)) return;
      const lead = Math.max(this.crossfade, 0.05);
      if (this.crossfade > 0 && a.duration - a.currentTime <= lead) {
        this.nearEndFired = true;
        this.emit({ type: "nearEnd" });
      }
    });
    a.addEventListener("ended", () => {
      if (index === this.active && !this.nearEndFired) this.emit({ type: "ended" });
    });
    a.addEventListener("error", () => {
      if (index === this.active) this.emit({ type: "error", message: "This preview couldn't be loaded.", track: deck.track });
    });
  }

  private get isFading() {
    return this.fadeTimer !== null;
  }

  private ensureContext() {
    if (this.ctx) return;
    try {
      const ctx = new AudioContext({ latencyHint: "playback" });
      const master = ctx.createGain();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0.5;
      analyser.minDecibels = -95;
      analyser.maxDecibels = -15;
      master.connect(analyser);
      analyser.connect(ctx.destination);
      for (const deck of this.decks) {
        const source = ctx.createMediaElementSource(deck.audio);
        const gain = ctx.createGain();
        source.connect(gain);
        gain.connect(master);
        deck.gain = gain;
      }
      this.ctx = ctx;
      this.master = master;
      this.analyser = analyser;
      this.applyVolume();
      if (this.sinkId) void this.setOutput(this.sinkId);
    } catch {
      this.ctx = null;
    }
  }

  private sinkId = "";

  async setOutput(deviceId: string) {
    this.sinkId = deviceId;
    type Sinkable = { setSinkId?: (id: string) => Promise<void> };
    const target = (this.ctx as unknown as Sinkable | null) ?? null;
    try {
      if (target?.setSinkId) await target.setSinkId(deviceId);
      else for (const deck of this.decks) await (deck.audio as unknown as Sinkable).setSinkId?.(deviceId);
      return true;
    } catch {
      return false;
    }
  }

  private applyVolume() {
    const value = this.muted ? 0 : this.volume * this.volume;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(value, this.ctx.currentTime, 0.04);
    else this.decks.forEach((d) => (d.audio.volume = value));
  }

  setVolume(volume: number) {
    this.volume = Math.min(1, Math.max(0, volume));
    this.applyVolume();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.applyVolume();
  }

  get current(): HTMLAudioElement {
    return this.decks[this.active].audio;
  }

  get currentTime() {
    return this.current.currentTime || 0;
  }

  get duration() {
    const d = this.current.duration;
    return Number.isFinite(d) ? d : 0;
  }

  get currentTrack() {
    return this.decks[this.active].track;
  }

  async load(track: Track, autoplay: boolean, fade = true) {
    if (!track.dz_id || !track.has_preview) {
      this.emit({ type: "error", message: "No preview for this song.", track });
      return;
    }
    this.ensureContext();
    if (this.ctx?.state === "suspended") await this.ctx.resume().catch(() => undefined);
    const outgoing = this.decks[this.active];
    const nextIndex = 1 - this.active;
    const incoming = this.decks[nextIndex];
    this.clearFade();
    incoming.audio.pause();
    incoming.track = track;
    incoming.audio.src = media(`/api/audio/${track.dz_id}`) ?? "";
    incoming.audio.currentTime = 0;
    const shouldFade = fade && autoplay && this.crossfade > 0 && !outgoing.audio.paused && !!this.ctx;
    this.active = nextIndex;
    this.nearEndFired = false;
    if (!autoplay) {
      outgoing.audio.pause();
      this.resetGain(incoming, 1);
      return;
    }
    if (shouldFade && incoming.gain && outgoing.gain && this.ctx) {
      const now = this.ctx.currentTime;
      const length = Math.min(this.crossfade, 12);
      incoming.gain.gain.cancelScheduledValues(now);
      outgoing.gain.gain.cancelScheduledValues(now);
      incoming.gain.gain.setValueCurveAtTime(fadeIn, now, length);
      outgoing.gain.gain.setValueCurveAtTime(fadeOut, now, length);
      this.fadeTimer = window.setTimeout(() => {
        outgoing.audio.pause();
        this.resetGain(outgoing, 1);
        this.fadeTimer = null;
      }, length * 1000 + 60);
    } else {
      outgoing.audio.pause();
      this.resetGain(incoming, 1);
    }
    try {
      await incoming.audio.play();
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        this.emit({ type: "error", message: "Playback was blocked — press play.", track });
      }
    }
  }

  private resetGain(deck: Deck, value: number) {
    if (deck.gain && this.ctx) {
      deck.gain.gain.cancelScheduledValues(this.ctx.currentTime);
      deck.gain.gain.setValueAtTime(value, this.ctx.currentTime);
    }
  }

  private clearFade() {
    if (this.fadeTimer !== null) {
      window.clearTimeout(this.fadeTimer);
      this.fadeTimer = null;
      const other = this.decks[1 - this.active];
      other.audio.pause();
      this.resetGain(other, 1);
    }
  }

  async play() {
    this.ensureContext();
    if (this.ctx?.state === "suspended") await this.ctx.resume().catch(() => undefined);
    if (!this.current.src) return;
    try {
      await this.current.play();
    } catch {
      this.emit({ type: "playing", value: false });
    }
  }

  pause() {
    this.clearFade();
    this.current.pause();
  }

  seek(seconds: number) {
    const a = this.current;
    if (!Number.isFinite(a.duration)) return;
    a.currentTime = Math.min(Math.max(0, seconds), a.duration - 0.05);
    this.nearEndFired = false;
  }

  stop() {
    this.clearFade();
    this.decks.forEach((d) => {
      d.audio.pause();
      d.track = null;
    });
  }
}

export const engine = new PreviewEngine();
