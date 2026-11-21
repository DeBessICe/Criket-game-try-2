import {
  Ball, Delivery, V3, createBall, stepBall, predictPath, speedOf, DT,
  STRIKER_STUMPS_Z, BOWLER_STUMPS_Z, CREASE, ENV,
} from "./physics";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 0.5;
const rad = (d: number) => (d * Math.PI) / 180;
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

export interface Shot { name: string; angle: number; foot: number; lat: number; h: number; base: number; elev: number }
export const SHOTS: Record<string, Shot> = {
  cover:    { name: "Cover drive",    angle: 35,   foot: -0.5, lat: 0.3,   h: 0.45, base: 27, elev: 6 },
  straight: { name: "Straight drive", angle: 0,    foot: -0.5, lat: 0,     h: 0.4,  base: 28, elev: 6 },
  lofted:   { name: "Lofted drive",   angle: 5,    foot: -0.5, lat: 0.05,  h: 0.5,  base: 31, elev: 28 },
  flick:    { name: "Flick",          angle: -45,  foot: -0.4, lat: -0.25, h: 0.55, base: 24, elev: 8 },
  pull:     { name: "Pull",           angle: -80,  foot: 0.4,  lat: -0.2,  h: 0.95, base: 28, elev: 14 },
  cut:      { name: "Cut",            angle: 85,   foot: 0.4,  lat: 0.3,   h: 0.85, base: 25, elev: 8 },
  sweep:    { name: "Sweep",          angle: -105, foot: -0.3, lat: -0.1,  h: 0.15, base: 22, elev: 6 },
  hook:     { name: "Hook",           angle: -135, foot: 0.4,  lat: -0.15, h: 1.25, base: 27, elev: 32 },
  defend:   { name: "Defensive block", angle: 0,   foot: -0.3, lat: 0,     h: 0.45, base: 4,  elev: 2 },
};

export interface Fielder {
  x: number; z: number; hx: number; hz: number; tx: number; tz: number; eta: number;
  skill: number; speed: number; keeper: boolean; bowler: boolean;
  hasBall: boolean; wait: number; tried: boolean;
}
export interface Batter {
  isPlayer: boolean; end: 0 | 1; target: 0 | 1; fromEnd: 0 | 1; z: number;
  running: boolean; v: number; delay: number; dive: boolean;
}
export type Phase = "runup" | "bowl" | "live" | "throw" | "decision" | "dead" | "end";

export interface Stadium { name: string; r: number; bounce: number; roll: number; cap: number; sky: number; grass: number; night: boolean }
export const STADIUMS: Stadium[] = [
  { name: "Oval Park", r: 65, bounce: 0.6, roll: 1.4, cap: 0.9, sky: 0x87ceeb, grass: 0x3f8f3a, night: false },
  { name: "Dust Bowl", r: 58, bounce: 0.55, roll: 2.2, cap: 0.5, sky: 0xd8c9a0, grass: 0x8f8a3a, night: false },
  { name: "Night Arena", r: 70, bounce: 0.65, roll: 1.2, cap: 1.0, sky: 0x0b1226, grass: 0x2f6f2f, night: true },
];
export interface Umpire { name: string; wide: number; err: number }
export const UMPIRES: Umpire[] = [
  { name: "Strict", wide: 0.8, err: 0.04 }, { name: "Lenient", wide: 1.1, err: 0.08 }, { name: "Quick finger", wide: 0.95, err: 0.11 },
];
export const TEAMS = [{ name: "Royals", c: 0x1e4fd8 }, { name: "Titans", c: 0xd81e1e }, { name: "Strikers", c: 0x16a34a }];
export interface GameOpts { team: number; pos: number; striker: boolean; stadium: number }
export const DEFAULT_OPTS: GameOpts = { team: 0, pos: 1, striker: true, stadium: 0 };

export const ATTR = { technique: 0.7, power: 0.72, timing: 0.7, footwork: 0.7, running: 0.7, stamina: 0.7, composure: 0.7 };

const FIELD = [
  { x: 0, z: 13, keeper: true }, { x: 3.5, z: 11 }, { x: 15, z: 2 }, { x: 20, z: -10 },
  { x: 15, z: -25 }, { x: -15, z: -25 }, { x: -22, z: -8 }, { x: -18, z: 4 },
  { x: -14, z: 22 }, { x: 28, z: 22 }, { x: -0.6, z: -18.6, bowler: true },
] as { x: number; z: number; keeper?: boolean; bowler?: boolean }[];

const COMM: Record<string, string[]> = {
  four: ["Cracked through the gap!", "That's raced away to the rope."],
  six: ["Gone! Into the stands!", "Massive hit!"],
  wicket: ["Big moment! He has to go.", "The bowler strikes!"],
  drop: ["Oh, that should have stuck!", "Dropped! A real let-off."],
  close: ["Tight! Incredibly close.", "Almost! The umpire takes a look."],
};

export class Game {
  phase: Phase = "dead";
  fielders: Fielder[] = [];
  player: Batter; partner: Batter; batters: Batter[];
  ball: Ball | null = null;
  delivery!: Delivery;
  deliveryId = 0;
  ghost: V3[] = [];
  runs = 0; wkts = 0; legal = 0; target: number; aiScore: number;
  pressure = 0.2; fatigue = 0; pBias = 0;
  joy = { x: 0, y: 0 };
  msg = ""; msgT = 0; comm = ""; commT = 0; gesture = ""; gestureT = 0; feedback = ""; fbT = 0;
  result = ""; reviewsLeft = 1; lookBack = false; slow = 1; simT = 0; bowlerZ = -28;
  swing: { shot: string; t0: number } | null = null;
  attr = ATTR;
  stadium: Stadium = STADIUMS[0]; umpire: Umpire = UMPIRES[0]; team = 0; oppTeam = 1;
  weather = { temp: 24, wind: 3, windDir: 1, humidity: 0.5, cloud: 0.3, rain: 0.2 }; raining = false;
  neutral = true; homeIsUser = false; mood = [0, 0, 0, 0];
  crowdKind: ("user" | "opp" | "neutral")[] = ["neutral", "neutral", "neutral", "neutral"];
  boundStreak = 0; dotStreak = 0; celebT = 0; injury = 0; dived = false;
  onSpeak?: (t: string) => void; onSound?: (k: string, p?: number) => void;

  private acc = 0; private runT = 0; private deadT = 0; private decisionT = 0;
  private crossed = false; private stumpsChecked = false;
  private runsThisBall = 0; private overthrow = 0; private noBall = false;
  private controlled = false; private legBye = false;
  private startEnds: [0 | 1, 0 | 1] = [0, 1];
  private chaserEta = 99; private holdT = 0; private thrower: Fielder | null = null;
  private throwData: { E: 0 | 1; sx: number; sz: number; t: number; T: number; fx: number; fz: number; hit: boolean } | null = null;
  private wicketKind = ""; private wicketVictim: Batter | null = null;
  private lbwTruth = false; private partnerCall = ""; private lastComm = ""; private idleHold = 0;
  private playerOut = false;

  constructor(o: GameOpts = DEFAULT_OPTS) {
    this.aiScore = Math.max(10, Math.round(20 + gauss() * 6));
    this.target = this.aiScore + 1;
    this.player = { isPlayer: true, end: 0, target: 0, fromEnd: 0, z: CREASE[0], running: false, v: 0, delay: 0, dive: false };
    this.partner = { isPlayer: false, end: 1, target: 1, fromEnd: 1, z: CREASE[1], running: false, v: 0, delay: 0, dive: false };
    this.batters = [this.player, this.partner];
    this.fielders = FIELD.map((f) => {
      const skill = f.keeper ? 0.85 : 0.45 + Math.random() * 0.45;
      return { x: f.x, z: f.z, hx: f.x, hz: f.z, tx: f.x, tz: f.z, eta: 99, skill, speed: 5.5 + 3 * skill,
        keeper: !!f.keeper, bowler: !!f.bowler, hasBall: false, wait: 0, tried: false };
    });
    this.team = o.team; this.oppTeam = (o.team + 1) % 3;
    this.stadium = STADIUMS[o.stadium]; ENV.bounce = this.stadium.bounce; ENV.roll = this.stadium.roll;
    this.umpire = pick(UMPIRES);
    const r0 = Math.random(); this.neutral = r0 < 0.4; this.homeIsUser = r0 > 0.7;
    this.crowdKind = this.neutral ? ["neutral", "neutral", "neutral", "neutral"]
      : this.homeIsUser ? ["user", "user", "opp", "neutral"] : ["opp", "opp", "user", "neutral"];
    this.weather = { temp: Math.round(14 + Math.random() * 20), wind: Math.random() * 8, windDir: Math.random() * 6.28,
      humidity: Math.random(), cloud: Math.random(), rain: Math.random() * 0.5 };
    if (!o.striker) {
      this.player.end = 1; this.player.z = CREASE[1]; this.player.target = 1; this.player.fromEnd = 1;
      this.partner.end = 0; this.partner.z = CREASE[0]; this.partner.target = 0; this.partner.fromEnd = 0;
    }
    for (let i = 0; i < Math.max(0, o.pos - 2); i++) { this.wkts++; this.runs += 1 + Math.floor(Math.random() * 4); this.legal++; }
    this.legal = Math.min(this.legal, 8);
    if (o.pos >= 8) this.attr = { ...ATTR, technique: 0.55, timing: 0.6 };
    this.say(`Target ${this.target} in 2 overs. ${this.stadium.name}, ${this.umpire.name} umpire.`, 3.5);
    this.deadT = 0.5;
  }

  // ---------- helpers
  get footZ() { return this.player.end === 0 ? this.joy.y * 0.7 : 0; }
  get batX() { return this.player.end === 0 ? this.joy.x * 0.5 : 0; }
  get ritualDown() { return this.phase === "runup" && this.runT < 0.6 && this.playerStriker; }
  get playerStriker() { return this.player.end === 0; }
  get swingProgress() { return this.swing ? clamp((this.simT - this.swing.t0) / 0.3, 0, 1) : 0; }
  private say(t: string, secs = 2.2) { this.msg = t; this.msgT = secs; }
  private comment(kind: string) {
    let l = pick(COMM[kind]); if (l === this.lastComm) l = pick(COMM[kind]);
    this.lastComm = l; this.comm = l; this.commT = 3;
  }
  private strikerBatter() { return this.batters.find((b) => b.end === 0) || this.player; }
  private sigma() {
    return (0.018 + 0.03 * this.pressure + 0.03 * this.fatigue + (this.delivery.speed - 28) * 0.0015 + 0.01 * this.injury) * (1.4 - this.attr.timing * 0.7);
  }
  private launch(b: Ball, th: number, sp: number, el: number) {
    const t = rad(th), e = rad(el);
    b.v = { x: Math.sin(t) * Math.cos(e) * sp, y: Math.sin(e) * sp, z: -Math.cos(t) * Math.cos(e) * sp };
    b.hit = true; b.grounded = false; b.p.y = Math.max(b.p.y, 0.25);
  }
  private timeScale() {
    const b = this.ball;
    if (!b || this.crossed || !this.playerStriker) return 1;
    const w = clamp(1 - 0.55 * this.pressure - 0.45 * this.fatigue, 0.2, 1);
    return 1 - 0.78 * w * clamp((b.p.z + 6.5) / 2.5, 0, 1);
  }

  // ---------- input
  onSwipe(dx: number, dy: number, circular: boolean) {
    if (this.phase === "bowl" && this.playerStriker && !this.crossed && !this.swing) {
      const a = (Math.atan2(dx, -dy) * 180) / Math.PI, aa = Math.abs(a), len = Math.hypot(dx, dy);
      if (len < 30) return;
      let s: string;
      if (aa < 22) s = len > 170 ? "lofted" : "straight";
      else if (aa < 68) s = a > 0 ? "cover" : "flick";
      else if (aa < 112) s = a > 0 ? "cut" : "pull";
      else s = a > 0 ? "hook" : "sweep";
      this.swing = { shot: s, t0: this.simT };
    } else if (this.phase === "bowl" && this.crossed && this.stumpsChecked && this.ball && !this.ball.hit && !this.wicketKind && dy < -30 && !circular) {
      this.ball.hit = true; this.legBye = true; this.phase = "live"; this.planFielders(); this.startRun(); this.say("Byes!", 1);
    } else if (this.phase === "live" || this.phase === "throw") {
      if (circular) { if (this.player.running) this.player.dive = true; return; }
      if (dy < -30 && Math.abs(dx) < Math.abs(dy) * 1.5) this.startRun();
      else if (dy > 30) this.turnBack();
    }
  }
  onButton(k: "defend" | "leave" | "review" | "retire") {
    if (k === "review") return this.review();
    if (k === "retire") {
      if ((this.phase === "runup" || this.phase === "dead") && !this.playerOut) {
        this.wicketKind = "Retired out"; this.wicketVictim = this.player; this.playerOut = true; this.wkts++;
        this.say("RETIRED OUT", 2); this.phase = "dead"; this.deadT = 1.5;
      }
      return;
    }
    if (this.phase === "live" && this.ball && this.ball.hit && this.playerStriker && !this.controlled && !this.player.running
      && Math.hypot(this.ball.p.x - this.batX, this.ball.p.z - this.footZ) < 2 && speedOf(this.ball) < 6) {
      this.dismiss("Hit the ball twice", this.player); this.deadBall(); return;
    }
    if (this.phase === "bowl" && this.playerStriker && !this.crossed && !this.swing)
      this.swing = { shot: k === "defend" ? "defend" : "leave", t0: this.simT };
  }

  // ---------- running
  private startRun() {
    const p = this.player;
    if (p.running || this.controlled || this.wicketKind) return;
    p.fromEnd = p.end; p.target = (1 - p.end) as 0 | 1; p.running = true; p.v = 0; p.delay = 0.05; p.dive = false;
    if (!this.partner.running) {
      const safe = this.runSafety(), q = clamp(0.2 + safe * 0.85, 0.05, 0.97);
      if (Math.random() < q) {
        this.beginRun(this.partner, 0.2 + (Math.random() < 0.08 + 0.22 * this.pressure ? 0.9 : 0));
        this.gesture = "Partner: 👍 Yes!";
      } else this.gesture = "Partner: 👎 No!";
      this.gestureT = 1.5;
    }
  }
  private beginRun(b: Batter, delay: number) {
    b.fromEnd = b.end; b.target = (1 - b.end) as 0 | 1; b.running = true; b.v = 0; b.delay = delay; b.dive = false;
  }
  private turnBack() {
    const p = this.player;
    if (!p.running) return;
    if (this.phase === "throw" && this.throwData && this.throwData.E === p.fromEnd && Math.random() < 0.35) {
      this.dismiss("Obstructing the field", p); this.deadBall(); return;
    }
    p.target = p.fromEnd; p.v = 0; p.delay = 0.2 * (1 + this.fatigue);
    const q = this.partner;
    if (q.running && Math.random() < 0.7 - 0.2 * this.pressure) { q.target = q.fromEnd; q.v = 0; q.delay = 0.3; }
  }
  private runSafety() {
    const eta = Math.min(this.chaserEta, 6);
    return clamp(0.5 + (eta + 1.3 - 2.9) / 2.5, 0, 1);
  }
  private moveBatters(dt: number) {
    for (const r of this.batters) {
      if (!r.running) continue;
      if (r.isPlayer && r.dive) this.dived = true;
      if (r.delay > 0) { r.delay -= dt; continue; }
      const tz = CREASE[r.target], dir = Math.sign(tz - r.z);
      const top = r.isPlayer ? (6.4 + 1.6 * this.attr.running) * (1 - 0.3 * this.fatigue) * (1 - 0.15 * this.injury) : 7;
      r.v = Math.min(top, r.v + 6 * dt);
      const step = Math.min(r.v * dt, Math.abs(tz - r.z));
      r.z += dir * step;
      if (Math.abs(tz - r.z) < 1e-4) { r.z = tz; r.running = false; r.end = r.target; r.v = 0; r.dive = false; this.onArrive(); }
    }
  }
  private onArrive() {
    if (this.batters.some((b) => b.running)) return;
    const [a, b] = this.batters, s = this.startEnds;
    if (a.end !== s[0] && b.end !== s[1]) { this.runsThisBall++; this.startEnds = [a.end, b.end]; }
  }

  // ---------- delivery flow
  private makeDelivery(): Delivery {
    const kinds = [{ k: "yorker", z: -1.8 }, { k: "full", z: -3.8 }, { k: "good", z: -6 }, { k: "short", z: -8.8 }];
    const k = pick(kinds);
    const wide = Math.random() < 0.06;
    return {
      kind: k.k, speed: 28 + Math.random() * 10, releaseX: -0.4, releaseY: 2.1,
      bounceX: wide ? 1.1 + Math.random() * 0.3 : -0.3 + Math.random() * 0.7,
      bounceZ: k.z + (Math.random() - 0.5) * 0.6, swing: (Math.random() - 0.5) * 2.5, spin: (Math.random() - 0.5) * 1.6,
    };
  }
  private startDelivery() {
    this.phase = "runup"; this.runT = 0; this.ball = null; this.swing = null; this.crossed = false; this.stumpsChecked = false;
    this.runsThisBall = 0; this.overthrow = 0; this.controlled = false; this.legBye = false; this.partnerCall = "";
    this.wicketKind = ""; this.wicketVictim = null; this.thrower = null; this.throwData = null; this.lookBack = false;
    this.delivery = this.makeDelivery(); this.driftWeather();
    this.delivery.swing = this.delivery.swing * (0.5 + this.weather.humidity * 0.6 + this.weather.cloud * 0.5) + this.weather.wind * Math.sin(this.weather.windDir) * 0.12;
    this.deliveryId++; this.ghost = predictPath(this.delivery);
    this.noBall = Math.random() < 0.04;
    this.startEnds = [this.batters[0].end, this.batters[1].end];
    for (const f of this.fielders) { f.x = f.hx; f.z = f.hz; f.tx = f.hx; f.tz = f.hz; f.hasBall = false; f.tried = false; f.wait = 0; }
    for (const b of this.batters) { b.z = CREASE[b.end]; b.running = false; b.dive = false; }
    const need = this.target - this.runs, left = Math.max(1, 12 - this.legal);
    const goal = clamp(0.12 + 0.09 * (need / left) + 0.03 * this.wkts + this.pBias + this.crowdP(), 0, 1) * (1.25 - 0.5 * this.attr.composure);
    this.pressure += (goal - this.pressure) * 0.6;
  }

  update(real: number) {
    let dt = real;
    if (this.phase === "bowl") dt *= this.timeScale();
    this.slow = dt / real;
    this.celebT = Math.max(0, this.celebT - real);
    for (let i = 0; i < 4; i++) this.mood[i] *= 1 - 0.3 * real;
    this.msgT -= real; if (this.msgT <= 0) this.msg = "";
    this.commT -= real; if (this.commT <= 0) this.comm = "";
    this.gestureT -= real; if (this.gestureT <= 0) this.gesture = "";
    this.fbT -= real; if (this.fbT <= 0) this.feedback = "";
    if (this.phase === "end") return;

    // fatigue
    const pr = this.player.running;
    if (pr) this.fatigue += 0.028 * (1.3 - this.attr.stamina * 0.6) * dt;
    else this.fatigue -= (this.player.end === 1 ? 0.012 : 0.006) * dt * (this.phase === "runup" || this.phase === "dead" ? 1 : 0.2);
    this.fatigue = clamp(this.fatigue + 0.001 * dt, 0, 1);

    this.moveBatters(dt);
    this.moveFielders(dt);

    switch (this.phase) {
      case "dead":
        this.deadT += dt;
        if (this.deadT > 2) this.nextBall();
        break;
      case "runup": {
        this.runT += dt;
        const f = this.fielders.find((q) => q.bowler)!;
        this.bowlerZ = -28 + 9.6 * clamp(this.runT / 1.4, 0, 1); f.z = this.bowlerZ; f.x = -0.6;
        if (this.runT >= 1.4) {
          this.ball = createBall(this.delivery); this.phase = "bowl"; this.simT = 0; this.acc = 0;
          if (this.noBall) this.say("NO BALL!", 1.5);
        }
        break;
      }
      case "bowl": case "live": this.stepPhysics(dt); this.liveChecks(dt); break;
      case "throw": this.throwTick(dt); break;
      case "decision":
        this.decisionT -= dt;
        if (this.decisionT <= 0) { this.dismiss("LBW", this.wicketVictim || this.player); this.deadBall(); }
        break;
    }
  }

  private stepPhysics(dt: number) {
    this.acc += dt; let n = 0;
    while (this.acc >= DT && n++ < 400) {
      this.acc -= DT; this.simT += DT;
      const b = this.ball; if (!b) return;
      const prevZ = b.p.z;
      const held = this.fielders.find((f) => f.hasBall);
      if (held) { b.p.x = held.x; b.p.z = held.z; b.p.y = 1; b.v = { x: 0, y: 0, z: 0 }; }
      else stepBall(b);
      if (this.phase === "bowl") this.bowlTick(prevZ); else if (this.phase === "live") this.liveTick();
      if (this.phase !== "bowl" && this.phase !== "live") return;
    }
  }

  private bowlTick(prevZ: number) {
    const b = this.ball!, plane = this.footZ - 0.5;
    if (!this.crossed && prevZ < plane && b.p.z >= plane) { this.crossed = true; this.atBat(); return; }
    if (this.crossed && !b.hit && this.phase === "bowl") {
      if (!this.stumpsChecked && b.p.z >= STRIKER_STUMPS_Z) {
        this.stumpsChecked = true;
        if (Math.abs(b.p.x) < 0.12 && b.p.y < 0.72) {
          this.dismiss("Bowled", this.strikerBatter()); this.lookBack = this.wicketKind !== "";
          if (this.noBall) this.say("No ball! Not out.");
          this.deadBall();
        }
      }
      if (this.phase === "bowl" && b.p.z > 13) {
        if (this.playerStriker && this.swing && this.swing.shot !== "leave" && this.footZ < -0.5 && Math.random() < 0.7) {
          this.dismiss("Stumped", this.player); this.lookBack = this.wicketKind !== "";
        }
        this.deadBall();
      }
    }
  }

  // ---------- bat and ball
  private atBat() {
    const b = this.ball!, pStr = this.playerStriker, batX = this.batX, footZ = this.footZ;
    let hit = false;
    if (pStr) {
      const sw = this.swing;
      if (sw && sw.shot !== "leave") {
        if (footZ > 0.6 && Math.random() < 0.3) {
          this.dismiss("Hit wicket", this.player); this.lookBack = this.wicketKind !== "";
          if (this.wicketKind) { this.deadBall(); return; }
        }
        const s = SHOTS[sw.shot];
        const footQ = clamp(1 - (Math.abs(footZ - s.foot) / 0.9) * (1.4 - this.attr.footwork * 0.6), 0, 1);
        const err = this.simT - (sw.t0 + 0.17) + gauss() * this.sigma();
        hit = this.contact(s, b.p.x - (batX + s.lat), b.p.y - s.h, footQ, err);
        if (!hit) { this.feedback = "Missed!"; this.fbT = 1.5; }
      } else if (sw) { this.feedback = "Left alone"; this.fbT = 1.2; }
    } else {
      const z = this.delivery.bounceZ;
      const opts = z > -3 ? ["straight", "cover", "lofted"] : z > -5.5 ? ["cover", "flick", "straight"]
        : z > -7.5 ? ["defend", "flick", "cut"] : ["pull", "cut", "hook"];
      const s = SHOTS[pick(opts)];
      hit = this.contact(s, (b.p.x - s.lat) * 0.4 + gauss() * 0.1, (b.p.y - s.h) * 0.5 + gauss() * 0.1, 0.75, gauss() * (this.sigma() + 0.02));
    }
    if (hit) return;
    if (Math.abs(b.p.x) > this.umpire.wide) { // wide
      this.runs += 1; this.say("WIDE!", 1.4); this.phase = "dead"; this.deadT = 1.2; return;
    }
    if (Math.abs(b.p.x - batX) < 0.25 && b.p.y < 0.55) { // pad
      const sim: Ball = { p: { ...b.p }, v: { ...b.v }, bounced: b.bounced, hit: false, grounded: false, swing: b.swing, spin: 0 };
      for (let i = 0; i < 800 && sim.p.z < STRIKER_STUMPS_Z; i++) stepBall(sim);
      const truth = Math.abs(sim.p.x) < 0.13 && sim.p.y < 0.74;
      const out = truth !== (Math.random() < this.umpire.err);
      if (out) {
        const v = this.strikerBatter();
        this.lbwTruth = truth; this.wicketVictim = v;
        if (v.isPlayer && this.reviewsLeft > 0) {
          this.phase = "decision"; this.decisionT = 3.5; this.say("OUT! LBW. Tap REVIEW?", 3.5); this.lookBack = true;
        } else { this.dismiss("LBW", v); this.deadBall(); }
        return;
      }
      this.launch(b, -30 + gauss() * 30, 2.5 + Math.random() * 3, 2); this.legBye = true; this.afterHit();
    }
  }

  private contact(s: Shot, dx: number, dy: number, footQ: number, err: number): boolean {
    const b = this.ball!;
    if (Math.abs(err) > 0.16 || Math.abs(dx) > 0.42 || Math.abs(dy) > 0.8) return false;
    const q = clamp(1 - Math.abs(dx) / 0.5 - Math.abs(dy) / 1.2 - (1 - footQ) * 0.5 - Math.abs(err) / 0.3, 0, 1);
    const timing = Math.abs(err) < 0.035 ? "Perfect" : err > 0 ? "Early" : "Late";
    let kind = "clean";
    if (Math.abs(dy) > 0.45) kind = dy > 0 ? "top" : "bottom"; else if (Math.abs(dx) > 0.2) kind = dx > 0 ? "outer" : "inner";
    let th = s.angle - err * 140 + dx * 30;
    let sp = s.base * (0.25 + 0.75 * q) * (0.55 + 0.6 * this.attr.power), el = s.elev + (1 - q) * 14;
    if (kind === "outer") { th = 150; sp = 10 + 8 * q; el = 10; }
    else if (kind === "inner") {
      if (Math.abs(dx) < 0.3 && Math.random() < 0.3) {
        this.launch(b, -170, 3, 2); this.dismiss("Bowled (inside edge)", this.strikerBatter()); this.lookBack = this.wicketKind !== ""; this.deadBall(); return true;
      }
      th = -160; sp = 9 + 6 * q; el = 4;
    } else if (kind === "top") { th = 170; sp = 9; el = 60; }
    else if (kind === "bottom") { th = s.angle; sp = 6 + 6 * q; el = 0; }
    this.launch(b, th, sp, el); this.onSound?.("bat", sp);
    if (this.playerStriker) {
      this.feedback = `${s.name}: ${timing}${kind !== "clean" ? " (" + kind + " edge)" : q > 0.75 ? " - middled!" : ""}`; this.fbT = 2;
    }
    this.afterHit();
    return true;
  }

  private afterHit() {
    this.phase = "live"; this.planFielders();
    if (!this.playerStriker) { // AI striker calls
      let go = this.runSafety() > 0.45;
      if (Math.random() < 0.08 + 0.18 * this.pressure) go = !go;
      const sp = speedOf(this.ball!);
      if (sp > 18) go = false;
      if (go) { this.beginRun(this.partner, 0.1); this.gesture = "Partner: 👍 YES, come!"; this.partnerCall = "go"; }
      else { this.gesture = "Partner: ✋ No! Stay!"; this.partnerCall = "no"; }
      this.gestureT = 1.8;
    }
  }

  private planFielders() {
    const b = this.ball!;
    const sim: Ball = { p: { ...b.p }, v: { ...b.v }, bounced: b.bounced, hit: true, grounded: b.grounded, swing: 0, spin: 0 };
    const path: { t: number; x: number; y: number; z: number }[] = []; let t = 0;
    for (let i = 0; i < 1700; i++) {
      stepBall(sim); t += DT;
      if (i % 12 === 0) path.push({ t, x: sim.p.x, y: sim.p.y, z: sim.p.z });
      if (Math.hypot(sim.p.x, sim.p.z) > this.stadium.r) break;
    }
    this.chaserEta = 99;
    for (const f of this.fielders) {
      const react = 0.25 + (1 - f.skill) * 0.25; let found = false;
      for (const s of path) {
        const need = react + Math.hypot(s.x - f.x, s.z - f.z) / f.speed;
        if (need <= s.t && s.y < 2.3) { f.tx = s.x; f.tz = s.z; f.eta = s.t; this.chaserEta = Math.min(this.chaserEta, s.t); found = true; break; }
      }
      if (!found) { const s = path[path.length - 1]; f.tx = s.x; f.tz = s.z; f.eta = 99; }
    }
  }

  private moveFielders(dt: number) {
    if (this.phase !== "live" && this.phase !== "throw") return;
    for (const f of this.fielders) {
      if (f.hasBall) continue;
      if (f.wait > 0) { f.wait -= dt; continue; }
      const dx = f.tx - f.x, dz = f.tz - f.z, d = Math.hypot(dx, dz);
      if (d > 0.05) { const s = Math.min(d, f.speed * dt); f.x += (dx / d) * s; f.z += (dz / d) * s; }
    }
  }

  private liveTick() {
    const b = this.ball!;
    if (!b.hit) return;
    // boundary
    if (Math.hypot(b.p.x, b.p.z) >= this.stadium.r) {
      const six = !b.grounded; b.v = { x: 0, y: 0, z: 0 };
      this.say(six ? "SIX!" : "FOUR!", 2); this.comment(six ? "six" : "four"); this.pBias = Math.max(-0.2, this.pBias - 0.06);
      this.deadBall(six ? 6 : 4); return;
    }
    if (this.thrower && this.holdT > 0) { this.holdT -= DT; if (this.holdT <= 0) { this.holdT = 0; this.decideThrow(this.thrower); } return; }
    if (this.controlled) return;
    for (const f of this.fielders) {
      if (f.hasBall || f.wait > 0) continue;
      const d = Math.hypot(f.x - b.p.x, f.z - b.p.z);
      if (!b.grounded && !f.tried && d < 0.8 && b.p.y > 0.25 && b.p.y < 2.4) { // catch attempt
        f.tried = true;
        const p = clamp(0.45 + 0.55 * f.skill - speedOf(b) / 80 - 0.1 * this.pressure + (f.keeper ? 0.2 : 0), 0.15, 0.97);
        if (Math.random() < p) {
          f.hasBall = true; this.controlled = true;
          if (this.noBall || this.legBye) { this.say("Caught, but it's a no-ball!"); this.deadBall(); }
          else { this.dismiss("Caught", this.strikerBatter()); this.deadBall(); }
          return;
        }
        this.say("DROPPED!", 1.5); this.comment("drop"); f.skill *= 0.9; this.crowdEvent(false); this.pBias = Math.max(-0.2, this.pBias - 0.03);
      }
      if (d < 0.7 && b.p.y < 0.5 && (b.grounded || b.bounced)) { // ground pickup
        if (Math.random() < (1 - f.skill) * 0.3 + 0.05 * this.pressure && speedOf(b) > 3) {
          b.v.x *= 0.3; b.v.z *= 0.3; f.wait = 0.5; this.say("Fumble!", 1.2); return;
        }
        if (speedOf(b) > 14 && Math.random() < 0.04) this.injureFielder(f);
        f.hasBall = true; this.thrower = f; this.holdT = 0.35; return;
      }
    }
  }

  private liveChecks(dt: number) {
    if (this.phase !== "live") return;
    if (this.controlled && this.holdT <= 0 && !this.batters.some((b) => b.running)) {
      this.idleHold += dt; if (this.idleHold > 0.5) { this.idleHold = 0; this.deadBall(); }
    } else this.idleHold = 0;
  }

  private decideThrow(f: Fielder) {
    const run = this.batters.filter((b) => b.running);
    let best: 0 | 1 | -1 = -1, bs = 1e9, bd = 0, bT = 0;
    for (const E of [0, 1] as const) {
      const r = run.find((b) => b.target === E); if (!r) continue;
      const sz = E === 0 ? STRIKER_STUMPS_Z : BOWLER_STUMPS_Z, dist = Math.hypot(f.x, f.z - sz);
      const T = dist / (24 + 10 * f.skill) + 0.2, tr = Math.abs(r.z - CREASE[E]) / Math.max(r.v, 6);
      if (tr - T < bs) { bs = tr - T; best = E; bd = dist; bT = T; }
    }
    this.controlled = true;
    if (best < 0) return;
    const acc = clamp(0.5 + 0.45 * f.skill - 0.25 * this.pressure - bd / 200, 0.15, 0.97);
    const E = best as 0 | 1;
    this.throwData = { E, sx: 0, sz: E === 0 ? STRIKER_STUMPS_Z : BOWLER_STUMPS_Z, t: 0, T: bT, fx: f.x, fz: f.z, hit: Math.random() < acc };
    f.hasBall = false; this.phase = "throw";
  }

  private throwTick(dt: number) {
    const td = this.throwData!, b = this.ball!;
    td.t += dt;
    const k = clamp(td.t / td.T, 0, 1);
    b.p.x = td.fx * (1 - k); b.p.z = td.fz + (td.sz - td.fz) * k; b.p.y = 1.4 - 1.1 * k + Math.sin(k * Math.PI) * 1.5;
    for (const r of this.batters) { // auto-dive when a throw is about to arrive
      if (r.running && r.target === td.E && !r.dive && Math.abs(r.z - CREASE[td.E]) < 2.5 && td.T - td.t < 0.8) r.dive = true;
    }
    if (td.t < td.T) return;
    this.phase = "live";
    const E = td.E;
    if (!td.hit) { this.say("Wild throw!", 1.2); if (Math.random() < 0.4) { this.overthrow++; this.say("Overthrow!"); } return; }
    const inside = (b2: Batter) => Math.abs(b2.z - CREASE[E]) <= (b2.dive ? 1.0 : 0.12);
    let victim: Batter | null = null, margin = 9;
    for (const r of this.batters) {
      const idx = this.batters.indexOf(r), heading = (r.running && r.target === E);
      if (heading && !inside(r)) victim = r;
      else if (heading) margin = Math.min(margin, 0.5);
      else if (!r.running && r.end === E) {
        const other = this.batters.find((o) => o !== r)!;
        if (other.end === E && !other.running && this.startEnds[idx] !== E) victim = r; // same end: the arriver is out
      }
    }
    if (victim && !this.wicketKind) { this.dismiss("Run out", victim); this.comment("wicket"); this.deadBall(); }
    else { this.say("Safe!", 1.2); if (margin < 1) this.comment("close"); }
  }

  // ---------- results of the ball
  private dismiss(kind: string, victim: Batter) {
    if (this.noBall && kind !== "Run out" && kind !== "Obstructing the field") { this.say("No ball: NOT OUT!"); this.wicketKind = ""; return; }
    this.wicketKind = kind; this.wicketVictim = victim;
    if (/Bowled|LBW|Hit wicket/.test(kind)) this.onSound?.("stump");
    this.say(`OUT! ${kind}`, 3); this.comment("wicket");
  }
  private review() {
    if (this.phase !== "decision") return;
    this.reviewsLeft--;
    if (this.lbwTruth) { this.say("Review: hitting stumps. OUT.", 3); this.dismiss("LBW", this.wicketVictim || this.player); }
    else { this.reviewsLeft++; this.say("Review: missing. NOT OUT!", 3); this.wicketKind = ""; this.lookBack = false; }
    this.deadBall();
  }
  private deadBall(boundary = 0) {
    if (this.phase === "dead" || this.phase === "end") return;
    if (!this.wicketKind && this.batters[0].end === this.batters[1].end) {
      const v = this.batters.find((b, i) => b.end !== this.startEnds[i]);
      if (v) { this.dismiss("Run out", v); }
    }
    let r = boundary || this.runsThisBall + this.overthrow;
    if (this.wicketKind === "Caught" || this.wicketKind === "Bowled" || this.wicketKind === "LBW" || this.wicketKind.startsWith("Bowled")) r = 0;
    this.runs += r + (this.noBall ? 1 : 0);
    if (!this.noBall) this.legal++;
    if (this.wicketKind && this.wicketKind !== "Retired hurt") {
      this.wkts++; this.pBias = Math.min(0.2, this.pBias + 0.05);
      if (this.wicketVictim && this.wicketVictim.isPlayer) this.playerOut = true;
    } else if (r === 0) this.pBias = Math.min(0.2, this.pBias + 0.03);
    if (!this.wicketKind && !boundary) this.say(r === 0 ? "Dot ball" : `${r} run${r > 1 ? "s" : ""}`, 1.6);
    if (!this.wicketKind && this.legal > 0 && this.legal % 6 === 0 && !this.noBall) for (const b of this.batters) b.end = (1 - b.end) as 0 | 1;
    this.afterBall(r, boundary); this.phase = "dead"; this.deadT = 0; this.thrower = null; this.throwData = null;
  }
  private nextBall() {
    if (this.runs >= this.target) return this.finish(`YOU WIN by ${Math.max(1, 10 - this.wkts)} wickets!`);
    if (this.playerOut) {
      let balls = 12 - this.legal;
      while (balls-- > 0 && this.runs < this.target && this.wkts < 10) {
        const r = Math.random();
        if (r < 0.1) this.wkts++; else if (r < 0.38) { } else if (r < 0.66) this.runs += 1; else if (r < 0.74) this.runs += 2; else if (r < 0.9) this.runs += 4; else this.runs += 6;
      }
      if (this.runs >= this.target) return this.finish(`Out ${this.wicketKind}, but your team still won!`);
      return this.finish(`Out ${this.wicketKind}. Lost by ${this.target - 1 - this.runs} runs.`);
    }
    if (this.legal >= 12 || this.wkts >= 10)
      return this.finish(this.runs === this.target - 1 ? "TIE!" : `Lost by ${this.target - 1 - this.runs} runs.`);
    this.startDelivery();
  }
  private finish(t: string) { this.result = t; this.phase = "end"; }

  private crowdP() {
    const base = this.neutral ? 0.02 : this.homeIsUser ? -0.03 : 0.07;
    return 0.05 + base + 0.04 * Math.max(...this.mood.map(Math.abs));
  }
  crowdEvent(good: boolean) {
    for (let i = 0; i < 4; i++) {
      const k = this.crowdKind[i];
      const d = k === "user" ? (good ? 0.6 : -0.5) : k === "opp" ? (good ? -0.4 : 0.6) : 0.3;
      this.mood[i] = clamp(this.mood[i] + d, -1, 1);
    }
  }
  get crowdLevel() { return clamp(0.25 + 0.6 * (this.mood.reduce((a, m) => a + Math.abs(m), 0) / 4), 0, 1); }
  private driftWeather() {
    const w = this.weather;
    w.cloud = clamp(w.cloud + gauss() * 0.04, 0, 1); w.humidity = clamp(w.humidity + gauss() * 0.03, 0, 1);
    w.wind = clamp(w.wind + gauss() * 0.5, 0, 12); w.windDir += gauss() * 0.1; w.rain = clamp(w.rain + gauss() * 0.04, 0, 1);
    this.raining = w.cloud > 0.6 && w.rain > 0.55;
    ENV.bounce = this.stadium.bounce * (this.raining ? 0.92 : 1);
  }
  private speak(t: string) { this.comm = t; this.commT = 3; this.onSpeak?.(t); }
  private injureFielder(f: Fielder) {
    f.speed *= 0.85; this.say("Fielder hurt! Physio on.", 2.5);
    if (Math.random() < 0.5) { f.skill = 0.5; f.speed = 6.8; this.say("Substitute fielder on.", 2.5); }
  }
  private afterBall(r: number, boundary: number) {
    if (this.wicketKind) {
      this.crowdEvent(false); this.celebT = 2.5; this.onSound?.("groan"); this.boundStreak = 0; this.dotStreak = 0;
      if (this.wicketVictim && !this.wicketVictim.isPlayer && Math.random() < 0.015) { this.wkts++; this.say("TIMED OUT! Next batter was late.", 3); }
    } else if (boundary) {
      this.boundStreak++; this.dotStreak = 0; this.crowdEvent(true); this.onSound?.("cheer");
      if (this.boundStreak >= 2) this.speak("Back-to-back boundaries! The momentum has swung.");
    } else if (r === 0) {
      this.dotStreak++; this.boundStreak = 0;
      if (this.dotStreak >= 3) this.speak(`${this.dotStreak} dot balls in a row. The pressure is building.`);
    } else { this.dotStreak = 0; this.boundStreak = 0; if (r >= 2) { this.crowdEvent(true); this.onSound?.("cheer"); } }
    if (!this.wicketKind && Math.abs(this.delivery.swing) > 1.6 && Math.random() < 0.3) this.speak("That one swung late in the air.");
    if (this.dived && !this.wicketKind && Math.random() < 0.07 + 0.1 * this.fatigue) {
      const sev = 1 + Math.floor(Math.random() * 3);
      this.injury = Math.max(this.injury, sev); this.say(`Injury! Physio on (grade ${sev})`, 3);
      if (sev === 3) { this.wicketKind = "Retired hurt"; this.wicketVictim = this.player; this.playerOut = true; }
    }
    this.dived = false;
  }
  get infoText() {
    const w = this.weather;
    return `${this.stadium.name} · ${w.temp}°C · wind ${w.wind.toFixed(0)} · ${this.raining ? "RAIN" : w.cloud > 0.6 ? "overcast" : "clear"} · ${this.umpire.name} umpire`;
  }
  get scoreText() {
    return `${this.runs}/${this.wkts}  (${Math.floor(this.legal / 6)}.${this.legal % 6})  Target ${this.target}  Need ${Math.max(0, this.target - this.runs)} off ${12 - this.legal}`;
  }
}
