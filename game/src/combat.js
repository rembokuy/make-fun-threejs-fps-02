// Combat: hitscan fire, grenades, tracers and impacts. One shared raycaster,
// one tracer pool, one impact pool, one explosion effect — all preallocated,
// so a firefight allocates nothing. The caller owns ammo; this module owns
// the ray, the damage call and the look of a shot.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const TRACER_COUNT = 24;
const IMPACT_COUNT = 12;
const GRENADE_RADIUS = 7.5;

export function createCombat(scene, ctx) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 90;
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();

  // Tracer pool: two-point lines, faded out over 70 ms.
  const tracers = [];
  for (let i = 0; i < TRACER_COUNT; i += 1) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 });
    const line = new THREE.Line(geo, mat);
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, geo, mat, life: 0 });
  }
  let tracerNext = 0;

  // Impact pool: small bright spheres that shrink away at a hit point.
  const impacts = [];
  const impactGeo = new THREE.SphereGeometry(0.07, 8, 6);
  for (let i = 0; i < IMPACT_COUNT; i += 1) {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.amber), transparent: true, opacity: 0 });
    const mesh = new THREE.Mesh(impactGeo, mat);
    mesh.visible = false;
    scene.add(mesh);
    impacts.push({ mesh, mat, life: 0 });
  }
  let impactNext = 0;

  // One explosion effect, reused: an expanding shell and a light.
  const blast = new THREE.Mesh(
    new THREE.SphereGeometry(1, 18, 12),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff8c3a'), transparent: true, opacity: 0, depthWrite: false }),
  );
  blast.visible = false;
  scene.add(blast);
  const blastLight = new THREE.PointLight(new THREE.Color('#ff8c3a'), 0, 22);
  scene.add(blastLight);
  let blastLife = 0;
  let shake = 0;

  const grenades = [];
  const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.dark), roughness: 0.5, metalness: 0.6 });

  function spawnTracer(from, to, color) {
    const t = tracers[tracerNext];
    tracerNext = (tracerNext + 1) % TRACER_COUNT;
    const pos = t.geo.attributes.position.array;
    pos[0] = from.x; pos[1] = from.y; pos[2] = from.z;
    pos[3] = to.x; pos[4] = to.y; pos[5] = to.z;
    t.geo.attributes.position.needsUpdate = true;
    t.mat.color.set(color);
    t.mat.opacity = 0.85;
    t.life = 0.07;
  }

  function spawnImpact(point) {
    const p = impacts[impactNext];
    impactNext = (impactNext + 1) % IMPACT_COUNT;
    p.mesh.position.copy(point);
    p.mesh.visible = true;
    p.mesh.scale.setScalar(1);
    p.mat.opacity = 0.95;
    p.life = 0.16;
  }

  function raycastTargets() {
    return ctx.targets();
  }

  // One hitscan pellet. shooter: 'player' or a bot object. Returns the hit.
  function pellet(from, direction, def, shooter) {
    origin.copy(from);
    dir.copy(direction);
    raycaster.far = 90;
    raycaster.set(origin, dir);
    const hits = raycaster.intersectObjects(raycastTargets(), false);
    const hit = hits[0];
    const end = hit ? hit.point : tmp2.copy(origin).addScaledVector(dir, 85);
    spawnTracer(origin, end, shooter === 'player' ? PALETTE.amber : '#ff5a4a');
    if (!hit) return { hit: false };
    spawnImpact(hit.point);
    const data = hit.object.userData;
    if (data.bot) {
      const part = data.part || 'torso';
      const amount = def.damage * (part === 'head' ? def.headMult : 1);
      ctx.damageBot(data.bot, amount, part, shooter);
      return { hit: true, bot: data.bot, part, amount, killed: !data.bot.alive };
    }
    if (data.player) {
      const part = data.part || 'torso';
      const amount = def.damage * (part === 'head' ? def.headMult : 1);
      ctx.damagePlayer(amount, part, from, shooter);
      return { hit: true, player: true, part, amount };
    }
    return { hit: true, world: true, point: hit.point };
  }

  function fire(from, direction, def, shooter, spread, random) {
    const pellets = def.pellets || 1;
    let anyHit = false;
    let killed = false;
    let headshot = false;
    for (let p = 0; p < pellets; p += 1) {
      dir.copy(direction);
      dir.x += (random() * 2 - 1) * spread;
      dir.y += (random() * 2 - 1) * spread;
      dir.z += (random() * 2 - 1) * spread;
      dir.normalize();
      const result = pellet(from, dir, def, shooter);
      if (result.hit) anyHit = true;
      if (result.killed) killed = true;
      if (result.part === 'head' && result.hit) headshot = true;
    }
    ctx.noise(from, shooter === 'player' ? 26 : 20);
    return { hit: anyHit, killed, headshot };
  }

  function throwGrenade(from, direction, owner) {
    const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
    mesh.position.copy(from);
    scene.add(mesh);
    const vel = new THREE.Vector3();
    vel.copy(direction).multiplyScalar(17);
    vel.y += 5.5;
    grenades.push({ mesh, pos: mesh.position, vel, fuse: 2.4, owner, bounced: false });
  }

  function explode(g) {
    scene.remove(g.mesh);
    blast.position.copy(g.pos);
    blast.visible = true;
    blastLife = 0.45;
    blastLight.position.copy(g.pos);
    blastLight.intensity = 60;
    shake = Math.min(1, shake + 0.7);
    ctx.audio.explosion();
    ctx.noise(g.pos, 40);
    // Damage: line of sight from the blast to each fighter's chest, falloff
    // with distance. The thrower's own team is spared except the thrower.
    const victims = ctx.fighters();
    for (const v of victims) {
      if (v.team === g.owner.team && v !== g.owner) continue;
      tmp.copy(v.chest);
      const dist = tmp.distanceTo(g.pos);
      if (dist > GRENADE_RADIUS) continue;
      tmp2.copy(g.pos);
      dir.copy(tmp).sub(tmp2).normalize();
      raycaster.set(tmp2, dir);
      raycaster.far = dist;
      const blocked = raycaster.intersectObjects(ctx.worldMeshes(), false)[0];
      raycaster.far = 90;
      if (blocked) continue;
      const falloff = 1 - (dist / GRENADE_RADIUS) * 0.7;
      const amount = (v === g.owner ? 55 : 110) * falloff;
      if (v.isPlayer) ctx.damagePlayer(amount, 'torso', g.pos, g.owner);
      else ctx.damageBot(v, amount, 'torso', g.owner);
    }
  }

  function stepGrenades(dt) {
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const g = grenades[i];
      g.fuse -= dt;
      g.vel.y -= 16 * dt;
      tmp.copy(g.pos).addScaledVector(g.vel, dt);
      // Cheap bounce: test the next position against world boxes; on overlap,
      // push out along the smallest penetration axis and reflect that velocity.
      let bounced = false;
      for (const box of ctx.colliders) {
        if (tmp.x > box.min.x && tmp.x < box.max.x && tmp.y > box.min.y && tmp.y < box.max.y && tmp.z > box.min.z && tmp.z < box.max.z) {
          const dxMin = tmp.x - box.min.x;
          const dxMax = box.max.x - tmp.x;
          const dyMin = tmp.y - box.min.y;
          const dyMax = box.max.y - tmp.y;
          const dzMin = tmp.z - box.min.z;
          const dzMax = box.max.z - tmp.z;
          const m = Math.min(dxMin, dxMax, dyMin, dyMax, dzMin, dzMax);
          if (m === dxMin) { tmp.x = box.min.x; g.vel.x = -Math.abs(g.vel.x) * 0.45; }
          else if (m === dxMax) { tmp.x = box.max.x; g.vel.x = Math.abs(g.vel.x) * 0.45; }
          else if (m === dyMin) { tmp.y = box.min.y; g.vel.y = -Math.abs(g.vel.y) * 0.45; }
          else if (m === dyMax) { tmp.y = box.max.y; g.vel.y = Math.abs(g.vel.y) * 0.45; }
          else if (m === dzMin) { tmp.z = box.min.z; g.vel.z = -Math.abs(g.vel.z) * 0.45; }
          else { tmp.z = box.max.z; g.vel.z = Math.abs(g.vel.z) * 0.45; }
          bounced = true;
          break;
        }
      }
      if (bounced) {
        g.bounced = true;
        g.vel.multiplyScalar(0.7);
      }
      g.pos.copy(tmp);
      if (g.pos.y < 0.09) {
        g.pos.y = 0.09;
        g.vel.y = Math.abs(g.vel.y) * 0.4;
        g.vel.x *= 0.7;
        g.vel.z *= 0.7;
      }
      if (g.fuse <= 0) {
        explode(g);
        grenades.splice(i, 1);
      }
    }
  }

  function step(dt) {
    for (const t of tracers) {
      if (t.life > 0) {
        t.life -= dt;
        t.mat.opacity = Math.max(0, t.life / 0.07) * 0.85;
      }
    }
    for (const p of impacts) {
      if (p.life > 0) {
        p.life -= dt;
        p.mat.opacity = Math.max(0, p.life / 0.16) * 0.95;
        p.mesh.scale.setScalar(1 + (0.16 - p.life) * 6);
        if (p.life <= 0) p.mesh.visible = false;
      }
    }
    if (blastLife > 0) {
      blastLife -= dt;
      const k = 1 - blastLife / 0.45;
      blast.scale.setScalar(0.5 + k * GRENADE_RADIUS);
      blast.material.opacity = Math.max(0, 0.75 * (1 - k));
      blastLight.intensity = Math.max(0, 60 * (1 - k));
      if (blastLife <= 0) {
        blast.visible = false;
        blastLight.intensity = 0;
      }
    }
    shake = Math.max(0, shake - dt * 2.2);
    stepGrenades(dt);
  }

  return {
    fire,
    throwGrenade,
    step,
    grenadeCount() {
      return grenades.length;
    },
    clearGrenades() {
      for (const g of grenades) scene.remove(g.mesh);
      grenades.length = 0;
    },
    takeShake() {
      const s = shake;
      shake = 0;
      return s;
    },
    addShake(amount) {
      shake = Math.min(1, shake + amount);
    },
  };
}
