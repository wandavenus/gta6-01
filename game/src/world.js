// Port Solace: a procedural neon-dusk port city. A 7x7 grid of blocks between eight avenues
// each way, a waterfront promenade and the sea to the south. Buildings are boxes dressed with
// canvas-generated window and neon-sign textures; every solid registers an AABB collider that
// the shared circle collision in util.js pushes against. Layout constants are exported so
// traffic, pedestrians, the minimap and missions all agree on where the roads are.

import * as THREE from '../vendor/three.module.min.js';
import { createRandom, clamp } from './util.js';

export const PITCH = 84;                 // block pitch (lot + road)
export const ROAD_HALF = 10;             // half the road width
export const ROADS = [-294, -210, -126, -42, 42, 126, 210, 294]; // avenue centre lines
export const CITY_MIN = -304, CITY_MAX = 304;                    // outer road edges
export const WATER_Z = 322;              // shoreline
export const PROM_Z = 314;               // promenade / sand start

export const DINER = { x: -8, z: 288, name: "Sol's Diner" };
export const DEPOT = { x: 84, z: -84, name: 'Solace Couriers' };
export const POLICE_STATION = { x: -176, z: -238, name: 'Port Solace PD' };
export const HOSPITAL = { x: 160, z: -238, name: 'St. Marina Hospital' };
export const DOCKS = { x: 238, z: 296, name: 'Pier 9 Docks' };
export const HIDEOUT = { x: -238, z: 196, name: 'Viper Hideout' };

const SIGN_WORDS = ['NEON RAMEN', 'PALM CLUB', 'HOTEL VISTA', 'KAIYO', 'LUMEN LOUNGE', 'ORBIT BAR', 'TIDE & CO',
  'MARINA INN', 'VELVET', 'PIER 9', 'SOLACE BANK', 'NIGHT OWL', 'CORAL', 'AZURA', 'DOCK 7', 'PALMS', 'ECHO', 'SABLE'];
const NEON = ['#ff5d8f', '#4dc9ff', '#ffd94d', '#7dffb0', '#c792ff', '#ff9d5c'];

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A facade: flat colour with a grid of windows, some lit warm, some cool, some dark. */
function facadeTexture(rand, base, litRatio) {
  return canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    const cols = 6, rows = 12, cw = w / cols, ch = h / rows;
    for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) {
      const r = rand();
      g.fillStyle = r < litRatio ? (rand() < 0.7 ? '#ffd9a0' : '#bfe3ff') : 'rgba(10,12,20,0.85)';
      g.fillRect(x * cw + 3, y * ch + 4, cw - 6, ch - 8);
    }
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, h - 10, w, 10);
  });
}

function signTexture(text, color) {
  return canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#0d0a14'; g.fillRect(0, 0, w, h);
    g.font = '900 30px "Avenir Next", sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = color; g.shadowBlur = 16;
    g.fillStyle = color;
    g.fillText(text, w / 2, h / 2 + 1);
    g.shadowBlur = 6; g.fillText(text, w / 2, h / 2 + 1);
  });
}

/** The whole street plan painted once onto one big ground texture. */
function groundTexture() {
  const S = 2048, W = 680, k = S / W; // world span -340..340
  const px = (v) => (v + 340) * k;
  return canvasTex(S, S, (g) => {
    g.fillStyle = '#33363f'; g.fillRect(0, 0, S, S); // block concrete base
    g.fillStyle = '#4a4f5c';
    for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) {
      const cx = -252 + i * PITCH, cz = -252 + j * PITCH;
      g.fillRect(px(cx - 32), px(cz - 32), 64 * k, 64 * k); // sidewalk apron
      g.fillStyle = '#3d414d';
      g.fillRect(px(cx - 27), px(cz - 27), 54 * k, 54 * k); // lot
      g.fillStyle = '#4a4f5c';
    }
    // Roads: asphalt bands along every centre line.
    g.fillStyle = '#22242c';
    for (const c of ROADS) {
      g.fillRect(px(c - ROAD_HALF), px(CITY_MIN), (ROAD_HALF * 2) * k, (CITY_MAX - CITY_MIN) * k);
      g.fillRect(px(CITY_MIN), px(c - ROAD_HALF), (CITY_MAX - CITY_MIN) * k, (ROAD_HALF * 2) * k);
    }
    // Promenade + beach to the south.
    g.fillStyle = '#5c5348'; g.fillRect(px(-340), px(304), S, (PROM_Z - 304) * k);
    g.fillStyle = '#8a7a5c'; g.fillRect(px(-340), px(PROM_Z), S, (WATER_Z - PROM_Z + 18) * k);
    // Lane dashes.
    g.fillStyle = '#c8b06a';
    for (const c of ROADS) {
      for (let v = CITY_MIN; v < CITY_MAX; v += 12) {
        g.fillRect(px(c) - 1, px(v), 2, 6 * k);
        g.fillRect(px(v), px(c) - 1, 6 * k, 2);
      }
    }
    // Crosswalks at intersections.
    g.fillStyle = 'rgba(230,230,230,0.5)';
    for (const cx of ROADS) for (const cz of ROADS) {
      for (let s = -8; s <= 8; s += 4) {
        g.fillRect(px(cx + s - 1), px(cz - ROAD_HALF), 2, 3 * k);
        g.fillRect(px(cx + s - 1), px(cz + ROAD_HALF - 3), 2, 3 * k);
        g.fillRect(px(cx - ROAD_HALF), px(cz + s - 1), 3 * k, 2);
        g.fillRect(px(cx + ROAD_HALF - 3), px(cz + s - 1), 3 * k, 2);
      }
    }
  });
}

export class World {
  constructor(scene, seed = 7) {
    this.rand = createRandom(seed * 1000 + 17);
    this.colliders = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this._buildLights(scene);
    this._buildGround();
    this._buildBlocks();
    this._buildWaterfront();
    this._buildSkyline();
    this._buildProps();
  }

  _addCollider(x, z, w, d) {
    this.colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
  }

  _buildLights(scene) {
    scene.fog = new THREE.Fog(0x3a2340, 120, 620);
    const sky = canvasTex(4, 256, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#241a4d'); gr.addColorStop(0.45, '#5c2a5e');
      gr.addColorStop(0.72, '#c65363'); gr.addColorStop(0.92, '#ff9d5c'); gr.addColorStop(1, '#ffb36b');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    scene.background = sky;
    const hemi = new THREE.HemisphereLight(0x8a6bb8, 0x1f1626, 0.75);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffb36b, 1.9);
    sun.position.set(-160, 130, 260);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -95; sun.shadow.camera.right = 95;
    sun.shadow.camera.top = 95; sun.shadow.camera.bottom = -95;
    sun.shadow.camera.far = 700;
    sun.shadow.bias = -0.0006;
    scene.add(sun); scene.add(sun.target);
    this.sun = sun;
    // A low sun disc on the horizon over the water.
    const disc = new THREE.Mesh(new THREE.CircleGeometry(46, 24),
      new THREE.MeshBasicMaterial({ color: 0xffc98a, fog: false }));
    disc.position.set(-190, 26, 640);
    disc.lookAt(0, 26, 0);
    scene.add(disc);
  }

  _buildGround() {
    const tex = groundTexture();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(680, 680),
      new THREE.MeshLambertMaterial({ map: tex }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400),
      new THREE.MeshLambertMaterial({ color: 0x191423 }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.08;
    this.group.add(outer);
  }

  _facades() {
    if (this._facadeMats) return this._facadeMats;
    const rand = this.rand;
    const bases = ['#4b4258', '#5a4638', '#3c4a5c', '#584a63', '#46524a', '#63505e'];
    this._facadeMats = bases.map((b) => new THREE.MeshLambertMaterial({ map: facadeTexture(rand, b, 0.42) }));
    this._roofMat = new THREE.MeshLambertMaterial({ color: 0x241f2c });
    return this._facadeMats;
  }

  _building(x, z, w, d, h, mat, signText) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, [mat, mat, this._roofMat, this._roofMat, mat, mat]);
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.group.add(mesh);
    this._addCollider(x, z, w, d);
    if (signText) {
      const color = NEON[(this.rand() * NEON.length) | 0];
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(w * 0.9, 16), 3.4),
        new THREE.MeshBasicMaterial({ map: signTexture(signText, color) }));
      sign.position.set(x, Math.min(h - 2.5, 7), z + d / 2 + 0.12);
      this.group.add(sign);
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(w * 0.95, 17), 4.2),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }));
      glow.position.set(x, Math.min(h - 2.5, 7), z + d / 2 + 0.06);
      this.group.add(glow);
    }
    return mesh;
  }

  _buildBlocks() {
    const rand = this.rand;
    const mats = this._facades();
    const special = new Map([
      ['3,6', 'diner'], ['1,0', 'police'], ['5,0', 'hospital'], ['4,2', 'depot'], ['0,5', 'hideout'],
    ]);
    for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) {
      const cx = -252 + i * PITCH, cz = -252 + j * PITCH;
      const kind = special.get(i + ',' + j);
      if (kind === 'diner') {
        this._building(cx - 6, cz + 14, 34, 16, 7, mats[1], "SOL'S DINER");
        this._building(cx + 16, cz - 12, 14, 30, 16, mats[3], null);
        continue;
      }
      if (kind === 'police') {
        this._building(cx, cz - 6, 38, 26, 11, mats[2], 'PORT SOLACE PD');
        continue;
      }
      if (kind === 'hospital') {
        this._building(cx, cz - 6, 40, 26, 15, mats[0], 'ST. MARINA');
        continue;
      }
      if (kind === 'depot') {
        this._building(cx - 4, cz + 10, 36, 18, 8, mats[4], 'SOLACE COURIERS');
        this._building(cx + 14, cz - 14, 16, 20, 22, mats[5], null);
        continue;
      }
      if (kind === 'hideout') {
        this._building(cx - 8, cz, 26, 30, 9, mats[5], null);
        this._building(cx + 16, cz - 10, 14, 18, 26, mats[2], null);
        continue;
      }
      const style = rand();
      if (style < 0.34) {
        const w = 26 + rand() * 14, d = 26 + rand() * 14, h = 26 + rand() * 62;
        const sign = rand() < 0.5 ? SIGN_WORDS[(rand() * SIGN_WORDS.length) | 0] : null;
        this._building(cx, cz, w, d, h, mats[(rand() * mats.length) | 0], sign);
      } else if (style < 0.72) {
        for (const [ox, oz] of [[-13, -13], [13, 13]]) {
          const w = 20 + rand() * 6, d = 20 + rand() * 6, h = 12 + rand() * 26;
          const sign = rand() < 0.3 ? SIGN_WORDS[(rand() * SIGN_WORDS.length) | 0] : null;
          this._building(cx + ox, cz + oz, w, d, h, mats[(rand() * mats.length) | 0], sign);
        }
      } else {
        for (const [ox, oz] of [[-13, -13], [13, 13], [-13, 13], [13, 13]]) {
          const w = 20 + rand() * 5, d = 20 + rand() * 5, h = 6 + rand() * 7;
          const sign = rand() < 0.55 ? SIGN_WORDS[(rand() * SIGN_WORDS.length) | 0] : null;
          this._building(cx + ox, cz + oz, w, d, h, mats[(rand() * mats.length) | 0], sign);
        }
      }
    }
  }

  _buildWaterfront() {
    const tex = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = '#14405f'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(140,210,255,0.25)';
      for (let i = 0; i < 42; i++) {
        g.beginPath();
        const y = Math.random() * h;
        g.moveTo(Math.random() * w, y);
        g.lineTo(Math.random() * w, y + 2);
        g.stroke();
      }
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(18, 10);
    this.waterTex = tex;
    const water = new THREE.Mesh(new THREE.PlaneGeometry(1600, 560),
      new THREE.MeshPhongMaterial({ map: tex, color: 0x9fc8ff, shininess: 90, specular: 0xff9d5c }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -0.04, WATER_Z + 278);
    this.group.add(water);
    const wood = new THREE.MeshLambertMaterial({ color: 0x6b4e33 });
    const pier = new THREE.Mesh(new THREE.BoxGeometry(70, 1, 26), wood);
    pier.position.set(DOCKS.x, 0.2, WATER_Z + 8);
    pier.castShadow = true;
    this.group.add(pier);
    const cols = [0xc24b4b, 0x4b7dc2, 0x4bc27a, 0xc2a44b, 0x7a4bc2];
    for (let i = 0; i < 7; i++) {
      const cx = 196 + (i % 4) * 13, cz = 296 + ((i / 4) | 0) * 7;
      const m = new THREE.Mesh(new THREE.BoxGeometry(11, 3, 5.4),
        new THREE.MeshLambertMaterial({ color: cols[i % cols.length] }));
      m.position.set(cx, 1.5, cz);
      m.castShadow = true;
      this.group.add(m);
      if (cz < 300) this._addCollider(cx, cz, 11, 5.4);
    }
  }

  _buildSkyline() {
    const mat = new THREE.MeshBasicMaterial({ color: 0x241a38 });
    const rand = this.rand;
    for (let i = 0; i < 46; i++) {
      const ang = (i / 46) * Math.PI * 2;
      if (Math.sin(ang) > 0.55) continue; // leave the sea horizon open
      const r = 430 + rand() * 130;
      const h = 40 + rand() * 120;
      const m = new THREE.Mesh(new THREE.BoxGeometry(26 + rand() * 30, h, 26 + rand() * 30), mat);
      m.position.set(Math.cos(ang) * r, h / 2 - 2, Math.sin(ang) * r);
      this.group.add(m);
    }
  }

  _buildProps() {
    const rand = this.rand;
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.13, 6.4, 5);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x2c2f38 });
    const headGeo = new THREE.BoxGeometry(0.5, 0.18, 1.4);
    const headMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
    const spots = [];
    for (const c of ROADS) for (let v = CITY_MIN + 6; v < CITY_MAX; v += 42) {
      spots.push([c + 11.5, v, 0], [c - 11.5, v + 21, 0], [v, c + 11.5, 1], [v + 21, c - 11.5, 1]);
    }
    for (const [x, z, horiz] of spots) {
      if (z > 306) continue;
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(x, 3.2, z);
      this.group.add(pole);
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.set(x, 6.4, z);
      if (horiz) head.rotation.y = Math.PI / 2;
      this.group.add(head);
    }
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 5.6, 5);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5c40 });
    const frondGeo = new THREE.ConeGeometry(2.6, 1.1, 6);
    const frondMat = new THREE.MeshLambertMaterial({ color: 0x2e7d4f });
    const palmAt = (x, z) => {
      const t = new THREE.Group();
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.y = 2.8; trunk.rotation.z = (rand() - 0.5) * 0.16;
      trunk.castShadow = true;
      const top = new THREE.Mesh(frondGeo, frondMat);
      top.position.y = 5.9; top.rotation.x = Math.PI;
      t.add(trunk, top);
      t.position.set(x, 0, z);
      this.group.add(t);
      this._addCollider(x, z, 0.7, 0.7);
    };
    for (let x = -290; x <= 290; x += 29) palmAt(x + (rand() - 0.5) * 6, 309 + rand() * 3);
    for (let i = 0; i < 34; i++) {
      const bx = -252 + ((rand() * 7) | 0) * PITCH, bz = -252 + ((rand() * 7) | 0) * PITCH;
      palmAt(bx + (rand() < 0.5 ? -30 : 30), bz + (rand() < 0.5 ? -30 : 30));
    }
    const dumpMat = new THREE.MeshLambertMaterial({ color: 0x2f5d43 });
    const crateMat = new THREE.MeshLambertMaterial({ color: 0x8a6a42 });
    for (let i = 0; i < 40; i++) {
      const bx = -252 + ((rand() * 7) | 0) * PITCH, bz = -252 + ((rand() * 7) | 0) * PITCH;
      const x = bx + (rand() - 0.5) * 46, z = bz + 29;
      const m = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.3, 1.3), rand() < 0.6 ? dumpMat : crateMat);
      m.position.set(x, 0.65, z);
      m.castShadow = true;
      this.group.add(m);
      this._addCollider(x, z, 2.4, 1.3);
    }
  }

  /** Per-frame: scroll the water, keep the shadow camera centred on the action. */
  update(dt, focus) {
    if (this.waterTex) {
      this.waterTex.offset.x += dt * 0.008;
      this.waterTex.offset.y += dt * 0.005;
    }
    if (focus && this.sun) {
      this.sun.position.set(focus.x - 160, 130, focus.z + 260);
      this.sun.target.position.set(focus.x, 0, focus.z);
    }
  }
}

/** Clamp a position to the playable streets (no swimming, no leaving town). */
export function clampToCity(p) {
  p.x = clamp(p.x, CITY_MIN - 6, CITY_MAX + 6);
  p.z = clamp(p.z, CITY_MIN - 6, PROM_Z + 2);
  return p;
}

/** Nearest point on any road centre line — used to spawn things on streets. */
export function roadPoint(x, z) {
  const nx = ROADS.reduce((a, b) => (Math.abs(b - x) < Math.abs(a - x) ? b : a));
  const nz = ROADS.reduce((a, b) => (Math.abs(b - z) < Math.abs(a - z) ? b : a));
  return Math.abs(nx - x) < Math.abs(nz - z) ? { x: nx, z } : { x, z: nz };
}
