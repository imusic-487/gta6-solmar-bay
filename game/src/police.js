// Solmar Bay — wanted level + police pursuit (slice 4).
//
//   const police = createPolice(scene, city, rng);
//   Returns { cars, update, addWanted, getWanted, getPoliceCount, clearWanted }.
//   clearWanted() (slice 7) — heat back to 0; patrol cars leave on the
//   next update through the existing wanted<=0 path.
//   Each car: { mesh, x, z, heading, speed, topSpeed, redLight,
//   blueLight, flashTimer }; mesh is a THREE.Group facing +Z.
//   police.update(dt, target, others): target is a driven car
//   ({ x, z, heading, speed }) or the player ({ pos: { x, z } });
//   others is an array of obstacle cars to keep a gap from.
//   Wanted 0-5: addWanted(n) raises it (clamped, resets the quiet
//   timer); it decays by 1 after ~25 s quiet with no patrol car
//   within ~25 m. Spawns are staggered (~1.5 s apart), 40-60 m from
//   the target, count by level: 1->1, 2->2, 3->3, 4-5->4 (cap 4).
//   At wanted 0 all patrol cars leave. A patrol car within ~2.5 m
//   rams: a driven car keeps 40% speed, a player is shoved away.

import * as THREE from 'three';

const MAX_WANTED = 5;
const MAX_CARS = 4;          // cap on patrol cars, reached at 4-5 stars
const SPAWN_GAP = 1.5;       // seconds between staggered spawns
const SPAWN_MIN = 40;        // spawn at least this far from the target
const SPAWN_MAX = 60;        // ... and at most this far
const TOP_SPEED_BASE = 30;   // m/s at 1 star (slice 10: must beat the 26 m/s player car)
const TOP_SPEED_STEP = 1;    // +1 m/s per extra star (34 m/s at 5 stars)
const ACCEL = 7;             // m/s^2 pulling up to speed
const TURN_RATE = 2.6;       // rad/s steering towards the target
const BODY_RADIUS = 2.0;     // collision circle, matches the other cars
const RAM_DIST = 2.5;        // ram when closer than this (m)
const RAM_SLOW = 0.4;        // driven car keeps 40% of its speed on a ram
const SHOVE = 1.2;           // metres a player on foot is pushed by a ram
const DECAY_AFTER = 25;      // seconds quiet before the heat drops
const DECAY_RANGE = 25;      // ... only if no patrol car is this close
const SEPARATION = 4.2;      // keep at least this far from obstacle cars
const FLASH_PERIOD = 0.28;   // seconds per light-bar flash phase
const REVERSE_SPEED = 5;     // m/s backing out of a pocket
const REVERSE_ACCEL = 20;    // m/s^2 getting up to reverse speed
const UNSTICK_TIME = 1.0;    // seconds of reversing per escape
const STUCK_WINDOW = 1.0;    // seconds of trail to judge stillness over
const STUCK_AFTER = 1.0;     // seconds of stillness before reversing out
const STUCK_RADIUS = 1.0;    // m: less than this far in STUCK_WINDOW counts as stuck

// Patrol cars wanted by level: 1 star -> 1, 2 -> 2, 3 -> 3, 4-5 -> 4.
function carsWanted(level) {
  if (level <= 0) return 0;
  return Math.min(level, MAX_CARS);
}

// Fresh procedural box-assembly patrol car, built here and nowhere
// else: white body, black doors and hood, a red/blue light bar on the
// roof, four wheels. Faces +Z at heading 0, like the other cars.
function buildPatrolMesh() {
  const group = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: 0xf2f2ee });
  const black = new THREE.MeshLambertMaterial({ color: 0x14161a });
  const glass = new THREE.MeshLambertMaterial({ color: 0x1a2836 });
  const rubber = new THREE.MeshLambertMaterial({ color: 0x101216 });
  const steel = new THREE.MeshLambertMaterial({ color: 0xcfcfcf });
  const beam = new THREE.MeshLambertMaterial({ color: 0xfff0a8, emissive: 0xffdf66, emissiveIntensity: 0.5 });
  const brake = new THREE.MeshLambertMaterial({ color: 0xb02418, emissive: 0x7a1208, emissiveIntensity: 0.5 });
  const red = new THREE.MeshLambertMaterial({ color: 0xd21f1f, emissive: 0xff2020, emissiveIntensity: 1.6 });
  const blue = new THREE.MeshLambertMaterial({ color: 0x1f4fd2, emissive: 0x2040ff, emissiveIntensity: 0.4 });

  const box = (mat, w, h, len, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, len), mat);
    m.position.set(x, y, z);
    group.add(m);
    return m;
  };

  box(white, 1.9, 0.72, 4.5, 0, 0.71, 0);           // white lower body
  box(black, 1.7, 0.08, 1.1, 0, 1.10, 1.55);        // black hood panel
  for (const s of [-1, 1]) box(black, 0.06, 0.5, 1.5, s * 0.96, 0.72, -0.1); // black doors
  box(glass, 1.6, 0.62, 2.1, 0, 1.38, -0.25);       // glass cabin
  box(white, 1.66, 0.08, 2.16, 0, 1.73, -0.25);     // white roof slab
  for (const s of [-1, 1]) {                        // head/tail lights
    box(beam, 0.34, 0.16, 0.06, s * 0.62, 0.72, 2.26);
    box(brake, 0.34, 0.16, 0.06, s * 0.62, 0.72, -2.26);
  }
  // Light bar on the roof: red left, blue right, on a black base.
  const redLight = box(red, 0.62, 0.16, 0.34, -0.36, 1.86, -0.25);
  const blueLight = box(blue, 0.62, 0.16, 0.34, 0.36, 1.86, -0.25);
  box(black, 1.5, 0.06, 0.4, 0, 1.78, -0.25);

  const tyreGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.26, 12);
  const hubGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.28, 8);
  for (const s of [-1, 1]) for (const e of [-1, 1]) {
    const wx = s * 0.89, wz = e * 1.55;
    const wheel = new THREE.Mesh(tyreGeo, rubber);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.35, wz);
    group.add(wheel);
    const hub = new THREE.Mesh(hubGeo, steel);
    hub.rotation.z = Math.PI / 2;
    hub.position.set(wx, 0.35, wz);
    group.add(hub);
  }
  return { group, redLight, blueLight, redMat: red, blueMat: blue };
}

// Push a circle out of a building AABB. Fixed position, or null if clear.
function pushOutOfBox(x, z, radius, box) {
  const cx = Math.max(box.minX, Math.min(x, box.maxX));
  const cz = Math.max(box.minZ, Math.min(z, box.maxZ));
  const dx = x - cx, dz = z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= radius * radius) return null;
  if (d2 > 1e-8) {
    const d = Math.sqrt(d2), push = (radius - d) / d;
    return { x: x + dx * push, z: z + dz * push };
  }
  // Centre inside the box: leave along the shallowest side.
  const m = Math.min(x - box.minX, box.maxX - x, z - box.minZ, box.maxZ - z);
  if (m === x - box.minX) return { x: box.minX - radius, z };
  if (m === box.maxX - x) return { x: box.maxX + radius, z };
  if (m === z - box.minZ) return { x, z: box.minZ - radius };
  return { x, z: box.maxZ + radius };
}

// Is (x, z) clear of every building collider (with a margin)?
function spotIsClear(x, z, colliders, margin) {
  if (!colliders) return true;
  for (const box of colliders) {
    if (x > box.minX - margin && x < box.maxX + margin &&
        z > box.minZ - margin && z < box.maxZ + margin) return false;
  }
  return true;
}

export function createPolice(scene, city, rng) {
  const nextRand = (typeof rng === 'function') ? rng : Math.random;
  const colliders = (city && city.colliders) || null;
  const bounds = (city && city.bounds) || { minX: -162, maxX: 162, minZ: -162, maxZ: 162 };

  let wanted = 0;
  let quietFor = 0;        // seconds since the last crime
  let spawnTimer = 0;      // counts down to the next staggered spawn
  const cars = [];

  function addWanted(n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return wanted;
    wanted = Math.max(0, Math.min(MAX_WANTED, wanted + n));
    quietFor = 0;
    return wanted;
  }
  function getWanted() { return wanted; }
  function getPoliceCount() { return cars.length; }

  // Slice 7 respawn reset: heat drops to zero at once; the patrol
  // cars stand down on the next update (wanted<=0 removes them).
  function clearWanted() {
    wanted = 0;
  }

  // Pick a spot 40-60 m from the target, facing it. Try a few angles
  // so the car never spawns inside a building or on top of the target.
  function spawnSpot(tx, tz) {
    let fallback = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const angle = nextRand() * Math.PI * 2;
      const dist = SPAWN_MIN + nextRand() * (SPAWN_MAX - SPAWN_MIN);
      const x = Math.max(bounds.minX + BODY_RADIUS, Math.min(bounds.maxX - BODY_RADIUS, tx + Math.sin(angle) * dist));
      const z = Math.max(bounds.minZ + BODY_RADIUS, Math.min(bounds.maxZ - BODY_RADIUS, tz + Math.cos(angle) * dist));
      if (!fallback) fallback = { x, z, angle };
      if (spotIsClear(x, z, colliders, BODY_RADIUS + 0.5)) return { x, z, angle };
    }
    return fallback;
  }

  function spawnCar(tx, tz) {
    const spot = spawnSpot(tx, tz);
    if (!spot) return;
    const { group, redLight, blueLight, redMat, blueMat } = buildPatrolMesh();
    const heading = Math.atan2(tx - spot.x, tz - spot.z);
    group.position.set(spot.x, 0, spot.z);
    group.rotation.y = heading;
    scene.add(group);
    cars.push({
      mesh: group, x: spot.x, z: spot.z, heading, speed: 0,
      topSpeed: TOP_SPEED_BASE + TOP_SPEED_STEP * Math.max(0, wanted - 1),
      redLight, blueLight, redMat, blueMat,
      flashTimer: nextRand() * FLASH_PERIOD,
      blocked: false,      // in contact with a building last frame
      stillFor: 0,         // seconds of stillness while far from the target
      unstickTimer: 0,     // seconds of reversing left in an escape
      clock: 0,            // seconds this car has existed (trail time base)
      trail: [],           // recent { t, x, z } snapshots for stillness checks
      wallNX: 0, wallNZ: 0, // last building-contact normal (out of the wall)
    });
  }

  function removeAll() {
    for (const car of cars) scene.remove(car.mesh);
    cars.length = 0;
    spawnTimer = 0;
  }

  // Read the target's position either way it can arrive: a player
  // object ({ pos: { x, z } }) or a plain { x, z } car.
  function targetPos(target) {
    if (!target) return null;
    if (target.pos && typeof target.pos.x === 'number' && typeof target.pos.z === 'number') {
      return { x: target.pos.x, z: target.pos.z };
    }
    if (typeof target.x === 'number' && typeof target.z === 'number') {
      return { x: target.x, z: target.z };
    }
    return null;
  }

  function update(dt, target, others) {
    dt = Math.min(dt, 0.05);
    if (dt <= 0) return;
    quietFor += dt;

    const pos = targetPos(target);
    if (!pos) return;

    if (wanted <= 0) {                 // no heat, no police
      if (cars.length > 0) removeAll();
      return;
    }

    // Staggered spawns: one car at a time until the level's count.
    spawnTimer -= dt;
    if (cars.length < carsWanted(wanted) && spawnTimer <= 0) {
      spawnCar(pos.x, pos.z);
      spawnTimer = SPAWN_GAP;
    }

    // Heat decay: quiet ~25 s with no patrol car close by.
    let nearest = Infinity;
    for (const car of cars) {
      const d = Math.hypot(car.x - pos.x, car.z - pos.z);
      if (d < nearest) nearest = d;
    }
    if (quietFor >= DECAY_AFTER && nearest > DECAY_RANGE) {
      wanted = Math.max(0, wanted - 1);
      quietFor = 0;
      if (wanted <= 0) { removeAll(); return; }
    }

    const topSpeed = TOP_SPEED_BASE + TOP_SPEED_STEP * Math.max(0, wanted - 1);

    for (const car of cars) {
      car.topSpeed = topSpeed;
      const dx = pos.x - car.x, dz = pos.z - car.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      // Unstick: backed into a pocket — reverse straight out for a
      // second, then chase again. Point the nose into the wall, so
      // reversing carries the car out along the wall normal instead
      // of sliding it along the face it is already stuck on.
      if (car.unstickTimer > 0) {
        car.unstickTimer -= dt;
        if (car.wallNX !== 0 || car.wallNZ !== 0) {
          car.heading = Math.atan2(-car.wallNX, -car.wallNZ);
        }
        car.speed = Math.max(-REVERSE_SPEED, car.speed - REVERSE_ACCEL * dt);
      } else {
        if (car.speed < topSpeed) car.speed = Math.min(topSpeed, car.speed + ACCEL * dt);
        // Seek steering: turn towards the target's current position.
        if (dist > 0.5 && car.speed > 0.1) {
          const wantHeading = Math.atan2(dx, dz);
          let diff = wantHeading - car.heading;
          while (diff > Math.PI) diff -= 2 * Math.PI;
          while (diff < -Math.PI) diff += 2 * Math.PI;
          car.heading += Math.max(-TURN_RATE * dt, Math.min(TURN_RATE * dt, diff));
        }
      }
      car.x += Math.sin(car.heading) * car.speed * dt;
      car.z += Math.cos(car.heading) * car.speed * dt;

      // Buildings are solid: circle vs each AABB, pushed out. Instead
      // of grinding into the wall — the old code halved the speed on
      // every contact frame, which pinned a wedged car at ~0.1 m/s —
      // the car slides along the face: its heading is deflected to
      // the wall tangent that closes on the target, and it only loses
      // speed once, on impact.
      if (colliders) {
        let nx = 0, nz = 0, contacts = 0;
        for (const box of colliders) {
          const fixed = pushOutOfBox(car.x, car.z, BODY_RADIUS, box);
          if (fixed) {
            const px = fixed.x - car.x, pz = fixed.z - car.z;
            const pl = Math.hypot(px, pz);
            if (pl > 1e-6) { nx += px / pl; nz += pz / pl; }
            car.x = fixed.x; car.z = fixed.z;
            contacts++;
          }
        }
        if (contacts > 0) {
          const nl = Math.hypot(nx, nz);
          if (nl > 1e-6) {
            nx /= nl; nz /= nl;
            car.wallNX = nx; car.wallNZ = nz;
            const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
            const into = Math.max(0, -(fx * nx + fz * nz));
            // Tangent along the wall, pointing the way that closes on
            // the target.
            let tx = -nz, tz = nx;
            if (tx * dx + tz * dz < 0) { tx = -tx; tz = -tz; }
            car.heading = Math.atan2(tx, tz);
            if (!car.blocked) car.speed = Math.max(0, car.speed * (1 - 0.5 * into));
          }
        } else {
          car.wallNX = 0; car.wallNZ = 0;
        }
        car.blocked = contacts > 0;
      }
      // Keep a gap from obstacle cars (parked + traffic): circle push.
      if (others) {
        for (const other of others) {
          if (other === car) continue;
          if (typeof other.x !== 'number' || typeof other.z !== 'number') continue;
          const ox = car.x - other.x, oz = car.z - other.z;
          const d2 = ox * ox + oz * oz;
          if (d2 < SEPARATION * SEPARATION && d2 > 1e-8) {
            const d = Math.sqrt(d2), push = (SEPARATION - d) / d;
            car.x += ox * push * 0.5;
            car.z += oz * push * 0.5;
          }
        }
      }
      // Stay inside the city.
      car.x = Math.max(bounds.minX + BODY_RADIUS, Math.min(bounds.maxX - BODY_RADIUS, car.x));
      car.z = Math.max(bounds.minZ + BODY_RADIUS, Math.min(bounds.maxZ - BODY_RADIUS, car.z));

      // Stuck detection: how far has the car got in the last second?
      // A wedged car can sit at full speed and still go nowhere — it
      // grinds along a face, or flickers back and forth across the
      // target's line — so speed alone cannot show it, and a fixed
      // anchor keeps getting reset by the flicker. Judge the trail
      // instead: net displacement over STUCK_WINDOW. Close to the
      // target the car is ramming, not stuck, so it does not count.
      car.clock += dt;
      car.trail.push({ t: car.clock, x: car.x, z: car.z });
      while (car.trail.length > 1 && car.trail[0].t < car.clock - STUCK_WINDOW) car.trail.shift();
      const ref = car.trail[0];
      if (dist > 5 && car.unstickTimer <= 0 && ref && car.clock - ref.t >= STUCK_WINDOW - 0.05) {
        if (Math.hypot(car.x - ref.x, car.z - ref.z) < STUCK_RADIUS) {
          if ((car.stillFor += dt) > STUCK_AFTER) {
            car.unstickTimer = UNSTICK_TIME;
            car.stillFor = 0;
          }
        } else {
          car.stillFor = 0;
        }
      } else {
        car.stillFor = 0;
      }

      // Ram: close enough to touch — slow the target, bounce back.
      if (dist <= RAM_DIST) {
        if (target && typeof target.speed === 'number') {
          target.speed *= RAM_SLOW;
        } else if (target && target.pos && typeof target.pos.x === 'number' && typeof target.pos.z === 'number') {
          const px = target.pos.x - car.x, pz = target.pos.z - car.z;
          const pd = Math.sqrt(px * px + pz * pz) || 1;
          target.pos.x += (px / pd) * SHOVE;
          target.pos.z += (pz / pd) * SHOVE;
          if (target.mesh && target.mesh.position) {
            target.mesh.position.x = target.pos.x;
            target.mesh.position.z = target.pos.z;
          }
        }
        car.x -= Math.sin(car.heading) * 1.0;
        car.z -= Math.cos(car.heading) * 1.0;
        car.speed = Math.max(0, car.speed * 0.5);
      }

      // Flash the light bar: red and blue alternate.
      car.flashTimer += dt;
      if (car.flashTimer >= FLASH_PERIOD) {
        car.flashTimer = 0;
        const redOn = car.redMat.emissiveIntensity > 1;
        car.redMat.emissiveIntensity = redOn ? 0.4 : 1.6;
        car.blueMat.emissiveIntensity = redOn ? 1.6 : 0.4;
        car.redLight.visible = !redOn;
        car.blueLight.visible = redOn;
      }

      car.mesh.position.set(car.x, 0, car.z);
      car.mesh.rotation.y = car.heading;
    }
  }

  return { cars, update, addWanted, getWanted, getPoliceCount, clearWanted };
}
