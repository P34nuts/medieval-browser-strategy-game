// Kleiner Synthesizer auf Basis der WebAudio-API – keine externen Dateien nötig.
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private last: Record<string, number> = {};
  muted = false;

  unlock() {
    if (!this.ctx) {
      try {
        const AC: typeof AudioContext =
          window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.32;
        this.master.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      } catch {
        this.ctx = null;
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.32;
  }

  private gate(key: string, gap: number) {
    const now = performance.now();
    if (now - (this.last[key] ?? 0) < gap) return false;
    this.last[key] = now;
    return true;
  }

  private tone(f0: number, f1: number, dur: number, type: OscillatorType, vol: number, delay = 0) {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  private noise(dur: number, vol: number, cutoff: number, delay = 0) {
    if (!this.ctx || !this.master || !this.noiseBuf || this.muted) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, t);
    f.frequency.exponentialRampToValueAtTime(100, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.03);
  }

  shoot() {
    if (!this.gate('shoot', 90)) return;
    this.tone(880, 380, 0.07, 'square', 0.05);
  }
  enemyShoot() {
    if (!this.gate('eshoot', 120)) return;
    this.tone(300, 160, 0.09, 'sawtooth', 0.04);
  }
  hit() {
    if (!this.gate('hit', 50)) return;
    this.tone(200, 120, 0.05, 'square', 0.05);
  }
  explode(big = false) {
    if (!this.gate(big ? 'bigx' : 'x', big ? 100 : 40)) return;
    this.noise(big ? 0.9 : 0.35, big ? 0.6 : 0.35, big ? 2500 : 1800);
    this.tone(big ? 120 : 160, 30, big ? 0.7 : 0.25, 'triangle', big ? 0.3 : 0.18);
  }
  pickup() {
    this.tone(660, 990, 0.09, 'triangle', 0.18);
    this.tone(990, 1480, 0.12, 'triangle', 0.16, 0.08);
  }
  hurt() {
    this.noise(0.35, 0.5, 1200);
    this.tone(180, 50, 0.35, 'sawtooth', 0.2);
  }
  shieldHit() {
    if (!this.gate('sh', 80)) return;
    this.tone(1200, 600, 0.12, 'sine', 0.15);
  }
  bomb() {
    this.noise(1.2, 0.7, 3500);
    this.tone(90, 20, 1.1, 'sawtooth', 0.3);
  }
  warn() {
    for (let i = 0; i < 3; i++) this.tone(440, 440, 0.22, 'square', 0.1, i * 0.35);
    for (let i = 0; i < 3; i++) this.tone(330, 330, 0.22, 'square', 0.1, i * 0.35 + 0.17);
  }
  wave() {
    this.tone(440, 660, 0.12, 'triangle', 0.16);
    this.tone(660, 880, 0.12, 'triangle', 0.16, 0.12);
    this.tone(880, 1320, 0.2, 'triangle', 0.16, 0.24);
  }
  phase() {
    this.tone(120, 400, 0.5, 'sawtooth', 0.18);
    this.noise(0.4, 0.3, 1500);
  }
  start() {
    [392, 523, 659, 784].forEach((f, i) => this.tone(f, f, 0.15, 'square', 0.08, i * 0.08));
  }
  gameOver() {
    [392, 330, 262, 196].forEach((f, i) => this.tone(f, f * 0.98, 0.35, 'triangle', 0.2, i * 0.28));
  }
  record() {
    [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, f, 0.18, 'triangle', 0.16, i * 0.1));
  }
}
