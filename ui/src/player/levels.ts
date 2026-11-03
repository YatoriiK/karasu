import { useEffect } from "react";
import { API_BASE } from "../lib/api";
import { usePlayer } from "../store/player";
import { usePrefs } from "../store/prefs";
import { engine } from "./engine";

export const BANDS = 64;

const system = new Float32Array(BANDS);
let systemRms = 0;
let systemAt = 0;
let socket: WebSocket | null = null;
let users = 0;
let retry: number | null = null;

function socketUrl() {
  const base = API_BASE || window.location.origin;
  return base.replace(/^http/, "ws") + "/api/audio/levels";
}

function open() {
  if (socket || users <= 0) return;
  try {
    socket = new WebSocket(socketUrl());
  } catch {
    socket = null;
    return;
  }
  socket.binaryType = "arraybuffer";
  socket.onmessage = (event) => {
    if (typeof event.data === "string") return;
    const data = new Uint8Array(event.data as ArrayBuffer);
    for (let i = 0; i < BANDS && i < data.length; i++) system[i] = data[i] / 255;
    systemRms = data.length > BANDS ? data[BANDS] / 255 : 0;
    systemAt = performance.now();
  };
  socket.onclose = () => {
    socket = null;
    if (users > 0 && retry === null) retry = window.setTimeout(() => ((retry = null), open()), 2500);
  };
}

function close() {
  if (retry !== null) window.clearTimeout(retry);
  retry = null;
  socket?.close();
  socket = null;
}

export function useSystemAudio() {
  const enabled = usePrefs((s) => s.systemAudio);
  useEffect(() => {
    if (!enabled) return;
    users += 1;
    open();
    return () => {
      users -= 1;
      if (users <= 0) close();
    };
  }, [enabled]);
}

const edges = (() => {
  const out: number[] = [];
  for (let i = 0; i <= BANDS; i++) out.push(35 * Math.pow(15000 / 35, i / BANDS));
  return out;
})();

const RANGE = 54;
const QUIETEST = -70;
const GATE = 4e-4;

let freq: Uint8Array<ArrayBuffer> | null = null;
let wave: Float32Array<ArrayBuffer> | null = null;
let power: Float32Array<ArrayBuffer> | null = null;
let top = QUIETEST;
const db = new Float32Array(BANDS);
const tilt = Array.from({ length: BANDS }, (_, b) => {
  const center = Math.sqrt(35 * Math.pow(15000 / 35, b / BANDS) * 35 * Math.pow(15000 / 35, (b + 1) / BANDS));
  return 3 * Math.log2(center / 1000);
});

function fromAnalyser(analyser: AnalyserNode, out: Float32Array) {
  if (!freq || freq.length !== analyser.frequencyBinCount) freq = new Uint8Array(analyser.frequencyBinCount);
  if (!wave || wave.length !== analyser.fftSize) wave = new Float32Array(analyser.fftSize);
  if (!power || power.length !== 256) {
    power = new Float32Array(256);
    for (let i = 0; i < 256; i++) power[i] = Math.pow(10, (analyser.minDecibels + ((analyser.maxDecibels - analyser.minDecibels) * i) / 255) / 10);
  }
  analyser.getFloatTimeDomainData(wave);
  let rms = 0;
  for (let i = 0; i < wave.length; i++) rms += wave[i] * wave[i];
  rms = Math.sqrt(rms / wave.length);
  if (rms < GATE) {
    top = Math.max(QUIETEST, top - 0.5);
    out.fill(0);
    return 0;
  }
  analyser.getByteFrequencyData(freq);
  const width = analyser.context.sampleRate / 2 / freq.length;
  let peak = -200;
  for (let b = 0; b < BANDS; b++) {
    let lo = Math.floor(edges[b] / width);
    const hi = Math.max(lo + 1, Math.ceil(edges[b + 1] / width));
    let sum = 0;
    let n = 0;
    for (; lo < hi && lo < freq.length; lo++, n++) sum += power[freq[lo]];
    db[b] = n ? 10 * Math.log10(sum / n) + tilt[b] : -200;
    peak = Math.max(peak, db[b]);
  }
  top = Math.max(peak, top - 0.06, QUIETEST);
  for (let b = 0; b < BANDS; b++) out[b] = Math.min(1, Math.max(0, (db[b] - top + RANGE) / RANGE));
  return Math.min(1, rms * 4);
}

export function readLevels(out: Float32Array): { rms: number; live: boolean } {
  const player = usePlayer.getState();
  const analyser = engine.analyser;
  if (player.source === "preview" && player.playing && analyser) {
    const rms = fromAnalyser(analyser, out);
    return { rms, live: true };
  }
  if (systemAt && performance.now() - systemAt < 400) {
    out.set(system);
    return { rms: systemRms, live: systemRms > 0.002 };
  }
  out.fill(0);
  return { rms: 0, live: false };
}
