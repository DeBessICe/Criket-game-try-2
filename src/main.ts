import * as THREE from "three";
import { Game, SHOTS, STADIUMS, TEAMS } from "./game";
import { setupInput } from "./input";
import { AudioFX } from "./audio";
import { BOWLER_STUMPS_Z, STRIKER_STUMPS_Z } from "./physics";

const $ = (id: string) => document.getElementById(id)!;
const posSel = $("mPos") as HTMLSelectElement;
for (let i = 1; i <= 11; i++) posSel.add(new Option(String(i), String(i)));
$("mGo").addEventListener("click", () => {
  const o = { team: +(($("mTeam") as HTMLSelectElement).value), pos: +posSel.value,
    striker: (($("mRole") as HTMLSelectElement).value) === "1", stadium: +(($("mStad") as HTMLSelectElement).value) };
  $("menu").style.display = "none"; fx.init(); start(o);
});
const fx = new AudioFX();

function start(o: { team: number; pos: number; striker: boolean; stadium: number }) {
  const game = new Game(o), st = game.stadium;
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.setSize(innerWidth, innerHeight);
  document.body.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const sky = new THREE.Color(st.sky); scene.background = sky.clone(); scene.fog = new THREE.Fog(st.sky, 60, 220);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x3a6b35, st.night ? 0.45 : 1.1); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, st.night ? 0.2 : 1.2); sun.position.set(10, 20, 5); scene.add(sun);
  if (st.night) for (const [x, z] of [[-50, -50], [50, -50], [-50, 50], [50, 50]]) { const l = new THREE.PointLight(0xfff5d0, 1.6, 220); l.position.set(x, 35, z); scene.add(l); }
  const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.05, 400);
  const mat = (c: number) => new THREE.MeshStandardMaterial({ color: c });

  const field = new THREE.Mesh(new THREE.PlaneGeometry(500, 500), mat(st.grass)); field.rotation.x = -Math.PI / 2; scene.add(field);
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(3.05, 24), mat(0xc9b27c)); pitch.rotation.x = -Math.PI / 2; pitch.position.set(0, 0.01, -9); scene.add(pitch);
  const rope = new THREE.Mesh(new THREE.RingGeometry(st.r - 0.3, st.r, 96), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
  rope.rotation.x = -Math.PI / 2; rope.position.y = 0.02; scene.add(rope);

  // stands + crowd (one quarter per crowd section)
  const colFor = (k: string) => k === "user" ? TEAMS[game.team].c : k === "opp" ? TEAMS[game.oppTeam].c : 0x888888;
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(st.r + 16, st.r + 4, 8, 16, 1, true, i * Math.PI / 2, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x555a66, side: THREE.DoubleSide })); m.position.y = 4; scene.add(m);
  }
  const N = Math.round(st.cap * 1800), pos = new Float32Array(N * 3), col = new Float32Array(N * 3), sec = new Uint8Array(N), ph = new Float32Array(N), by = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const s = Math.floor(Math.random() * 4); sec[i] = s;
    const a = s * Math.PI / 2 + Math.random() * Math.PI / 2, u = Math.random(), r = st.r + 4.3 + u * 11, y = 0.5 + u * 7;
    pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = y; pos[i * 3 + 2] = Math.sin(a) * r; by[i] = y; ph[i] = Math.random() * 6.28;
    const c = new THREE.Color(Math.random() < 0.7 ? colFor(game.crowdKind[s]) : 0xdddddd); col.set([c.r, c.g, c.b], i * 3);
  }
  const cg = new THREE.BufferGeometry(); cg.setAttribute("position", new THREE.BufferAttribute(pos, 3)); cg.setAttribute("color", new THREE.BufferAttribute(col, 3));
  scene.add(new THREE.Points(cg, new THREE.PointsMaterial({ size: 0.9, vertexColors: true })));

  // rain
  const RN = 1500, rp = new Float32Array(RN * 6);
  const rain = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xaaccff, transparent: true, opacity: 0.5 }));
  rain.geometry.setAttribute("position", new THREE.BufferAttribute(rp, 3)); rain.frustumCulled = false; scene.add(rain);
  const drops = Array.from({ length: RN }, () => ({ x: (Math.random() - 0.5) * 30, y: Math.random() * 15, z: (Math.random() - 0.5) * 40 }));

  const bails: THREE.Mesh[] = [];
  for (const z of [STRIKER_STUMPS_Z, BOWLER_STUMPS_Z]) {
    for (const x of [-0.1, 0, 0.1]) { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.71, 8), mat(0xf5f0e0)); s.position.set(x, 0.355, z); scene.add(s); }
    for (const x of [-0.05, 0.05]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 0.02), mat(0xffe08a)); b.position.set(x, 0.72, z); scene.add(b); if (z === STRIKER_STUMPS_Z) bails.push(b); }
  }
  const person = (c: number) => {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.2, 1.1, 10), mat(c)); body.position.y = 0.85;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 10), mat(0xe0b08c)); head.position.y = 1.6;
    g.add(body, head); scene.add(g); return g;
  };
  const oppC = TEAMS[game.oppTeam].c;
  const fMeshes = game.fielders.map((f) => person(f.keeper ? 0xffd23f : oppC));
  const partnerMesh = person(TEAMS[game.team].c);
  const mkUmp = (x: number, z: number) => {
    const u = person(0x222222); u.position.set(x, 0, z);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 0.08), mat(0xe0b08c)); arm.position.set(0.25, 1.3, 0); u.add(arm); return arm;
  };
  const arm1 = mkUmp(1.6, BOWLER_STUMPS_Z - 1); mkUmp(-18, 0);

  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 16), mat(0xb01c1c)); ball.visible = false; scene.add(ball);
  const ghost = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 })); scene.add(ghost);
  const bat = new THREE.Group();
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.8, 0.04), mat(0xe8c98a)); blade.position.y = -0.3;
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), mat(0x222222)); hand.position.y = 0.1;
  bat.add(blade, hand); bat.position.set(0.28, -0.45, -0.6); camera.add(bat); scene.add(camera);

  // sound + commentary hooks
  game.onSound = (k, p) => {
    const b = game.ball;
    if (k === "bat" && b) fx.play("bat", [b.p.x, b.p.y, b.p.z], p);
    else if (k === "stump") fx.play("stump", [0, 0.4, STRIKER_STUMPS_Z]); else fx.play(k);
  };
  game.onSpeak = (t) => { try { if ("speechSynthesis" in window) { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(t); u.volume = 0.7; speechSynthesis.speak(u); } } catch { /* ignore */ } };

  setupInput(game.joy, (dx, dy, c) => { fx.init(); game.onSwipe(dx, dy, c); });
  for (const k of ["defend", "leave", "review", "retire"] as const) $(k).addEventListener("pointerdown", (e) => { e.stopPropagation(); fx.init(); game.onButton(k); });
  $("end").addEventListener("click", () => location.reload());
  addEventListener("resize", () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

  const look = new THREE.Vector3(0, 1.2, -18), fwd = new THREE.Vector3();
  let lastId = -1, last = performance.now(), t = 0, frameN = 0;
  const skyBase = new THREE.Color(st.sky);

  function frame(now: number) {
    const dt = Math.min((now - last) / 1000, 0.05); last = now; t += dt; frameN++;
    game.update(dt);
    const p = game.player, w = game.weather;

    if (game.deliveryId !== lastId) {
      lastId = game.deliveryId;
      ghost.geometry.dispose(); ghost.geometry = new THREE.BufferGeometry().setFromPoints(game.ghost.map((q) => new THREE.Vector3(q.x, q.y, q.z)));
      bails.forEach((b, i) => b.position.set(i ? 0.05 : -0.05, 0.72, STRIKER_STUMPS_Z));
    }
    ghost.visible = game.phase === "bowl" && !!game.ball && game.ball.p.z < -0.5;
    if (game.lookBack && game.phase !== "bowl") bails.forEach((b, i) => { b.position.y = Math.max(0.05, b.position.y - dt * 2); b.position.z += dt * 2; b.position.x += (i ? 1 : -1) * dt * 0.8; });

    // weather
    const dark = st.night ? 1 : 1 - 0.45 * w.cloud;
    (scene.background as THREE.Color).copy(skyBase).multiplyScalar(dark);
    (scene.fog as THREE.Fog).color.copy(scene.background as THREE.Color);
    (scene.fog as THREE.Fog).far = 230 - 110 * (game.raining ? 1 : 0) - 50 * w.cloud;
    rain.visible = game.raining;
    if (game.raining) {
      for (let i = 0; i < RN; i++) {
        const d = drops[i]; d.y -= 14 * dt; if (d.y < 0) d.y = 15;
        rp.set([camera.position.x + d.x, d.y, camera.position.z + d.z, camera.position.x + d.x, d.y - 0.5, camera.position.z + d.z], i * 6);
      }
      (rain.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }

    // crowd jumping
    if (frameN % 3 === 0) {
      for (let i = 0; i < N; i++) { const m = Math.abs(game.mood[sec[i]]); pos[i * 3 + 1] = by[i] + (m > 0.1 ? Math.abs(Math.sin(t * 8 + ph[i])) * 0.6 * m : 0); }
      (cg.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }

    // camera pose
    const bob = Math.sin(t * (1.5 + game.fatigue * 3)) * (0.008 + 0.03 * game.fatigue);
    const cz = p.z + (p.end === 0 && !p.running ? game.footZ : 0);
    const cx = p.running ? 0.4 : p.end === 0 ? game.batX : 1.1;
    camera.position.set(cx, 1.7 + bob - 0.12 * game.injury, cz);
    const facingEnd = p.running ? p.target : p.end === 0 ? 0 : 1;
    const want = new THREE.Vector3(0, 1.2, facingEnd === 0 ? -18 : 2);
    const b = game.ball;
    if (game.ritualDown) want.set(0.2, 0.05, -2.5);
    if (game.lookBack) want.set(0, 0.4, STRIKER_STUMPS_Z);
    else if (b && game.phase !== "runup" && (game.phase !== "bowl" || b.p.z > -12)) want.set(b.p.x, Math.max(b.p.y, 0.3), b.p.z);
    look.lerp(want, 1 - Math.exp(-(game.lookBack ? 4 : 12) * dt));
    camera.lookAt(look);
    fwd.copy(look).sub(camera.position).normalize();
    fx.listener(cx, 1.7, cz, fwd.x, fwd.y, fwd.z);
    fx.setCrowd(game.crowdLevel * st.cap); fx.setRain(game.raining ? 1 : 0); fx.breath(dt, game.fatigue);
    fx.steps(dt, p.running, Math.abs(p.z + 9) < 10);

    const sw = game.swing ? SHOTS[game.swing.shot] : null, prog = game.swingProgress;
    bat.rotation.set(-0.3 + (sw ? prog * 1.4 : 0), sw ? (sw.angle / 90) * prog : 0, 0.15);
    bat.visible = game.phase !== "end";

    ball.visible = !!b && (game.phase === "bowl" || game.phase === "live" || game.phase === "throw");
    if (b) ball.position.set(b.p.x, b.p.y, b.p.z);
    game.fielders.forEach((f, i) => {
      const hop = game.celebT > 0 ? Math.abs(Math.sin(t * 10 + i)) * 0.35 : 0;
      fMeshes[i].position.set(f.x, hop, f.z); fMeshes[i].lookAt(b ? b.p.x : 0, hop, b ? b.p.z : 0);
    });
    const q = game.partner;
    partnerMesh.position.set(q.running ? 0.5 : q.end === 0 ? 0 : 1.1, 0, q.z);
    partnerMesh.lookAt(0, 0, q.end === 0 ? -18 : 2);
    arm1.rotation.z = /OUT|SIX|FOUR|WIDE|NO BALL/.test(game.msg) ? -2.6 : 0;

    $("score").textContent = game.scoreText; $("info").textContent = game.infoText;
    $("msg").textContent = game.msg; $("comm").textContent = game.comm;
    $("fb").textContent = game.feedback; $("partner").textContent = game.gesture;
    $("vig").style.opacity = String(Math.min(0.9, game.fatigue * 1.1 + (game.slow < 0.9 ? 0.1 : 0)));
    $("review").style.display = game.phase === "decision" ? "block" : "none";
    if (game.phase === "end") { const e = $("end"); e.style.display = "flex"; e.innerHTML = `${game.result}<br><span style="font-size:16px;font-weight:400">${game.scoreText}<br>Tap to play again</span>`; }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
