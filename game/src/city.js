// Solmar Bay — the procedural city. One seeded build of a sun-soaked coastal
// grid: blocks of low-poly buildings with canvas-drawn windows, roads with
// markings, sidewalks, palms, streetlights, a central plaza, a beach and the
// sea to the south, and a distant skyline. Nothing here is loaded from a file:
// every texture is drawn on a canvas at build time.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { makeRng } from './random.js';

// Warm stucco and glass palettes for the building faces.
const FACADE_COLORS = ['#f2c9a0', '#e8a878', '#f7e0c0', '#d99a6c', '#eec39a', '#e0b184'];
const ROOF_COLORS = ['#7a5a48', '#6b4f42', '#8a6552', '#5f4a3e'];
const WINDOW_LIT = '#ffd98a';
const WINDOW_DARK = '#3a4a5e';

/**
 * Draw one building face: a warm facade, a grid of windows (some lit by the
 * low sun, some dark), and a darker ground floor with a doorway.
 */
function makeFacadeTexture(rng, baseColor, floors, cols) {
  const width = 128;
  const height = 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = baseColor;
  ctx.fillRect(0, 0, width, height);
  // Subtle vertical shading so faces read as separate slabs.
  const shade = ctx.createLinearGradient(0, 0, width, 0);
  shade.addColorStop(0, 'rgba(0,0,0,0.12)');
  shade.addColorStop(0.5, 'rgba(255,255,255,0.06)');
  shade.addColorStop(1, 'rgba(0,0,0,0.16)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, width, height);
  const marginX = 12;
  const marginTop = 14;
  const cellW = (width - marginX * 2) / cols;
  const cellH = (height - marginTop - 26) / floors;
  for (let floor = 0; floor < floors; floor += 1) {
    for (let col = 0; col < cols; col += 1) {
      const x = marginX + col * cellW + cellW * 0.18;
      const y = marginTop + floor * cellH + cellH * 0.2;
      const w = cellW * 0.64;
      const h = cellH * 0.6;
      ctx.fillStyle = rng.chance(0.45) ? WINDOW_LIT : WINDOW_DARK;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(x, y, w, 2);
    }
  }
  // Ground floor: darker band with a doorway.
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(0, height - 26, width, 26);
  ctx.fillStyle = '#2e2118';
  const doorW = 18;
  ctx.fillRect(width / 2 - doorW / 2, height - 24, doorW, 24);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** A road strip with a dashed centre line, drawn once and repeated. `axis` is
 *  the direction the road runs: 'x' draws the dashes horizontally, 'z' vertically. */
function makeRoadTexture(axis) {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3d3a38';
  ctx.fillRect(0, 0, 64, 128);
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(0, 0, 64, 4);
  ctx.fillRect(0, 124, 64, 4);
  ctx.fillStyle = '#e8d27a';
  if (axis === 'x') {
    ctx.fillRect(8, 62, 20, 4);
    ctx.fillRect(36, 62, 20, 4);
  } else {
    ctx.fillRect(30, 8, 4, 44);
    ctx.fillRect(30, 76, 4, 44);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function box(w, h, d, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  return mesh;
}

/**
 * Build the city into `scene` from `seed`. Returns the collision boxes, the
 * minimap data and the named places, so the player, the camera and the HUD
 * all read the same world.
 */
export function buildCity(scene, seed) {
  const rng = makeRng(seed);
  const city = CONFIG.city;
  const colliders = [];
  const minimap = { blocks: [], roads: [], palms: [], sea: null, bounds: city };

  const unitBox = new THREE.BoxGeometry(1, 1, 1);

  // --- ground, beach and sea -------------------------------------------
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(city.boundX * 2 + 80, city.boundZMax - city.boundZMin + 80),
    new THREE.MeshLambertMaterial({ color: 0x9a8a76 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, (city.boundZMin + city.boundZMax) / 2);
  scene.add(ground);

  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(city.boundX * 2 + 80, city.seaZ - city.beachZ + 8),
    new THREE.MeshLambertMaterial({ color: 0xf0d09a }),
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, 0.02, (city.beachZ + city.seaZ) / 2);
  scene.add(sand);

  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(city.seaSize, city.seaSize),
    new THREE.MeshLambertMaterial({ color: 0x2fa8d8, emissive: 0x0a4a66 }),
  );
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, 0.05, city.seaZ + city.seaSize / 2);
  scene.add(sea);
  minimap.sea = { z0: city.seaZ, z1: city.seaZ + city.seaSize };

  // --- roads ---------------------------------------------------------------
  const roadTextureX = makeRoadTexture('x');
  const roadTextureZ = makeRoadTexture('z');
  const pitch = city.blockSize + city.roadWidth;
  const halfGrid = (city.blocksX * pitch) / 2;
  // Street centre lines: one at each block boundary, outer edges included.
  const streetLines = [];
  for (let i = 0; i <= city.blocksX; i += 1) {
    streetLines.push(-halfGrid - city.roadWidth / 2 + i * pitch);
  }
  const roadLength = halfGrid * 2 + city.roadWidth;
  for (const line of streetLines) {
    // One road along X and one along Z at each street line.
    const roadX = new THREE.Mesh(
      new THREE.PlaneGeometry(roadLength, city.roadWidth),
      new THREE.MeshLambertMaterial({ map: roadTextureX.clone() }),
    );
    roadX.material.map.repeat.set(roadLength / 14, 1);
    roadX.material.map.needsUpdate = true;
    roadX.rotation.x = -Math.PI / 2;
    roadX.position.set(0, 0.04, line);
    scene.add(roadX);
    const roadZ = new THREE.Mesh(
      new THREE.PlaneGeometry(city.roadWidth, roadLength),
      new THREE.MeshLambertMaterial({ map: roadTextureZ.clone() }),
    );
    roadZ.material.map.repeat.set(1, roadLength / 14);
    roadZ.material.map.needsUpdate = true;
    roadZ.rotation.x = -Math.PI / 2;
    roadZ.position.set(line, 0.04, 0);
    scene.add(roadZ);
    minimap.roads.push(line);
  }

  // --- building facades ----------------------------------------------------
  const facadeVariants = [];
  for (let v = 0; v < 5; v += 1) {
    const texture = makeFacadeTexture(rng, FACADE_COLORS[v % FACADE_COLORS.length], 4 + (v % 4), 3 + (v % 3));
    const side = new THREE.MeshLambertMaterial({ map: texture });
    const roof = new THREE.MeshLambertMaterial({ color: ROOF_COLORS[v % ROOF_COLORS.length] });
    facadeVariants.push([side, side, roof, roof, side, side]);
  }

  // --- blocks and buildings --------------------------------------------------
  const palmPositions = [];
  const lightPositions = [];
  const blockCentres = [];
  for (let bx = 0; bx < city.blocksX; bx += 1) {
    for (let bz = 0; bz < city.blocksZ; bz += 1) {
      const cx = -halfGrid + city.roadWidth / 2 + city.blockSize / 2 + bx * pitch;
      const cz = -halfGrid + city.roadWidth / 2 + city.blockSize / 2 + bz * pitch;
      blockCentres.push({ x: cx, z: cz });
      // The middle block is the plaza: open, no buildings.
      const isPlaza = bx === 1 && bz === 1;
      const walk = new THREE.Mesh(
        new THREE.PlaneGeometry(city.blockSize + city.sidewalk * 2, city.blockSize + city.sidewalk * 2),
        new THREE.MeshLambertMaterial({ color: isPlaza ? 0xc9a888 : 0xb9a894 }),
      );
      walk.rotation.x = -Math.PI / 2;
      walk.position.set(cx, 0.03, cz);
      scene.add(walk);
      minimap.blocks.push({ x: cx, z: cz, size: city.blockSize });
      if (isPlaza) {
        // A low fountain ring and benches mark the plaza.
        const ring = new THREE.Mesh(
          new THREE.CylinderGeometry(5, 5.6, 0.9, 20),
          new THREE.MeshLambertMaterial({ color: 0x7fb3c9 }),
        );
        ring.position.set(cx, 0.45, cz);
        scene.add(ring);
        const rim = new THREE.Mesh(
          new THREE.TorusGeometry(5, 0.5, 8, 24),
          new THREE.MeshLambertMaterial({ color: 0xd8cdb8 }),
        );
        rim.rotation.x = Math.PI / 2;
        rim.position.set(cx, 0.95, cz);
        scene.add(rim);
        for (let b = 0; b < 4; b += 1) {
          const bench = box(3, 0.5, 1, new THREE.MeshLambertMaterial({ color: 0x8a6a4a }));
          const angle = (b / 4) * Math.PI * 2;
          bench.position.set(cx + Math.cos(angle) * 10, 0.25, cz + Math.sin(angle) * 10);
          bench.rotation.y = -angle;
          scene.add(bench);
        }
        continue;
      }
      // Two to four buildings per block, placed on a small inner grid.
      const slots = [];
      for (let sx = 0; sx < 2; sx += 1) {
        for (let sz = 0; sz < 2; sz += 1) {
          slots.push({ sx, sz });
        }
      }
      // Shuffle the slots so blocks do not all fill the same corner first.
      for (let i = slots.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng.next() * (i + 1));
        [slots[i], slots[j]] = [slots[j], slots[i]];
      }
      const count = rng.int(2, 4);
      for (let s = 0; s < count; s += 1) {
        const slot = slots[s];
        const w = rng.range(10, 15);
        const d = rng.range(10, 15);
        const h = rng.range(9, 34);
        const ox = (slot.sx - 0.5) * (city.blockSize / 2) * 0.95;
        const oz = (slot.sz - 0.5) * (city.blockSize / 2) * 0.95;
        const x = cx + ox;
        const z = cz + oz;
        const mesh = new THREE.Mesh(unitBox, facadeVariants[rng.int(0, facadeVariants.length - 1)]);
        mesh.scale.set(w, h, d);
        mesh.position.set(x, h / 2, z);
        scene.add(mesh);
        colliders.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 });
      }
    }
  }

  // --- palms and streetlights along the streets ------------------------------
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 5.5, 6);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5a3a });
  const frondGeo = new THREE.ConeGeometry(1.6, 2.4, 5);
  const frondMat = new THREE.MeshLambertMaterial({ color: 0x4d8a3f });
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 6, 6);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x3a3a3f });
  const lampGeo = new THREE.SphereGeometry(0.28, 8, 6);
  const lampMat = new THREE.MeshLambertMaterial({ color: 0xffe6a8, emissive: 0xffc978 });
  const addPalm = (x, z) => {
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(x, 2.75, z);
    trunk.rotation.z = rng.range(-0.06, 0.06);
    scene.add(trunk);
    const fronds = new THREE.Mesh(frondGeo, frondMat);
    fronds.position.set(x, 6.1, z);
    fronds.scale.set(1, 0.7, 1);
    scene.add(fronds);
    palmPositions.push({ x, z });
  };
  const addLight = (x, z) => {
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(x, 3, z);
    scene.add(pole);
    const lamp = new THREE.Mesh(lampGeo, lampMat);
    lamp.position.set(x, 6.1, z);
    scene.add(lamp);
    lightPositions.push({ x, z });
  };
  for (const line of streetLines) {
    for (let t = -halfGrid + 12; t <= halfGrid - 12; t += 26) {
      if (rng.chance(0.75)) addPalm(line + city.roadWidth / 2 + 1.6, t);
      if (rng.chance(0.6)) addLight(line - city.roadWidth / 2 - 1.6, t + 13);
    }
  }
  // A palm row along the beach.
  for (let x = -110; x <= 110; x += 18) {
    if (rng.chance(0.8)) addPalm(x + rng.range(-3, 3), city.beachZ + rng.range(3, 10));
  }
  minimap.palms = palmPositions;

  // --- distant skyline silhouettes, north of the city ------------------------
  const skyMat = new THREE.MeshLambertMaterial({ color: 0xb98a68 });
  for (let i = 0; i < 22; i += 1) {
    const w = rng.range(14, 30);
    const h = rng.range(28, 70);
    const d = rng.range(14, 26);
    const x = -260 + i * 24 + rng.range(-8, 8);
    const z = -halfGrid - rng.range(55, 130);
    const tower = new THREE.Mesh(unitBox, skyMat);
    tower.scale.set(w, h, d);
    tower.position.set(x, h / 2, z);
    scene.add(tower);
  }

  return { colliders, minimap, blockCentres, palmPositions, lightPositions };
}
