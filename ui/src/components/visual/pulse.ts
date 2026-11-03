const LOW = 10;
const MID = 36;

export class Pulse {
  energy = 0;
  bass = 0;
  mid = 0;
  high = 0;
  beat = 0;
  hit = false;
  live = false;
  count = 0;
  sense = 1;
  private prev: Float32Array | null = null;
  private flux = 0;
  private spread = 0.02;
  private since = 1;

  update(bands: Float32Array, rms: number, dt: number) {
    const ease = (rate: number) => 1 - Math.exp(-dt * rate);
    const prev = this.prev && this.prev.length === bands.length ? this.prev : (this.prev = new Float32Array(bands.length));
    let lows = 0;
    let mids = 0;
    let highs = 0;
    let flux = 0;
    let changed = false;
    for (let i = 0; i < bands.length; i++) {
      const v = bands[i];
      if (v !== prev[i]) changed = true;
      if (i < LOW) {
        lows += v;
        const d = v - prev[i];
        if (d > 0) flux += d;
      } else if (i < MID) mids += v;
      else highs += v;
    }
    prev.set(bands);
    this.live = rms > 0.003;
    const gain = Math.min(2, 0.6 + 0.4 * this.sense);
    this.energy += ((this.live ? Math.min(1, rms) : 0) - this.energy) * ease(6);
    this.bass += ((this.live ? Math.min(1, (lows / LOW) * gain) : 0) - this.bass) * ease(14);
    this.mid += ((this.live ? Math.min(1, (mids / (MID - LOW)) * gain) : 0) - this.mid) * ease(10);
    this.high += ((this.live ? Math.min(1, (highs / Math.max(1, bands.length - MID)) * gain) : 0) - this.high) * ease(10);
    this.since += dt;
    this.hit = false;
    if (changed) {
      flux /= LOW;
      const threshold = this.flux + (this.spread * 2.2) / Math.max(0.4, this.sense);
      if (this.live && flux > threshold && flux > 0.025 && this.since > 0.2) {
        this.hit = true;
        this.beat = 1;
        this.since = 0;
        this.count++;
      }
      this.flux += (flux - this.flux) * 0.12;
      this.spread += (Math.abs(flux - this.flux) - this.spread) * 0.12;
    }
    this.beat = Math.max(0, this.beat - dt * 3.2);
  }
}
