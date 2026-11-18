// Solmar Bay — moving traffic (slice 3). A handful of AI cars circling
// the road grid so the streets feel alive: each car loops the rectangle
// of roads around one city block, clockwise, in the right-hand lane, at
// a steady cruise speed. When something is directly ahead — another
// traffic car, a parked car, or the player — the car eases off and, if
// it gets close, waits; once the way is clear it pulls away again.
// Nothing cleverer than that: no junctions logic, no overtaking.
//
// Why the loops never hit anything: roads sit 20-32 m out from a block
// centre (road centre 26 m, half-width 6 m), and the loop runs 21 m out,
// i.e. 1 m inside the road's inner edge. Parked cars sit 4 m off a road
// centre at the crossing road's centre line, which puts every parked
// car at least ~5 m from the nearest loop corner — outside the 4 m
// two-car gap — and the corner-cutting below only moves cars further
// inwards, towards the block, never outwards. One car per loop, on
// different blocks, so traffic cars never share a lane.
//
// API for main.js (same shape as cars.js):
//   import { createTraffic } from './traffic.js';
//
//   const traffic = createTraffic(scene, city, rng);
//     scene — THREE.Scene; city — buildCity() result ({ blocks, bounds });
//     rng — seeded rng (mulberry32), so placement is deterministic.
//     Returns { cars, update } where cars is an array of:
//       { mesh, x, z, heading, speed, cruise, shape, color, corners }
//     mesh is a THREE.Group facing +Z at heading 0; speed is m/s.
//     corners is the loop's four corners in driving order — the car
//     steers at a lookahead point on that rectangle, which keeps it on
//     the road and rounds the corners for it.
//
//   traffic.update(dt, player, cars)
//     Step every traffic car by dt (clamped to 0.05 s). player is the
//     player object ({ pos: { x, z } }) or a plain { x, z } or null;
//     cars is the parked/driven array from createCars (may be empty).
//     The wiring session should also pass traffic.cars as the `others`
//     argument of updateCar, so a driven car bumps into traffic.

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { randRange, pick } from './random.js';

const TRAFFIC_COUNT = 9;      // one car per loop, nine different blocks
const LANE = 21;              // loop half-extent from its block centre (m)
const EDGE_LEN = LANE * 2;    // one side of the road rectangle (m)
const LOOKAHEAD = 5;          // steer at a point this far ahead on the loop (m)
const LOOKAHEAD_MIN = 0.4;    // shortest steering lookahead, right at a corner (m)
const CORNER_SPEED = 0.8;     // m/s at the corner itself — slow enough to turn tight
const BRAKE_DIST = 12;        // m from a corner to start easing off (and to speed back up after)
const TURN_HOLD = 0.35;       // rad of heading error: still turning, hold corner speed
const CREEP_SPEED = 0.8;      // m/s inching forward out of a past-corner deadlock
const CREEP_CLEAR = 4.5;      // only creep while the blocker is further than this (m)
const CREEP_TIME = 2.0;       // seconds a latched creep keeps inching through the turn
const CRUISE_MIN = 6.5;       // m/s, slowest cruiser (~23 km/h)
const CRUISE_MAX = 9.5;       // m/s, fastest cruiser (~34 km/h)
const TURN_RATE = 5.0;        // rad/s steering towards the lookahead point
const STOP_AHEAD = 7;         // stop if something is this close ahead (m)
const SLOW_AHEAD = 14;        // ease off if something is this close (m)
const LANE_HALF = 2.8;        // only react to things near our lane line (m)
const ACCEL = 4;              // m/s^2 pulling away
const BRAKE = 9;              // m/s^2 slowing down
const BODY_RADIUS = 2.0;      // collision circle, matches the parked cars

const SHAPES = ['sedan', 'hatchback', 'van'];
const PAINTS = [0x3a7bd5, 0xd23b2e, 0xe8c33a, 0x2f3338, 0xe8e2d4, 0x3f8f5f, 0x7a5fc2, 0xd07a2e];
// Per shape: body length/width/height, cabin length/width/height, cabin
// offset along the car (car faces +Z; negative offset = rearward).
const BODY = {
  sedan:     { len: 4.4, wid: 1.8,  tall: 0.70, cabLen: 2.0, cabWid: 1.55, cabTall: 0.60, cabZ: -0.30 },
  hatchback: { len: 3.8, wid: 1.8,  tall: 0.75, cabLen: 1.9, cabWid: 1.50, cabTall: 0.65, cabZ: -0.45 },
  van:       { len: 4.6, wid: 1.95, tall: 1.35, cabLen: 1.8, cabWid: 1.70, cabTall: 0.70, cabZ: 0.95 },
};

// Fresh procedural box-assembly car: lower body, glass cabin, roof slab,
// bumpers, head/tail lights and four wheels. (Shapes are built here, not
// imported — cars.js keeps its own builder private.)
function buildTrafficMesh(shape, color) {
  const d = BODY[shape];
  const group = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color });
  const glass = new THREE.MeshLambertMaterial({ color: 0x18242f });
  const rubber = new THREE.MeshLambertMaterial({ color: 0x101216 });
  const steel = new THREE.MeshLambertMaterial({ color: 0xcfcfcf });
  const beam = new THREE.MeshLambertMaterial({ color: 0xfff0a8, emissive: 0xffdf66, emissiveIntensity: 0.5 });
  const brake = new THREE.MeshLambertMaterial({ color: 0xb02418, emissive: 0x7a1208, emissiveIntensity: 0.5 });

  const box = (mat, w, h, len, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, len), mat);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };

  // Lower body sits on the wheels (axle height 0.35).
  box(paint, d.wid, d.tall, d.len, 0, 0.35 + d.tall / 2, 0);
  // Glass cabin with a painted roof slab on top of it.
  box(glass, d.cabWid, d.cabTall, d.cabLen, 0, 0.35 + d.tall + d.cabTall / 2, d.cabZ);
  box(paint, d.cabWid + 0.06, 0.07, d.cabLen + 0.06, 0, 0.35 + d.tall + d.cabTall + 0.035, d.cabZ);
  // Dark bumper strips front and rear.
  box(rubber, d.wid - 0.1, 0.22, 0.1, 0, 0.42, d.len / 2);
  box(rubber, d.wid - 0.1, 0.22, 0.1, 0, 0.42, -d.len / 2);
  // Headlights at the nose (+Z), taillights at the tail (-Z).
  for (const s of [-1, 1]) {
    box(beam, 0.34, 0.16, 0.06, s * (d.wid / 2 - 0.32), 0.72, d.len / 2 + 0.01);
    box(brake, 0.34, 0.16, 0.06, s * (d.wid / 2 - 0.32), 0.72, -d.len / 2 - 0.01);
  }

  // Four wheels: dark cylinders spun so the axle runs across the car.
  const tyreGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.26, 12);
  const hubGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.28, 8);
  for (const s of [-1, 1]) {
    for (const e of [-1, 1]) {
      const wx = s * (d.wid / 2 - 0.06);
      const wz = e * (d.len / 2 - 0.68);
      const wheel = new THREE.Mesh(tyreGeo, rubber);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, 0.35, wz);
      group.add(wheel);
      const hub = new THREE.Mesh(hubGeo, steel);
      hub.rotation.z = Math.PI / 2;
      hub.position.set(wx, 0.35, wz);
      group.add(hub);
    }
  }
  return group;
}

// The four corners of the road rectangle around one block, in driving
// order: west edge southbound, south edge eastbound, east edge
// northbound, north edge westbound (clockwise from above).
function loopCorners(cx, cz) {
  return [
    { x: cx - LANE, z: cz - LANE },
    { x: cx - LANE, z: cz + LANE },
    { x: cx + LANE, z: cz + LANE },
    { x: cx + LANE, z: cz - LANE },
  ];
}

// Block centres: prefer the city's own list, fall back to the grid.
function blockCentres(city) {
  if (city && Array.isArray(city.blocks) && city.blocks.length > 0) {
    return city.blocks.map((b) => ({ x: b.x, z: b.z }));
  }
  const { blocks, blockSize, roadWidth } = CONFIG.grid;
  const pitch = blockSize + roadWidth;
  const span = blocks * blockSize + (blocks + 1) * roadWidth;
  const half = span / 2;
  const centres = [];
  for (let bx = 0; bx < blocks; bx++) {
    for (let bz = 0; bz < blocks; bz++) {
      centres.push({
        x: -half + roadWidth + blockSize / 2 + bx * pitch,
        z: -half + roadWidth + blockSize / 2 + bz * pitch,
      });
    }
  }
  return centres;
}

// Fisher-Yates shuffle driven by the seeded rng.
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

export function createTraffic(scene, city, rng) {
  const centres = shuffle(blockCentres(city), rng).slice(0, TRAFFIC_COUNT);
  const bounds = (city && city.bounds) || { minX: -162, maxX: 162, minZ: -162, maxZ: 162 };
  const trafficCars = [];

  for (const centre of centres) {
    const shape = pick(rng, SHAPES);
    const color = pick(rng, PAINTS);
    const mesh = buildTrafficMesh(shape, color);
    const corners = loopCorners(centre.x, centre.z);

    // Start at a random point along a random edge of the loop, facing
    // along that edge, so the cars begin spread out instead of bunched
    // at one corner.
    const edge = Math.floor(rng() * 4);
    const from = corners[edge];
    const to = corners[(edge + 1) % 4];
    const t = randRange(rng, 0.15, 0.85);
    const x = from.x + (to.x - from.x) * t;
    const z = from.z + (to.z - from.z) * t;
    const heading = Math.atan2(to.x - from.x, to.z - from.z);

    mesh.position.set(x, 0, z);
    mesh.rotation.y = heading;
    scene.add(mesh);
    trafficCars.push({
      mesh,
      x, z, heading,
      speed: randRange(rng, CRUISE_MIN, CRUISE_MAX),
      cruise: randRange(rng, CRUISE_MIN, CRUISE_MAX),
      shape, color,
      corners,
      creepTimer: 0, // latched deadlock-escape creep, counts down while inching
    });
  }

  // Step every traffic car by dt. `player` is the player object
  // ({ pos: { x, z } }), a plain { x, z }, or null; `cars` is the
  // parked/driven array from createCars (may be empty or omitted).
  function update(dt, player, cars) {
    dt = Math.min(dt, 0.05);
    if (dt <= 0) return;

    const solids = [];
    if (cars) for (const c of cars) solids.push(c);
    for (const t of trafficCars) solids.push(t);
    if (player) {
      const px = player.pos ? player.pos.x : player.x;
      const pz = player.pos ? player.pos.z : player.z;
      if (typeof px === 'number' && typeof pz === 'number') solids.push({ x: px, z: pz });
    }

    for (const car of trafficCars) stepCar(car, dt, solids, bounds);
  }

  return { cars: trafficCars, update };
}

// Closest point on the loop rectangle to (x, z), with the edge it sits
// on and how far along that edge it is (t in 0..1).
function nearestOnLoop(corners, x, z) {
  let best = null;
  for (let e = 0; e < 4; e++) {
    const a = corners[e], b = corners[(e + 1) % 4];
    const abx = b.x - a.x, abz = b.z - a.z;
    const len2 = abx * abx + abz * abz;
    let t = ((x - a.x) * abx + (z - a.z) * abz) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + abx * t, pz = a.z + abz * t;
    const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
    if (!best || d2 < best.d2) best = { edge: e, t, x: px, z: pz, d2 };
  }
  return best;
}

// The point `ahead` metres further along the loop from (edge, t),
// walking the rectangle in driving order and wrapping around corners.
function pointAhead(corners, edge, t, ahead) {
  let dist = t * EDGE_LEN + ahead;
  let e = edge;
  while (dist >= EDGE_LEN) {
    dist -= EDGE_LEN;
    e = (e + 1) % 4;
  }
  const a = corners[e], b = corners[(e + 1) % 4];
  const f = dist / EDGE_LEN;
  return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f };
}

// One traffic car, one step: ease towards the speed the road ahead
// allows, steer at a lookahead point on the loop, roll forward.
function stepCar(car, dt, solids, bounds) {
  // How far is the nearest thing directly ahead in our lane?
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  const rx = Math.cos(car.heading), rz = -Math.sin(car.heading);
  let nearestAhead = Infinity;
  for (const o of solids) {
    if (o === car) continue;
    const dx = o.x - car.x, dz = o.z - car.z;
    const along = dx * fx + dz * fz;
    if (along <= 0 || along > SLOW_AHEAD) continue;
    const side = Math.abs(dx * rx + dz * rz);
    if (side > LANE_HALF) continue;
    if (along < nearestAhead) nearestAhead = along;
  }
  let want = car.cruise;
  if (nearestAhead < STOP_AHEAD) want = 0;
  else if (nearestAhead < SLOW_AHEAD) want = car.cruise * 0.35;

  // Corner approach: the loop's corners are sharp, so a car that takes
  // one at cruise speed on a 5 m lookahead cuts across it by ~1.5 m.
  // Ease off on a ramp either side of the corner instead, so the car
  // is already at ~CORNER_SPEED when the turn starts (a lookahead
  // before the corner) and turns tight on the lane line: want falls
  // linearly from cruise BRAKE_DIST out to CORNER_SPEED at the edge
  // of the turn zone, and climbs back the same way after it.
  // (The ramp falls slower than BRAKE, so the car always catches it.)
  const near = nearestOnLoop(car.corners, car.x, car.z);
  const alongEdge = near.t * EDGE_LEN;
  const distAhead = EDGE_LEN - alongEdge;   // to the next corner ahead
  const distToCorner = Math.min(distAhead, alongEdge); // to the nearest corner either way
  const rampDist = Math.max(0, distToCorner - LOOKAHEAD_MIN);
  const cornerWant = CORNER_SPEED + (car.cruise - CORNER_SPEED) * Math.min(1, rampDist / BRAKE_DIST);
  if (cornerWant < want) want = cornerWant;

  // Steering geometry: aim at a point a short way ahead on the loop.
  // Near a corner the lookahead shortens to the corner itself, so the
  // car turns at the corner instead of starting the turn metres early
  // and cutting across it. Computed here, before the speed easing, so
  // the heading error can hold the speed down through the turn.
  const lookAhead = Math.max(LOOKAHEAD_MIN, Math.min(LOOKAHEAD, distAhead));
  const look = pointAhead(car.corners, near.edge, near.t, lookAhead);
  const wantHeading = Math.atan2(look.x - car.x, look.z - car.z);
  let diff = wantHeading - car.heading;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;

  // Don't speed up mid-turn: while the nose is still well off the
  // lane's direction, hold the corner speed — accelerating through
  // the turn widens the arc and cuts the corner again.
  if (Math.abs(diff) > TURN_HOLD) want = Math.min(want, CORNER_SPEED);

  // Deadlock escape: a parked car can sit on the extension of our lane
  // just past a corner, so the car stops short of the corner and can
  // never turn away from it (steering needs motion, motion needs a
  // clear lane). If the blocker is past the next corner and still a
  // car's length away, inch forward — the turn takes us away from it.
  // The creep latches for CREEP_TIME: while the car rotates through
  // the turn, the blocker slides sideways out of the ahead cone, so
  // its along-track distance shrinks even though the car is not
  // closing on it — a plain distance test would cut the creep off
  // mid-turn and strand the car at the corner.
  if (want === 0 && car.creepTimer <= 0 && nearestAhead > distAhead + 0.5 && nearestAhead > CREEP_CLEAR) {
    car.creepTimer = CREEP_TIME;
  }
  if (want === 0 && car.creepTimer > 0) {
    want = CREEP_SPEED;
    car.creepTimer -= dt;
  } else if (want > 0) {
    car.creepTimer = 0;
  }

  // Ease towards that speed: gentle pull-away, firmer braking.
  if (car.speed < want) car.speed = Math.min(want, car.speed + ACCEL * dt);
  else if (car.speed > want) car.speed = Math.max(want, car.speed - BRAKE * dt);

  // Steer at the lookahead point: the car follows its road rectangle,
  // drifts back onto the lane if it ever leaves it, and rounds each
  // corner instead of pivoting on it. No steering while stopped.
  if (car.speed > 0.1) {
    const turn = Math.max(-TURN_RATE * dt, Math.min(TURN_RATE * dt, diff));
    car.heading += turn;
  }

  car.x += Math.sin(car.heading) * car.speed * dt;
  car.z += Math.cos(car.heading) * car.speed * dt;

  // Safety net only — the loops never leave the grid, but never let a
  // car escape the city if something unexpected happens.
  if (bounds) {
    car.x = Math.max(bounds.minX + BODY_RADIUS, Math.min(bounds.maxX - BODY_RADIUS, car.x));
    car.z = Math.max(bounds.minZ + BODY_RADIUS, Math.min(bounds.maxZ - BODY_RADIUS, car.z));
  }

  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.heading;
}
