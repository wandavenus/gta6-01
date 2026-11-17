// NEON HARBOR — the orchestrator. Boots three.js, builds Port Solace, wires every system
// (world, traffic, pedestrians, police, missions, combat, HUD, sound, save) into one loop,
// and owns the game states: menu, play, pause, busted/wasted, and the deterministic
// screenshot scenes behind ?shot=cover|drive|chase|foot&seed=N.

import * as THREE from '../vendor/three.module.min.js';
import { createRandom, clamp, dist2, losBlocked } from './util.js';
import { World, DINER, HOSPITAL } from './world.js';
import { Car, Traffic, Particles, collideCars, driveTo, randomRoadPose, CAR_COLORS } from './vehicles.js';
import { Player, PedManager } from './people.js';
import { Wanted, PoliceManager } from './police.js';
import { MISSIONS, makeSideJob, MissionRunner, DINER_MARKER, DEPOT_MARKER } from './missions.js';
import { HUD } from './hud.js';
import { SoundFX } from './audio.js';
import { loadSave, writeSave } from './save.js';

const params = new URLSearchParams(location.search);
const SEED = Number(params.get('seed') ?? 7) || 7;
const SHOT = params.get('shot');
const rand = createRandom(SEED * 777 + 5);

// ---------------------------------------------------------------- renderer / scene
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 1500);
camera.position.set(0, 14, 330);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- world & cast
const world = new World(scene, SEED);
const fx = new Particles(scene);
const traffic = new Traffic(scene, rand);
const peds = new PedManager(scene, rand, 26);
const police = new PoliceManager(scene, rand);
const player = new Player(scene);
const wanted = new Wanted();
const runner = new MissionRunner();
const hud = new HUD();
const sfx = new SoundFX();

const TRAFFIC_TYPES = ['sedan', 'sedan', 'hatch', 'taxi', 'coupe', 'van', 'hatch', 'sedan'];
for (let i = 0; i < 13; i++) {
  const pose = randomRoadPose(rand, { x: 0, z: 262 }, 30);
  traffic.addCar(TRAFFIC_TYPES[(rand() * TRAFFIC_TYPES.length) | 0],
    CAR_COLORS[(rand() * CAR_COLORS.length) | 0], pose.x, pose.z, pose.heading);
}
for (let i = 0; i < 7; i++) {
  const vertical = rand() < 0.5;
  const lines = [-294, -210, -126, -42, 42, 126, 210, 294];
  const line = lines[(rand() * lines.length) | 0];
  const along = -280 + rand() * 540;
  const side = rand() < 0.5 ? -8.3 : 8.3;
  const x = vertical ? line + side : along;
  const z = vertical ? along : line + side;
  const heading = vertical ? (side > 0 ? Math.PI : 0) : (side > 0 ? -Math.PI / 2 : Math.PI / 2);
  traffic.addCar(TRAFFIC_TYPES[(rand() * TRAFFIC_TYPES.length) | 0],
    CAR_COLORS[(rand() * CAR_COLORS.length) | 0], x, z, heading, true);
}
// Mama Sol's teal Vanta — the first mission's car, parked outside the diner.
let missionCar = traffic.addCar('coupe', 0x1f8a8a, -20, 289, Math.PI / 2, true);

// Script-driven cars (the Viper you tail) and Viper chasers: {car, points, idx, speed, arrived, kind}
const extras = [];
function spawnScriptCar(type, color, x, z, heading, route, speed) {
  const car = new Car(scene, type, color, x, z, heading);
  car.driver = 'script';
  const entry = { car, points: route.map(([px, pz]) => ({ x: px, z: pz })), idx: 0, speed, arrived: false, kind: 'script' };
  extras.push(entry);
  return entry;
}
function spawnChaser(x, z) {
  const car = new Car(scene, 'viper', 0x14301d, x, z, 0);
  car.driver = 'viper';
  extras.push({ car, kind: 'chaser' });
  return car;
}
function clearChasers() {
  for (let i = extras.length - 1; i >= 0; i--) {
    if (extras[i].kind === 'chaser') {
      scene.remove(extras[i].car.mesh);
      extras.splice(i, 1);
    }
  }
}

// Objective beacon: a column of light moved to wherever the game wants you to go.
function makeBeacon(color) {
  const grp = new THREE.Group();
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 34, 12, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.y = 17;
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.7, 2.3, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.15;
  grp.add(beam, ring);
  scene.add(grp);
  return grp;
}
const dinerBeacon = makeBeacon(0xffd94d);
dinerBeacon.position.set(DINER_MARKER.x, 0, DINER_MARKER.z);
const depotBeacon = makeBeacon(0x4dc9ff);
depotBeacon.position.set(DEPOT_MARKER.x, 0, DEPOT_MARKER.z);
const objBeacon = makeBeacon(0xffd94d);
objBeacon.visible = false;

// ---------------------------------------------------------------- game state
let state = 'menu'; // menu | play | pause | over | shot
let time = 0;
let cash = 120;
let storyIndex = 0;
let storyDone = false;
let sideJobs = 0;
let playerCar = null;
let bustedMeter = 0;
let markerCd = 0;
let ammoCd = 0;
let prevStars = 0;
let shake = 0;
let overKind = null; // 'busted' | 'wasted'
const settings = { music: true, shadows: true, sound: true };
const savedGame = loadSave();
if (savedGame?.settings) Object.assign(settings, savedGame.settings);

// Combat state.
const gun = { drawn: false, mag: 12, reserve: 48, reloadT: 0, shotCd: 0, crimeCd: 0 };
const tracers = [];
{
  const geo = new THREE.BoxGeometry(0.035, 0.035, 1);
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    m.visible = false;
    scene.add(m);
    tracers.push({ m, life: 0 });
  }
}
const muzzleLight = new THREE.PointLight(0xffc060, 0, 16);
scene.add(muzzleLight);
const pickups = []; // {mesh, x, z, kind:'ammo'}
const ammoGeo = new THREE.BoxGeometry(0.5, 0.3, 0.35);
const ammoMat = new THREE.MeshBasicMaterial({ color: 0x53b06a });
function dropAmmo(x, z) {
  const m = new THREE.Mesh(ammoGeo, ammoMat);
  m.position.set(x, 0.5, z);
  scene.add(m);
  pickups.push({ mesh: m, x, z, kind: 'ammo' });
}

// ---------------------------------------------------------------- crime & consequence
function isWitnessed(x, z, radius) {
  for (const p of peds.peds) {
    if (p.state === 'dead') continue;
    if (dist2(x, z, p.x, p.z) < radius * radius && !losBlocked(x, z, p.x, p.z, world.colliders)) return true;
  }
  for (const u of police.units) {
    if (dist2(x, z, u.x, u.z) < 48 * 48) return true;
  }
  return false;
}
function addCrime(points, x, z, radius = 20) {
  if (isWitnessed(x, z, radius)) {
    wanted.add(points);
    return true;
  }
  return false;
}
const RADIO_LINES = {
  1: 'Dispatch — keep eyes on the courier in Port Solace.',
  2: 'Suspect is hot. Intercept, do not engage alone.',
  3: 'All units: the courier is priority one. Bring him in.',
  4: 'Roadblocks authorized. Repeat — roadblocks authorized.',
  5: 'Port Solace is locked down. Nobody sleeps till he is caught.',
};

// ---------------------------------------------------------------- the G context for missions
const G = {
  hud, sfx, wanted,
  get playerCar() { return playerCar; },
  get missionCar() { return missionCar; },
  actorPos() { return playerCar ? { x: playerCar.x, z: playerCar.z } : { x: player.x, z: player.z }; },
  say(lines) { for (const [who, text, color] of lines) hud.say(who, text, color); },
  spawnScriptCar,
  spawnChaser(x, z) { return spawnChaser(x, z); },
  completeMission(def) {
    cash += def.reward;
    sfx.jingle(true);
    sfx.cash();
    if (def.side) {
      sideJobs++;
      hud.banner('DELIVERY DONE', '+' + '$' + def.reward + ' — Solace Couriers thanks you');
    } else {
      storyIndex++;
      hud.banner('MISSION COMPLETE', def.title + ' · +$' + def.reward);
      if (storyIndex >= MISSIONS.length) {
        storyDone = true;
        setTimeout(() => hud.banner('STORY COMPLETE', 'Port Solace is yours, Rook. Free roam — Package Rush still pays.'), 3000);
      }
    }
    G.say(def.outro);
    markerCd = 3.5;
    saveGame();
  },
  failMission(reason) {
    runner.abandon();
    clearChasers();
    hud.banner('MISSION FAILED', reason, 3.2);
    sfx.jingle(false);
    markerCd = 4;
  },
};

// ---------------------------------------------------------------- save
function saveGame() {
  writeSave({
    cash, storyIndex, storyDone, sideJobs,
    pos: { x: player.x, z: player.z },
    settings,
  });
  hud.toast('Game saved');
}
function applySettings() {
  sfx.setEnabled(settings.sound);
  sfx.setMusic(settings.music);
  world.sun.castShadow = settings.shadows;
  for (const id of ['setMusic', 'setMusic2']) document.getElementById(id).textContent = settings.music ? 'ON' : 'OFF';
  for (const id of ['setShadows', 'setShadows2']) document.getElementById(id).textContent = settings.shadows ? 'ON' : 'OFF';
  for (const id of ['setSound', 'setSound2']) document.getElementById(id).textContent = settings.sound ? 'ON' : 'OFF';
}

// ---------------------------------------------------------------- input
const keys = new Set();
let camYaw = Math.PI, camPitch = 0.24;
let mouseDown = false;
addEventListener('pointerdown', () => sfx.unlock());
addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  sfx.unlock();
  if (state === 'play') {
    if (e.code === 'KeyF') toggleCar();
    if (e.code === 'Digit1') toggleGun();
    if (e.code === 'KeyR') startReload();
    if (e.code === 'KeyM') hud.toggleBigMap();
    if (e.code === 'KeyN') { settings.music = !settings.music; applySettings(); }
    if (e.code === 'KeyP' || e.code === 'Escape') pauseGame();
  } else if (state === 'pause' && (e.code === 'KeyP' || e.code === 'Escape')) resumeGame();
  if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
canvas.addEventListener('mousedown', (e) => {
  sfx.unlock();
  if (state !== 'play') return;
  if (document.pointerLockElement !== canvas) { canvas.requestPointerLock(); return; }
  if (e.button === 0) {
    mouseDown = true;
    if (!playerCar) {
      if (gun.drawn) fireGun();
      else punch();
    }
  }
});
addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas || state !== 'play') return;
  camYaw -= e.movementX * 0.0026;
  camPitch = clamp(camPitch + e.movementY * 0.0022, -0.45, 1.05);
});
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== canvas && state === 'play' && !SHOT) pauseGame();
});

// ---------------------------------------------------------------- menus
const $ = (id) => document.getElementById(id);
function showMenu() {
  state = 'menu';
  hud.hide();
  $('menu').classList.remove('hidden');
  $('pause').classList.add('hidden');
  $('over').classList.add('hidden');
  $('btnContinue').classList.toggle('hidden', !savedGame && storyIndex === 0 && cash === 120);
}
function startPlay(fresh) {
  $('menu').classList.add('hidden');
  $('over').classList.add('hidden');
  hud.show();
  state = 'play';
  if (fresh) hud.say('MAMA SOL', 'Gold marker, Rook. That\'s where the work is.', '#ffd94d', 4);
}
function pauseGame() {
  if (state !== 'play') return;
  state = 'pause';
  $('pause').classList.remove('hidden');
  if (document.pointerLockElement === canvas) document.exitPointerLock();
  sfx.setEngine(0, false);
  sfx.setSiren(0);
}
function resumeGame() {
  $('pause').classList.add('hidden');
  state = 'play';
}
function endScreen(kind) {
  state = 'over';
  overKind = kind;
  $('overTitle').textContent = kind === 'busted' ? 'BUSTED' : 'WASTED';
  $('overTitle').style.color = kind === 'busted' ? '#5d8fff' : '#ff5d73';
  $('overSub').textContent = kind === 'busted'
    ? 'The precinct keeps a cut of your cash.'
    : 'St. Marina patches you up — for a fee.';
  $('over').classList.remove('hidden');
  if (document.pointerLockElement === canvas) document.exitPointerLock();
  sfx.stopEngine();
  sfx.setSiren(0);
}
function respawn() {
  $('over').classList.add('hidden');
  if (playerCar) exitCar(true);
  wanted.clear();
  police.clearRoadblock();
  bustedMeter = 0;
  player.health = 100;
  const at = overKind === 'busted' ? { x: -168, z: -234 } : { x: 168, z: -234 };
  player.pos.set(at.x, 0, at.z);
  player.heading = Math.PI;
  camYaw = Math.PI;
  state = 'play';
}
$('btnNew').onclick = () => {
  sfx.unlock(); sfx.click();
  cash = 120; storyIndex = 0; storyDone = false; sideJobs = 0;
  wanted.clear();
  if (playerCar) exitCar(true);
  player.pos.set(0, 0, 262); player.heading = Math.PI; camYaw = Math.PI;
  player.health = 100;
  gun.mag = 12; gun.reserve = 48; gun.drawn = false;
  startPlay(true);
};
$('btnContinue').onclick = () => {
  sfx.unlock(); sfx.click();
  if (savedGame) {
    cash = savedGame.cash ?? cash;
    storyIndex = savedGame.storyIndex ?? 0;
    storyDone = !!savedGame.storyDone;
    sideJobs = savedGame.sideJobs ?? 0;
    if (savedGame.pos) player.pos.set(savedGame.pos.x, 0, savedGame.pos.z);
  }
  startPlay(false);
};
$('btnHow').onclick = () => { sfx.click(); $('howpanel').classList.toggle('hidden'); };
$('btnResume').onclick = () => { sfx.click(); resumeGame(); };
$('btnSave').onclick = () => { sfx.click(); saveGame(); };
$('btnQuit').onclick = () => { sfx.click(); saveGame(); $('pause').classList.add('hidden'); showMenu(); };
$('btnRespawn').onclick = () => { sfx.click(); respawn(); };
for (const [id, key] of [['setMusic', 'music'], ['setMusic2', 'music'], ['setShadows', 'shadows'], ['setShadows2', 'shadows'], ['setSound', 'sound'], ['setSound2', 'sound']]) {
  $(id).onclick = () => { settings[key] = !settings[key]; applySettings(); sfx.click(); };
}
applySettings();

/** Mama's Vanta must be waiting outside the diner when the first job starts. */
function ensureMissionCar() {
  if (playerCar === missionCar) return;
  const home = dist2(missionCar.x, missionCar.z, -20, 289) < 45 * 45;
  if (!missionCar.disabled && home) return;
  const i = traffic.cars.indexOf(missionCar);
  if (i >= 0) traffic.cars.splice(i, 1);
  scene.remove(missionCar.mesh);
  missionCar = traffic.addCar('coupe', 0x1f8a8a, -20, 289, Math.PI / 2, true);
}

// ---------------------------------------------------------------- cars: enter / exit
function nearestCar(maxD) {
  let best = null, bd = maxD * maxD;
  for (const c of allCars()) {
    const d = dist2(player.x, player.z, c.x, c.z);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}
function allCars() {
  const list = [...traffic.cars, ...police.allCars()];
  for (const e of extras) list.push(e.car);
  return list;
}
function toggleCar() {
  if (playerCar) { exitCar(false); return; }
  const car = nearestCar(3.6);
  if (!car) return;
  if (car.disabled) { hud.toast('That ride is wrecked.', '#ff9d9d'); return; }
  if (Math.abs(car.speed) > 3) { hud.toast('Too fast to take!', '#ff9d9d'); return; }
  enterCar(car);
}
function enterCar(car) {
  const wasTraffic = car.driver === 'traffic';
  const wasParked = car.parked;
  car.parked = false;
  car.driver = 'player';
  playerCar = car;
  player.mesh.visible = false;
  car.setHeadlights(true);
  car.onCrash = (intensity) => {
    sfx.crash(intensity);
    shake = Math.min(0.5, intensity * 0.5);
    if (intensity > 0.45) player.hurt((intensity - 0.4) * 16, time);
  };
  sfx.door();
  sfx.startEngine();
  if ((wasTraffic || wasParked) && car !== missionCar) {
    if (car.isPolice) addCrime(2, car.x, car.z, 24);
    else if (addCrime(1, car.x, car.z, 20)) hud.toast('Car stolen — someone saw that.', '#ff9d9d');
  }
  hud.toast(car.spec.name, '#7dd7ff');
}
function exitCar(silent) {
  const car = playerCar;
  if (!car) return;
  car.driver = null;
  car.onCrash = null;
  car.setHeadlights(false);
  playerCar = null;
  const rx = -Math.cos(car.heading), rz = Math.sin(car.heading);
  player.pos.set(car.x + rx * 2.1, 0, car.z + rz * 2.1);
  player.heading = car.heading;
  player.mesh.visible = true;
  if (!silent) sfx.door();
  sfx.stopEngine();
}

// ---------------------------------------------------------------- combat
function toggleGun() {
  if (playerCar) return;
  gun.drawn = !gun.drawn;
  player.aiming = gun.drawn;
  sfx.click();
}
function startReload() {
  if (!gun.drawn || gun.reloadT > 0 || gun.mag >= 12 || gun.reserve <= 0) return;
  gun.reloadT = 1.1;
  sfx.reload();
}
const raycaster = new THREE.Raycaster();
const screenCenter = new THREE.Vector2(0, 0);
function fireGun() {
  if (gun.reloadT > 0 || gun.shotCd > 0) return;
  if (gun.mag <= 0) { sfx.click(); startReload(); return; }
  gun.mag--;
  gun.shotCd = 0.16;
  sfx.gunshot();
  peds.fleeArea(player.x, player.z, 26);
  if (gun.crimeCd <= 0) { addCrime(1, player.x, player.z, 30); gun.crimeCd = 2.5; }
  // Hitscan from the camera through the crosshair.
  raycaster.setFromCamera(screenCenter, camera);
  const o = raycaster.ray.origin, d = raycaster.ray.direction;
  let bestT = 130, hitPed = null, hitCar = null;
  for (const p of peds.peds) {
    if (p.state === 'dead') continue;
    for (const [cy, r] of [[1.15, 0.62], [1.66, 0.3]]) {
      const vx = p.x - o.x, vy = cy - o.y, vz = p.z - o.z;
      const t = vx * d.x + vy * d.y + vz * d.z;
      if (t < 0.5 || t > bestT) continue;
      const px = o.x + d.x * t - p.x, py = o.y + d.y * t - cy, pz = o.z + d.z * t - p.z;
      if (px * px + py * py + pz * pz < r * r) { bestT = t; hitPed = p; hitCar = null; }
    }
  }
  for (const c of allCars()) {
    const vx = c.x - o.x, vy = 0.75 - o.y, vz = c.z - o.z;
    const t = vx * d.x + vy * d.y + vz * d.z;
    if (t < 0.5 || t > bestT) continue;
    const px = o.x + d.x * t - c.x, py = o.y + d.y * t - 0.75, pz = o.z + d.z * t - c.z;
    const rr = c.radius + 0.35;
    if (px * px + py * py * 2.2 + pz * pz < rr * rr) { bestT = t; hitCar = c; hitPed = null; }
  }
  const end = new THREE.Vector3(o.x + d.x * bestT, o.y + d.y * bestT, o.z + d.z * bestT);
  const muzzle = new THREE.Vector3(player.x + Math.sin(player.heading) * 0.45, 1.42, player.z + Math.cos(player.heading) * 0.45);
  spawnTracer(muzzle, end, 0xffd9a0);
  muzzleLight.position.copy(muzzle);
  muzzleLight.intensity = 26;
  if (hitPed) {
    const headshot = end.y > 1.5;
    hitPed.damage(headshot ? 100 : 34, fx, player.x, player.z);
    if (hitPed.state === 'dead') addCrime(1.2, hitPed.x, hitPed.z, 30);
  } else if (hitCar) {
    hitCar.damage(9, fx);
    fx.spawn(end.x, end.y, end.z, { color: 0xffc060, scale: 0.5, life: 0.3, vy: 0.6, spread: 2 });
    if (hitCar.isPolice) addCrime(1.2, hitCar.x, hitCar.z, 34);
    if (hitCar.disabled && hitCar.isPolice && Math.random() < 0.5) dropAmmo(hitCar.x, hitCar.z);
  } else {
    fx.spawn(end.x, Math.max(0.2, end.y), end.z, { color: 0xcccccc, scale: 0.4, life: 0.3, vy: 0.5, spread: 1.5 });
  }
  shake = Math.min(shake + 0.05, 0.12);
}
function punch() {
  if (player.punchT > 0) return;
  player.punchT = 0.38;
  const fxv = Math.sin(player.heading), fzv = Math.cos(player.heading);
  const p = peds.nearest(player.x + fxv * 1.1, player.z + fzv * 1.1, 1.5);
  setTimeout(() => {
    if (state !== 'play') return;
    if (p && p.state !== 'dead' && dist2(p.x, p.z, player.x, player.z) < 2.1 * 2.1) {
      p.damage(30, fx, player.x, player.z);
      sfx.punch();
      addCrime(0.8, p.x, p.z, 18);
      if (p.state !== 'dead') { p.state = 'down'; p.stateT = 2.6; }
    }
  }, 110);
}
function spawnTracer(from, to, color) {
  const t = tracers.find((x) => x.life <= 0) || tracers[0];
  t.life = 0.07;
  t.m.visible = true;
  t.m.material.color.setHex(color);
  t.m.material.opacity = 0.9;
  t.m.position.copy(from).add(to).multiplyScalar(0.5);
  t.m.lookAt(to);
  t.m.scale.set(1, 1, from.distanceTo(to));
}
function policeShoot(unit) {
  const from = new THREE.Vector3(unit.x, 1.25, unit.z);
  const targetPos = playerCar
    ? new THREE.Vector3(playerCar.x, 0.9, playerCar.z)
    : new THREE.Vector3(player.x, 1.1, player.z);
  spawnTracer(from, targetPos, 0xff7a5c);
  sfx.gunshot();
  const roll = Math.random();
  if (playerCar) {
    if (roll < 0.34) {
      playerCar.damage(4, fx);
      if (roll < 0.12) player.hurt(2.5, time);
    }
  } else if (roll < 0.4) {
    player.hurt(4 + Math.random() * 5, time);
    sfx.hurt();
    shake = Math.min(shake + 0.14, 0.3);
  }
}

// ---------------------------------------------------------------- per-frame updates
function updatePlayer(dt) {
  if (playerCar) {
    let throttle = 0, steer = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) throttle = 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) throttle = -1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) steer = -1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) steer = 1;
    if (keys.has('Space')) {
      playerCar.speed -= playerCar.speed * 3.2 * dt;
      steer *= 1.35;
    }
    playerCar.step(dt, throttle, steer, world.colliders, fx);
    sfx.setEngine(clamp(Math.abs(playerCar.speed) / playerCar.spec.top, 0, 1), true);
    player.pos.set(playerCar.x, 0, playerCar.z);
    player.heading = playerCar.heading;
    return;
  }
  const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const r = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const fxv = Math.sin(camYaw), fzv = Math.cos(camYaw);
  const rx = -Math.cos(camYaw), rz = Math.sin(camYaw);
  player.update(dt, {
    x: fxv * f + rx * r,
    z: fzv * f + rz * r,
    sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    jump: keys.has('Space'),
  }, world.colliders, time);
  if (gun.drawn) player.heading = camYaw;
}

function updateExtras(dt) {
  const actor = G.actorPos();
  for (let i = extras.length - 1; i >= 0; i--) {
    const e = extras[i];
    if (e.car.driver === 'player' || e.car.disabled) {
      if (e.car.driver !== 'player') e.car.step(dt, 0, 0, world.colliders, fx);
      continue;
    }
    if (e.kind === 'script') {
      const target = e.points[e.idx];
      if (!target) { e.arrived = true; continue; }
      const last = e.idx === e.points.length - 1;
      const nd = driveTo(e.car, target.x, target.z, dt, { topSpeed: e.speed, slowNear: last, stopAt: last ? 2 : 0 });
      e.car.step(dt, nd.throttle, nd.steer, world.colliders, fx);
      if (nd.dist < 7) {
        e.idx++;
        if (e.idx >= e.points.length) e.arrived = true;
      }
      if (dist2(e.car.x, e.car.z, actor.x, actor.z) > 260 * 260) { /* keep: the tail target matters */ }
    } else if (e.kind === 'chaser') {
      const nd = driveTo(e.car, actor.x, actor.z, dt, { topSpeed: e.car.spec.top * 0.94 });
      e.car.step(dt, nd.throttle, nd.steer, world.colliders, fx);
      if (dist2(e.car.x, e.car.z, actor.x, actor.z) > 240 * 240) {
        scene.remove(e.car.mesh);
        extras.splice(i, 1);
      }
    }
  }
}

function updateWorld(dt) {
  time += dt;
  world.update(dt, G.actorPos());
  fx.update(dt);
  const cars = allCars();
  const obstacles = cars.map((c) => ({ x: c.x, z: c.z }));
  const pedPts = peds.peds.filter((p) => p.state !== 'dead').map((p) => ({ x: p.x, z: p.z }));
  if (!playerCar) pedPts.push({ x: player.x, z: player.z });
  traffic.update(dt, { colliders: world.colliders, fx, obstacles, peds: pedPts });
  peds.update(dt, {
    colliders: world.colliders, cars, fx, playerPos: player.pos,
    onEvent: (ev) => {
      if (ev.type === 'pedHit' && ev.car.driver === 'player') {
        sfx.crash(0.5);
        addCrime(ev.lethal ? 1.2 : 0.7, ev.ped.x, ev.ped.z, 26);
        if (playerCar && Math.abs(playerCar.speed) > 9) player.hurt(2, time);
      }
    },
  });
  updateExtras(dt);
  collideCars(cars, fx, (a, b, intensity) => {
    const playerInvolved = a === playerCar || b === playerCar;
    if (playerInvolved) {
      sfx.crash(intensity);
      shake = Math.min(0.55, intensity * 0.55);
      const other = a === playerCar ? b : a;
      if (other.driver === 'traffic') addCrime(0.4, other.x, other.z, 22);
      if (other.isPolice) addCrime(0.6, other.x, other.z, 30);
    }
  });
  // Police.
  const actor = G.actorPos();
  const actorVel = playerCar
    ? { x: playerCar.forwardX() * playerCar.speed, z: playerCar.forwardZ() * playerCar.speed }
    : { x: 0, z: 0 };
  const nearestPolice = police.update(dt, {
    playerPos: actor, playerVel: actorVel, playerInCar: !!playerCar,
    wanted, colliders: world.colliders, fx, time, obstacles,
    onShoot: policeShoot,
    onRoadblock: () => {
      police.spawnRoadblock(actor, playerCar ? playerCar.heading : camYaw);
      hud.toast('Roadblock ahead!', '#ff9d9d');
    },
  });
  // Are we seen? Any unit close with line of sight.
  let seen = false;
  for (const u of police.units) {
    if (u.driver === 'player') continue;
    const d2 = dist2(actor.x, actor.z, u.x, u.z);
    if (d2 < 20 * 20) { seen = true; break; }
    if (d2 < 58 * 58 && !losBlocked(actor.x, actor.z, u.x, u.z, world.colliders)) { seen = true; break; }
  }
  wanted.update(dt, seen);
  const stars = wanted.stars();
  if (stars > prevStars) {
    hud.say('POLICE RADIO', RADIO_LINES[stars] || '', '#ff9d9d', 2.8);
    sfx.radioBlip();
  }
  prevStars = stars;
  sfx.setSiren(clamp(1 - nearestPolice / 75, 0, 1) * (stars > 0 ? 1 : 0.35));
  // Busted meter.
  let busting = false;
  if (stars > 0) {
    for (const u of police.units) {
      if (u.driver === 'player') continue;
      const d = Math.sqrt(dist2(actor.x, actor.z, u.x, u.z));
      if ((!playerCar && d < 7.5) || (playerCar && Math.abs(playerCar.speed) < 1.2 && d < 9)) { busting = true; break; }
    }
  }
  bustedMeter = clamp(bustedMeter + (busting ? dt / 2.4 : -dt * 0.7), 0, 1);
  if (bustedMeter >= 1) return doBusted();
  // Mission logic.
  runner.update(dt, G);
  // Beacons.
  dinerBeacon.visible = !runner.busy && !storyDone;
  depotBeacon.visible = !runner.busy;
  const blip = runner.blip();
  objBeacon.visible = !!blip;
  if (blip) objBeacon.position.set(blip.x, 0, blip.z);
  const pulse = 0.26 + Math.sin(time * 4) * 0.08;
  for (const b of [dinerBeacon, depotBeacon, objBeacon]) {
    b.children[0].material.opacity = pulse;
    b.rotation.y = time * 0.7;
  }
  // Markers: start jobs by stepping in.
  markerCd -= dt;
  ammoCd -= dt;
  if (!runner.busy && markerCd <= 0) {
    if (dist2(player.x, player.z, DINER_MARKER.x, DINER_MARKER.z) < 3.4 * 3.4 && !playerCar) {
      if (!storyDone) {
        if (storyIndex === 0) ensureMissionCar();
        runner.start(MISSIONS[storyIndex], G);
      }
      else { hud.toast('The night\'s story is done. Package Rush still pays.', '#7dd7ff'); markerCd = 6; }
    } else if (dist2(player.x, player.z, DEPOT_MARKER.x, DEPOT_MARKER.z) < 3.4 * 3.4 && !playerCar) {
      runner.start(makeSideJob(rand), G);
    }
  }
  // Diner restock + hospital patch-up.
  if (ammoCd <= 0 && dist2(player.x, player.z, DINER.x, DINER.z) < 36) {
    if (gun.reserve < 60) { gun.reserve = 60; hud.toast('Ammo restocked at the diner'); ammoCd = 15; }
  }
  if (ammoCd <= 0 && dist2(player.x, player.z, HOSPITAL.x, HOSPITAL.z) < 64 && player.health < 100 && !playerCar) {
    player.health = 100;
    hud.toast('Patched up at St. Marina');
    ammoCd = 15;
  }
  // Pickups.
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    p.mesh.rotation.y = time * 2.4;
    p.mesh.position.y = 0.5 + Math.sin(time * 3 + i) * 0.12;
    if (dist2(player.x, player.z, p.x, p.z) < 2 * 2) {
      gun.reserve += 12;
      sfx.pickup();
      hud.toast('+12 pistol rounds', '#7dd7ff');
      scene.remove(p.mesh);
      pickups.splice(i, 1);
    }
  }
  // Combat timers.
  gun.shotCd = Math.max(0, gun.shotCd - dt);
  gun.crimeCd = Math.max(0, gun.crimeCd - dt);
  if (gun.reloadT > 0) {
    gun.reloadT -= dt;
    if (gun.reloadT <= 0) {
      const take = Math.min(12 - gun.mag, gun.reserve);
      gun.mag += take;
      gun.reserve -= take;
    }
  }
  for (const t of tracers) {
    if (t.life > 0) {
      t.life -= dt;
      t.m.material.opacity = Math.max(0, t.life / 0.07) * 0.9;
      if (t.life <= 0) t.m.visible = false;
    }
  }
  muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 320);
  if (player.health <= 0 && state === 'play') return doWasted();
}

function doBusted() {
  if (state !== 'play') return;
  const fine = Math.min(cash, 60 + wanted.stars() * 45);
  cash -= fine;
  runner.abandon();
  clearChasers();
  hud.toast('Fine paid: $' + fine, '#ff9d9d');
  endScreen('busted');
}
function doWasted() {
  if (state !== 'play') return;
  const fee = Math.min(cash, 120);
  cash -= fee;
  runner.abandon();
  clearChasers();
  endScreen('wasted');
}

// ---------------------------------------------------------------- HUD sync
function syncHud() {
  hud.setCash(cash);
  hud.setStars(wanted.stars(), wanted.blinking);
  hud.setHealth(player.health / 100);
  hud.setCarHealth(playerCar ? playerCar.health / 100 : null);
  hud.setWeapon(gun.mag, gun.reserve, gun.drawn && !playerCar);
  hud.setSpeed(playerCar ? playerCar.speed * 3.6 : 0, playerCar ? playerCar.spec.name.toUpperCase() : '', !!playerCar);
  const actor = G.actorPos();
  let obj = runner.objective(actor);
  if (!obj) {
    obj = storyDone
      ? { title: 'PORT SOLACE', sub: 'Free roam — the night is yours. The blue marker at Solace Couriers still pays.', meta: '' }
      : { title: 'PORT SOLACE', sub: 'Gold marker at Sol\'s Diner: work. Blue marker: Package Rush deliveries.', meta: 'JOB ' + (storyIndex + 1) + ' OF ' + MISSIONS.length };
  }
  if (bustedMeter > 0.12) obj = { title: '⚠ THE POLICE ARE CLOSING IN', sub: 'Move! Break away before they take you.', meta: '' };
  hud.setObjective(state === 'play' || state === 'shot' ? obj : null);
  // Interaction prompt.
  let prompt = null;
  if (state === 'play') {
    if (playerCar) prompt = '<b>F</b> — Exit ' + playerCar.spec.name;
    else {
      const car = nearestCar(3.6);
      if (car && !car.disabled && Math.abs(car.speed) <= 3) prompt = '<b>F</b> — Enter ' + car.spec.name;
      else if (car && car.disabled) prompt = 'That ride is wrecked';
      if (gun.reloadT > 0) prompt = 'Reloading…';
    }
    if (bustedMeter > 0.12) prompt = '<b>⚠ BUSTED IN ' + Math.max(0, (1 - bustedMeter)).toFixed(1) + 's — RUN!</b>';
  }
  hud.prompt(prompt);
  hud.setVignette(clamp((time - player.lastHurtT < 0.25 ? 0.85 : 0) + (player.health < 30 ? 0.35 : 0), 0, 1));
  const blip = runner.blip() || (!runner.busy && !storyDone ? { ...DINER_MARKER, color: '#ffd94d' } : !runner.busy ? { ...DEPOT_MARKER, color: '#7dd7ff' } : null);
  const view = {
    px: actor.x, pz: actor.z, heading: playerCar ? playerCar.heading : player.heading,
    blip, police: police.units.map((u) => ({ x: u.x, z: u.z })), time,
  };
  hud.drawMinimap(view);
  if (hud.bigOpen) hud.drawBigMap(view);
}

// ---------------------------------------------------------------- camera
const camTarget = new THREE.Vector3();
function updateCamera(dt) {
  shake = Math.max(0, shake - dt * 1.8);
  const shx = (Math.random() - 0.5) * shake * 0.5;
  const shy = (Math.random() - 0.5) * shake * 0.35;
  if (state === 'menu') {
    const a = time * 0.05;
    camera.position.set(Math.sin(a) * 55, 15 + Math.sin(time * 0.13) * 2, 262 + Math.cos(a) * 55);
    camera.lookAt(DINER.x, 4, 280);
    camera.fov = 58; camera.updateProjectionMatrix();
    return;
  }
  if (playerCar) {
    const c = playerCar;
    const fxv = c.forwardX(), fzv = c.forwardZ();
    const back = 8.6 + Math.abs(c.speed) * 0.06;
    camTarget.set(c.x - fxv * back, 3.1, c.z - fzv * back);
    const k = 1 - Math.pow(0.0016, dt);
    camera.position.lerp(camTarget, k);
    camera.position.x += shx; camera.position.y += shy;
    camera.lookAt(c.x + fxv * 7, 1.3, c.z + fzv * 7);
    const fov = 62 + clamp(Math.abs(c.speed) / c.spec.top, 0, 1) * 11;
    if (Math.abs(camera.fov - fov) > 0.1) { camera.fov = fov; camera.updateProjectionMatrix(); }
    return;
  }
  // On foot: orbit camera from yaw/pitch, pulled in when a building blocks the view.
  const cp = Math.cos(camPitch), sp = Math.sin(camPitch);
  const dir = { x: Math.sin(camYaw) * cp, y: sp, z: Math.cos(camYaw) * cp };
  const head = { x: player.x, y: 1.7 + player.pos.y, z: player.z };
  let dist = 5.6;
  for (const frac of [1, 0.75, 0.5, 0.3, 0.15]) {
    const cx = head.x - dir.x * dist * frac, cy = head.y - dir.y * dist * frac + 0.4, cz = head.z - dir.z * dist * frac;
    let inside = false;
    for (const b of world.colliders) {
      if (cx > b.minX - 0.3 && cx < b.maxX + 0.3 && cz > b.minZ - 0.3 && cz < b.maxZ + 0.3 && cy < 26) { inside = true; break; }
    }
    if (!inside || frac === 0.15) {
      camera.position.set(cx + shx, Math.max(0.5, cy) + shy, cz);
      break;
    }
  }
  camera.lookAt(head.x + dir.x * 5, head.y + dir.y * 5, head.z + dir.z * 5);
  if (Math.abs(camera.fov - 62) > 0.1) { camera.fov = 62; camera.updateProjectionMatrix(); }
}

// ---------------------------------------------------------------- screenshot scenes
// Posed and deterministic: each scene's actors are placed by a small rig every frame and
// the camera is locked to a composed offset from them, so a capture taken at any moment
// shows the same frame (only wheels, light bars and the water animate). The live traffic
// and police AI never run here — ambient traffic is parked on the far north avenue first,
// so nothing can wander into a composition or knock it off its line.
let shotTick = null;
let shotCam = null;

function lockShotFov() {
  if (Math.abs(camera.fov - 62) > 0.1) { camera.fov = 62; camera.updateProjectionMatrix(); }
}

/** Place a car kinematically: position, heading, and the speed its wheels/HUD should read. */
function poseShotCar(car, x, z, heading, speed) {
  car.pos.set(x, 0, z);
  car.heading = heading;
  car.mesh.rotation.set(0, heading, 0);
  car.speed = speed;
}
function rollShotWheels(car, dt) {
  const spin = car.speed * dt / 0.35;
  for (const w of car.wheels) w.wheel.rotation.x += spin;
}

function shotTakeCar(car, x, z, heading) {
  car.parked = false;
  car.driver = 'player';
  car.setHeadlights(true);
  playerCar = car;
  player.mesh.visible = false;
  poseShotCar(car, x, z, heading, 0);
  player.pos.set(x, 0, z);
}

/** Park every ambient traffic car along the north avenue, out of every staged frame. */
function quarantineTraffic() {
  let i = 0;
  for (const car of traffic.cars) {
    if (car === missionCar) continue;
    car.parked = true;
    car.driver = null;
    poseShotCar(car, -280 + (i++) * 26, -296, Math.PI / 2, 0);
  }
}

/** Hold a pedestrian at one point of its block's sidewalk loop, standing still. */
function stageShotPed(ped, bx, bz, s) {
  ped.bx = bx; ped.bz = bz; ped.s = s; ped.dir = 1;
  ped.speed = 0; ped.phase = 0;
  ped.state = 'walk'; ped.stateT = 0;
  ped._placeOnLoop();
}

function stageShot(name) {
  state = 'shot';
  $('menu').classList.add('hidden');
  hud.show();
  dinerBeacon.visible = depotBeacon.visible = false;
  quarantineTraffic();
  if (name === 'drive' || name === 'chase') {
    // A short straight run of one neon avenue, looped: the player car holds the lane
    // centre at a constant speed and every other actor is offset-locked to it, so the
    // composition is identical on every lap.
    const isChase = name === 'chase';
    const laneX = isChase ? 47 : -47;
    const from = isChase ? 8 : 96, to = isChase ? 88 : 178;
    const speed = isChase ? 13.5 : 12.7;
    shotTakeCar(missionCar, laneX, from, 0);
    let ahead = null;
    const units = [];
    if (isChase) {
      wanted.add(3);
      for (const [ox, oz] of [[-3.4, -7.5], [3.6, -11]]) {
        const u = new Car(scene, 'police', 0xe8e8ec, laneX + ox, from + oz, 0);
        u.driver = 'shot';
        u.setHeadlights(true);
        police.units.push(u); // in the manager's list so the minimap draws their blips
        units.push({ u, ox, oz });
      }
    } else {
      ahead = new Car(scene, 'taxi', 0xf2b134, laneX, from + 26, 0);
      ahead.driver = 'shot';
      runner.start(MISSIONS[0], G); // FIRST WHEELS: the real objective banner + docks blip
    }
    let z = from;
    shotTick = (dt) => {
      z += speed * dt;
      if (z > to) z = from;
      poseShotCar(missionCar, laneX, z, 0, speed);
      rollShotWheels(missionCar, dt);
      player.pos.set(laneX, 0, z);
      if (ahead) { poseShotCar(ahead, laneX, z + 26, 0, speed); rollShotWheels(ahead, dt); }
      for (const { u, ox, oz } of units) {
        poseShotCar(u, laneX + ox, z + oz, 0, speed);
        rollShotWheels(u, dt);
        u.flashBars(time);
      }
    };
    shotCam = () => {
      const back = isChase ? 13.5 : 9.5;
      camera.position.set(laneX, isChase ? 3.6 : 3.2, z - back);
      camera.lookAt(laneX, 1.2, z + 8);
      lockShotFov();
    };
  } else if (name === 'foot') {
    // Over Rook's shoulder on the diner front: pistol raised, two pedestrians held on
    // the sidewalk loop in front of the lit SOL'S DINER sign, the Vanta parked at home.
    world.sun.intensity = 2.15; // a modest lift from the game's own key light
    player.pos.set(6, 0, 280);
    player.heading = -Math.PI / 2; // facing west along the diner front
    gun.drawn = true;
    player.aiming = true;
    stageShotPed(peds.peds[0], 0, 252, 148.5); // stands at (-1, 281.5)
    stageShotPed(peds.peds[1], 0, 252, 160.5); // stands at (-13, 281.5)
    shotCam = () => {
      const fxv = Math.sin(player.heading), fzv = Math.cos(player.heading);
      const rx = -Math.cos(player.heading), rz = Math.sin(player.heading);
      camera.position.set(player.x - fxv * 2.7 + rx * 0.95, 1.72, player.z - fzv * 2.7 + rz * 0.95);
      camera.lookAt(player.x + fxv * 6, 1.3, player.z + fzv * 6);
      lockShotFov();
    };
  } else {
    // cover (and any unknown name): Rook and the Vanta on the promenade at dusk —
    // the SOL'S DINER composition, with the camera closer and lower than before.
    world.sun.intensity = 2.15;
    missionCar.parked = true;
    poseShotCar(missionCar, -7, 307, Math.PI / 2, 0);
    player.pos.set(-13.5, 0, 304.5);
    player.heading = -0.55;
    shotCam = () => {
      camera.position.set(-17.8 + Math.sin(time * 0.1) * 0.6, 1.75, 311.8);
      camera.lookAt(-9.6, 1.35, 303.6);
      lockShotFov();
    };
  }
}

function updateShot(dt) {
  time += dt;
  if (shotTick) shotTick(dt);
  const focus = playerCar ? { x: playerCar.x, z: playerCar.z } : { x: player.x, z: player.z };
  world.update(dt, focus);
  fx.update(dt);
  runner.update(dt, G); // advances the staged mission (drive); idle in the other scenes
  const cars = allCars();
  peds.update(dt, { colliders: world.colliders, cars, fx, playerPos: focus, onEvent: null });
  if (!playerCar) player.update(dt, { x: 0, z: 0, sprint: false, jump: false }, world.colliders, time);
  if (shotCam) shotCam();
  else updateCamera(dt);
}

// ---------------------------------------------------------------- boot & loop
if (SHOT) stageShot(SHOT);
else showMenu();
document.body.dataset.nhReady = '1';

let last = performance.now();
function frame(nowMs) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (nowMs - last) / 1000);
  last = nowMs;
  if (state === 'play') {
    updatePlayer(dt);
    updateWorld(dt);
    hud.update(dt);
    syncHud();
    updateCamera(dt);
  } else if (state === 'shot') {
    updateShot(dt);
    hud.update(dt);
    syncHud();
  } else if (state === 'menu') {
    time += dt;
    world.update(dt, { x: 0, z: 270 });
    fx.update(dt);
    const obstacles = traffic.cars.map((c) => ({ x: c.x, z: c.z }));
    traffic.update(dt, { colliders: world.colliders, fx, obstacles, peds: [] });
    peds.update(dt, { colliders: world.colliders, cars: traffic.cars, fx, playerPos: { x: 0, z: 262 }, onEvent: null });
    updateCamera(dt);
  }
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
