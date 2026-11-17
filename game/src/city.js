import * as THREE from 'three';
import { CONFIG } from './config.js';
import { randRange, pick } from './random.js';

// Build the whole coastal city: streets, blocks, towers, beach and light.
// Deterministic — the same seed always lays out the same streets.
export function buildCity(scene, rng) {
  const { blocks, blockSize, roadWidth } = CONFIG.grid;
  const pitch = blockSize + roadWidth;
  const span = blocks * blockSize + (blocks + 1) * roadWidth;
  const half = span / 2;
  const palette = CONFIG.colors;

  scene.background = new THREE.Color(palette.sky);
  scene.fog = new THREE.Fog(palette.fog, 280, 640);

  // Golden-hour sun, low in the west, plus a warm sky bounce.
  const sun = new THREE.DirectionalLight(0xffd9a0, 2.1);
  sun.position.set(-160, 70, 90);
  scene.add(sun);
  const skyBounce = new THREE.HemisphereLight(0xffe2b8, 0x8a7a66, 0.85);
  scene.add(skyBounce);

  // Base ground slab under everything.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(span + 160, span + 220),
    new THREE.MeshLambertMaterial({ color: palette.ground })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, 30);
  scene.add(ground);

  // Road strips: one vertical and one horizontal per grid line.
  const roadMat = new THREE.MeshLambertMaterial({ color: palette.road });
  for (let i = 0; i <= blocks; i++) {
    const c = -half + roadWidth / 2 + i * pitch;
    const vRoad = new THREE.Mesh(new THREE.PlaneGeometry(roadWidth, span), roadMat);
    vRoad.rotation.x = -Math.PI / 2;
    vRoad.position.set(c, 0.01, 0);
    scene.add(vRoad);
    const hRoad = new THREE.Mesh(new THREE.PlaneGeometry(span, roadWidth), roadMat);
    hRoad.rotation.x = -Math.PI / 2;
    hRoad.position.set(0, 0.01, c);
    scene.add(hRoad);
  }

  // Beach sand and sea along the south edge (z beyond the last road).
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(span + 160, 42),
    new THREE.MeshLambertMaterial({ color: palette.sand })
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, 0.02, half + 21);
  scene.add(sand);
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(span + 160, 130),
    new THREE.MeshLambertMaterial({ color: palette.sea })
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, 0.015, half + 42 + 65);
  scene.add(sea);

  // Three facade variants, painted once on offscreen canvases.
  const facades = [makeFacade(palette.buildings[0], 0), makeFacade(palette.buildings[3], 1), makeFacade(palette.buildings[5], 2)];

  const colliders = [];
  const blockList = [];
  const lampMat = new THREE.MeshLambertMaterial({ color: 0x2e3438 });
  const lampGlowMat = new THREE.MeshLambertMaterial({ color: palette.lamp, emissive: 0xffc860, emissiveIntensity: 0.6 });
  const sidewalkMat = new THREE.MeshLambertMaterial({ color: palette.sidewalk });

  for (let bx = 0; bx < blocks; bx++) {
    for (let bz = 0; bz < blocks; bz++) {
      const cx = -half + roadWidth + blockSize / 2 + bx * pitch;
      const cz = -half + roadWidth + blockSize / 2 + bz * pitch;
      blockList.push({ x: cx, z: cz, w: blockSize, d: blockSize });

      // Pale sidewalk slab for the whole block.
      const walk = new THREE.Mesh(new THREE.PlaneGeometry(blockSize, blockSize), sidewalkMat);
      walk.rotation.x = -Math.PI / 2;
      walk.position.set(cx, 0.02, cz);
      scene.add(walk);

      // One to three towers per block, kept inside the block with a margin.
      const count = 1 + Math.floor(rng() * 3);
      const spots = splitBlock(cx, cz, blockSize, count, rng);
      for (const s of spots) {
        const h = randRange(rng, 12, 44);
        const tex = pick(rng, facades);
        const mat = new THREE.MeshLambertMaterial({ map: tex });
        const tower = new THREE.Mesh(new THREE.BoxGeometry(s.w, h, s.d), mat);
        tower.position.set(s.x, h / 2, s.z);
        scene.add(tower);
        // Flat darker roof cap.
        const roof = new THREE.Mesh(
          new THREE.BoxGeometry(s.w + 0.6, 0.8, s.d + 0.6),
          new THREE.MeshLambertMaterial({ color: 0x4a4640 })
        );
        roof.position.set(s.x, h + 0.4, s.z);
        scene.add(roof);
        colliders.push({ minX: s.x - s.w / 2, maxX: s.x + s.w / 2, minZ: s.z - s.d / 2, maxZ: s.z + s.d / 2 });
      }
    }
  }

  // Street lamps at road corners, every other intersection.
  for (let i = 0; i <= blocks; i += 2) {
    for (let j = 0; j <= blocks; j += 2) {
      const lx = -half + roadWidth / 2 + i * pitch + 5;
      const lz = -half + roadWidth / 2 + j * pitch + 5;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 6, 6), lampMat);
      pole.position.set(lx, 3, lz);
      scene.add(pole);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.25, 0.4), lampGlowMat);
      head.position.set(lx, 6.1, lz);
      scene.add(head);
    }
  }

  return {
    colliders,
    spawn: { x: 0, z: 0 },
    bounds: { minX: -half, maxX: half, minZ: -half, maxZ: half },
    blocks: blockList,
  };
}

// Paint one building face: flat wall colour with a grid of lit/dark windows.
function makeFacade(baseColor, variant) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#' + baseColor.toString(16).padStart(6, '0');
  ctx.fillRect(0, 0, 256, 256);
  const cols = 6 + variant * 2;
  const rows = 8 + variant;
  const cw = 256 / cols;
  const ch = 256 / rows;
  // Local deterministic shuffle so each variant looks different.
  let s = 1234 + variant * 777;
  const next = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      ctx.fillStyle = next() < 0.35 ? CONFIG.colors.windowLit : CONFIG.colors.windowDark;
      ctx.fillRect(c * cw + cw * 0.2, r * ch + ch * 0.25, cw * 0.6, ch * 0.5);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Split a block into 1-3 building footprints with breathing room.
function splitBlock(cx, cz, size, count, rng) {
  const margin = 5;
  const inner = size - margin * 2;
  if (count === 1) {
    const w = randRange(rng, inner * 0.55, inner * 0.85);
    const d = randRange(rng, inner * 0.55, inner * 0.85);
    return [{ x: cx, z: cz, w, d }];
  }
  if (count === 2) {
    const w = inner * 0.44;
    const d = randRange(rng, inner * 0.6, inner * 0.9);
    const off = inner / 4;
    return [
      { x: cx - off, z: cz, w, d },
      { x: cx + off, z: cz, w, d },
    ];
  }
  const w = inner * 0.42;
  const d = inner * 0.42;
  const off = inner / 4;
  return [
    { x: cx - off, z: cz - off, w, d },
    { x: cx + off, z: cz - off, w, d },
    { x: cx, z: cz + off, w: inner * 0.7, d },
  ];
}
