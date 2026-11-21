// Procedural 3D audio (no asset files). Starts after the first tap (browser rule).
export class AudioFX {
  private ctx: AudioContext | null = null;
  private noise!: AudioBuffer; private crowd!: GainNode; private rain!: GainNode; private master!: GainNode;
  private bTimer = 0; private sTimer = 0;
  init() {
    if (this.ctx) { void this.ctx.resume(); return; }
    const C = window.AudioContext || (window as any).webkitAudioContext;
    if (!C) return;
    const c: AudioContext = new C(); this.ctx = c;
    this.master = c.createGain(); this.master.gain.value = 0.8; this.master.connect(c.destination);
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    const loop = (type: BiquadFilterType, f: number) => {
      const s = c.createBufferSource(); s.buffer = buf; s.loop = true;
      const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f;
      const g = c.createGain(); g.gain.value = 0; s.connect(fl); fl.connect(g); g.connect(this.master); s.start(); return g;
    };
    this.crowd = loop("bandpass", 650); this.rain = loop("highpass", 3500);
  }
  setCrowd(v: number) { if (this.ctx) this.crowd.gain.setTargetAtTime(v * 0.25, this.ctx.currentTime, 0.3); }
  setRain(v: number) { if (this.ctx) this.rain.gain.setTargetAtTime(v * 0.08, this.ctx.currentTime, 0.5); }
  listener(x: number, y: number, z: number, fx: number, fy: number, fz: number) {
    if (!this.ctx) return; const l = this.ctx.listener as any;
    if (l.positionX) {
      l.positionX.value = x; l.positionY.value = y; l.positionZ.value = z;
      l.forwardX.value = fx; l.forwardY.value = fy; l.forwardZ.value = fz; l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else if (l.setPosition) { l.setPosition(x, y, z); l.setOrientation(fx, fy, fz, 0, 1, 0); }
  }
  private burst(freq: number, q: number, dur: number, gain: number, type: BiquadFilterType, pos?: [number, number, number]) {
    const c = this.ctx; if (!c) return;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(gain, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
    s.connect(f); f.connect(g);
    if (pos) {
      const p = c.createPanner(); p.panningModel = "HRTF"; p.refDistance = 2;
      if ((p as any).positionX) { p.positionX.value = pos[0]; p.positionY.value = pos[1]; p.positionZ.value = pos[2]; } else (p as any).setPosition(pos[0], pos[1], pos[2]);
      g.connect(p); p.connect(this.master);
    } else g.connect(this.master);
    s.start(0, Math.random(), dur + 0.05);
  }
  play(kind: string, pos?: [number, number, number], power = 20) {
    if (!this.ctx) return;
    if (kind === "bat") this.burst(1800, 3, 0.09, Math.min(1, power / 30), "bandpass", pos);
    else if (kind === "stump") this.burst(2500, 1, 0.25, 0.9, "highpass", pos);
    else if (kind === "cheer") this.crowd.gain.setTargetAtTime(0.7, this.ctx.currentTime, 0.1);
    else if (kind === "groan") this.crowd.gain.setTargetAtTime(0.45, this.ctx.currentTime, 0.1);
  }
  breath(dt: number, fatigue: number) {
    if (!this.ctx || fatigue < 0.15) return;
    this.bTimer += dt;
    if (this.bTimer > 3.2 - 2.4 * fatigue) { this.bTimer = 0; this.burst(700, 0.5, 0.4, 0.04 + 0.12 * fatigue, "lowpass"); }
  }
  steps(dt: number, running: boolean, onPitch: boolean) {
    if (!this.ctx || !running) return;
    this.sTimer += dt;
    if (this.sTimer > 0.3) { this.sTimer = 0; this.burst(onPitch ? 900 : 350, 1, 0.08, 0.15, "bandpass"); }
  }
}
