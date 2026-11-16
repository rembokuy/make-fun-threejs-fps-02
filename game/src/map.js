// Foundry Yard: an original three-lane map. Attackers spawn south, defenders
// north; two charge sites (A west, B east) sit behind the defender line, and
// three lanes join them: A Lane west, Mid through the foundry doors, B Lane
// east. Every wall is an axis-aligned box, so colliders are exact Box3s built
// from the same numbers as the meshes. No texture file is loaded: the yard
// floor is a canvas texture painted once at load time.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// [width, height, depth, x, y, z, material] — y is the box centre.
const TALL = [
  // Perimeter, 64 x 48 m, 5 m high.
  [64.8, 5, 0.8, 0, 2.5, -24.4, 'surface'],
  [64.8, 5, 0.8, 0, 2.5, 24.4, 'surface'],
  [0.8, 5, 48.8, -32.4, 2.5, 0, 'surface'],
  [0.8, 5, 48.8, 32.4, 2.5, 0, 'surface'],
  // Lane dividers: A lane west of x=-13, B lane east of x=13, each with a
  // door gap at z 4..8 so attackers can cross between lanes mid-map.
  [0.8, 4, 12, -13, 2, -2, 'surface'],
  [0.8, 4, 8, -13, 2, 12, 'surface'],
  [0.8, 4, 12, 13, 2, -2, 'surface'],
  [0.8, 4, 8, 13, 2, 12, 'surface'],
  // Foundry block north of mid: two halves with a 3 m door gap at x -1.5..1.5.
  [4.5, 4, 6, -3.75, 2, -9, 'dark'],
  [4.5, 4, 6, 3.75, 2, -9, 'dark'],
  // Site approach walls: a doorway each side of the foundry block into the sites.
  [12, 4, 0.8, -26, 2, -8, 'surface'],
  [12, 4, 0.8, 26, 2, -8, 'surface'],
  // Defender back wall segment behind mid, so the spawn is not one long lane.
  [8, 3.4, 0.8, 0, 1.7, -20.5, 'dark'],
];

// Low cover: crouch-height boxes and sandbag lines. [w, h, d, x, y, z, mat]
const LOW = [
  [2.2, 1.1, 1.2, -8, 0.55, 8, 'sand'],
  [2.2, 1.1, 1.2, 8, 0.55, 2, 'sand'],
  [1.2, 1.1, 2.2, -5, 0.55, -2, 'sand'],
  [1.2, 1.1, 2.2, 6, 0.55, 10, 'sand'],
  [3.0, 1.1, 1.0, -18, 0.55, -12, 'sand'],
  [3.0, 1.1, 1.0, 18, 0.55, -12, 'sand'],
  [1.4, 1.1, 3.2, -27, 0.55, -18, 'sand'],
  [1.4, 1.1, 3.2, 27, 0.55, -18, 'sand'],
  [2.6, 0.9, 1.0, -16, 0.45, -19, 'sand'],
  [2.6, 0.9, 1.0, 16, 0.45, -19, 'sand'],
];

// Crates and containers. [w, h, d, x, y, z, mat]
const CRATES = [
  [1.4, 1.4, 1.4, -9, 0.7, 14, 'hairline'],
  [1.4, 1.4, 1.4, -7.4, 0.7, 14, 'hairline'],
  [1.4, 1.4, 1.4, 9, 0.7, 14, 'hairline'],
  [1.4, 1.4, 1.4, -20, 0.7, 4, 'hairline'],
  [1.4, 1.4, 1.4, 20, 0.7, 4, 'hairline'],
  [1.4, 1.4, 1.4, -18, 0.7, -16, 'hairline'],
  [1.4, 1.4, 1.4, 18, 0.7, -16, 'hairline'],
  [1.4, 1.4, 1.4, -25, 0.7, -12, 'hairline'],
  [1.4, 1.4, 1.4, 25, 0.7, -12, 'hairline'],
  [2.4, 2.6, 6.0, -26, 1.3, 2, 'rust'],
  [2.4, 2.6, 6.0, 26, 1.3, 2, 'teal'],
  [2.4, 2.6, 4.0, -28, 1.3, -19, 'hairline'],
  [2.4, 2.6, 4.0, 28, 1.3, -19, 'hairline'],
  [1.4, 1.4, 1.4, -2, 0.7, -14, 'hairline'],
  [1.4, 1.4, 1.4, 2, 0.7, -14, 'hairline'],
];

// Barrels: [x, z] cylinders, collider approximated by a box.
const BARRELS = [
  [-10, 6], [-10.9, 6.2], [-10.4, 7.1],
  [10, -4], [10.9, -4.2],
  [-16, -4], [-16.9, -4.4],
  [16, 8], [16.9, 8.3],
  [-22, -20], [22, -20],
];

// Waypoints: [x, z] nodes bots walk between. Edges are hand-listed so a bot
// never tries to path through a wall.
const WAYPOINTS = [
  [0, 19], [-5, 20], [5, 20], // 0-2 attacker spawn
  [-20, 14], [-24, 6], [-20, -2], [-22, -10], [-22, -15], [-16, -14], // 3-8 A lane + site
  [20, 14], [24, 6], [20, -2], [22, -10], [22, -15], [16, -14], // 9-14 B lane + site
  [0, 12], [0, 4], [0, -2], [0, -9], [0, -16], // 15-19 mid
  [-8, -16], [8, -16], // 20-21 defender mid
  [-4, -20], [4, -20], // 22-23 defender spawn
  [-16, -10], [16, -10], // 24-25 site approach doors
];
const EDGES = [
  [0, 1], [0, 2], [0, 15], [1, 3], [2, 9], [1, 15], [2, 15],
  [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [6, 24], [24, 20], [8, 24],
  [9, 10], [10, 11], [11, 12], [12, 13], [13, 14], [12, 25], [25, 21], [14, 25],
  [15, 16], [16, 17], [17, 18], [18, 19], [19, 20], [19, 21], [20, 22], [21, 23],
  [22, 23], [3, 15], [9, 15], [16, 5], [16, 11], [5, 24], [11, 25],
];

export const SITES = [
  { name: 'A', label: 'CRANE YARD', x: -22, z: -15, radius: 4.5 },
  { name: 'B', label: 'SILO', x: 22, z: -15, radius: 4.5 },
];

export const SPAWNS = {
  attackers: [
    [0, 19], [-4, 20], [4, 20],
  ],
  defenders: [
    [-6, -20], [0, -21], [6, -20], [-12, -18],
  ],
};

function groundTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 384;
  const g = canvas.getContext('2d');
  g.fillStyle = PALETTE.ground;
  g.fillRect(0, 0, 512, 384);
  // Concrete speckle.
  for (let i = 0; i < 5200; i += 1) {
    const v = Math.random();
    g.fillStyle = v < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.05)';
    g.fillRect(Math.random() * 512, Math.random() * 384, 2, 2);
  }
  // Expansion joints.
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 2;
  for (let x = 0; x <= 512; x += 64) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 384);
    g.stroke();
  }
  for (let z = 0; z <= 384; z += 64) {
    g.beginPath();
    g.moveTo(0, z);
    g.lineTo(512, z);
    g.stroke();
  }
  // Worn lane paint: a faded centre line down mid and amber edges at the sites.
  g.strokeStyle = 'rgba(232,163,61,0.5)';
  g.lineWidth = 5;
  g.setLineDash([26, 18]);
  g.beginPath();
  g.moveTo(256, 20);
  g.lineTo(256, 364);
  g.stroke();
  g.setLineDash([]);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 3);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function siteLetter(letter, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, 256, 256);
  g.strokeStyle = color;
  g.lineWidth = 10;
  g.strokeRect(14, 14, 228, 228);
  g.fillStyle = color;
  g.font = 'bold 150px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(letter, 128, 136);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'ink' ? 0.5 : 0.92,
      metalness: name === 'surface' || name === 'dark' ? 0.25 : 0.03,
    });
  }
  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3(
      new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2),
      new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2),
    ));
    shootables.push(mesh);
    return mesh;
  }

  // Yard floor.
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(65.6, 49.6),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95, metalness: 0.02 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);
  colliders.push(new THREE.Box3(new THREE.Vector3(-32.8, -0.4, -24.8), new THREE.Vector3(32.8, 0, 24.8)));
  shootables.push(floor);

  for (const spec of TALL) box(...spec);
  for (const spec of LOW) box(...spec);
  for (const spec of CRATES) box(...spec);

  // Silo at site B: a tall cylinder, collider as a box.
  const siloMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.teal), roughness: 0.6, metalness: 0.45 });
  const silo = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 5.4, 20), siloMaterial);
  silo.position.set(26.5, 2.7, -19);
  silo.castShadow = true;
  silo.receiveShadow = true;
  group.add(silo);
  colliders.push(new THREE.Box3(new THREE.Vector3(24.3, 0, -21.2), new THREE.Vector3(28.7, 5.4, -16.8)));
  shootables.push(silo);
  const siloCap = new THREE.Mesh(new THREE.ConeGeometry(2.3, 1.2, 20), materials.dark);
  siloCap.position.set(26.5, 6.0, -19);
  siloCap.castShadow = true;
  group.add(siloCap);

  // Crane prop over the mid doors: two pillars and a beam, a landmark.
  const craneMat = materials.rust;
  for (const x of [-4.6, 4.6]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.9, 8.5, 0.9), craneMat);
    pillar.position.set(x, 4.25, -6.2);
    pillar.castShadow = true;
    group.add(pillar);
    colliders.push(new THREE.Box3(new THREE.Vector3(x - 0.45, 0, -6.65), new THREE.Vector3(x + 0.45, 8.5, -5.75)));
    shootables.push(pillar);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.9, 1.0), craneMat);
  beam.position.set(0, 8.6, -6.2);
  beam.castShadow = true;
  group.add(beam);
  shootables.push(beam);

  // Barrels.
  const barrelMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.rust), roughness: 0.7, metalness: 0.3 });
  const barrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.0, 12);
  for (const [x, z] of BARRELS) {
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.position.set(x, 0.5, z);
    barrel.castShadow = true;
    barrel.receiveShadow = true;
    group.add(barrel);
    colliders.push(new THREE.Box3(new THREE.Vector3(x - 0.42, 0, z - 0.42), new THREE.Vector3(x + 0.42, 1.0, z + 0.42)));
    shootables.push(barrel);
  }

  // Site markers: a ground ring and a floating letter board.
  const markers = [];
  for (const site of SITES) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.radius - 0.35, site.radius, 40),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.rust), transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, 0.02, site.z);
    group.add(ring);
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 2.6),
      new THREE.MeshBasicMaterial({ map: siteLetter(site.name, PALETTE.rust), transparent: true, side: THREE.DoubleSide, depthWrite: false }),
    );
    board.position.set(site.x, 3.4, site.z);
    group.add(board);
    markers.push({ board, baseY: 3.4, phase: site.name === 'A' ? 0 : 2.1 });
  }

  // Dusk light: a low warm sun, a cool sky fill, and a warm bounce from the yard.
  const sky = new THREE.HemisphereLight(new THREE.Color('#a8bfd4'), new THREE.Color('#3a2f22'), 1.25);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb066'), 2.9);
  sun.position.set(28, 24, 26);
  sun.target.position.set(0, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -38;
  sun.shadow.camera.right = 38;
  sun.shadow.camera.top = 38;
  sun.shadow.camera.bottom = -38;
  sun.shadow.camera.far = 110;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#5f7ea6'), 0.75);
  fill.position.set(-24, 16, -20);
  scene.add(fill);

  return {
    colliders,
    shootables,
    group,
    markers,
    waypoints: WAYPOINTS,
    edges: EDGES,
    sites: SITES,
    spawns: SPAWNS,
  };
}
