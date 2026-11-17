// Cars: box-built models (sedan, coupe, hatch, taxi, van, police interceptor, Viper fang),
// arcade physics with building and car-to-car collision, damage with smoke, and the traffic
// manager that drives ambient cars along the avenue grid in right-hand lanes.

import * as THREE from '../vendor/three.module.min.js';
import { clamp, angDiff, collideCircle, dist2 } from './util.js';
import { ROADS, clampToCity } from './world.js';

export const CAR_TYPES = {
  sedan: { name: 'Solace Sedan', w: 1.85, l: 4.4, bodyH: 0.62, cabH: 0.55, cabL: 2.0, cabZ: -0.2, top: 26, accel: 13 },
  coupe: { name: 'Vanta Coupe', w: 1.85, l: 4.5, bodyH: 0.5, cabH: 0.42, cabL: 1.7, cabZ: -0.35, top: 33, accel: 17 },
  hatch: { name: 'Palm Hatch', w: 1.75, l: 3.8, bodyH: 0.66, cabH: 0.6, cabL: 1.9, cabZ: 0.1, top: 24, accel: 12 },
  taxi: { name: 'City Cab', w: 1.85, l: 4.4, bodyH: 0.62, cabH: 0.55, cabL: 2.0, cabZ: -0.2, top: 26, accel: 13 },
  van: { name: 'Cargo Van', w: 2.0, l: 4.7, bodyH: 1.25, cabH: 0.0, cabL: 0, cabZ: 0, top: 22, accel: 10 },
  police: { name: 'PD Interceptor', w: 1.9, l: 4.6, bodyH: 0.6, cabH: 0.55, cabL: 2.0, cabZ: -0.2, top: 32, accel: 17 },
  viper: { name: 'Viper Fang', w: 1.9, l: 4.6, bodyH: 0.48, cabH: 0.4, cabL: 1.6, cabZ: -0.4, top: 35, accel: 19 },
};
export const CAR_COLORS = [0xc24b4b, 0x4b7dc2, 0xd8d8dc, 0x30303a, 0xc2a44b, 0x4bc27a, 0x8a8f9e, 0x7a4bc2, 0xe8e8f0, 0x2b6cb0];

const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.26, 10);
const wheelMat = new THREE.MeshLambertMaterial({ color: 0x14151a });
const glassMat = new THREE.MeshPhongMaterial({ color: 0x101722, shininess: 80, specular: 0x88aaff });
const trimMat = new THREE.MeshLambertMaterial({ color: 0x1c1d24 });
const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe6b0 });
const tailMat = new THREE.MeshBasicMaterial({ color: 0xff3b30 });

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)');
  gr.addColorStop(0.4, 'rgba(255,255,255,0.28)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
let sharedGlowTex = null;

/** A tiny pooled sprite particle system: grey smoke and orange sparks. */
export class Particles {
  constructor(scene, count = 110) {
    if (!sharedGlowTex) sharedGlowTex = glowTexture();
    this.items = [];
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({ map: sharedGlowTex, transparent: true, opacity: 0, depthWrite: false });
      const s = new THREE.Sprite(mat);
      s.visible = false;
      scene.add(s);
      this.items.push({ s, life: 0, max: 1, vel: new THREE.Vector3(), grow: 1 });
    }
    this.head = 0;
  }
  spawn(x, y, z, opts = {}) {
    const p = this.items[this.head];
    this.head = (this.head + 1) % this.items.length;
    p.s.visible = true;
    p.s.position.set(x, y, z);
    p.vel.set((Math.random() - 0.5) * (opts.spread ?? 1), opts.vy ?? 1.6, (Math.random() - 0.5) * (opts.spread ?? 1));
    p.max = p.life = opts.life ?? 1.1;
    p.grow = opts.grow ?? 2.2;
    p.s.material.color.set(opts.color ?? 0x8a8a92);
    p.s.material.opacity = opts.opacity ?? 0.5;
    p.s.scale.setScalar(opts.scale ?? 1.1);
    p.baseOpacity = p.s.material.opacity;
  }
  update(dt) {
    for (const p of this.items) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.s.visible = false; continue; }
      const t = p.life / p.max;
      p.s.position.addScaledVector(p.vel, dt);
      p.s.scale.addScalar(p.grow * dt);
      p.s.material.opacity = p.baseOpacity * t;
    }
  }
}

let carSerial = 0;

export class Car {
  constructor(scene, type, color, x, z, heading) {
    const spec = CAR_TYPES[type];
    this.id = carSerial++;
    this.type = type;
    this.spec = spec;
    this.isPolice = type === 'police';
    this.heading = heading;
    this.speed = 0;
    this.health = 100;
    this.disabled = false;
    this.parked = false;
    this.driver = null; // null | 'player' | 'traffic' | 'police' | 'viper' | 'racer'
    this.steerVis = 0;
    this.smokeT = 0;
    this.onCrash = null;
    this.radius = spec.l * 0.42;

    const g = this.mesh = new THREE.Group();
    const bodyMat = this.bodyMat = new THREE.MeshPhongMaterial({ color, shininess: 60, specular: 0x666677 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(spec.w, spec.bodyH, spec.l), bodyMat);
    body.position.y = 0.38 + spec.bodyH / 2;
    body.castShadow = true;
    g.add(body);
    if (spec.cabL > 0) {
      const cab = new THREE.Mesh(new THREE.BoxGeometry(spec.w - 0.25, spec.cabH, spec.cabL), glassMat);
      cab.position.set(0, 0.38 + spec.bodyH + spec.cabH / 2 - 0.04, spec.cabZ);
      cab.castShadow = true;
      g.add(cab);
    }
    if (type === 'van') {
      const cab = new THREE.Mesh(new THREE.BoxGeometry(spec.w - 0.1, 0.62, 0.9), glassMat);
      cab.position.set(0, 0.95, spec.l / 2 - 0.5);
      g.add(cab);
    }
    // Bumpers, headlights, tail lights.
    const bf = new THREE.Mesh(new THREE.BoxGeometry(spec.w + 0.06, 0.22, 0.3), trimMat);
    bf.position.set(0, 0.42, spec.l / 2); g.add(bf);
    const bb = bf.clone(); bb.position.z = -spec.l / 2; g.add(bb);
    for (const sx of [-1, 1]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.06), lampMat);
      lamp.position.set(sx * (spec.w / 2 - 0.32), 0.72, spec.l / 2 + 0.14); g.add(lamp);
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.12, 0.06), tailMat);
      tail.position.set(sx * (spec.w / 2 - 0.32), 0.74, -spec.l / 2 - 0.14); g.add(tail);
    }
    // Headlight beams (fake cones, additive) — dusk city, always on.
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const beamGeo = new THREE.ConeGeometry(1.5, 8, 10, 1, true);
    for (const sx of [-1, 1]) {
      const beam = new THREE.Mesh(beamGeo, beamMat);
      beam.rotation.x = Math.PI / 2 + 0.06;
      beam.position.set(sx * (spec.w / 2 - 0.32), 0.66, spec.l / 2 + 4);
      g.add(beam);
    }
    // Real spotlights, only switched on for the car the player drives.
    this.spots = [];
    for (const sx of [-1, 1]) {
      const spot = new THREE.SpotLight(0xffd9a0, 0, 34, 0.5, 0.5, 1.2);
      spot.position.set(sx * 0.6, 0.8, spec.l / 2);
      const tgt = new THREE.Object3D();
      tgt.position.set(sx * 0.9, 0, spec.l / 2 + 16);
      g.add(tgt); spot.target = tgt;
      g.add(spot);
      this.spots.push(spot);
    }
    if (type === 'taxi') {
      const sign = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.24, 0.4),
        new THREE.MeshBasicMaterial({ color: 0xffd94d }));
      sign.position.set(0, 0.38 + spec.bodyH + spec.cabH + 0.1, spec.cabZ);
      g.add(sign);
      bodyMat.color.set(0xf2b134);
    }
    if (type === 'police') {
      bodyMat.color.set(0xe8e8ec);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(spec.w + 0.03, 0.3, spec.l * 0.5), trimMat);
      stripe.position.set(0, 0.62, 0); g.add(stripe);
      const barR = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.5), new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
      barR.position.set(-0.32, 0.38 + spec.bodyH + spec.cabH + 0.06, spec.cabZ);
      const barB = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.16, 0.5), new THREE.MeshBasicMaterial({ color: 0x2a6cff }));
      barB.position.set(0.32, 0.38 + spec.bodyH + spec.cabH + 0.06, spec.cabZ);
      g.add(barR, barB);
      this.barMats = [barR.material, barB.material];
      if (!sharedGlowTex) sharedGlowTex = glowTexture();
      this.barGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: sharedGlowTex, color: 0xff4444, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
      this.barGlow.scale.setScalar(4.2);
      this.barGlow.position.y = 1.75;
      g.add(this.barGlow);
    }
    if (type === 'viper' || type === 'coupe') {
      const spoiler = new THREE.Mesh(new THREE.BoxGeometry(spec.w - 0.2, 0.07, 0.42), trimMat);
      spoiler.position.set(0, 1.02, -spec.l / 2 + 0.3); g.add(spoiler);
      for (const sx of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.24, 0.08), trimMat);
        post.position.set(sx * 0.6, 0.88, -spec.l / 2 + 0.3); g.add(post);
      }
    }
    // Wheels.
    this.wheels = [];
    const wx = spec.w / 2 - 0.05, wz = spec.l / 2 - 0.85;
    for (const [sx, sz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.rotation.z = Math.PI / 2;
      const pivot = new THREE.Group();
      pivot.position.set(sx * wx, 0.35, sz * wz);
      pivot.add(w);
      g.add(pivot);
      this.wheels.push({ pivot, wheel: w, front: sz > 0 });
    }
    g.position.set(x, 0, z);
    g.rotation.y = heading;
    scene.add(g);
    this.pos = g.position;
  }

  get x() { return this.pos.x; }
  get z() { return this.pos.z; }
  forwardX() { return Math.sin(this.heading); }
  forwardZ() { return Math.cos(this.heading); }

  setHeadlights(on) { for (const s of this.spots) s.intensity = on ? 60 : 0; }

  flashBars(t) {
    if (!this.barMats) return;
    const phase = Math.floor(t * 6) % 2;
    this.barMats[0].color.setHex(phase ? 0xff2a2a : 0x551111);
    this.barMats[1].color.setHex(phase ? 0x112255 : 0x2a6cff);
    if (this.barGlow) {
      this.barGlow.material.color.setHex(phase ? 0xff3333 : 0x3366ff);
      this.barGlow.material.opacity = 0.35 + 0.2 * Math.sin(t * 18);
    }
  }

  damage(amount, fx) {
    if (this.disabled) return;
    this.health -= amount;
    if (this.health <= 0) {
      this.health = 0;
      this.disabled = true;
      this.bodyMat.color.multiplyScalar(0.35);
      if (fx) for (let i = 0; i < 8; i++) fx.spawn(this.x, 1, this.z, { color: 0x55555e, scale: 1.6, life: 1.6, vy: 2.2 });
    }
  }

  /**
   * Advance the arcade physics. throttle -1..1, steer -1..1 (left..right).
   * Collides with building boxes (two circle probes) and clamps to the city.
   */
  step(dt, throttle, steer, colliders, fx) {
    const spec = this.spec;
    if (this.disabled) throttle = 0;
    const topF = spec.top * (this.health < 30 ? 0.55 : 1);
    if (throttle > 0) this.speed += spec.accel * throttle * dt * (1 - Math.max(0, this.speed) / (topF * 1.15));
    else if (throttle < 0) {
      if (this.speed > 0.6) this.speed -= 26 * dt;
      else this.speed = Math.max(this.speed - 8 * dt, -7);
    }
    this.speed -= this.speed * 0.32 * dt;
    if (Math.abs(this.speed) < 0.04 && throttle === 0) this.speed = 0;
    this.speed = clamp(this.speed, -7.5, topF + 4);

    const turn = steer * 1.65 * clamp(this.speed / 6.5, -1, 1) * (this.speed < 0 ? -1 : 1);
    this.heading -= turn * dt * (Math.abs(this.speed) > 0.1 ? 1 : 0);
    this.steerVis = steer;

    const fxv = this.forwardX(), fzv = this.forwardZ();
    this.pos.x += fxv * this.speed * dt;
    this.pos.z += fzv * this.speed * dt;

    // Building collision: probe front and rear circles.
    let impact = 0;
    const probe = { x: 0, z: 0 };
    for (const s of [1, -1]) {
      probe.x = this.pos.x + fxv * s * (spec.l / 2 - 0.55);
      probe.z = this.pos.z + fzv * s * (spec.l / 2 - 0.55);
      const before = { x: probe.x, z: probe.z };
      const hit = collideCircle(probe, spec.w / 2 + 0.12, colliders);
      if (hit > 0.02) {
        this.pos.x += probe.x - before.x;
        this.pos.z += probe.z - before.z;
        impact = Math.max(impact, Math.abs(this.speed));
      }
    }
    clampToCity(this.pos);
    if (impact > 3.5) {
      const dmg = (impact - 3.5) * 2.6;
      this.damage(dmg, fx);
      if (this.onCrash) this.onCrash(Math.min(1, impact / 22), null);
      this.speed *= -0.18;
      if (fx) for (let i = 0; i < 5; i++) fx.spawn(this.pos.x + fxv * spec.l / 2, 0.7, this.pos.z + fzv * spec.l / 2, { color: 0xffa040, scale: 0.7, life: 0.4, vy: 1, spread: 3 });
    }
    // Wheels: spin + front steer, body roll/pitch for feel.
    const spin = this.speed * dt / 0.35;
    for (const w of this.wheels) {
      w.wheel.rotation.x += spin;
      if (w.front) w.pivot.rotation.y = -steer * 0.42;
    }
    this.mesh.rotation.y = this.heading;
    this.mesh.rotation.z = -steer * clamp(Math.abs(this.speed) / topF, 0, 1) * 0.045;
    this.mesh.rotation.x = clamp(-(throttle * 0.012), -0.02, 0.02);
    // Damage smoke.
    if (fx && this.health < 50 && this.health > 0) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.smokeT = this.health < 22 ? 0.07 : 0.16;
        fx.spawn(this.pos.x + fxv * spec.l * 0.3, 1.0, this.pos.z + fzv * spec.l * 0.3, { color: 0x3c3c44, scale: 0.9, life: 1.2, vy: 2.4, opacity: 0.55 });
      }
    }
    if (fx && this.disabled) {
      this.smokeT -= dt;
      if (this.smokeT <= 0) {
        this.smokeT = 0.12;
        fx.spawn(this.pos.x, 1.1, this.pos.z, { color: 0x2c2c33, scale: 1.2, life: 1.5, vy: 2.6, opacity: 0.6 });
      }
    }
  }
}

/** Pairwise car-to-car collision: push apart, trade speed, take damage. */
export function collideCars(cars, fx, onHit) {
  for (let i = 0; i < cars.length; i++) {
    const a = cars[i];
    if (!a.mesh.visible) continue;
    for (let j = i + 1; j < cars.length; j++) {
      const b = cars[j];
      if (!b.mesh.visible) continue;
      const rr = a.radius + b.radius;
      const d2 = dist2(a.x, a.z, b.x, b.z);
      if (d2 > rr * rr || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const nx = (b.x - a.x) / d, nz = (b.z - a.z) / d;
      const push = (rr - d) / 2 + 0.02;
      a.pos.x -= nx * push; a.pos.z -= nz * push;
      b.pos.x += nx * push; b.pos.z += nz * push;
      const impactSpeed = Math.max(Math.abs(a.speed), Math.abs(b.speed));
      if (impactSpeed > 3) {
        const dmg = (impactSpeed - 3) * 1.7;
        a.damage(dmg, fx); b.damage(dmg, fx);
        if (onHit) onHit(a, b, Math.min(1, impactSpeed / 24));
        if (fx) fx.spawn((a.x + b.x) / 2, 0.8, (a.z + b.z) / 2, { color: 0xffc060, scale: 0.8, life: 0.35, vy: 1.4, spread: 3 });
      }
      a.speed *= 0.55; b.speed *= 0.55;
    }
  }
}

/** The lane a car at (x, z) with a heading belongs to: axis, centre line, direction, lane centre. */
export function laneFor(x, z, heading) {
  const vertical = Math.abs(Math.cos(heading)) > 0.7; // travelling along z
  if (vertical) {
    const line = ROADS.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a));
    const dir = Math.cos(heading) > 0 ? 1 : -1; // +z south or -z north
    return { axis: 'z', line, dir, cross: line + (dir > 0 ? -5 : 5) };
  }
  const line = ROADS.reduce((a, b) => (Math.abs(b - z) < Math.abs(a - z) ? b : a));
  const dir = Math.sin(heading) > 0 ? 1 : -1; // +x east or -x west
  return { axis: 'x', line, dir, cross: line + (dir > 0 ? 5 : -5) };
}

/** Steer a car toward a world point; returns {throttle, steer} for Car.step. */
export function driveTo(car, tx, tz, dt, opts = {}) {
  const topSpeed = opts.topSpeed ?? 12;
  const dx = tx - car.x, dz = tz - car.z;
  const dist = Math.hypot(dx, dz);
  const desired = Math.atan2(dx, dz);
  const diff = angDiff(car.heading, desired);
  const steer = clamp(diff * 1.7, -1, 1);
  let want = topSpeed;
  if (Math.abs(diff) > 0.7) want = Math.min(want, 5);
  if (opts.slowNear && dist < 14) want = Math.min(want, Math.max(2.5, dist * 0.45));
  if (opts.stopAt && dist < opts.stopAt) want = 0;
  const throttle = clamp((want - car.speed) * 0.45, -1, 1);
  return { throttle, steer, dist, diff };
}

/** Ambient traffic: cars that follow lanes, turn at intersections and brake for obstacles. */
export class Traffic {
  constructor(scene, rand) {
    this.scene = scene;
    this.rand = rand;
    this.cars = [];
  }

  addCar(type, color, x, z, heading, parked = false) {
    const car = new Car(this.scene, type, color, x, z, heading);
    car.parked = parked;
    if (parked) {
      car.driver = null;
    } else {
      car.driver = 'traffic';
      car.lane = this._laneFor(car);
      car.turnCd = 0;
      car.cruise = 9 + this.rand() * 4;
    }
    this.cars.push(car);
    return car;
  }

  /** The lane state for a car sitting at (x,z) with a heading: axis, line, direction. */
  _laneFor(car) {
    return laneFor(car.x, car.z, car.heading);
  }

  update(dt, ctx) {
    // ctx: {colliders, fx, obstacles:[{x,z,speed}], peds:[{x,z}], onEvent}
    for (const car of this.cars) {
      if (car.parked || car.driver !== 'traffic') {
        if (!car.parked && car.driver === null) car.step(dt, 0, 0, ctx.colliders, ctx.fx);
        continue;
      }
      if (car.disabled) { car.step(dt, 0, 0, ctx.colliders, ctx.fx); continue; }
      const lane = car.lane;
      car.turnCd -= dt;
      // Where is the next intersection along the travel axis?
      const along = lane.axis === 'z' ? car.z : car.x;
      let nextCross = null;
      for (const c of ROADS) {
        const d = (c - along) * lane.dir;
        if (d > 1 && (nextCross === null || d < nextCross.d)) nextCross = { at: c, d };
      }
      // Decide a turn shortly before the intersection.
      if (!car.turning && nextCross && nextCross.d < 10 && car.turnCd <= 0) {
        car.turnCd = 3;
        const r = this.rand();
        if (r > 0.45) {
          const turnDir = r > 0.72 ? 1 : -1; // left or right
          car.turning = { at: nextCross.at, dir: turnDir };
        }
      }
      let tx, tz;
      if (car.turning) {
        // Aim through the intersection into the new lane.
        const t = car.turning;
        if (lane.axis === 'z') {
          const newHeading = car.heading + t.dir * Math.PI / 2;
          const rx = -Math.cos(newHeading), rz = Math.sin(newHeading); // right vector
          tx = lane.line + Math.sin(newHeading) * 18 + rx * 5;
          tz = t.at + Math.cos(newHeading) * 18 + rz * 5;
        } else {
          const newHeading = car.heading + t.dir * Math.PI / 2;
          const rx = -Math.cos(newHeading), rz = Math.sin(newHeading);
          tx = t.at + Math.sin(newHeading) * 18 + rx * 5;
          tz = lane.line + Math.cos(newHeading) * 18 + rz * 5;
        }
        const nd = driveTo(car, tx, tz, dt, { topSpeed: 7.5 });
        // Finished turning once roughly aligned with the new axis.
        const axisDiff = Math.abs(Math.sin(car.heading)) > 0.7 ? 'x' : 'z';
        if (axisDiff !== lane.axis && Math.abs(nd.diff) < 0.35) {
          car.lane = this._laneFor(car);
          car.turning = null;
        }
        car.step(dt, nd.throttle, nd.steer, ctx.colliders, ctx.fx);
        continue;
      }
      // Lane following: aim ahead, corrected onto the lane centre.
      const fxv = car.forwardX(), fzv = car.forwardZ();
      const crossErr = lane.axis === 'z' ? (lane.cross - car.x) : (lane.cross - car.z);
      const rx = -Math.cos(car.heading), rz = Math.sin(car.heading);
      tx = car.x + fxv * 13 + rx * crossErr;
      tz = car.z + fzv * 13 + rz * crossErr;
      // Braking: anything solid in the corridor ahead.
      let want = car.cruise;
      const check = (ox, oz) => {
        const dx = ox - car.x, dz = oz - car.z;
        const ahead = dx * fxv + dz * fzv;
        const side = dx * rx + dz * rz;
        if (ahead > 0.5 && ahead < 12 && Math.abs(side) < 2.1) {
          want = ahead < 5.5 ? 0 : Math.min(want, 4);
        }
      };
      for (const o of ctx.obstacles) if (o !== car) check(o.x, o.z);
      for (const p of ctx.peds) check(p.x, p.z);
      const nd = driveTo(car, tx, tz, dt, { topSpeed: want });
      car.step(dt, nd.throttle, nd.steer, ctx.colliders, ctx.fx);
    }
  }
}

/** Spawn helper: a random road position with the matching lane heading. */
export function randomRoadPose(rand, minDistFrom = null, minDist = 0) {
  for (let tries = 0; tries < 24; tries++) {
    const vertical = rand() < 0.5;
    const line = ROADS[(rand() * ROADS.length) | 0];
    const along = -290 + rand() * 580;
    const dir = rand() < 0.5 ? 1 : -1;
    let x, z, heading;
    if (vertical) {
      heading = dir > 0 ? 0 : Math.PI;
      x = line + (dir > 0 ? -5 : 5); z = along;
    } else {
      heading = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      x = along; z = line + (dir > 0 ? 5 : -5);
    }
    if (minDistFrom && dist2(x, z, minDistFrom.x, minDistFrom.z) < minDist * minDist) continue;
    return { x, z, heading };
  }
  return { x: 42, z: 200, heading: 0 };
}
