// The law: a 0-5 star wanted level that crimes raise and hiding lowers, and the police
// manager — patrol cars that witness trouble, chase units that pursue and ram, officers who
// shoot at high heat, and roadblocks at four stars and up.

import { Car, driveTo, laneFor, randomRoadPose } from './vehicles.js';
import { ROADS } from './world.js';
import { clamp, dist2 } from './util.js';

export class Wanted {
  constructor() {
    this.level = 0;      // float 0..5; displayed stars are its ceiling
    this.hiddenT = 0;    // seconds since any unit last had eyes on the player
    this.blinking = false;
  }
  stars() {
    return this.level <= 0.02 ? 0 : clamp(Math.ceil(this.level), 0, 5);
  }
  add(points) {
    this.level = clamp(this.level + points, 0, 5);
    this.hiddenT = 0;
    this.blinking = false;
  }
  setAtLeast(points) {
    if (points > this.level) { this.level = points; this.hiddenT = 0; }
  }
  clear() { this.level = 0; this.hiddenT = 0; this.blinking = false; }
  /** seen: whether any police unit currently has eyes on the player. */
  update(dt, seen) {
    if (this.level <= 0) return;
    if (seen) {
      this.hiddenT = 0;
      this.blinking = false;
      return;
    }
    this.hiddenT += dt;
    this.blinking = this.hiddenT > 2.2;
    if (this.hiddenT >= 5.5) {
      this.level = Math.max(0, Math.ceil(this.level) - 1);
      this.hiddenT = 0;
      this.blinking = false;
    }
  }
}

export class PoliceManager {
  constructor(scene, rand) {
    this.scene = scene;
    this.rand = rand;
    this.units = [];       // active police cars (patrol + chase)
    this.blockers = [];    // roadblock cars (stationary)
    this.spawnT = 0;
    this.roadblockFor = 0; // wanted level the current roadblock was placed for
  }

  allCars() { return this.units.concat(this.blockers); }

  desiredUnits(stars) {
    if (stars <= 0) return 2; // ambient patrol
    return clamp(1 + stars, 2, 6);
  }

  _spawn(playerPos, stars) {
    // Pick a road pose in the ring around the player: far enough to be out of sight,
    // close enough to reach the chase (and inside the despawn radius).
    let pose = null;
    for (let tries = 0; tries < 16; tries++) {
      const p = randomRoadPose(this.rand, playerPos, 62);
      const d = Math.sqrt(dist2(p.x, p.z, playerPos.x, playerPos.z));
      if (d < 168) { pose = p; break; }
    }
    if (!pose) return null;
    const car = new Car(this.scene, 'police', 0xe8e8ec, pose.x, pose.z, pose.heading);
    car.driver = 'police';
    car.lane = laneFor(car.x, car.z, car.heading);
    car.cruise = 10.5;
    car.turnCd = 0;
    car.fireT = 1 + this.rand() * 2;
    this.units.push(car);
    return car;
  }

  /** Place two interceptors across the road ahead of the player. */
  spawnRoadblock(playerPos, heading) {
    this.clearRoadblock();
    const fx = Math.sin(heading), fz = Math.cos(heading);
    let bx = playerPos.x + fx * 58, bz = playerPos.z + fz * 58;
    // Snap to the nearest road crossing so the block sits on a street.
    const nx = ROADS.reduce((a, b) => (Math.abs(b - bx) < Math.abs(a - bx) ? b : a));
    const nz = ROADS.reduce((a, b) => (Math.abs(b - bz) < Math.abs(a - bz) ? b : a));
    if (Math.abs(nx - bx) < Math.abs(nz - bz)) bx = nx; else bz = nz;
    const across = heading + Math.PI / 2;
    for (const off of [-2.6, 2.6]) {
      const car = new Car(this.scene, 'police', 0xe8e8ec,
        bx + Math.sin(across) * off, bz + Math.cos(across) * off, across);
      car.driver = 'block';
      this.blockers.push(car);
    }
  }

  clearRoadblock() {
    for (const c of this.blockers) this.scene.remove(c.mesh);
    this.blockers = [];
    this.roadblockFor = 0;
  }

  _remove(car) {
    this.scene.remove(car.mesh);
    const i = this.units.indexOf(car);
    if (i >= 0) this.units.splice(i, 1);
  }

  /**
   * ctx: {playerPos, playerVel:{x,z}, playerInCar, wanted, colliders, fx, time,
   *       onShoot(unit), radio(msg)} — returns the nearest unit distance for the siren mix.
   */
  update(dt, ctx) {
    const stars = ctx.wanted.stars();
    const pp = ctx.playerPos;
    // Spawn / despawn to the desired strength.
    this.spawnT -= dt;
    const want = this.desiredUnits(stars);
    if (this.units.length < want && this.spawnT <= 0) {
      if (this._spawn(pp, stars)) this.spawnT = 2.2;
      else this.spawnT = 0.6;
    }
    let nearest = 1e9;
    for (let i = this.units.length - 1; i >= 0; i--) {
      const car = this.units[i];
      if (car.driver === 'player') { car.flashBars(ctx.time); continue; } // a stolen unit drives itself
      const d2 = dist2(car.x, car.z, pp.x, pp.z);
      nearest = Math.min(nearest, Math.sqrt(d2));
      if (d2 > 210 * 210) { this._remove(car); continue; }
      car.flashBars(ctx.time);
      if (car.disabled) {
        car.step(dt, 0, 0, ctx.colliders, ctx.fx);
        continue;
      }
      if (stars <= 0) {
        this._patrol(car, dt, ctx);
        continue;
      }
      // Chase: aim at where the player will be in half a second.
      const tx = pp.x + (ctx.playerVel?.x ?? 0) * 0.45;
      const tz = pp.z + (ctx.playerVel?.z ?? 0) * 0.45;
      const topSpeed = car.spec.top * (0.8 + stars * 0.055);
      const dist = Math.hypot(tx - car.x, tz - car.z);
      const opts = { topSpeed };
      if (!ctx.playerInCar) opts.stopAt = 4.5; // pull up beside a suspect on foot
      const nd = driveTo(car, tx, tz, dt, opts);
      car.step(dt, nd.throttle, nd.steer, ctx.colliders, ctx.fx);
      // Officers fire at high heat when close and not moving fast.
      car.fireT -= dt;
      if (stars >= 3 && dist < 26 && Math.abs(car.speed) < 4 && car.fireT <= 0) {
        car.fireT = 0.55 + this.rand() * 0.8;
        ctx.onShoot(car);
      }
      void dist;
    }
    // Roadblocks at 4+ stars, refreshed per level.
    if (stars >= 4 && this.roadblockFor < stars) {
      this.roadblockFor = stars;
      ctx.onRoadblock?.();
    }
    if (stars < 4 && this.blockers.length) this.clearRoadblock();
    for (const b of this.blockers) b.flashBars(ctx.time);
    return nearest;
  }

  /** Patrol: lane-follow like traffic, a touch slower, watching for trouble. */
  _patrol(car, dt, ctx) {
    const lane = car.lane ?? (car.lane = laneFor(car.x, car.z, car.heading));
    const fxv = car.forwardX(), fzv = car.forwardZ();
    const crossErr = lane.axis === 'z' ? (lane.cross - car.x) : (lane.cross - car.z);
    const rx = -Math.cos(car.heading), rz = Math.sin(car.heading);
    let want = car.cruise;
    for (const o of ctx.obstacles ?? []) {
      if (o === car) continue;
      const dx = o.x - car.x, dz = o.z - car.z;
      const ahead = dx * fxv + dz * fzv;
      const side = dx * rx + dz * rz;
      if (ahead > 0.5 && ahead < 11 && Math.abs(side) < 2.1) want = ahead < 5.5 ? 0 : Math.min(want, 4);
    }
    const nd = driveTo(car, car.x + fxv * 13 + rx * crossErr, car.z + fzv * 13 + rz * crossErr, dt, { topSpeed: want });
    car.step(dt, nd.throttle, nd.steer, ctx.colliders, ctx.fx);
    // Occasionally change avenue at intersections.
    car.turnCd -= dt;
    if (car.turnCd <= 0) {
      car.turnCd = 4 + this.rand() * 5;
      if (this.rand() < 0.4) {
        car.heading += (this.rand() < 0.5 ? 1 : -1) * Math.PI / 2;
        car.lane = laneFor(car.x, car.z, car.heading);
      }
    }
  }
}
