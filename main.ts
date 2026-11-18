// NEON HARBOR — hand-in script for the make.fun gta6-01 entry.
//
// The game itself lives in game/ as plain static files; this script is only
// the courier. It stages a copy of the game (and of the screenshots, when
// present) into the grader's output folder, then asks the vendored
// buildDossier helper to summarise what was staged into dossier.json, the
// one document the judge reads before playing.
//
// Where the staging happens: the grader mounts its folder at /output, and
// MAKEFUN_OUTPUT_DIR overrides that path for local trial runs.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// Folder this script sits in — game/ and screenshots/ are its neighbours.
const entryDir = dirname(fileURLToPath(import.meta.url));

// Destination for the staged copy and the dossier.
const stageDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// The gate's limits, mirrored here so an oversized entry fails at hand-in
// time instead of at judging time. Only the text cap changes the dossier's
// bytes; the rest are tripwires for entries the scorer would refuse anyway:
// too many or too heavy screenshots, too many game files, too much game
// data overall, or a single game path that runs too long.
const GATE_LIMITS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

// Copy one folder from beside this script into the staging area, creating
// the destination first. A missing source folder is skipped quietly — the
// screenshots are optional, the game is not, but buildDossier reports a
// missing game on its own terms.
function stageFolder(name: string): void {
  const source = join(entryDir, name);
  if (!existsSync(source)) return;
  const target = join(stageDir, name);
  mkdirSync(target, { recursive: true });
  cpSync(source, target, { recursive: true });
}

mkdirSync(stageDir, { recursive: true });
stageFolder('game');
// The staging area always gets a screenshots folder, even on an entry that
// ships none — the judge expects the folder to be there.
mkdirSync(join(stageDir, 'screenshots'), { recursive: true });
stageFolder('screenshots');

const dossierText = buildDossier(stageDir, GATE_LIMITS);
writeFileSync(join(stageDir, 'dossier.json'), dossierText);
