// Solmar Bay — drivable cars (slice 2). Procedural box-assembly cars
// (sedan / hatchback / van): body + glass cabin + roof + 4 wheels.
// All cars start parked; the wiring session lets the player steal one.
//
// API for main.js:
//   import { createCars, updateCar, nearestCar } from './cars.js';
//
//   const { cars } = createCars(scene, city, rng);
//     scene — THREE.Scene; city — buildCity() result { colliders, spawn,
//     bounds, blocks }; rng — seeded rng (mulberry32), so placement is
//     deterministic. Returns { cars }, each car:
//       { mesh, x, z, heading, speed, shape, color }
//     mesh is a THREE.Group facing +Z at heading 0; speed is m/s
//     (positive = forward). Parked cars have speed 0.
//
//   updateCar(car, input, dt, colliders, bounds, others?)
//     Arcade driving. input is the slice-1 input object ({ keys: Set of
//     e.code strings }) or a plain { forward, back, left, right } object
//     (w/s/a/d also accepted). W/S accelerate / brake / reverse, A/D steer
//     (steering scales with speed, flips in reverse). The car advances
//     along its heading, collides as a circle (radius ~2) against the
//     building AABBs in colliders — on a hit it is pushed out and stopped,
//     never passing through a building — and is clamped inside bounds.
//     `others` is an optional array of other cars to collide with as
//     circles (parked cars are solid too). The mesh follows x/z/heading.
//
//   nearestCar(cars, x, z, maxDist)
//     Closest car within maxDist of (x, z), or null. The wiring session
//     uses it for E-to-enter: on foot near a car + E = drive it (hide the
//     player mesh, chase camera on the car).

import * as THREE from 'three';
import { randRange, pick } from './random.js';

const CAR = {
  accel: 16, maxSpeed: 26,      // forward
  brake: 26,                    // S while moving forward
  reverseAccel: 10, maxReverse: 8,
  drag: 1.6,                    // 1/s coasting slowdown
  steerRate: 1.9,               // rad/s at full speed
  radius: 2.0,                  // collision circle radius
};

const SHAPES = ['sedan', 'hatchback', 'van'];
const COLORS = [0xc23b2e, 0x2e6fc2, 0xe8c33a, 0x3a3f45, 0xe8e4da, 0x3f8f5f, 0x8a5fc2, 0xd07a2e];
// Per shape: [bodyLen, bodyW, bodyH, cabinLen, cabinW, cabinH, cabinZ]
// (car faces +Z; cabinZ negative = rearward).
const DIMS = {
  sedan: [4.6, 1.9, 0.75, 2.2, 1.7, 0.65, -0.2],
  hatchback: [3.9, 1.85, 0.8, 2.0, 1.65, 0.7, -0.5],
  van: [4.8, 2.0, 1.5, 2.0, 1.8, 0.8, 1.2],
};

function buildCarMesh(shape, color) {
  const [bl, bw, bh, cl, cw, ch, cz] = DIMS[shape];
  const group = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color });
  const glass = new THREE.MeshLambertMaterial({ color: 0x1c2836 });
  const tyre = new THREE.MeshLambertMaterial({ color: 0x14161a });
  const trim = new THREE.MeshLambertMaterial({ color: 0xd8d8d8 });
  const headMat = new THREE.MeshLambertMaterial({ color: 0xfff2b0, emissive: 0xffe680, emissiveIntensity: 0.5 });
  const tailMat = new THREE.MeshLambertMaterial({ color: 0xc22a1e, emissive: 0x881505, emissiveIntensity: 0.5 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bl), paint);
  body.position.y = 0.55 + bh / 2;
  group.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(cw, ch, cl), glass);
  cabin.position.set(0, 0.55 + bh + ch / 2, cz);
  group.add(cabin);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(cw + 0.06, 0.08, cl + 0.06), paint);
  roof.position.set(0, 0.55 + bh + ch + 0.04, cz);
  group.add(roof);

  // Headlights (nose, +Z) and taillights (tail, -Z).
  const lampGeo = new THREE.BoxGeometry(0.35, 0.18, 0.06);
  for (const sx of [-1, 1]) {
    const head = new THREE.Mesh(lampGeo, headMat);
    head.position.set(sx * (bw / 2 - 0.3), 0.75, bl / 2 + 0.01);
    group.add(head);
    const tail = new THREE.Mesh(lampGeo, tailMat);
    tail.position.set(sx * (bw / 2 - 0.3), 0.75, -bl / 2 - 0.01);
    group.add(tail);
  }

  // Four wheels: dark cylinders, axis across the car.
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.3, 8);
  hubGeo.rotateZ(Math.PI / 2);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const pos = [sx * (bw / 2 - 0.08), 0.36, sz * (bl / 2 - 0.65)];
      const wheel = new THREE.Mesh(wheelGeo, tyre);
      wheel.position.set(...pos);
      group.add(wheel);
      const hub = new THREE.Mesh(hubGeo, trim);
      hub.position.set(...pos);
      group.add(hub);
    }
  }
  return group;
}

// Park cars parallel along roads, just off the driving lane, facing along
// the road. Roads run at x/z = -156, -104, -52, 0, 52, 104, 156 (pitch 52,
// roadWidth 12); a car at road centre +/- 4 sits on the road without
// blocking its middle, and its along-road position is a block centre so
// it never sits on an intersection.
function parkingSpots() {
  const spots = [];
  for (const rx of [-104, -52, 52, 104])           // vertical roads, face +/-Z
    for (const rz of [-52, 52]) spots.push({ x: rx + 4, z: rz, heading: 0 });
  for (const rz of [-104, 104])                    // horizontal roads, face +/-X
    for (const rx of [-52, 52]) spots.push({ x: rx, z: rz + 4, heading: Math.PI / 2 });
  spots.push({ x: 4, z: -104, heading: 0 });       // central avenue, clear of spawn (0,0)
  spots.push({ x: -4, z: 104, heading: Math.PI });
  return spots;                                    // 8 + 4 + 2 = 14 cars
}

export function createCars(scene, city, rng) {
  const cars = [];
  for (const spot of parkingSpots()) {
    const shape = pick(rng, SHAPES);
    const color = pick(rng, COLORS);
    const mesh = buildCarMesh(shape, color);
    // Small deterministic jitter so parked cars don't look stamped out.
    const x = spot.x + randRange(rng, -0.6, 0.6);
    const z = spot.z + randRange(rng, -0.6, 0.6);
    const heading = spot.heading + randRange(rng, -0.05, 0.05);
    mesh.position.set(x, 0, z);
    mesh.rotation.y = heading;
    scene.add(mesh);
    cars.push({ mesh, x, z, heading, speed: 0, shape, color });
  }
  return { cars };
}

function readInput(input) {
  if (!input) return { f: false, b: false, l: false, r: false };
  if (input.keys instanceof Set) {
    return {
      f: input.keys.has('KeyW') || input.keys.has('ArrowUp'),
      b: input.keys.has('KeyS') || input.keys.has('ArrowDown'),
      l: input.keys.has('KeyA') || input.keys.has('ArrowLeft'),
      r: input.keys.has('KeyD') || input.keys.has('ArrowRight'),
    };
  }
  return { f: !!(input.forward || input.w), b: !!(input.back || input.s), l: !!(input.left || input.a), r: !!(input.right || input.d) };
}

// Push a circle (car) out of an AABB (building). Returns the fixed position, or null.
function resolveAabb(x, z, radius, box) {
  const cx = Math.max(box.minX, Math.min(x, box.maxX));
  const cz = Math.max(box.minZ, Math.min(z, box.maxZ));
  const dx = x - cx, dz = z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= radius * radius) return null;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2), push = (radius - d) / d;
    return { x: x + dx * push, z: z + dz * push };
  }
  // Centre inside the box: shove out along the shallowest axis.
  const m = Math.min(x - box.minX, box.maxX - x, z - box.minZ, box.maxZ - z);
  if (m === x - box.minX) return { x: box.minX - radius, z };
  if (m === box.maxX - x) return { x: box.maxX + radius, z };
  if (m === z - box.minZ) return { x, z: box.minZ - radius };
  return { x, z: box.maxZ + radius };
}

export function updateCar(car, input, dt, colliders, bounds, others) {
  const { f, b, l, r } = readInput(input);
  dt = Math.min(dt, 0.05);

  if (f) car.speed += CAR.accel * dt;
  if (b) car.speed -= (car.speed > 0.5 ? CAR.brake : CAR.reverseAccel) * dt;
  if (!f && !b) {  // coasting drag
    const drag = CAR.drag * car.speed * dt;
    car.speed -= Math.abs(drag) > Math.abs(car.speed) ? car.speed : drag;
  }
  car.speed = Math.max(-CAR.maxReverse, Math.min(CAR.maxSpeed, car.speed));

  // Steering scales with speed, none when still, flips when reversing.
  const steer = (l ? 1 : 0) - (r ? 1 : 0);
  const speedFactor = Math.min(1, Math.abs(car.speed) / 8);
  car.heading += steer * CAR.steerRate * speedFactor * Math.sign(car.speed || 1) * dt;

  // Advance along the heading (mesh faces +Z at heading 0).
  car.x += Math.sin(car.heading) * car.speed * dt;
  car.z += Math.cos(car.heading) * car.speed * dt;

  // Building collision: circle vs each AABB, push out and stop.
  if (colliders) {
    for (const box of colliders) {
      const fixed = resolveAabb(car.x, car.z, CAR.radius, box);
      if (fixed) { car.x = fixed.x; car.z = fixed.z; car.speed = 0; }
    }
  }
  // Parked-car collision: circle vs circle, push out and stop.
  if (others) {
    for (const other of others) {
      if (other === car) continue;
      const dx = car.x - other.x, dz = car.z - other.z;
      const minD = CAR.radius * 2, d2 = dx * dx + dz * dz;
      if (d2 < minD * minD && d2 > 1e-8) {
        const d = Math.sqrt(d2), push = (minD - d) / d;
        car.x += dx * push; car.z += dz * push; car.speed = 0;
      }
    }
  }
  // Stay inside the city.
  if (bounds) {
    car.x = Math.max(bounds.minX + CAR.radius, Math.min(bounds.maxX - CAR.radius, car.x));
    car.z = Math.max(bounds.minZ + CAR.radius, Math.min(bounds.maxZ - CAR.radius, car.z));
  }

  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.heading;
  return car;
}

export function nearestCar(cars, x, z, maxDist) {
  let best = null, bestD2 = maxDist * maxDist;
  for (const car of cars) {
    const dx = car.x - x, dz = car.z - z, d2 = dx * dx + dz * dz;
    if (d2 < bestD2) { bestD2 = d2; best = car; }
  }
  return best;
}
