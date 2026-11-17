// The story of one long night in Port Solace: six jobs for fixer Mama Sol, told as data and
// run by a small stage machine (go places, pick up, deliver, tail, race checkpoints, escape).
// Plus Package Rush, the repeatable delivery job at Solace Couriers. The runner talks to the
// game only through the G context main.js hands it (spawn helpers, wanted, cash, dialogue).

import { DINER, DEPOT, DOCKS, HIDEOUT } from './world.js';

const SOL = '#ffd94d', ROOK = '#7dd7ff', RADIO = '#ff9d9d', SABLE = '#9dff70', CREW = '#e8e2f5';

export const MISSIONS = [
  {
    id: 'm1', title: 'FIRST WHEELS', reward: 150,
    intro: [
      ['MAMA SOL', 'Rook. You made it to Port Solace.', SOL],
      ['MAMA SOL', "I'm Mama Sol. In this town everything moves by car — and I move everything.", SOL],
      ['ROOK', 'I just need work, ma\'am.', ROOK],
      ['MAMA SOL', "Then drive. My teal Vanta is outside. Take it down to Pier 9 and tell the foreman the kitchen sent you.", SOL],
    ],
    outro: [
      ['FOREMAN', "Sol's new runner, huh. Don't scratch the paint.", CREW],
      ['MAMA SOL', "You're hired. Come back to the diner — there's always another package.", SOL],
    ],
    stages: [
      { kind: 'getin', title: 'FIRST WHEELS', sub: 'Get into Mama Sol\'s teal Vanta Coupe outside the diner.' },
      { kind: 'goto', x: DOCKS.x, z: 288, r: 10, title: 'FIRST WHEELS', sub: 'Drive to Pier 9 on the waterfront.' },
    ],
  },
  {
    id: 'm2', title: 'HOT PACKAGE', reward: 300,
    intro: [
      ['MAMA SOL', 'A guest at the Palms left a suitcase in the alley behind the hotel, west side. Fetch it.', SOL],
      ['MAMA SOL', 'Then take it to the Coral garage across town. Don\'t open it. Don\'t stop.', SOL],
      ['ROOK', 'And if the lights behind me turn red and blue?', ROOK],
      ['MAMA SOL', 'Then you keep driving, baby.', SOL],
    ],
    outro: [
      ['MAMA SOL', 'Paid in full. Whatever was in that case — we never saw it.', SOL],
    ],
    stages: [
      { kind: 'pickup', x: -84, z: 118, r: 6, title: 'HOT PACKAGE', sub: 'Collect the suitcase from the alley.',
        onArrive: (G) => { G.wanted.setAtLeast(1); G.say([['POLICE RADIO', 'Dispatch — suspect vehicle took the package. All units, keep eyes open.', RADIO]]); } },
      { kind: 'goto', x: 168, z: 36, r: 8, timer: 150, title: 'HOT PACKAGE', sub: 'Deliver the suitcase to the Coral garage.', failText: 'The buyer gave up waiting.' },
    ],
  },
  {
    id: 'm3', title: 'VIPER TAIL', reward: 350,
    intro: [
      ['MAMA SOL', 'The Vipers have been lifting my cargo off the docks. I want their nest.', SOL],
      ['MAMA SOL', 'One of their Fangs leaves the east market about now. Follow it home — close enough to see, far enough to live.', SOL],
    ],
    outro: [
      ['ROOK', 'Found it. Old warehouse, west side, green door.', ROOK],
      ['MAMA SOL', 'Good eyes. We pay them a visit soon.', SOL],
    ],
    stages: [
      { kind: 'tail', title: 'VIPER TAIL', sub: 'Tail the Viper Fang. Stay between 12 m and 80 m.',
        spawn: (G) => G.spawnScriptCar('viper', 0x1d3b26, 252, -42, -Math.PI / 2,
          [[126, -42], [42, -126], [-126, -126], [-210, -42], [-294, 42], [-294, 196]], 11.5) },
    ],
  },
  {
    id: 'm4', title: 'HARBOR SPRINT', reward: 450,
    intro: [
      ['MAMA SOL', 'A client pays for speed, not stories. Eight lights around the harbor, Rook.', SOL],
      ['MAMA SOL', 'Hit every one before the clock eats you.', SOL],
    ],
    outro: [
      ['MAMA SOL', 'Fastest courier on the water. The client sends his regards — and his money.', SOL],
    ],
    stages: [
      { kind: 'race', title: 'HARBOR SPRINT', sub: 'Drive through every checkpoint.', timer: 210,
        points: [[210, 42], [42, 210], [-126, 294], [-294, 42], [-210, -126], [-42, -294], [126, -210], [294, -42]],
        failText: 'The clock ate you.' },
    ],
  },
  {
    id: 'm5', title: 'HEAT WAVE', reward: 400,
    intro: [
      ['MAMA SOL', 'Rook, listen to me. The Vipers dropped your name and your plate at the precinct.', SOL],
      ['MAMA SOL', 'Every badge in Port Solace is hunting you. Lose them. Then come home.', SOL],
    ],
    outro: [
      ['MAMA SOL', 'Gone like harbor fog. You\'re learning, baby.', SOL],
    ],
    stages: [
      { kind: 'escape', title: 'HEAT WAVE', sub: 'Lose the police: break their line of sight until the stars are gone.',
        onStart: (G) => { G.wanted.setAtLeast(3); G.say([['POLICE RADIO', 'All units — the courier is priority one. Bring him in.', RADIO]]); } },
    ],
  },
  {
    id: 'm6', title: 'THE BRIEFCASE', reward: 1000,
    intro: [
      ['MAMA SOL', 'Last job of the night, and the biggest. A briefcase, in the Viper warehouse you found.', SOL],
      ['MAMA SOL', 'Bring it to Pier 9. Sable himself will try to stop you.', SOL],
      ['ROOK', 'Let him try.', ROOK],
    ],
    outro: [
      ['SABLE', 'You have no idea what you just carried, courier.', SABLE],
      ['MAMA SOL', 'Port Solace is ours tonight, Rook. All of it. Get some sleep — the city won\'t.', SOL],
    ],
    stages: [
      { kind: 'pickup', x: HIDEOUT.x, z: 178, r: 7, title: 'THE BRIEFCASE', sub: 'Take the briefcase from the Viper warehouse.',
        onArrive: (G) => {
          G.wanted.setAtLeast(3);
          G.spawnChaser(-210, 126);
          G.spawnChaser(-126, 252);
          G.say([['SABLE', 'That case stays with the Vipers. Take him down!', SABLE]]);
        } },
      { kind: 'goto', x: DOCKS.x, z: 288, r: 10, title: 'THE BRIEFCASE', sub: 'Deliver the briefcase to Pier 9. Survive.' },
    ],
  },
];

/** A repeatable delivery: from the depot to a random address, paid by distance. */
export function makeSideJob(rand) {
  const spots = [[-252, -42], [126, 126], [-42, -252], [252, 84], [-168, 210], [84, -84], [210, -210], [-252, 252], [42, 42], [168, -42]];
  const [x, z] = spots[(rand() * spots.length) | 0];
  const dist = Math.hypot(x - DEPOT.x, z - DEPOT.z);
  return {
    id: 'side', title: 'PACKAGE RUSH', side: true,
    reward: Math.round(35 + dist * 0.16),
    intro: [['DISPATCH', 'One parcel, one address, no questions. Clock\'s running.', CREW]],
    outro: [['DISPATCH', 'Signed for. Money\'s in your pocket.', CREW]],
    stages: [
      { kind: 'goto', x, z, r: 8, timer: Math.round(dist / 10.5) + 30, title: 'PACKAGE RUSH', sub: 'Deliver the parcel.', failText: 'The customer cancelled.' },
    ],
  };
}

export class MissionRunner {
  constructor() {
    this.active = null;
    this.stage = null;
    this.stageIdx = 0;
  }

  get busy() { return this.active !== null; }

  start(def, G) {
    this.active = def;
    this.stageIdx = 0;
    G.say(def.intro);
    this._beginStage(G);
  }

  _beginStage(G) {
    const def = this.active.stages[this.stageIdx];
    this.stage = {
      ...def,
      t: def.timer ?? null,
      progress: 0,
      lostT: 0,
      closeT: 0,
      pointIdx: 0,
      target: null,
    };
    if (def.kind === 'tail' && def.spawn) this.stage.target = def.spawn(G);
    if (def.onStart) def.onStart(G);
    if (def.kind === 'getin') this.stage.car = G.missionCar;
  }

  abandon() {
    this.active = null;
    this.stage = null;
  }

  /** The world position the minimap should mark, or null. */
  blip() {
    const s = this.stage;
    if (!s) return null;
    if (s.kind === 'goto' || s.kind === 'pickup') return { x: s.x, z: s.z, color: '#ffd94d' };
    if (s.kind === 'race') {
      const p = s.points[Math.min(s.pointIdx, s.points.length - 1)];
      return { x: p[0], z: p[1], color: '#ffd94d' };
    }
    if (s.kind === 'tail' && s.target) return { x: s.target.car.x, z: s.target.car.z, color: '#ff5d5d' };
    return null;
  }

  objective(actor) {
    const s = this.stage;
    if (!s) return null;
    let meta = '';
    if (s.t !== null) meta = 'TIME ' + Math.max(0, Math.ceil(s.t)) + 's';
    if (s.kind === 'goto' || s.kind === 'pickup') {
      const d = Math.round(Math.hypot(actor.x - s.x, actor.z - s.z));
      meta = (meta ? meta + ' · ' : '') + d + ' m';
      if (s.kind === 'pickup' && s.progress > 0) meta = 'LOADING… ' + Math.round(s.progress * 100) + '%';
    }
    if (s.kind === 'race') meta = (meta ? meta + ' · ' : '') + 'CHECKPOINT ' + (s.pointIdx + 1) + ' / ' + s.points.length;
    if (s.kind === 'tail' && s.target) meta = 'DISTANCE ' + Math.round(Math.hypot(actor.x - s.target.car.x, actor.z - s.target.car.z)) + ' m';
    if (s.kind === 'escape') meta = 'STAY OUT OF SIGHT';
    return { title: s.title, sub: s.sub, meta };
  }

  update(dt, G) {
    const s = this.stage;
    if (!s || !this.active) return;
    const actor = G.actorPos();
    if (s.t !== null) {
      s.t -= dt;
      if (s.t <= 0) return G.failMission(s.failText || 'Out of time.');
    }
    switch (s.kind) {
      case 'getin':
        if (G.playerCar && G.playerCar === s.car) this._next(G);
        break;
      case 'goto': {
        if (Math.hypot(actor.x - s.x, actor.z - s.z) < s.r) this._arrive(G);
        break;
      }
      case 'pickup': {
        const near = Math.hypot(actor.x - s.x, actor.z - s.z) < s.r;
        if (near) {
          s.progress += dt / 1.2;
          if (s.progress >= 1) this._arrive(G);
        } else s.progress = Math.max(0, s.progress - dt * 2);
        break;
      }
      case 'race': {
        const p = s.points[s.pointIdx];
        if (p && Math.hypot(actor.x - p[0], actor.z - p[1]) < 11) {
          s.pointIdx++;
          G.sfx.pickup();
          G.hud.toast('Checkpoint ' + s.pointIdx + ' / ' + s.points.length, '#ffd94d');
          if (s.pointIdx >= s.points.length) this._next(G);
        }
        break;
      }
      case 'tail': {
        const t = s.target;
        if (!t) break;
        const d = Math.hypot(actor.x - t.car.x, actor.z - t.car.z);
        if (d > 88) { s.lostT += dt; if (s.lostT > 5) return G.failMission('You lost the Viper.'); }
        else s.lostT = Math.max(0, s.lostT - dt);
        if (d < 11.5) { s.closeT += dt; if (s.closeT > 2.5) return G.failMission('You were made. The Viper bolted.'); }
        else s.closeT = Math.max(0, s.closeT - dt);
        if (t.arrived) this._next(G);
        break;
      }
      case 'escape':
        if (G.wanted.stars() === 0) this._next(G);
        break;
    }
  }

  _arrive(G) {
    const s = this.stage;
    if (s.onArrive) s.onArrive(G);
    this._next(G);
  }

  _next(G) {
    this.stageIdx++;
    if (this.stageIdx >= this.active.stages.length) {
      const def = this.active;
      this.active = null;
      this.stage = null;
      G.completeMission(def);
    } else {
      this._beginStage(G);
    }
  }
}

export const DINER_MARKER = { x: DINER.x, z: 288 };
export const DEPOT_MARKER = { x: DEPOT.x, z: -46 };
