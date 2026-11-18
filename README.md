# NEON HARBOR

[![gta6-01 on make.fun](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![entry rank](https://make.fun/badge/gta6-01/wandavenus/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01)
[![entry reward](https://make.fun/badge/gta6-01/wandavenus/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01)

NEON HARBOR is an original open-world crime game that plays entirely in a
desktop browser — no downloads, no server, no network. Everything loads from
static files and the city keeps running with the connection unplugged.

You are Rook, a courier working the neon-dusk streets of Port Solace, a port
city of 49 blocks with working docks, cargo cranes and palm-lined avenues
that glow after dark. Jobs come from Mama Sol, a fixer who knows every
loading bay and back alley on the waterfront. Cross her rivals — the Viper
crew, who treat the harbour as their own turf — and the whole city answers:
six story jobs carry Rook from small errands to open war with the Vipers,
and between them the repeatable Package Rush deliveries pay cash for fast,
clean runs across town.

Trouble is witnessed, not scripted. Commit a crime in front of pedestrians
or patrols and your wanted level climbs from one star to five, bringing
faster and angrier police; break line of sight and lie low until the heat
fades. Traffic AI drives the avenues, pedestrian AI crowds the sidewalks,
and any parked or passing car can be stolen — every vehicle takes damage,
and so does Rook, whether the ending is a shootout, a wreck, or a quiet
arrest. A live minimap and HUD track health, cash, weapon and wanted stars,
and the soundtrack is synthesised on the fly: WebAudio effects and a
brooding synthwave loop, no audio files involved.

## Controls

| Input | Action |
| --- | --- |
| WASD | Move on foot / drive |
| Mouse | Camera (click the game to lock the pointer) |
| F | Get in a car / steal one |
| Shift | Sprint |
| Space | Jump on foot / handbrake in a car |
| 1 | Draw the pistol |
| Left mouse | Punch / shoot |
| R | Reload |
| M | Map |
| Esc | Pause |

## Run it locally

```sh
node serve.ts --port 8901
```

Then open <http://localhost:8901> in desktop Chrome. Progress is saved in
the browser, so the city remembers Rook between visits.

An entry for the [make.fun gta6-01 bounty](https://make.fun/bounty/gta6-01).
MIT licensed — see LICENSE.
