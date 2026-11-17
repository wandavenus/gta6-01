// Shared helpers: seeded randomness (so a seed rebuilds the same city), math, and the one
// collision routine every mover in Port Solace uses — circles pushed out of building boxes.

/** mulberry32: the same seed always gives the same stream. */
export function createRandom(seed) {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist2 = (ax, az, bx, bz) => {
  const dx = ax - bx, dz = az - bz;
  return dx * dx + dz * dz;
};

/** Shortest signed turn from angle a to angle b, in radians. */
export function angDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export const angLerp = (a, b, t) => a + angDiff(a, b) * clamp(t, 0, 1);

/**
 * Push a circle (x, z, radius r) out of every axis-aligned box it overlaps.
 * boxes: flat array of {minX, maxX, minZ, maxZ}. Mutates and returns the point,
 * and reports the hardest impact speed absorbed (for crash damage).
 */
export function collideCircle(p, r, boxes) {
  let impact = 0;
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    const cx = clamp(p.x, b.minX, b.maxX);
    const cz = clamp(p.z, b.minZ, b.maxZ);
    let dx = p.x - cx, dz = p.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 > r * r) continue;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      const push = r - d;
      dx /= d; dz /= d;
      p.x += dx * push; p.z += dz * push;
      impact = Math.max(impact, push);
    } else {
      // Centre inside the box: leave by the nearest face.
      const left = p.x - b.minX, right = b.maxX - p.x, top = p.z - b.minZ, bot = b.maxZ - p.z;
      const m = Math.min(left, right, top, bot);
      if (m === left) p.x = b.minX - r;
      else if (m === right) p.x = b.maxX + r;
      else if (m === top) p.z = b.minZ - r;
      else p.z = b.maxZ + r;
      impact = Math.max(impact, r);
    }
  }
  return impact;
}

/** Is the segment (x0,z0)->(x1,z1) blocked by any box? Cheap line-of-sight for witnesses. */
export function losBlocked(x0, z0, x1, z1, boxes) {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i];
    // Slab test.
    const dx = x1 - x0, dz = z1 - z0;
    let t0 = 0, t1 = 1;
    if (Math.abs(dx) < 1e-9) { if (x0 < b.minX || x0 > b.maxX) continue; }
    else {
      let ta = (b.minX - x0) / dx, tb = (b.maxX - x0) / dx;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    if (Math.abs(dz) < 1e-9) { if (z0 < b.minZ || z0 > b.maxZ) continue; }
    else {
      let ta = (b.minZ - z0) / dz, tb = (b.maxZ - z0) / dz;
      if (ta > tb) { const s = ta; ta = tb; tb = s; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    return true;
  }
  return false;
}

/** Format dollars the way the HUD shows them. */
export const money = (n) => '$' + Math.round(n).toLocaleString('en-US');
