// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. main.js owns the wiring — the player, the bots, the rounds
// and the HUD meet here — and the rules that need more than one of them:
// who carries the charge, who wins a round, what a kill pays.
// ?shot=start|play|buy|end with &seed=N sets up a deterministic frame for a
// capture, renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';
import { createMap } from './map.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeaponRig, WEAPONS } from './weapons.js';
import { createCombat } from './combat.js';
import { createBots } from './bots.js';
import { createRounds, PLANT_TIME, ROUND_TIME } from './rounds.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 40, 110);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const audio = createAudio();
const map = createMap(scene);
const hud = createHud();
const player = createPlayer(map.colliders);
const weapon = createWeaponRig(camera);
const input = createInput(renderer.domElement, onLockChange);
const body = player.state;

const WEAPON_ORDER = ['pistol', 'rifle', 'smg', 'shotgun', 'sniper'];
const BUY_ORDER = ['rifle', 'smg', 'shotgun', 'sniper', 'grenade', 'armor'];

// The player's body for bot raycasts: invisible in the render (opacity 0)
// but solid to the raycaster, so a bot can hit the player at all.
const playerMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
const playerTorso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.8, 0.32), playerMat);
const playerHead = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), playerMat);
playerTorso.userData.player = true;
playerTorso.userData.part = 'torso';
playerHead.userData.player = true;
playerHead.userData.part = 'head';
scene.add(playerTorso, playerHead);

// The charge: a small case with a blinking light, shown dropped or planted.
const bombMesh = new THREE.Group();
const bombCase = new THREE.Mesh(
  new THREE.BoxGeometry(0.36, 0.24, 0.24),
  new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.dark), roughness: 0.5, metalness: 0.5 }),
);
const bombLight = new THREE.Mesh(
  new THREE.SphereGeometry(0.05, 8, 6),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.rust) }),
);
bombLight.position.set(0, 0.16, 0);
bombMesh.add(bombCase, bombLight);
bombMesh.visible = false;
scene.add(bombMesh);

const playerFighter = {
  isPlayer: true,
  team: 'atk',
  chest: new THREE.Vector3(),
};

let noiseEvent = null;
let noiseStamp = 0;
let elapsed = 0;
let started = false;
let buyOpen = false;
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
let wasFiring = false;
let stepAcc = 0;
let plantHeld = 0;
let playerAlive = true;
let playerHealth = 100;

const rounds = createRounds({
  audio,
  onRoundStart(round) {
    resetPositions();
    hud.banner(`ROUND ${round}`, round === 1 ? 'Plant the charge at A or B — or wipe the Wardens out' : '', 2400);
    audio.roundStart();
    syncHud();
  },
  onLive() {
    hideBuyMenu();
    hud.banner('GO', 'Plant the charge', 1400);
    syncHud();
  },
  onRoundEnd(winner, reason) {
    const won = winner === 'atk';
    hud.banner(won ? 'ROUND WON' : 'ROUND LOST', reason, 3000);
    audio.roundEnd(won);
    syncHud();
  },
  onMatchEnd(winner) {
    const text = winner === 'atk'
      ? `Ember takes the match ${rounds.state.score.atk} — ${rounds.state.score.def}.`
      : winner === 'def'
        ? `The Wardens take the match ${rounds.state.score.def} — ${rounds.state.score.atk}.`
        : `A draw, ${rounds.state.score.atk} — ${rounds.state.score.def}.`;
    hud.showEndOverlay(winner === 'atk' ? 'MATCH WON' : winner === 'def' ? 'MATCH LOST' : 'DRAW', `${text} Play again?`, 'Play again');
    if (document.pointerLockElement) document.exitPointerLock();
  },
  onPlant(site) {
    hud.banner('CHARGE PLANTED', `Detonation in 35 seconds — hold ${site.name}`, 2600);
    hud.setBomb(`CHARGE PLANTED AT ${site.name} — DEFEND IT`, true);
    audio.plantBeep(true);
    syncHud();
  },
});

const combat = createCombat(scene, {
  colliders: map.colliders,
  audio,
  targets() {
    return map.shootables.concat(bots.hitMeshes, playerTorso, playerHead);
  },
  worldMeshes() {
    return map.shootables;
  },
  fighters() {
    const list = [playerFighter];
    for (const bot of bots.bots) if (bot.alive) list.push(bot);
    return list;
  },
  noise(pos, radius) {
    noiseStamp += 1;
    noiseEvent = { x: pos.x, z: pos.z, time: elapsed, stamp: noiseStamp };
  },
  damageBot(bot, amount, part, shooter) {
    const killed = bots.damage(bot, amount, part);
    if (shooter === 'player') {
      hud.hitMarker(killed, part === 'head');
      audio.hit(killed);
    }
    if (killed) {
      const killerName = shooter === 'player' ? 'YOU' : shooter.name;
      hud.killfeed(killerName, bot.name, part === 'head', shooter === 'player');
      if (shooter === 'player') {
        rounds.state.money += 300;
        rounds.state.kills += 1;
      }
    }
    return killed;
  },
  damagePlayer(amount, part, fromPos, shooter) {
    if (!playerAlive || shot) return;
    let left = amount;
    const loadout = rounds.state.loadout;
    if (loadout.armor > 0) {
      const absorbed = Math.min(loadout.armor, left * 0.5);
      loadout.armor -= absorbed;
      left -= absorbed;
    }
    playerHealth -= left;
    hud.damageFlash();
    audio.hurt();
    if (playerHealth <= 0) {
      playerHealth = 0;
      playerAlive = false;
      rounds.state.deaths += 1;
      hud.killfeed(shooter === 'player' ? 'YOU' : shooter.name, 'YOU', part === 'head', false);
      hud.showOverlay('dead');
      input.exitLock();
      if (rounds.state.bomb.carrier === 'player') {
        rounds.state.bomb.carrier = null;
        rounds.state.bomb.dropped = { x: body.position.x, z: body.position.z };
      }
    }
    syncHud();
  },
});

const bots = createBots(scene, map, {
  colliders: map.colliders,
  combat,
  audio,
  worldMeshes() {
    return map.shootables;
  },
  get playerPos() {
    return body.position;
  },
  get playerEye() {
    return body.eye;
  },
  get playerAlive() {
    return playerAlive;
  },
  get playerSpeed() {
    return player.groundSpeed();
  },
  get bomb() {
    return rounds.state.bomb;
  },
  takeNoise(bot) {
    if (!noiseEvent || elapsed - noiseEvent.time > 1.5) return null;
    if (bot.noiseStamp === noiseEvent.stamp) return null;
    bot.noiseStamp = noiseEvent.stamp;
    return noiseEvent;
  },
  onPlant(bot) {
    const site = map.sites.find((s) => s.name === (bot.site === 8 ? 'A' : 'B'));
    if (site) rounds.plant(site, elapsed);
  },
  onDefuse() {
    rounds.state.money += 300;
    rounds.endRound('def', 'The charge was defused.', elapsed);
  },
  onBombDrop(bot) {
    rounds.state.bomb.carrier = null;
    rounds.state.bomb.dropped = { x: bot.position.x, z: bot.position.z };
  },
  onBotHitPlayer() {
    // A bot landing a shot is its own feedback; the HUD flash covers it.
  },
});

function resetPositions() {
  const spawn = map.spawns.attackers[0];
  player.reset(spawn[0], spawn[1], 0);
  playerAlive = true;
  playerHealth = 100;
  plantHeld = 0;
  const loadout = rounds.state.loadout;
  weapon.swap(loadout.current);
  bots.reset(rounds.state.round, random);
  combat.clearGrenades();
  bombMesh.visible = false;
  hud.hideProgress();
  syncHud();
}

function syncHud() {
  const rs = rounds.state;
  hud.setHealth(playerHealth, rs.loadout.armor);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def.name.toUpperCase());
  hud.setMoney(rs.money);
  hud.setTimer(rs.timer, rs.phase);
  hud.setScore(rs.score.atk, rs.score.def, rs.round);
  hud.setAlive(
    (playerAlive ? 1 : 0) + bots.aliveCount('atk'),
    3,
    bots.aliveCount('def'),
    4,
  );
  hud.setGrenades(rs.loadout.grenades);
  if (!rs.bomb.planted) {
    hud.setBomb(
      rs.bomb.carrier === 'player'
        ? 'YOU CARRY THE CHARGE — plant it at A or B'
        : rs.bomb.dropped
          ? 'CHARGE DROPPED — pick it up'
          : rs.bomb.carrier
            ? `${rs.bomb.carrier.name} carries the charge`
            : 'EMBER attacks — plant the charge at A or B',
      false,
    );
  }
  if (buyOpen) hud.refreshBuy(rs.money, rs.loadout.weapons, rs.loadout.current);
}

function showBuyMenu() {
  if (!rounds.canBuy()) return;
  buyOpen = true;
  input.exitLock();
  hud.showBuy(rounds.state.money, (id) => {
    if (rounds.buy(id)) {
      const loadout = rounds.state.loadout;
      if (WEAPONS[id]) weapon.swap(id);
      syncHud();
    } else {
      audio.deny();
    }
  });
  hud.refreshBuy(rounds.state.money, rounds.state.loadout.weapons, rounds.state.loadout.current);
}

function hideBuyMenu() {
  if (!buyOpen) return;
  buyOpen = false;
  hud.hideBuy();
}

function syncCamera() {
  const shake = combat.takeShake();
  const sx = shake > 0 ? (random() * 2 - 1) * shake * 0.02 : 0;
  const sy = shake > 0 ? (random() * 2 - 1) * shake * 0.02 : 0;
  camera.position.set(body.position.x, body.position.y + body.eye, body.position.z);
  camera.rotation.set(body.pitch + sy, body.yaw + sx, 0, 'YXZ');
  // Sniper zoom on right mouse.
  const wantFov = input.state.aiming && weapon.def.zoom > 1 && playerAlive ? 74 / weapon.def.zoom : 74;
  if (Math.abs(camera.fov - wantFov) > 0.1) {
    camera.fov += (wantFov - camera.fov) * 0.25;
    camera.updateProjectionMatrix();
  }
  playerTorso.position.set(body.position.x, body.position.y + 1.0, body.position.z);
  playerTorso.rotation.y = body.yaw;
  playerHead.position.set(body.position.x, body.position.y + 1.53, body.position.z);
  playerFighter.chest.set(body.position.x, body.position.y + 1.15, body.position.z);
}

function aimAt(point) {
  const dx = point.x - body.position.x;
  const dy = point.y - (body.position.y + body.eye);
  const dz = point.z - body.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  body.yaw = Math.atan2(-dx, -dz);
  body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

const shootDir = new THREE.Vector3();

function shootPlayer() {
  if (!weapon.takeRound()) {
    audio.dryFire();
    return;
  }
  camera.getWorldDirection(shootDir);
  const result = combat.fire(camera.position, shootDir, weapon.def, 'player', weapon.spread(player.groundSpeed()), random);
  weapon.pullTrigger();
  player.recoil(weapon.def.kick + random() * 0.004, (random() * 2 - 1) * 0.0035);
  audio.shot(weapon.def.sound);
  if (!result.hit) hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def.name.toUpperCase());
  else syncHud();
}

function checkRoundEnd() {
  const rs = rounds.state;
  if (rs.phase !== 'live') return;
  const defAlive = bots.aliveCount('def');
  const atkAlive = (playerAlive ? 1 : 0) + bots.aliveCount('atk');
  if (defAlive === 0) {
    rounds.endRound('atk', 'All Wardens eliminated.', elapsed);
  } else if (atkAlive === 0 && !rs.bomb.planted) {
    rounds.endRound('def', 'All Ember eliminated.', elapsed);
  }
}

function step(dt) {
  elapsed += dt;
  rounds.step(dt, elapsed);
  const rs = rounds.state;

  if (rs.phase === 'buy' || rs.phase === 'live') {
    player.step(dt, input.state.keys);
    // Footsteps.
    stepAcc += player.state.stepLength;
    if (stepAcc > 2.4 && player.state.onGround && player.groundSpeed() > 2) {
      stepAcc = 0;
      audio.step();
    }
  }
  weapon.step(dt, player.groundSpeed() > 0.5);

  if (rs.phase === 'live') {
    bots.step(dt, elapsed, random);
    // Bomb pickup: the player or an ally walks over a dropped charge.
    if (rs.bomb.dropped) {
      const d = rs.bomb.dropped;
      const pdx = body.position.x - d.x;
      const pdz = body.position.z - d.z;
      if (playerAlive && pdx * pdx + pdz * pdz < 1.5 * 1.5) {
        rs.bomb.carrier = 'player';
        rs.bomb.dropped = null;
        hud.banner('CHARGE RECOVERED', 'Plant it at A or B', 1600);
      } else {
        for (const bot of bots.bots) {
          if (bot.team !== 'atk' || !bot.alive) continue;
          const bdx = bot.position.x - d.x;
          const bdz = bot.position.z - d.z;
          if (bdx * bdx + bdz * bdz < 1.5 * 1.5) {
            bot.hasBomb = true;
            rs.bomb.carrier = bot;
            rs.bomb.dropped = null;
            hud.banner(`${bot.name.toUpperCase()} HAS THE CHARGE`, '', 1600);
            break;
          }
        }
      }
    }
    // Planting: hold E inside a site while carrying the charge.
    if (playerAlive && rs.bomb.carrier === 'player' && !rs.bomb.planted) {
      const site = map.sites.find((s) => {
        const dx = body.position.x - s.x;
        const dz = body.position.z - s.z;
        return dx * dx + dz * dz < s.radius * s.radius;
      });
      if (site && input.state.keys.has('KeyE')) {
        plantHeld += dt;
        hud.showProgress(`PLANTING AT ${site.name}`, plantHeld / PLANT_TIME);
        if (plantHeld >= PLANT_TIME) {
          plantHeld = 0;
          hud.hideProgress();
          rounds.plant(site, elapsed);
        }
      } else {
        if (plantHeld > 0) hud.hideProgress();
        plantHeld = 0;
      }
    }
    checkRoundEnd();
  }

  // Charge mesh: dropped on the floor, or planted and blinking at its site.
  if (rs.bomb.dropped) {
    bombMesh.visible = true;
    bombMesh.position.set(rs.bomb.dropped.x, 0.14, rs.bomb.dropped.z);
    bombLight.material.color.set(PALETTE.rust);
  } else if (rs.bomb.planted && rs.bomb.site) {
    bombMesh.visible = true;
    bombMesh.position.set(rs.bomb.site.x, 0.14, rs.bomb.site.z);
    const blink = Math.sin(elapsed * 6) > 0;
    bombLight.material.color.set(blink ? '#ff2a1a' : PALETTE.rust);
  } else {
    bombMesh.visible = false;
  }

  combat.step(dt);
  for (const marker of map.markers) {
    marker.board.position.y = marker.baseY + Math.sin(elapsed * 1.2 + marker.phase) * 0.12;
    marker.board.rotation.y = Math.sin(elapsed * 0.4 + marker.phase) * 0.25;
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (frozen) {
    renderer.render(scene, camera);
    return;
  }
  if (started && !buyOpen) {
    const look = input.takeLook();
    player.look(look.x, look.y);
  }
  const rs = rounds.state;
  if (started && playerAlive && (rs.phase === 'buy' || rs.phase === 'live')) {
    // Fire: automatic weapons hold, semi-automatic fire on the press edge.
    const wantFire = input.state.firing && !buyOpen;
    if (wantFire && weapon.ready()) {
      if (weapon.def.auto || !wasFiring) shootPlayer();
    } else if (wantFire && weapon.state.mag === 0 && weapon.state.reserve > 0 && weapon.state.reloadLeft === 0) {
      weapon.reload();
      audio.reload();
    }
    wasFiring = input.state.firing;
    if (input.consumePress('KeyR') && weapon.reload()) audio.reload();
    if (input.consumePress('KeyG') && rs.phase === 'live' && rs.loadout.grenades > 0) {
      rs.loadout.grenades -= 1;
      camera.getWorldDirection(shootDir);
      combat.throwGrenade(camera.position, shootDir, playerFighter);
      audio.shot('smg');
      syncHud();
    }
    if (input.consumePress('KeyB')) {
      if (buyOpen) {
        hideBuyMenu();
        input.requestLock();
      } else {
        showBuyMenu();
      }
    }
    for (let i = 0; i < WEAPON_ORDER.length; i += 1) {
      if (input.consumePress(`Digit${i + 1}`)) {
        if (buyOpen) {
          const buyId = BUY_ORDER[i];
          if (buyId && rounds.buy(buyId)) {
            if (WEAPONS[buyId]) weapon.swap(buyId);
            syncHud();
          } else {
            audio.deny();
          }
        } else if (rs.loadout.weapons.includes(WEAPON_ORDER[i])) {
          rs.loadout.current = WEAPON_ORDER[i];
          weapon.swap(WEAPON_ORDER[i]);
          syncHud();
        }
      }
    }
    if (buyOpen && input.consumePress('Digit6')) {
      if (rounds.buy('armor')) syncHud();
      else audio.deny();
    }
  } else {
    input.clearPresses();
  }
  accumulator += dt;
  let steps = 0;
  while (accumulator >= FIXED_STEP && steps < 5) {
    step(FIXED_STEP);
    accumulator -= FIXED_STEP;
    steps += 1;
  }
  if (accumulator > FIXED_STEP * 5) accumulator = 0;
  syncCamera();
  syncHud();
  // Dynamic crosshair gap: base 6 px plus spread and movement.
  const gap = 5 + weapon.spread(player.groundSpeed()) * 900 + player.groundSpeed() * 0.9;
  hud.setCrosshair(gap, playerAlive && started && !buyOpen && rs.phase !== 'menu');
  renderer.render(scene, camera);
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    audio.unlock();
    hud.hideOverlay();
    if (rounds.state.phase === 'menu') rounds.startMatch(elapsed);
  } else if (started && !buyOpen && rounds.state.phase !== 'match' && playerAlive) {
    hud.showOverlay('paused');
  }
}

hud.onPlay(() => {
  if (shot) return;
  if (rounds.state.phase === 'match') {
    rounds.startMatch(elapsed);
    hud.hideOverlay();
    input.requestLock();
    return;
  }
  if (!playerAlive) {
    hud.hideOverlay();
    return;
  }
  input.requestLock();
});

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    syncHud();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  hud.hideOverlay();
  started = true;
  body.pitch = 0;
  body.yaw = 0;
  if (name === 'start') {
    rounds.state.round = 1;
    body.position.set(0.6, 0, 12);
    settle(20);
    aimAt(new THREE.Vector3(0, 1.6, -8));
    hud.showOverlay('start');
  } else if (name === 'buy') {
    rounds.startMatch(0);
    body.position.set(0, 0, 16);
    settle(20);
    aimAt(new THREE.Vector3(-6, 1.4, -4));
    showBuyMenu();
  } else if (name === 'play' || name === 'end') {
    rounds.startMatch(0);
    rounds.state.phase = 'live';
    rounds.state.timer = ROUND_TIME;
    body.position.set(0, 0, 6);
    settle(360);
    // Stage the mid holder in the foundry doors, facing the player, so the
    // capture shows a bot, a tracer and a hit marker: the shot is a frame of
    // the game's own code, posed like the starter's captures.
    const target = bots.bots.find((b) => b.id === 4 && b.alive) || bots.bots.find((b) => b.team === 'def' && b.alive);
    if (target) {
      target.position.set(0, 0, -8);
      target.group.position.set(0, 0, -8);
      target.yaw = Math.PI;
      target.state = 'hold';
      target.holdUntil = 9999;
      target.target = null;
      aimAt(new THREE.Vector3(target.position.x, target.position.y + 1.2, target.position.z));
      shootPlayer();
      settle(1);
    }
    if (name === 'end') {
      settle(120);
      if (rounds.state.phase === 'live') {
        rounds.endRound('atk', 'All Wardens eliminated.', elapsed);
      }
      hud.showEndOverlay('ROUND WON', 'Ember takes round 1 — the Wardens are down. First to 5 takes the match.', 'Next round');
    }
    settle(4);
  }
  syncCamera();
  syncHud();
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
syncHud();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
