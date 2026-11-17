// Solmar Bay — pedestrians on the sidewalks (slice 3). Procedural
// capsule figures that stroll the perimeter of a city block, turn at
// the corners, and pause when a car or the player gets too close.
//
// Why the perimeter is safe: every block is a 40x40 sidewalk slab and
// every building footprint sits inside the inner 30x30 (5 m margin), so
// a lane 17-18.5 m from the block centre never enters a building. The
// building colliders are still checked as a backstop — a blocked step
// makes the pedestrian turn around instead of walking through a wall.
//
// API for main.js:
//   import { createPedestrians, updatePedestrians } from './pedestrians.js';
//
//   const { peds, update } = createPedestrians(scene, city, rng);
//     scene — THREE.Scene; city — buildCity() result { colliders,
//     spawn, bounds, blocks }; rng — seeded rng (mulberry32), so
//     placement is deterministic. Returns { peds, update }, each ped:
//       { mesh, x, z, heading, speed, block, lane, dir, color }
//     mesh is a THREE.Group facing +Z at heading 0; speed is m/s.
//     12 pedestrians, one per block, varied colours and speeds.
//
//   update(dt, player, cars)  — or updatePedestrians(peds, dt, player, cars, colliders?)
//     player — the createPlayer() result ({ pos: THREE.Vector3 }) or a
//     plain { x, z } / null; cars — the createCars() array ({ x, z,
//     speed }) or null. The closure form supplies city.colliders
//     itself; the standalone form takes them as an optional 5th arg. A pedestrian pauses briefly when a car or the
//     player comes within ~2 m, and when another pedestrian is right
//     in front of it. Legs swing while walking, settle while paused.

import * as THREE from 'three';
import { randRange, pick } from './random.js';

const COUNT = 12;
const RADIUS = 0.45; // half-width of a pedestrian's ground footprint
const PAUSE_NEAR = 2.1; // pause when a car/player is closer than this (m)
const PAUSE_TIME = 0.9; // seconds a pedestrian waits after a near miss

const SHIRTS = [0xc23b2e, 0x2e6fc2, 0xe8c33a, 0x3f8f5f, 0x8a5fc2, 0xd07a2e, 0xe8e4da, 0x2e8b8b, 0xd95f8a, 0x5a6b7a];
const PANTS = [0x33415c, 0x2e3438, 0x6b5a4a, 0x4a5a6b, 0x7a3a3a, 0x3a4a3a];
const SKINS = [0xe8b88a, 0xc98d64, 0x8a5a3a, 0xf0c8a0, 0x6b4426];
const HAIRS = [0x2a2118, 0x4a3220, 0x8a8a8a, 0x1c1c1c, 0xd9b380];

// Build one figure fresh: capsule torso, round head, two swinging legs.
// Nothing here is shared with the player figure — different shapes,
// different proportions, different colours per pedestrian.
function buildPedestrianMesh(shirtColor, pantsColor, skinColor, hairColor) {
  const figure = new THREE.Group();

  const shirt = new THREE.MeshLambertMaterial({ color: shirtColor });
  const pants = new THREE.MeshLambertMaterial({ color: pantsColor });
  const skin = new THREE.MeshLambertMaterial({ color: skinColor });
  const hair = new THREE.MeshLambertMaterial({ color: hairColor });

  // Capsule body: rounded torso from hips to shoulders.
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.55, 4, 10), shirt);
  body.position.y = 1.02;
  figure.add(body);

  // Round head with a flat hair cap.
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), skin);
  head.position.y = 1.68;
  figure.add(head);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.25, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
  cap.position.y = 1.72;
  figure.add(cap);

  // Two thin legs, pivoted at the hip so they can swing while walking.
  // Each leg mesh is offset down inside a pivot group at hip height.
  const legGeo = new THREE.BoxGeometry(0.2, 0.62, 0.22);
  legGeo.translate(0, -0.31, 0);
  const legL = new THREE.Group();
  legL.position.set(-0.15, 0.62, 0);
  legL.add(new THREE.Mesh(legGeo, pants));
  figure.add(legL);
  const legR = new THREE.Group();
  legR.position.set(0.15, 0.62, 0);
  legR.add(new THREE.Mesh(legGeo, pants));
  figure.add(legR);

  return { figure, legL, legR };
}

// Perimeter of one block, walked as four straight edges. Edge e runs
// from one corner of the square (half-side L) to the next, clockwise:
//   0: north side, west -> east   (z = -L, x: -L -> +L)
//   1: east side, north -> south  (x = +L, z: -L -> +L)
//   2: south side, east -> west   (z = +L, x: +L -> -L)
//   3: west side, south -> north  (x = -L, z: +L -> -L)
// `along` is the distance travelled on the current edge, 0..2L.
// Heading follows the same convention as the player: forward is
// (sin(heading), cos(heading)), so east = PI/2, south = PI, etc.
const EDGE_HEADING = [Math.PI / 2, Math.PI, -Math.PI / 2, 0];

function edgePosition(block, lane, edge, along) {
  const L = lane;
  const t = along - L; // -L..+L along the edge
  switch (edge) {
    case 0: return { x: block.x + t, z: block.z - L };
    case 1: return { x: block.x + L, z: block.z + t };
    case 2: return { x: block.x - t, z: block.z + L };
    default: return { x: block.x - L, z: block.z - t };
  }
}

function hitsBuilding(x, z, colliders) {
  if (!colliders) return false;
  for (const c of colliders) {
    if (x + RADIUS > c.minX && x - RADIUS < c.maxX && z + RADIUS > c.minZ && z - RADIUS < c.maxZ) {
      return true;
    }
  }
  return false;
}

function readXZ(obj) {
  if (!obj) return null;
  if (obj.pos) return { x: obj.pos.x, z: obj.pos.z };
  if (typeof obj.x === 'number' && typeof obj.z === 'number') return { x: obj.x, z: obj.z };
  return null;
}

export function createPedestrians(scene, city, rng) {
  const peds = [];

  // Shuffle the block list deterministically and take the first COUNT,
  // so pedestrians are spread across the city instead of clustered.
  const order = city.blocks.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  for (let n = 0; n < COUNT; n++) {
    const block = city.blocks[order[n % order.length]];
    const lane = randRange(rng, 17, 18.5); // clear of buildings (<=15), inside the slab (<=20)
    const dir = rng() < 0.5 ? 1 : -1;
    const edge = Math.floor(rng() * 4);
    const along = randRange(rng, 0, lane * 2);
    const speed = randRange(rng, 0.8, 1.7);
    const shirt = pick(rng, SHIRTS);
    const pants = pick(rng, PANTS);
    const skin = pick(rng, SKINS);
    const hair = pick(rng, HAIRS);

    const { figure, legL, legR } = buildPedestrianMesh(shirt, pants, skin, hair);
    const start = edgePosition(block, lane, edge, along);
    figure.position.set(start.x, 0, start.z);
    figure.rotation.y = EDGE_HEADING[edge] + (dir < 0 ? Math.PI : 0);
    scene.add(figure);

    peds.push({
      mesh: figure,
      legL, legR,
      x: start.x, z: start.z,
      heading: figure.rotation.y,
      speed, baseSpeed: speed,
      block, lane, dir, edge, along,
      color: shirt,
      pause: 0,
      phase: randRange(rng, 0, Math.PI * 2),
    });
  }

  return {
    peds,
    update: (dt, player, cars) => updatePedestrians(peds, dt, player, cars, city.colliders),
  };
}

export function updatePedestrians(peds, dt, player, cars, colliders) {
  dt = Math.min(dt, 0.05);
  const playerXZ = readXZ(player);

  for (const ped of peds) {
    // Slice 4: a knocked-down ped stays down (hidden, frozen) until
    // the timer runs out, then gets back up where they fell.
    if (ped.knockedDown > 0) {
      ped.knockedDown -= dt;
      if (ped.knockedDown <= 0) ped.mesh.visible = true;
      continue;
    }
    // --- Near miss? Pause briefly. ---
    let blocked = false;
    if (ped.pause > 0) {
      ped.pause -= dt;
      blocked = true;
    } else {
      if (playerXZ) {
        const dx = playerXZ.x - ped.x, dz = playerXZ.z - ped.z;
        if (dx * dx + dz * dz < PAUSE_NEAR * PAUSE_NEAR) blocked = true;
      }
      if (!blocked && cars) {
        for (const car of cars) {
          const c = readXZ(car);
          if (!c) continue;
          const dx = c.x - ped.x, dz = c.z - ped.z;
          // A parked car only matters up close; a moving one, a bit further out.
          const near = (car.speed ? Math.abs(car.speed) > 0.5 : false) ? PAUSE_NEAR + 1.2 : PAUSE_NEAR;
          if (dx * dx + dz * dz < near * near) { blocked = true; break; }
        }
      }
      if (!blocked) {
        for (const other of peds) {
          if (other === ped) continue;
          const dx = other.x - ped.x, dz = other.z - ped.z;
          if (dx * dx + dz * dz < 1.0 * 1.0) { blocked = true; break; }
        }
      }
      if (blocked) ped.pause = PAUSE_TIME;
    }

    // --- Walk the perimeter, turning at corners. ---
    if (!blocked) {
      let edge = ped.edge;
      let along = ped.along + ped.speed * dt * ped.dir;
      const edgeLen = ped.lane * 2;
      if (along >= edgeLen) {
        along -= edgeLen;
        edge = (edge + 1) % 4;
      } else if (along < 0) {
        along += edgeLen;
        edge = (edge + 3) % 4;
      }
      const next = edgePosition(ped.block, ped.lane, edge, along);
      if (hitsBuilding(next.x, next.z, colliders)) {
        // Backstop only — the lane should never reach a building.
        // Turn around in place: reverse direction along the same edge.
        ped.dir *= -1;
      } else {
        ped.edge = edge;
        ped.along = along;
        ped.x = next.x;
        ped.z = next.z;
      }
      ped.phase += dt * ped.speed * 5;
    }

    // Face the direction of travel, turning smoothly at corners.
    const targetYaw = EDGE_HEADING[ped.edge] + (ped.dir < 0 ? Math.PI : 0);
    let diff = targetYaw - ped.heading;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    ped.heading += diff * Math.min(1, dt * 8);

    // Legs swing while walking, settle to still while paused.
    const swing = blocked ? 0 : Math.sin(ped.phase) * 0.5;
    ped.legL.rotation.x = swing;
    ped.legR.rotation.x = -swing;

    ped.mesh.position.set(ped.x, 0, ped.z);
    ped.mesh.rotation.y = ped.heading;
  }
  return peds;
}

// Slice 4: knock a pedestrian down — they stay down (hidden, frozen in
// place) for `seconds`, then get back up where they fell. Returns false
// if the ped is already down (so one ped cannot re-trigger every frame).
export function knockDownPed(ped, seconds) {
  if (!ped || ped.knockedDown > 0) return false;
  ped.knockedDown = seconds;
  ped.mesh.visible = false;
  return true;
}
