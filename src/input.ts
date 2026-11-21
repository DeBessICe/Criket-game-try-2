export function setupInput(joy: { x: number; y: number }, onSwipe: (dx: number, dy: number, circ: boolean) => void) {
  const base = document.getElementById("joyBase")!, knob = document.getElementById("joyKnob")!;
  let joyId = -1, jx = 0, jy = 0, swId = -1, sx = 0, sy = 0, lx = 0, ly = 0, path = 0;
  const R = 60;
  window.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest("button,select,#end,#menu")) return;
    if (e.clientX < window.innerWidth * 0.45 && joyId < 0) {
      joyId = e.pointerId; jx = e.clientX; jy = e.clientY;
      base.style.display = "block"; base.style.left = jx - R + "px"; base.style.top = jy - R + "px"; knob.style.transform = "translate(0,0)";
    } else if (swId < 0) { swId = e.pointerId; sx = lx = e.clientX; sy = ly = e.clientY; path = 0; }
  });
  window.addEventListener("pointermove", (e) => {
    if (e.pointerId === joyId) {
      let dx = e.clientX - jx, dy = e.clientY - jy; const d = Math.hypot(dx, dy);
      if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
      joy.x = dx / R; joy.y = dy / R; knob.style.transform = `translate(${dx}px,${dy}px)`;
    } else if (e.pointerId === swId) { path += Math.hypot(e.clientX - lx, e.clientY - ly); lx = e.clientX; ly = e.clientY; }
  });
  const up = (e: PointerEvent) => {
    if (e.pointerId === joyId) { joyId = -1; joy.x = 0; joy.y = 0; base.style.display = "none"; }
    else if (e.pointerId === swId) {
      swId = -1; const dx = e.clientX - sx, dy = e.clientY - sy, net = Math.hypot(dx, dy);
      onSwipe(dx, dy, path > 140 && net < path * 0.45);
    }
  };
  window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
}
