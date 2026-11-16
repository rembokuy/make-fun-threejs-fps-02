// Bots: waypoint walkers with eyes. A bot follows a BFS route over the map's
// waypoint graph, holds an angle when it arrives, sees enemies by line of
// sight, reacts after a human-ish delay, then fires in bursts with aim error
// that grows with distance and target movement. Attackers push a site and
// plant; defenders hold, rotate to the planted site and defuse. Bots also
// turn toward loud noises. One shared raycaster and a few scratch vectors
// serve every bot; paths are only rebuilt when an objective changes.
import * as THREE from 'three';
import { WEAPONS } from './weapons.js';
import { PALETTE } from './palette.js';

const BOT_RADIUS = 0.34;
const WALK_SPEED = 3.7;
const EYE_HEIGHT = 1.55;
const CHEST_HEIGHT = 1.15;
const REACT_MIN = 0.28;
const REACT_MAX = 0.55;
const VISION_RANGE = 55;
const VISION_HALF_FOV = 0.94; // ~54 degrees each side

const ALLY_NAMES = ['Vex', 'Mira'];
const ENEMY_NAMES = ['Rook', 'Juno', 'Sable', 'Nox'];

function buildBody(team) {
  const accent = team === 'atk' ? PALETTE.rust : PALETTE.teal;
  const cloth = new THREE.MeshStandardMaterial({ color: new THREE.Color(accent), roughness: 0.75, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.dark), roughness: 0.8, metalness: 0.1 });
  const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.6, metalness: 0.05 });
  const group = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.78, 0.3), cloth);
  torso.position.y = 1.0;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 14, 10), skin);
  head.position.y = 1.53;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), dark);
  helmet.position.y = 1.56;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.62, 0.2), dark);
  legL.position.set(-0.13, 0.31, 0);
  const legR = legL.clone();
  legR.position.x = 0.13;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.62), dark);
  gun.position.set(0.22, 1.12, -0.25);
  group.add(torso, head, helmet, legL, legR, gun);
  group.traverse((mesh) => {
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  return { group, torso, head, gun };
}

export function createBots(scene, map, ctx) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 60;
  const eye = new THREE.Vector3();
  const toTarget = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const move = new THREE.Vector3();
  const probe = new THREE.Box3();

  const adjacency = map.waypoints.map(() => []);
  for (const [a, b] of map.edges) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }

  function nearestNode(x, z) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < map.waypoints.length; i += 1) {
      const [wx, wz] = map.waypoints[i];
      const d = (wx - x) * (wx - x) + (wz - z) * (wz - z);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  function findPath(from, to) {
    if (from === to) return [to];
    const prev = new Array(map.waypoints.length).fill(-1);
    const queue = [from];
    prev[from] = from;
    while (queue.length > 0) {
      const cur = queue.shift();
      for (const next of adjacency[cur]) {
        if (prev[next] !== -1) continue;
        prev[next] = cur;
        if (next === to) {
          const path = [to];
          let at = to;
          while (at !== from) {
            at = prev[at];
            path.unshift(at);
          }
          return path;
        }
        queue.push(next);
      }
    }
    return [to];
  }

  function makeBot(team, name, spawn, weaponId, index) {
    const body = buildBody(team);
    body.group.position.set(spawn[0], 0, spawn[1]);
    scene.add(body.group);
    const bot = {
      id: index,
      name,
      team,
      isPlayer: false,
      alive: true,
      health: 100,
      armor: 0,
      weapon: WEAPONS[weaponId],
      position: body.group.position,
      chest: new THREE.Vector3(spawn[0], CHEST_HEIGHT, spawn[1]),
      yaw: team === 'atk' ? 0 : Math.PI,
      speed: 0,
      state: 'path',
      path: [],
      pathPos: 0,
      objective: -1,
      holdUntil: 0,
      scanBase: 0,
      target: null,
      lastSeen: 0,
      lastSeenPos: new THREE.Vector3(),
      reactAt: 0,
      burstLeft: 0,
      burstGap: 0,
      burstPause: 0,
      strafeDir: 1,
      strafeUntil: 0,
      firstBurst: true,
      plantProgress: 0,
      defuseProgress: 0,
      hasBomb: false,
      fall: 0,
      visionAt: index * 0.05,
      group: body.group,
      torso: body.torso,
      head: body.head,
      gun: body.gun,
      home: { x: spawn[0], z: spawn[1] },
      site: null,
    };
    body.torso.userData.bot = bot;
    body.torso.userData.part = 'torso';
    body.head.userData.bot = bot;
    body.head.userData.part = 'head';
    return bot;
  }

  const bots = [];
  const hitMeshes = [];
  for (let i = 0; i < 2; i += 1) {
    const bot = makeBot('atk', ALLY_NAMES[i], map.spawns.attackers[(i + 1) % 3], i === 0 ? 'rifle' : 'smg', i);
    bots.push(bot);
    hitMeshes.push(bot.torso, bot.head);
  }
  for (let i = 0; i < 4; i += 1) {
    const weapon = i === 3 ? 'sniper' : i === 1 ? 'smg' : 'rifle';
    const bot = makeBot('def', ENEMY_NAMES[i], map.spawns.defenders[i], weapon, 2 + i);
    bots.push(bot);
    hitMeshes.push(bot.torso, bot.head);
  }

  function setPath(bot, node) {
    const from = nearestNode(bot.position.x, bot.position.z);
    bot.path = findPath(from, node);
    bot.pathPos = 0;
    bot.state = 'path';
  }

  function assignObjectives(round, random) {
    // Attackers: one to A, one to B. Defenders: one holds A, one holds B,
    // one holds mid, one roams between the sites.
    const aSite = random() < 0.5 ? 8 : 14;
    const bSite = aSite === 8 ? 14 : 8;
    bots[0].site = aSite;
    bots[1].site = bSite;
    bots[0].objective = aSite;
    bots[1].objective = bSite;
    setPath(bots[0], aSite);
    setPath(bots[1], bSite);
    bots[2].objective = 8;
    bots[3].objective = 14;
    bots[4].objective = 18;
    bots[5].objective = 8;
    setPath(bots[2], 8);
    setPath(bots[3], 14);
    setPath(bots[4], 18);
    setPath(bots[5], 8);
    bots[5].roam = true;
  }

  function overlaps(x, z) {
    probe.min.set(x - BOT_RADIUS, 0.05, z - BOT_RADIUS);
    probe.max.set(x + BOT_RADIUS, 1.7, z + BOT_RADIUS);
    for (let i = 0; i < ctx.colliders.length; i += 1) {
      if (probe.intersectsBox(ctx.colliders[i])) return true;
    }
    return false;
  }

  function moveToward(bot, tx, tz, dt, speed) {
    const dx = tx - bot.position.x;
    const dz = tz - bot.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.05) return true;
    const step = Math.min(dist, speed * dt);
    const nx = bot.position.x + (dx / dist) * step;
    const nz = bot.position.z + (dz / dist) * step;
    if (!overlaps(nx, bot.position.z)) bot.position.x = nx;
    if (!overlaps(bot.position.x, nz)) bot.position.z = nz;
    bot.yaw = Math.atan2(-(dx / dist), -(dz / dist));
    bot.speed = speed;
    return dist - step < 0.05;
  }

  function hasLineOfSight(fromX, fromY, fromZ, toX, toY, toZ) {
    eye.set(fromX, fromY, fromZ);
    toTarget.set(toX - fromX, toY - fromY, toZ - fromZ);
    const dist = toTarget.length();
    toTarget.normalize();
    raycaster.set(eye, toTarget);
    raycaster.far = dist;
    const hit = raycaster.intersectObjects(ctx.worldMeshes(), false)[0];
    return !hit;
  }

  function visibleEnemy(bot, time) {
    const px = ctx.playerPos.x;
    const py = ctx.playerPos.y + ctx.playerEye;
    const pz = ctx.playerPos.z;
    const candidates = [];
    if (ctx.playerAlive && bot.team === 'def') {
      candidates.push({ isPlayer: true, x: px, y: py, z: pz, chestY: ctx.playerPos.y + 1.1, speed: ctx.playerSpeed });
    }
    for (const other of bots) {
      if (other === bot || !other.alive || other.team === bot.team) continue;
      candidates.push({ isPlayer: false, bot: other, x: other.position.x, y: other.position.y + EYE_HEIGHT, z: other.position.z, chestY: other.position.y + CHEST_HEIGHT, speed: other.speed });
    }
    forward.set(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
    let best = null;
    let bestDist = Infinity;
    for (const c of candidates) {
      const dx = c.x - bot.position.x;
      const dy = c.chestY - (bot.position.y + EYE_HEIGHT);
      const dz = c.z - bot.position.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > VISION_RANGE || dist >= bestDist) continue;
      toTarget.set(dx / dist, dy / dist, dz / dist);
      const facing = forward.x * toTarget.x + forward.z * toTarget.z;
      if (dist > 4 && facing < Math.cos(VISION_HALF_FOV)) continue;
      if (!hasLineOfSight(bot.position.x, bot.position.y + EYE_HEIGHT, bot.position.z, c.x, c.chestY, c.z)) continue;
      best = c;
      bestDist = dist;
    }
    return best;
  }

  function aimError(bot, target, time) {
    const dx = target.x - bot.position.x;
    const dz = target.z - bot.position.z;
    const dist = Math.hypot(dx, dz);
    let error = 0.014 + dist * 0.0009;
    if (target.speed > 2) error += 0.012;
    if (bot.speed > 0.5) error += 0.014;
    if (bot.firstBurst) error += 0.022;
    return error;
  }

  function shootAt(bot, target, dt, time, random) {
    if (bot.burstPause > 0) {
      bot.burstPause -= dt;
      return;
    }
    if (bot.burstLeft <= 0) {
      bot.burstLeft = 3 + Math.floor(random() * 3);
      if (bot.weapon.id === 'sniper') bot.burstLeft = 1;
      if (bot.weapon.id === 'shotgun') bot.burstLeft = 1;
      bot.burstGap = 0;
    }
    bot.burstGap -= dt;
    if (bot.burstGap > 0) return;
    bot.burstGap = bot.weapon.gap;
    bot.burstLeft -= 1;
    if (bot.burstLeft <= 0) {
      bot.burstPause = bot.weapon.id === 'sniper' ? 1.4 + random() * 0.8 : 0.45 + random() * 0.55;
      bot.firstBurst = false;
    }
    const origin = eye.set(bot.position.x, bot.position.y + EYE_HEIGHT, bot.position.z);
    const error = aimError(bot, target, time);
    toTarget.set(target.x - origin.x, target.chestY - origin.y, target.z - origin.z).normalize();
    toTarget.x += (random() * 2 - 1) * error;
    toTarget.y += (random() * 2 - 1) * error;
    toTarget.z += (random() * 2 - 1) * error;
    toTarget.normalize();
    const result = ctx.combat.fire(origin, toTarget, bot.weapon, bot, error * 0.7, random);
    ctx.audio.shot('enemy', true);
    if (result.hit && result.player) ctx.onBotHitPlayer(bot);
    bot.speed = 0;
  }

  function stepBot(bot, dt, time, random) {
    if (!bot.alive) {
      if (bot.fall < 1) {
        bot.fall = Math.min(1, bot.fall + dt / 0.4);
        bot.group.rotation.x = -bot.fall * 1.45;
        bot.group.position.y = -bot.fall * 0.1;
      }
      return;
    }
    bot.speed = 0;

    // Vision, staggered so not every bot raycasts on the same step.
    if (time >= bot.visionAt) {
      bot.visionAt = time + 0.12;
      const seen = visibleEnemy(bot, time);
      if (seen) {
        bot.lastSeen = time;
        bot.lastSeenPos.set(seen.x, 0, seen.z);
        if (bot.target !== seen) {
          bot.target = seen;
          bot.reactAt = time + REACT_MIN + random() * (REACT_MAX - REACT_MIN);
          bot.firstBurst = true;
          bot.burstLeft = 0;
          bot.burstPause = 0;
        }
      } else if (bot.target && time - bot.lastSeen > 1.6) {
        bot.target = null;
      }
    }

    // A noise nearby pulls an idle bot to look.
    const noise = ctx.takeNoise(bot);
    if (noise && !bot.target && bot.state !== 'defuse' && bot.state !== 'plant') {
      const dx = noise.x - bot.position.x;
      const dz = noise.z - bot.position.z;
      if (dx * dx + dz * dz < 30 * 30) {
        bot.state = 'investigate';
        bot.investigateUntil = time + 3.5;
        setPath(bot, nearestNode(noise.x, noise.z));
      }
    }

    const bomb = ctx.bomb;
    // Plant / defuse take priority over routes.
    if (bomb.planted && bot.team === 'def' && bot.state !== 'defuse') {
      const site = bomb.site;
      const node = site.name === 'A' ? 8 : 14;
      if (bot.objective !== node) {
        bot.objective = node;
        setPath(bot, node);
      }
    }

    if (bot.target && time >= bot.reactAt) {
      bot.state = 'engage';
      const t = bot.target;
      const dx = t.x - bot.position.x;
      const dz = t.z - bot.position.z;
      bot.yaw = Math.atan2(-dx, -dz);
      // Strafe while firing so the bot is not a still target.
      if (time >= bot.strafeUntil) {
        bot.strafeDir = random() < 0.5 ? -1 : 1;
        bot.strafeUntil = time + 0.7 + random() * 0.8;
      }
      const sideX = Math.cos(bot.yaw) * bot.strafeDir;
      const sideZ = -Math.sin(bot.yaw) * bot.strafeDir;
      const nx = bot.position.x + sideX * WALK_SPEED * 0.45 * dt;
      const nz = bot.position.z + sideZ * WALK_SPEED * 0.45 * dt;
      if (!overlaps(nx, bot.position.z)) bot.position.x = nx;
      if (!overlaps(bot.position.x, nz)) bot.position.z = nz;
      bot.speed = WALK_SPEED * 0.45;
      shootAt(bot, t, dt, time, random);
      bot.plantProgress = 0;
      bot.defuseProgress = 0;
      return;
    }

    if (bot.state === 'engage') bot.state = 'path';

    // Planting: the carrier stands on its site, quiet, for 3.5 s.
    if (bot.hasBomb && bot.team === 'atk' && !bomb.planted && bot.state !== 'plant') {
      const site = map.sites.find((s) => s.name === (bot.site === 8 ? 'A' : 'B'));
      if (site) {
        const dx = site.x - bot.position.x;
        const dz = site.z - bot.position.z;
        if (dx * dx + dz * dz < site.radius * site.radius) {
          const near = visibleEnemy(bot, time);
          if (!near) {
            bot.state = 'plant';
            bot.plantProgress = 0;
          }
        }
      }
    }
    if (bot.state === 'plant') {
      bot.plantProgress += dt;
      bot.yaw += dt * 0.4;
      if (bot.plantProgress >= 3.5) {
        bot.state = 'path';
        bot.plantProgress = 0;
        ctx.onPlant(bot);
      }
      return;
    }

    // Defusing: a defender on the planted site, quiet, for 5 s.
    if (bomb.planted && bot.team === 'def') {
      const site = bomb.site;
      const dx = site.x - bot.position.x;
      const dz = site.z - bot.position.z;
      if (dx * dx + dz * dz < site.radius * site.radius && bot.state !== 'defuse') {
        const near = visibleEnemy(bot, time);
        if (!near) {
          bot.state = 'defuse';
          bot.defuseProgress = 0;
        }
      }
    }
    if (bot.state === 'defuse') {
      bot.defuseProgress += dt;
      if (bot.defuseProgress >= 5) {
        bot.state = 'path';
        bot.defuseProgress = 0;
        ctx.onDefuse(bot);
      }
      return;
    }

    // Follow the route; hold and scan at the end of it.
    if (bot.state === 'path' || bot.state === 'investigate') {
      if (bot.pathPos < bot.path.length) {
        const node = map.waypoints[bot.path[bot.pathPos]];
        const arrived = moveToward(bot, node[0], node[1], dt, WALK_SPEED);
        if (arrived) bot.pathPos += 1;
      } else {
        const wasInvestigate = bot.state === 'investigate';
        bot.state = 'hold';
        bot.holdUntil = time + (wasInvestigate ? 2 : 9999);
        bot.scanBase = bot.yaw;
        if (bot.roam && bot.team === 'def') {
          bot.objective = bot.objective === 8 ? 14 : 8;
          setPath(bot, bot.objective);
        }
      }
      return;
    }

    if (bot.state === 'hold') {
      if (bot.state === 'investigate' && time >= bot.investigateUntil) {
        bot.state = 'path';
        setPath(bot, bot.objective);
        return;
      }
      // Slow scan: sweep the yaw so the bot reads the lane, not one pixel.
      bot.yaw = bot.scanBase + Math.sin(time * 0.7 + bot.id * 1.3) * 0.9;
    }
  }

  function step(dt, time, random) {
    for (const bot of bots) stepBot(bot, dt, time, random);
    for (const bot of bots) {
      bot.chest.set(bot.position.x, bot.position.y + CHEST_HEIGHT, bot.position.z);
      bot.group.rotation.y = bot.yaw;
      // Walk bob: legs swing while moving.
      const bob = bot.alive && bot.speed > 0.5 ? Math.sin(time * 9 + bot.id) * 0.25 : 0;
      bot.group.children[3].rotation.x = bob;
      bot.group.children[4].rotation.x = -bob;
    }
  }

  function damage(bot, amount, part) {
    if (!bot.alive) return false;
    let left = amount;
    if (bot.armor > 0) {
      const absorbed = Math.min(bot.armor, left * 0.5);
      bot.armor -= absorbed;
      left -= absorbed;
    }
    bot.health -= left;
    // Being shot snaps a bot toward its attacker and breaks a defuse.
    bot.defuseProgress = 0;
    if (bot.state === 'defuse') bot.state = 'path';
    if (bot.health <= 0) {
      bot.alive = false;
      bot.health = 0;
      bot.fall = 0;
      bot.target = null;
      bot.state = 'dead';
      if (bot.hasBomb) {
        bot.hasBomb = false;
        ctx.onBombDrop(bot);
      }
      return true;
    }
    return false;
  }

  function reset(round, random) {
    assignObjectives(round, random);
    const atkSpawns = map.spawns.attackers;
    const defSpawns = map.spawns.defenders;
    for (const bot of bots) {
      const spawn = bot.team === 'atk' ? atkSpawns[(bot.id + 1) % 3] : defSpawns[bot.id - 2];
      bot.position.set(spawn[0], 0, spawn[1]);
      bot.group.position.set(spawn[0], 0, spawn[1]);
      bot.group.rotation.set(0, 0, 0);
      bot.alive = true;
      bot.health = 100;
      bot.armor = bot.team === 'def' ? 50 : 0;
      bot.yaw = bot.team === 'atk' ? 0 : Math.PI;
      bot.target = null;
      bot.state = 'path';
      bot.pathPos = 0;
      bot.plantProgress = 0;
      bot.defuseProgress = 0;
      bot.hasBomb = false;
      bot.fall = 0;
      bot.firstBurst = true;
      bot.burstLeft = 0;
      bot.burstPause = 0;
      bot.speed = 0;
      bot.weapon = WEAPONS[bot.id === 5 ? 'sniper' : bot.id === 3 ? 'smg' : bot.id === 1 ? 'smg' : 'rifle'];
    }
  }

  return {
    bots,
    hitMeshes,
    step,
    damage,
    reset,
    setPath,
    nearestNode,
    aliveCount(team) {
      let n = 0;
      for (const bot of bots) if (bot.team === team && bot.alive) n += 1;
      return n;
    },
    pickCarrier() {
      for (const bot of bots) {
        if (bot.team === 'atk' && bot.alive) return bot;
      }
      return null;
    },
  };
}
