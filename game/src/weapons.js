// Weapons: the table owns every number, the view model is built per weapon,
// and the state machine (cooldown, reload, kick, flash) is one shared shape.
// Balance: stopping to aim pays — spread grows with movement and with heat
// from sustained fire, and recoil kicks the view up every shot.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', price: 0, sound: 'pistol',
    damage: 34, headMult: 4, mag: 12, reserve: 36, gap: 0.15, auto: false,
    reload: 1.4, spreadStill: 0.0035, spreadMove: 0.02, kick: 0.007, zoom: 1,
  },
  rifle: {
    id: 'rifle', name: 'VK-47 Rifle', price: 2700, sound: 'rifle',
    damage: 33, headMult: 4, mag: 30, reserve: 90, gap: 0.1, auto: true,
    reload: 2.2, spreadStill: 0.0025, spreadMove: 0.028, kick: 0.011, zoom: 1,
  },
  smg: {
    id: 'smg', name: 'Kestrel SMG', price: 1500, sound: 'smg',
    damage: 26, headMult: 4, mag: 32, reserve: 96, gap: 0.075, auto: true,
    reload: 1.9, spreadStill: 0.004, spreadMove: 0.032, kick: 0.007, zoom: 1,
  },
  sniper: {
    id: 'sniper', name: 'Longbow DMR', price: 4750, sound: 'sniper',
    damage: 88, headMult: 4, mag: 5, reserve: 15, gap: 1.15, auto: false,
    reload: 3.0, spreadStill: 0.0008, spreadMove: 0.02, kick: 0.03, zoom: 2.6,
  },
  shotgun: {
    id: 'shotgun', name: 'Breacher 12', price: 1200, sound: 'shotgun',
    damage: 9, headMult: 3, mag: 6, reserve: 24, gap: 0.9, auto: false,
    reload: 2.6, spreadStill: 0.028, spreadMove: 0.045, kick: 0.022, zoom: 1,
    pellets: 8,
  },
};

export const GRENADE_PRICE = 300;
export const ARMOR_PRICE = 650;

function buildViewModel(id) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.65, metalness: 0.25 });
  const body = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.45, metalness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.dark), roughness: 0.6, metalness: 0.3 });
  const model = new THREE.Group();
  function part(w, h, d, x, y, z, mat) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    model.add(mesh);
    return mesh;
  }
  if (id === 'pistol') {
    part(0.05, 0.07, 0.2, 0, 0, -0.1, body);
    part(0.045, 0.09, 0.05, 0, -0.06, 0.02, grip);
    part(0.02, 0.02, 0.02, 0, 0.045, -0.19, dark);
  } else if (id === 'rifle') {
    part(0.09, 0.1, 0.42, 0, 0, 0, body);
    part(0.045, 0.045, 0.4, 0, 0.025, -0.38, grip);
    part(0.075, 0.08, 0.22, 0, -0.02, 0.3, grip);
    part(0.05, 0.09, 0.06, 0, -0.06, 0.05, dark);
    part(0.02, 0.05, 0.3, 0, 0.07, -0.12, dark);
  } else if (id === 'smg') {
    part(0.08, 0.09, 0.34, 0, 0, 0, body);
    part(0.04, 0.04, 0.3, 0, 0.02, -0.3, grip);
    part(0.05, 0.13, 0.05, 0, -0.08, -0.02, dark);
    part(0.06, 0.07, 0.14, 0, -0.015, 0.22, grip);
  } else if (id === 'sniper') {
    part(0.08, 0.09, 0.5, 0, 0, -0.05, body);
    part(0.035, 0.035, 0.42, 0, 0.02, -0.46, dark);
    part(0.05, 0.05, 0.12, 0, 0.08, -0.08, grip);
    part(0.07, 0.08, 0.2, 0, -0.02, 0.26, grip);
    part(0.045, 0.07, 0.05, 0, -0.06, 0.08, dark);
  } else if (id === 'shotgun') {
    part(0.09, 0.1, 0.46, 0, 0, 0, body);
    part(0.07, 0.07, 0.3, 0, -0.01, -0.32, grip);
    part(0.075, 0.08, 0.2, 0, -0.02, 0.28, grip);
    part(0.05, 0.08, 0.06, 0, -0.06, 0.06, dark);
  }
  return model;
}

export function createWeaponRig(camera) {
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.amber), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.17, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.amber), 0, 6);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const rig = {
    def: WEAPONS.pistol,
    model: null,
    state: { mag: 12, reserve: 36, cooldown: 0, reloadLeft: 0, flash: 0, kick: 0, heat: 0 },
    swap(id) {
      if (rig.model) {
        camera.remove(rig.model);
        rig.model = null;
      }
      rig.def = WEAPONS[id];
      rig.model = buildViewModel(id);
      rig.model.position.set(0.24, -0.2, -0.42);
      camera.add(rig.model);
      const s = rig.state;
      s.mag = rig.def.mag;
      s.reserve = rig.def.reserve;
      s.cooldown = 0;
      s.reloadLeft = 0;
      s.flash = 0;
      s.kick = 0;
      s.heat = 0;
    },
    step(dt, moving) {
      const s = rig.state;
      s.cooldown = Math.max(0, s.cooldown - dt);
      s.flash = Math.max(0, s.flash - dt);
      s.heat = Math.max(0, s.heat - dt * 0.55);
      s.kick += (0 - s.kick) * Math.min(1, dt * 13);
      if (rig.model) {
        rig.model.position.z = -0.42 + s.kick;
        rig.model.rotation.x = s.kick * 2.4;
        rig.model.position.y = -0.2 + Math.sin(performance.now() * 0.0012) * 0.0015 * (moving ? 1 : 0.2);
      }
      flash.visible = s.flash > 0;
      flash.rotation.z = s.flash * 28;
      flashLight.intensity = s.flash > 0 ? 20 : 0;
      if (s.reloadLeft > 0) {
        s.reloadLeft = Math.max(0, s.reloadLeft - dt);
        if (rig.model) rig.model.rotation.x = -0.5 * Math.min(1, (rig.def.reload - s.reloadLeft) * 2);
        if (s.reloadLeft === 0) {
          const need = rig.def.mag - s.mag;
          const take = Math.min(need, s.reserve);
          s.mag += take;
          s.reserve -= take;
        }
      }
    },
    ready() {
      const s = rig.state;
      return s.mag > 0 && s.cooldown === 0 && s.reloadLeft === 0;
    },
    pullTrigger() {
      const s = rig.state;
      s.cooldown = rig.def.gap;
      s.flash = 0.06;
      s.kick = 0.055;
      s.heat = Math.min(1, s.heat + (rig.def.auto ? 0.09 : 0.05));
    },
    takeRound() {
      if (rig.state.mag <= 0) return false;
      rig.state.mag -= 1;
      return true;
    },
    reload() {
      const s = rig.state;
      if (s.reloadLeft > 0 || s.mag === rig.def.mag || s.reserve === 0) return false;
      s.reloadLeft = rig.def.reload;
      return true;
    },
    spread(speed) {
      const d = rig.def;
      const move = Math.min(1, speed / 5.4);
      return d.spreadStill + move * d.spreadMove + rig.state.heat * 0.012;
    },
    refillAmmo() {
      const s = rig.state;
      s.mag = rig.def.mag;
      s.reserve = rig.def.reserve;
    },
  };
  rig.swap('pistol');
  return rig;
}
