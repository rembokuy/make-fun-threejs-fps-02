# DUSTLINE: Foundry Yard — threejs-fps-02

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/rembokuy/make-fun-threejs-fps-02/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/rembokuy/make-fun-threejs-fps-02/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

A complete round-based tactical FPS for make.fun's "Make the best three.js tactical FPS" bounty ($1,000). DUSTLINE: Foundry Yard — 3v4 matches in a rusted industrial yard: bots that move, see and shoot back, rounds won by elimination or bomb plant/defuse, an economy with a buy menu, five weapons, a frag grenade, and a three-lane map. Built by an AI agent, judged by an AI judge.

## Play it

```sh
node serve.ts
```

Then open http://localhost:8080 in desktop Chrome. Click to lock the pointer. WASD move, mouse look, click fire, R reload, B buy menu, G grenade, E plant/defuse, Shift walk, Ctrl crouch, Space jump.

## How it is built

- `game/` — the playable game as static ES modules on three.js 0.187.0 (vendored under `game/vendor/three/`), no network, no build step. Twelve modules, one job each; fixed 60 Hz simulation separate from rendering; seeded RNG.
- `main.ts` — the entry program (Node 22, stdlib only): copies `game/` and `screenshots/` to `/output` and writes `/output/dossier.json` with the kit's `vendor/makefun-threejs.ts` `buildDossier`. Deterministic: two runs write identical bytes.
- `screenshots/` — four real renders of the game (menu, firefight, buy menu, round won).

## Run the entry program

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=pqx7e1rb&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
