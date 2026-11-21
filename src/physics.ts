// Units: metres, seconds. Striker faces -z. +x = off side (right-hander). +y up.
export const G = 9.81;
export const STRIKER_STUMPS_Z = 0.9;
export const BOWLER_STUMPS_Z = -19.22;
export const CREASE = [0, -18] as const; // [striker end, bowler end]
export const RELEASE_Z = -17.8;
export const BALL_R = 0.036;
export const DT = 1 / 240;
export const BOUNDARY_R = 65;
export const ENV = { bounce: 0.6, roll: 1.4 }; // set per stadium / weather

export interface V3 { x: number; y: number; z: number }
export interface Delivery {
  speed: number; releaseX: number; releaseY: number;
  bounceX: number; bounceZ: number; swing: number; spin: number; kind: string;
}
export interface Ball {
  p: V3; v: V3; bounced: boolean; hit: boolean; grounded: boolean; swing: number; spin: number;
}

export function createBall(d: Delivery): Ball {
  const sx = d.releaseX, sy = d.releaseY;
  const dx = d.bounceX - sx, dz = d.bounceZ - RELEASE_Z;
  const dist = Math.hypot(dx, dz), t = dist / d.speed;
  const vy = (0.5 * G * t * t - sy + BALL_R) / t;
  return {
    p: { x: sx, y: sy, z: RELEASE_Z },
    v: { x: (dx / dist) * d.speed, y: vy, z: (dz / dist) * d.speed },
    bounced: false, hit: false, grounded: false, swing: d.swing, spin: d.spin,
  };
}

export function stepBall(b: Ball, dt: number = DT): void {
  if (!b.hit && !b.bounced) b.v.x += b.swing * dt;
  if (b.hit) { const k = 1 - 0.05 * dt; b.v.x *= k; b.v.y *= k; b.v.z *= k; }
  b.v.y -= G * dt;
  b.p.x += b.v.x * dt; b.p.y += b.v.y * dt; b.p.z += b.v.z * dt;
  if (b.p.y <= BALL_R && b.v.y < 0) {
    b.p.y = BALL_R;
    if (!b.hit && !b.bounced) { // pitch: bounce, seam/spin turn
      b.v.y = -b.v.y * ENV.bounce; b.v.z *= 0.82; b.v.x = b.v.x * 0.82 + b.spin;
    } else {
      if (b.hit) b.grounded = true;
      b.v.y = Math.abs(b.v.y) < 1.2 ? 0 : -b.v.y * 0.42;
      b.v.x *= 0.9; b.v.z *= 0.9;
    }
    b.bounced = true;
  }
  if (b.p.y <= BALL_R + 1e-3 && b.v.y === 0) { // rolling friction
    const s = Math.hypot(b.v.x, b.v.z);
    if (s > 0) { const n = Math.max(0, s - ENV.roll * dt); b.v.x *= n / s; b.v.z *= n / s; }
  }
}

export function speedOf(b: Ball): number { return Math.hypot(b.v.x, b.v.y, b.v.z); }

/** Ghost path: an estimate that ignores post-pitch spin turn, so it can be wrong. */
export function predictPath(d: Delivery): V3[] {
  const b = createBall({ ...d, spin: 0 });
  const pts: V3[] = [];
  for (let i = 0; i < 400 && b.p.z < 0; i++) {
    stepBall(b);
    if (i % 6 === 0) pts.push({ ...b.p });
  }
  return pts;
}
