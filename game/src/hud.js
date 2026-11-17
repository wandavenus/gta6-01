// The HUD: DOM bars, stars, cash, objective banner, subtitles, prompts and toasts, plus the
// canvas minimap (round, north-up, ~150 m across) and the full-city map behind the M key.
// Everything is updated only when its value changes, except the minimap which redraws a few
// dozen lines and dots per frame.

import { ROADS, WATER_Z, CITY_MIN, CITY_MAX, DINER, DEPOT, POLICE_STATION, HOSPITAL } from './world.js';
import { money } from './util.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.root = $('hud');
    this.cashEl = $('cash');
    this.starsEl = $('stars');
    this.healthEl = $('healthfill');
    this.carRow = [$('carlabel'), $('carfill').parentElement];
    this.carEl = $('carfill');
    this.weaponEl = $('weapon');
    this.magEl = $('mag');
    this.reserveEl = $('reserve');
    this.speedWrap = $('speedwrap');
    this.speedEl = $('speedo');
    this.gearEl = $('gear');
    this.objEl = $('objective');
    this.objTitle = $('objtitle');
    this.objSub = $('objsub');
    this.objMeta = $('objmeta');
    this.subEl = $('subtitle');
    this.promptEl = $('prompt');
    this.bannerEl = $('banner');
    this.crossEl = $('cross');
    this.vigEl = $('vig');
    this.bigWrap = $('bigmapwrap');
    this.mini = $('minimap').getContext('2d');
    this.big = $('bigmap').getContext('2d');
    this._cash = null;
    this._stars = null;
    this._subQueue = [];
    this._subT = 0;
    this._bannerT = 0;
    this.bigOpen = false;
  }

  show() { this.root.classList.remove('hidden'); }
  hide() { this.root.classList.add('hidden'); }

  setCash(n) {
    if (n === this._cash) return;
    this._cash = n;
    this.cashEl.innerHTML = money(n) + '<small>PORT SOLACE</small>';
  }

  setStars(n, blink) {
    const key = n + (blink ? 'b' : '');
    if (key === this._stars) return;
    this._stars = key;
    let html = '';
    for (let i = 0; i < 5; i++) html += `<span class="${i < n ? 'on' : 'off'}">★</span>`;
    this.starsEl.innerHTML = html;
    this.starsEl.classList.toggle('blink', !!blink);
  }

  setHealth(frac) {
    this.healthEl.style.width = Math.max(0, Math.min(1, frac)) * 100 + '%';
  }
  setCarHealth(frac) {
    const show = frac !== null && frac !== undefined;
    for (const el of this.carRow) el.style.display = show ? '' : 'none';
    if (show) this.carEl.style.width = Math.max(0, Math.min(1, frac)) * 100 + '%';
  }
  setWeapon(mag, reserve, drawn) {
    this.weaponEl.classList.toggle('hidden', !drawn);
    this.crossEl.classList.toggle('hidden', !drawn);
    if (drawn) { this.magEl.textContent = mag; this.reserveEl.textContent = reserve; }
  }
  setSpeed(kmh, label, driving) {
    this.speedWrap.classList.toggle('hidden', !driving);
    if (driving) {
      this.speedEl.innerHTML = Math.round(Math.abs(kmh)) + '<small> KM/H</small>';
      this.gearEl.textContent = label ?? '';
    }
  }
  setObjective(o) {
    if (!o) { this.objEl.classList.add('hidden'); return; }
    this.objEl.classList.remove('hidden');
    this.objTitle.textContent = o.title ?? '';
    this.objSub.textContent = o.sub ?? '';
    this.objMeta.textContent = o.meta ?? '';
  }
  prompt(html) {
    if (html) {
      this.promptEl.innerHTML = html;
      this.promptEl.classList.remove('hidden');
    } else this.promptEl.classList.add('hidden');
  }
  say(who, text, color = '#ffd94d', dur = 3.4) {
    this._subQueue.push({ who, text, color, dur });
  }
  clearSpeech() { this._subQueue = []; this._subT = 0; this.subEl.classList.add('hidden'); }
  banner(big, small = '', dur = 2.6) {
    this.bannerEl.querySelector('.big').textContent = big;
    this.bannerEl.querySelector('.small').textContent = small;
    this.bannerEl.classList.remove('hidden');
    this._bannerT = dur;
  }
  toast(text, color = '#7dffb0') {
    const box = $('toast');
    const el = document.createElement('div');
    el.className = 'toastitem';
    el.style.borderLeftColor = color;
    el.textContent = text;
    box.appendChild(el);
    setTimeout(() => el.remove(), 3600);
    while (box.children.length > 4) box.firstChild.remove();
  }
  setVignette(v) { this.vigEl.style.opacity = v.toFixed(2); }
  toggleBigMap() {
    this.bigOpen = !this.bigOpen;
    this.bigWrap.classList.toggle('hidden', !this.bigOpen);
    return this.bigOpen;
  }

  update(dt) {
    if (this._subT > 0) {
      this._subT -= dt;
      if (this._subT <= 0) this.subEl.classList.add('hidden');
    } else if (this._subQueue.length) {
      const line = this._subQueue.shift();
      this.subEl.innerHTML = '';
      const who = document.createElement('span');
      who.className = 'who';
      who.style.color = line.color;
      who.textContent = line.who;
      this.subEl.appendChild(who);
      this.subEl.appendChild(document.createTextNode(line.text));
      this.subEl.classList.remove('hidden');
      this._subT = line.dur;
    }
    if (this._bannerT > 0) {
      this._bannerT -= dt;
      if (this._bannerT <= 0) this.bannerEl.classList.add('hidden');
    }
  }

  /** view: {px, pz, heading, blip:{x,z,color}|null, police:[{x,z}], time} */
  drawMinimap(view) {
    const g = this.mini, S = 172, C = S / 2, RANGE = 78;
    const k = C / RANGE;
    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath(); g.arc(C, C, C - 2, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#23202e'; g.fillRect(0, 0, S, S);
    const X = (wx) => C + (wx - view.px) * k;
    const Z = (wz) => C + (wz - view.pz) * k;
    // Water.
    g.fillStyle = '#14405f';
    g.fillRect(0, Z(WATER_Z), S, S - Z(WATER_Z));
    // Roads.
    g.strokeStyle = '#55506a'; g.lineWidth = 7;
    for (const c of ROADS) {
      g.beginPath(); g.moveTo(X(c), 0); g.lineTo(X(c), S); g.stroke();
      g.beginPath(); g.moveTo(0, Z(c)); g.lineTo(S, Z(c)); g.stroke();
    }
    // Police blips.
    for (const p of view.police) {
      g.fillStyle = Math.floor(view.time * 3) % 2 ? '#ff5d5d' : '#5d8fff';
      g.beginPath(); g.arc(X(p.x), Z(p.z), 3.4, 0, Math.PI * 2); g.fill();
    }
    // Objective blip.
    if (view.blip) {
      const bx = Math.max(8, Math.min(S - 8, X(view.blip.x)));
      const bz = Math.max(8, Math.min(S - 8, Z(view.blip.z)));
      g.fillStyle = view.blip.color;
      g.beginPath(); g.arc(bx, bz, 4.6 + Math.sin(view.time * 5) * 1.1, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.6)'; g.stroke();
    }
    // Player arrow: drawn pointing up, rotated by PI - heading (map y is +z/south).
    g.translate(C, C);
    g.rotate(Math.PI - view.heading);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(0, -7); g.lineTo(4.6, 5.5); g.lineTo(0, 2.6); g.lineTo(-4.6, 5.5);
    g.closePath(); g.fill();
    g.restore();
    // North marker + rim.
    g.fillStyle = '#ffd94d';
    g.font = '800 11px sans-serif';
    g.textAlign = 'center';
    g.fillText('N', C, 14);
  }

  drawBigMap(view) {
    const g = this.big, S = 640;
    const k = S / (CITY_MAX - CITY_MIN + 40);
    const X = (wx) => (wx - CITY_MIN + 20) * k;
    const Z = (wz) => (wz - CITY_MIN + 20) * k;
    g.fillStyle = '#1b1826'; g.fillRect(0, 0, S, S);
    g.fillStyle = '#14405f'; g.fillRect(0, Z(WATER_Z), S, S);
    g.fillStyle = '#2c2838';
    for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) {
      g.fillRect(X(-252 + i * 84 - 27), Z(-252 + j * 84 - 27), 54 * k, 54 * k);
    }
    g.strokeStyle = '#5a5470'; g.lineWidth = 9;
    for (const c of ROADS) {
      g.beginPath(); g.moveTo(X(c), Z(CITY_MIN)); g.lineTo(X(c), Z(CITY_MAX)); g.stroke();
      g.beginPath(); g.moveTo(X(CITY_MIN), Z(c)); g.lineTo(X(CITY_MAX), Z(c)); g.stroke();
    }
    const label = (p, text, color) => {
      g.fillStyle = color;
      g.beginPath(); g.arc(X(p.x), Z(p.z), 5, 0, Math.PI * 2); g.fill();
      g.font = '700 12px sans-serif'; g.textAlign = 'left';
      g.fillText(text, X(p.x) + 9, Z(p.z) + 4);
    };
    label(DINER, "Sol's Diner", '#ffd94d');
    label(DEPOT, 'Solace Couriers', '#7dd7ff');
    label(POLICE_STATION, 'Police', '#5d8fff');
    label(HOSPITAL, 'Hospital', '#ff8fa0');
    for (const p of view.police) {
      g.fillStyle = Math.floor(view.time * 3) % 2 ? '#ff5d5d' : '#5d8fff';
      g.beginPath(); g.arc(X(p.x), Z(p.z), 4, 0, Math.PI * 2); g.fill();
    }
    if (view.blip) {
      g.fillStyle = view.blip.color;
      g.beginPath(); g.arc(X(view.blip.x), Z(view.blip.z), 7 + Math.sin(view.time * 5) * 1.6, 0, Math.PI * 2); g.fill();
    }
    g.save();
    g.translate(X(view.px), Z(view.pz));
    g.rotate(Math.PI - view.heading);
    g.fillStyle = '#fff';
    g.beginPath();
    g.moveTo(0, -9); g.lineTo(6, 7); g.lineTo(0, 3.4); g.lineTo(-6, 7);
    g.closePath(); g.fill();
    g.restore();
    g.fillStyle = '#ffd94d';
    g.font = '800 15px sans-serif';
    g.textAlign = 'center';
    g.fillText('N ↑', S / 2, 22);
    g.fillStyle = '#f3eefc';
    g.font = '800 17px sans-serif';
    g.fillText('PORT SOLACE', S / 2, S - 14);
  }
}
