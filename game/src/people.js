// People: box-built humanoids with swinging-limb walk animation. The Player is Rook, driven
// by keyboard + camera yaw with sprint and jump. Pedestrians stroll sidewalk loops around
// each block, sidestep traffic, flee from danger, and can be knocked down — which the rest
// of the game hears about through the manager's event callback.

import * as THREE from '../vendor/three.module.min.js';
import { clamp, angLerp, collideCircle, dist2 } from './util.js';
import { PITCH, clampToCity } from './world.js';

const SKIN = [0xe8b98d, 0xc68863, 0x8d5a3b, 0xf0c8a0, 0x6e4530];
const SHIRT = [0xc2544b, 0x4b7dc2, 0x53b06a, 0xd8c95c, 0x9a5cc2, 0xe8e8ec, 0x4bc2b8, 0xe07ba0];
const PANTS = [0x2c3040, 0x4a3b2c, 0x30455c, 0x222222, 0x5c4a68];

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** A stylized low-poly person, ~1.8 m tall, facing +Z. Limbs pivot at shoulder/hip. */
export function createHumanoid(shirt, pants, skin, hairColor) {
  const g = new THREE.Group();
  const shirtMat = new THREE.MeshLambertMaterial({ color: shirt });
  const pantsMat = new THREE.MeshLambertMaterial({ color: pants });
  const skinMat = new THREE.MeshLambertMaterial({ color: skin });
  const legGeo = new THREE.BoxGeometry(0.17, 0.82, 0.19);
  legGeo.translate(0, -0.41, 0);
  const armGeo = new THREE.BoxGeometry(0.13, 0.72, 0.15);
  armGeo.translate(0, -0.36, 0);
  const legL = new THREE.Mesh(legGeo, pantsMat); legL.position.set(-0.12, 0.84, 0);
  const legR = new THREE.Mesh(legGeo, pantsMat); legR.position.set(0.12, 0.84, 0);
  const armL = new THREE.Mesh(armGeo, shirtMat); armL.position.set(-0.31, 1.44, 0);
  const armR = new THREE.Mesh(armGeo, shirtMat); armR.position.set(0.31, 1.44, 0);
  const torso = box(0.5, 0.64, 0.26, shirtMat, 0, 1.16, 0);
  const head = box(0.26, 0.28, 0.26, skinMat, 0, 1.66, 0);
  const hair = box(0.28, 0.1, 0.28, new THREE.MeshLambertMaterial({ color: hairColor }), 0, 1.82, 0);
  for (const m of [legL, legR, armL, armR]) m.castShadow = true;
  g.add(legL, legR, armL, armR, torso, head, hair);
  return { group: g, legL, legR, armL, armR, torso, head };
}

/** Pose a humanoid: walkPhase advances with distance, aim raises the right arm, down lays it flat. */
export function poseHumanoid(h, phase, moving, opts = {}) {
  if (opts.down) {
    h.group.rotation.x = -Math.PI / 2;
    h.group.position.y = 0.22;
    h.legL.rotation.x = 0.2; h.legR.rotation.x = -0.15;
    h.armL.rotation.x = 0.7; h.armR.rotation.x = -0.4;
    return;
  }
  h.group.rotation.x = 0;
  h.group.position.y = opts.baseY ?? 0;
  const swing = moving ? Math.sin(phase) * 0.62 : 0;
  h.legL.rotation.x = swing;
  h.legR.rotation.x = -swing;
  if (opts.aim) {
    h.armR.rotation.x = -Math.PI / 2 + 0.08;
    h.armL.rotation.x = moving ? -swing * 0.7 : 0;
  } else if (opts.punchT > 0) {
    h.armR.rotation.x = -Math.PI / 2 * Math.sin(Math.min(1, opts.punchT * 3.2) * Math.PI);
    h.armL.rotation.x = moving ? -swing * 0.7 : 0;
  } else {
    h.armL.rotation.x = -swing * 0.8;
    h.armR.rotation.x = swing * 0.8;
  }
  h.group.position.y += moving ? Math.abs(Math.sin(phase)) * 0.045 : Math.sin(performance.now() * 0.0016) * 0.012;
}

export class Player {
  constructor(scene) {
    const h = createHumanoid(0x1f8a8a, 0x23232e, 0xc68863, 0x191919);
    this.h = h;
    this.mesh = h.group;
    scene.add(this.mesh);
    // A cap for Rook.
    const cap = box(0.3, 0.09, 0.3, new THREE.MeshLambertMaterial({ color: 0xff5d3b }), 0, 1.86, 0);
    const brim = box(0.28, 0.04, 0.18, cap.material, 0, 1.83, 0.2);
    this.mesh.add(cap, brim);
    // The pistol: a small dark sidearm in the right hand, shown while aiming. The barrel
    // runs along the arm's long axis, so when the aim pose raises the arm it points forward.
    const gunMat = new THREE.MeshLambertMaterial({ color: 0x17181d });
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.14, 0.09), gunMat);
    grip.position.set(0, -0.74, 0);
    const slide = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.07), gunMat);
    slide.position.set(0, -0.86, 0.01);
    grip.castShadow = slide.castShadow = true;
    const gun = new THREE.Group();
    gun.add(grip, slide);
    gun.visible = false;
    h.armR.add(gun);
    this.gunMesh = gun;
    this.pos = new THREE.Vector3(0, 0, 262); // logical position; the mesh follows it
    this.mesh.position.copy(this.pos);
    this.heading = Math.PI;
    this.vy = 0;
    this.grounded = true;
    this.health = 100;
    this.lastHurtT = -99;
    this.walkPhase = 0;
    this.speedNow = 0;
    this.punchT = 0;
    this.aiming = false;
  }

  get x() { return this.pos.x; }
  get z() { return this.pos.z; }

  hurt(amount, now) {
    this.health = Math.max(0, this.health - amount);
    this.lastHurtT = now;
  }

  /** move: {x,z} wish direction in world space (normalized-ish), sprint, jump bools. */
  update(dt, move, colliders, now) {
    const speed = move.sprint ? 7.6 : 4.3;
    const mag = Math.hypot(move.x, move.z);
    if (mag > 0.05) {
      const target = Math.atan2(move.x, move.z);
      this.heading = angLerp(this.heading, target, dt * 11);
      const s = speed * Math.min(1, mag);
      this.pos.x += move.x / (mag || 1) * s * dt;
      this.pos.z += move.z / (mag || 1) * s * dt;
      this.speedNow = s;
      this.walkPhase += dt * s * 1.55;
    } else {
      this.speedNow = 0;
    }
    if (move.jump && this.grounded) {
      this.vy = 8.4;
      this.grounded = false;
    }
    if (!this.grounded) {
      this.vy -= 23 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= 0) { this.pos.y = 0; this.vy = 0; this.grounded = true; }
    }
    collideCircle(this.pos, 0.42, colliders);
    clampToCity(this.pos);
    this.mesh.position.set(this.pos.x, this.pos.y, this.pos.z);
    this.mesh.rotation.y = this.heading;
    if (this.gunMesh) this.gunMesh.visible = this.aiming;
    this.punchT = Math.max(0, this.punchT - dt);
    poseHumanoid(this.h, this.walkPhase, this.speedNow > 0.2, { aim: this.aiming, punchT: this.punchT, baseY: this.pos.y });
    // Health regen after a quiet spell.
    if (this.health > 0 && this.health < 100 && now - this.lastHurtT > 6) {
      this.health = Math.min(100, this.health + 5 * dt);
    }
  }
}

const WALK_HALF = 29.5; // sidewalk loop half-size around a block centre

export class Pedestrian {
  constructor(scene, rand, bx, bz) {
    const h = createHumanoid(
      SHIRT[(rand() * SHIRT.length) | 0], PANTS[(rand() * PANTS.length) | 0],
      SKIN[(rand() * SKIN.length) | 0], [0x191919, 0x3a2a18, 0x777777, 0xb8b8b8][(rand() * 4) | 0]);
    this.h = h;
    this.mesh = h.group;
    scene.add(this.mesh);
    this.bx = bx; this.bz = bz;
    this.s = rand() * WALK_HALF * 8;
    this.dir = rand() < 0.5 ? 1 : -1;
    this.speed = 1.1 + rand() * 0.7;
    this.heading = 0;
    this.phase = rand() * 6;
    this.state = 'walk'; // walk | flee | down | dead
    this.health = 100;
    this.stateT = 0;
    this.threat = { x: 0, z: 0 };
    this.sideOff = 0;
    this.pos = this.mesh.position;
    this._placeOnLoop();
  }

  get x() { return this.pos.x; }
  get z() { return this.pos.z; }

  _placeOnLoop() {
    const H = WALK_HALF;
    let s = ((this.s % (H * 8)) + H * 8) % (H * 8);
    let x, z, heading;
    if (s < H * 2) { x = -H + s; z = -H; heading = Math.PI / 2; }
    else if (s < H * 4) { x = H; z = -H + (s - H * 2); heading = 0; }
    else if (s < H * 6) { x = H - (s - H * 4); z = H; heading = -Math.PI / 2; }
    else { x = -H; z = H - (s - H * 6); heading = Math.PI; }
    if (this.dir < 0) heading += Math.PI;
    this.pos.set(this.bx + x, 0, this.bz + z);
    this.heading = heading;
  }

  fleeFrom(x, z) {
    if (this.state === 'dead' || this.state === 'down') return;
    this.state = 'flee';
    this.stateT = 2.6;
    this.threat.x = x; this.threat.z = z;
  }

  damage(amount, fx, fromX, fromZ) {
    if (this.state === 'dead') return;
    this.health -= amount;
    if (this.health <= 0) {
      this.state = 'dead';
      this.stateT = 14;
      if (fx) fx.spawn(this.x, 0.7, this.z, { color: 0x6e2430, scale: 1, life: 0.7, vy: 1 });
    } else {
      this.state = 'flee';
      this.stateT = 3.2;
      this.threat.x = fromX; this.threat.z = fromZ;
    }
  }

  update(dt, ctx) {
    // ctx: {colliders, cars, fx, onEvent, playerPos}
    this.stateT -= dt;
    if (this.state === 'dead') {
      poseHumanoid(this.h, 0, false, { down: true });
      if (this.stateT < 1.2) this.mesh.position.y = -0.22 * (1.2 - Math.max(0, this.stateT));
      return;
    }
    if (this.state === 'down') {
      poseHumanoid(this.h, 0, false, { down: true });
      if (this.stateT <= 0) { this.state = 'walk'; this.health = Math.max(30, this.health); }
      return;
    }
    let moving = false;
    if (this.state === 'flee') {
      const dx = this.x - this.threat.x, dz = this.z - this.threat.z;
      const d = Math.hypot(dx, dz) || 1;
      const want = Math.atan2(dx / d, dz / d);
      this.heading = angLerp(this.heading, want, dt * 8);
      this.pos.x += Math.sin(this.heading) * 5.4 * dt;
      this.pos.z += Math.cos(this.heading) * 5.4 * dt;
      this.phase += dt * 9;
      moving = true;
      if (this.stateT <= 0) {
        // Rejoin the nearest block loop.
        this.bx = Math.round((this.x + 252) / PITCH) * PITCH - 252;
        this.bz = Math.round((this.z + 252) / PITCH) * PITCH - 252;
        this.bx = clamp(this.bx, -252, 252); this.bz = clamp(this.bz, -252, 252);
        this.s = 0;
        this.state = 'walk';
        this._placeOnLoop();
      }
    } else {
      // Sidewalk stroll, with a sidestep when a car bears down.
      let speedNow = this.speed;
      this.sideOff *= Math.pow(0.4, dt);
      for (const car of ctx.cars) {
        if (Math.abs(car.speed) < 2.5) continue;
        const d2 = dist2(this.x, this.z, car.x, car.z);
        if (d2 < 42) {
          const fxv = car.forwardX(), fzv = car.forwardZ();
          const ahead = (this.x - car.x) * fxv + (this.z - car.z) * fzv;
          if (ahead > 0 && ahead < 8) {
            this.sideOff = 1.6;
            speedNow = 2.6;
          }
        }
      }
      this.s += this.dir * speedNow * dt;
      this.phase += dt * speedNow * 2.1;
      this._placeOnLoop();
      // Apply the sidestep perpendicular to the heading.
      this.pos.x += -Math.cos(this.heading) * this.sideOff * 0.4;
      this.pos.z += Math.sin(this.heading) * this.sideOff * 0.4;
      moving = true;
    }
    collideCircle(this.pos, 0.35, ctx.colliders);
    clampToCity(this.pos);
    this.mesh.rotation.y = this.heading;
    poseHumanoid(this.h, this.phase, moving, { baseY: 0 });
    // Run over?
    for (const car of ctx.cars) {
      if (Math.abs(car.speed) < 2.6 || car.parked) continue;
      const rr = 1.15 + Math.abs(car.speed) * 0.02;
      if (dist2(this.x, this.z, car.x, car.z) < rr * rr) {
        const lethal = Math.abs(car.speed) > 7.5;
        this.damage(lethal ? 100 : 55, ctx.fx, car.x, car.z);
        if (this.state !== 'dead') { this.state = 'down'; this.stateT = 3.5; }
        car.speed *= 0.82;
        if (ctx.onEvent) ctx.onEvent({ type: 'pedHit', ped: this, car, lethal });
        break;
      }
    }
  }
}

export class PedManager {
  constructor(scene, rand, count = 26) {
    this.scene = scene;
    this.rand = rand;
    this.peds = [];
    for (let i = 0; i < count; i++) {
      const bx = -252 + ((rand() * 7) | 0) * PITCH;
      const bz = -252 + ((rand() * 7) | 0) * PITCH;
      this.peds.push(new Pedestrian(scene, rand, bx, bz));
    }
  }

  fleeArea(x, z, radius) {
    for (const p of this.peds) {
      if (dist2(p.x, p.z, x, z) < radius * radius) p.fleeFrom(x, z);
    }
  }

  /** Nearest living ped within range of a point, for punches and shots. */
  nearest(x, z, range) {
    let best = null, bd = range * range;
    for (const p of this.peds) {
      if (p.state === 'dead') continue;
      const d = dist2(p.x, p.z, x, z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  update(dt, ctx) {
    for (const p of this.peds) {
      // Keep the far side of town cheap: only animate peds within 190 m.
      if (dist2(p.x, p.z, ctx.playerPos.x, ctx.playerPos.z) > 190 * 190) continue;
      p.update(dt, ctx);
      if (p.state === 'dead' && p.stateT <= 0) {
        // Quietly recycle across town.
        p.bx = -252 + ((this.rand() * 7) | 0) * PITCH;
        p.bz = -252 + ((this.rand() * 7) | 0) * PITCH;
        p.health = 100; p.state = 'walk'; p.s = this.rand() * 200;
        p.mesh.position.y = 0;
        p._placeOnLoop();
      }
    }
  }
}
