// Solmar Bay — street melee combat (slice 6). Fists only: no guns,
// no ammo, no projectiles.
//
//   const combat = createCombat(scene, city, rng, { addWanted, onKnockout });
//   Returns { update, getHealth, getKnockouts, getOpponents }.
//   scene — THREE.Scene; city — buildCity() result ({ colliders,
//   spawn, bounds }); rng — seeded rng, so the three opponents
//   always spawn in the same spots with the same looks.
//   options.addWanted(n) — wired to police.addWanted(n); fired once
//   per opponent, on the first punch that lands on them (see the note
//   in tryPunch). options.onKnockout({ name, reward, index }) —
//   fired exactly once per knockout; the caller adds reward to cash,
//   like the missions onComplete callback. This module never touches
//   cash itself.
//   update(dt, player, input, driving) — step every play frame, after
//   player.update. driving skips punches entirely and opponents
//   stand down while the player is in a car. Opponents wander near
//   spawn until the player comes within AGGRO_RANGE, then close in
//   and swing inside ATTACK_RANGE.
//   getHealth() — player health, 100 at start, reduced only by
//   opponent hits (clamped at 0, no regen). getKnockouts() —
//   knockouts so far (0..3). getOpponents() — copies of
//   { name, x, z, hp, maxHp, knockedOut }.
//   All three opponents are original fiction for Solmar Bay —
//   invented names, invented looks, box-built figures assembled
//   fresh in this file. No Rockstar names, characters or assets.
import * as THREE from 'three';

const COUNT = 3;
const PLAYER_MAX_HP = 100, OPP_MAX_HP = 100;
const AGGRO_RANGE = 8, ATTACK_RANGE = 1.6; // chase inside 8 m, swing inside 1.6 m
const ATTACK_DAMAGE_MIN = 8, ATTACK_DAMAGE_MAX = 12; // rng roll per swing
const ATTACK_COOLDOWN = 1.0, CHASE_SPEED = 3.0, WANDER_SPEED = 1.2;
const PUNCH_KEY = 'KeyF'; // F: the mouse drags the camera, so the mouse can't punch
const PUNCH_RANGE = 2.0, PUNCH_HALF_ANGLE = Math.PI / 3; // 120 deg cone
const PUNCH_DAMAGE = 25, PUNCH_COOLDOWN = 0.45; // four clean hits = one KO
const KNOCKBACK = 1.2, FLASH_TIME = 0.15, KNOCKOUT_REWARD = 20;
const BODY_RADIUS = 0.45, SEPARATION = 0.9; // collision circle; min gap apart

// Invented street opponents: name, jacket, trousers, skin, hair.
// All original — no real people, no borrowed characters.
const ROSTER = [
  { name: 'Rocco Vane', jacket: 0x8a2e2e, pants: 0x2e3438, skin: 0xe8b88a, hair: 0x1c1c1c },
  { name: 'Mara Kess', jacket: 0x2e5a8a, pants: 0x4a5a6b, skin: 0xc98d64, hair: 0x8a4a2e },
  { name: 'Dune Park', jacket: 0x3f7a4a, pants: 0x33415c, skin: 0xf0c8a0, hair: 0x2a2118 },
];

// One figure, built fresh here: broad torso, square head, cap, fists
// held up in a guard. Different build from the player (wider
// shoulders, no hair slab) and from the pedestrians (box torso, not
// a capsule). Arms pivot at the shoulder so a swing can rotate them.
function buildOpponentMesh(def) {
  const figure = new THREE.Group();
  const jacket = new THREE.MeshLambertMaterial({ color: def.jacket });
  const pants = new THREE.MeshLambertMaterial({ color: def.pants });
  const skin = new THREE.MeshLambertMaterial({ color: def.skin });
  const hair = new THREE.MeshLambertMaterial({ color: def.hair });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.85, 0.44), jacket);
  torso.position.y = 1.05;
  figure.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.48, 0.44), skin);
  head.position.y = 1.74;
  figure.add(head);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.14, 0.5), hair);
  cap.position.y = 2.02;
  figure.add(cap);
  const legGeo = new THREE.BoxGeometry(0.28, 0.62, 0.32);
  const legL = new THREE.Mesh(legGeo, pants);
  legL.position.set(-0.2, 0.31, 0);
  figure.add(legL);
  const legR = new THREE.Mesh(legGeo, pants);
  legR.position.set(0.2, 0.31, 0);
  figure.add(legR);
  const armGeo = new THREE.BoxGeometry(0.22, 0.62, 0.26);
  armGeo.translate(0, -0.31, 0);
  const mkArm = (side) => {
    const arm = new THREE.Group();
    arm.position.set(side * 0.52, 1.42, 0.05);
    arm.add(new THREE.Mesh(armGeo, jacket));
    const fist = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.26), skin);
    fist.position.y = -0.68;
    arm.add(fist);
    arm.rotation.x = -0.9; // held up in front of the chest
    figure.add(arm);
    return arm;
  };
  return { figure, torso, armL: mkArm(-1), armR: mkArm(1), jacketMat: jacket };
}

// Is (x, z) clear of every building collider, with a margin?
function groundIsClear(x, z, colliders, margin) {
  if (!colliders) return true;
  for (const box of colliders) {
    if (x > box.minX - margin && x < box.maxX + margin &&
        z > box.minZ - margin && z < box.maxZ + margin) return false;
  }
  return true;
}

export function createCombat(scene, city, rng, options) {
  const nextRand = (typeof rng === 'function') ? rng : Math.random;
  const colliders = (city && city.colliders) || null;
  const bounds = (city && city.bounds) || { minX: -162, maxX: 162, minZ: -162, maxZ: 162 };
  const spawn = (city && city.spawn) || { x: 0, z: 0 };
  const addWanted = options && typeof options.addWanted === 'function' ? options.addWanted : null;
  const onKnockout = options && typeof options.onKnockout === 'function' ? options.onKnockout : null;

  let health = PLAYER_MAX_HP;
  let knockouts = 0;
  let punchTimer = 0; // counts down to the next punch the player may throw
  let prevF = false;  // edge detection: one press, one punch attempt

  // Spawn on the road / sidewalk ring around spawn: a ring 4-7 m out,
  // retrying angles until the spot is clear of buildings. Spawn (0,0)
  // is a road intersection, so the first tries almost always land.
  function spawnSpot() {
    for (let attempt = 0; attempt < 10; attempt++) {
      const angle = nextRand() * Math.PI * 2;
      const dist = 4 + nextRand() * 3;
      const x = spawn.x + Math.sin(angle) * dist;
      const z = spawn.z + Math.cos(angle) * dist;
      if (groundIsClear(x, z, colliders, BODY_RADIUS + 0.5)) return { x, z };
    }
    return { x: spawn.x + 5, z: spawn.z };
  }

  const opponents = [];
  for (let i = 0; i < COUNT; i++) {
    const def = ROSTER[i % ROSTER.length];
    const spot = spawnSpot();
    const built = buildOpponentMesh(def);
    built.figure.position.set(spot.x, 0, spot.z);
    scene.add(built.figure);
    opponents.push({
      name: def.name, index: i, mesh: built.figure, torso: built.torso,
      armL: built.armL, armR: built.armR, jacketMat: built.jacketMat,
      x: spot.x, z: spot.z, heading: nextRand() * Math.PI * 2,
      hp: OPP_MAX_HP, knockedOut: false,
      flagged: false, // true once this opponent has cost a wanted star
      paid: false,    // true once the knockout reward has fired
      attackTimer: 0, flashTimer: 0, swingTimer: 0,
      idleTimer: nextRand() * 2, target: null,
    });
  }

  // Nudge a circle out of every building it overlaps: take the closest
  // point of the box to the centre, and if that lies inside the
  // circle, slide the centre away along the line between them. A
  // centre that lands inside a box is slid out through the nearest side.
  function keepOutOfBuildings(opp) {
    if (!colliders) return;
    for (const box of colliders) {
      const nearX = Math.max(box.minX, Math.min(opp.x, box.maxX));
      const nearZ = Math.max(box.minZ, Math.min(opp.z, box.maxZ));
      const dx = opp.x - nearX, dz = opp.z - nearZ;
      const d2 = dx * dx + dz * dz;
      if (d2 >= BODY_RADIUS * BODY_RADIUS) continue;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const push = (BODY_RADIUS - d) / d;
        opp.x += dx * push;
        opp.z += dz * push;
      } else {
        const sides = [
          [opp.x - box.minX, 'w'], [box.maxX - opp.x, 'e'],
          [opp.z - box.minZ, 'n'], [box.maxZ - opp.z, 's'],
        ];
        let best = sides[0];
        for (const s of sides) if (s[0] < best[0]) best = s;
        if (best[1] === 'w') opp.x = box.minX - BODY_RADIUS;
        else if (best[1] === 'e') opp.x = box.maxX + BODY_RADIUS;
        else if (best[1] === 'n') opp.z = box.minZ - BODY_RADIUS;
        else opp.z = box.maxZ + BODY_RADIUS;
      }
    }
  }

  function clampInside(opp) {
    opp.x = Math.max(bounds.minX + BODY_RADIUS, Math.min(bounds.maxX - BODY_RADIUS, opp.x));
    opp.z = Math.max(bounds.minZ + BODY_RADIUS, Math.min(bounds.maxZ - BODY_RADIUS, opp.z));
  }

  // Walk one step toward (tx, tz) at `speed`, then resolve buildings,
  // bounds and the other opponents. Returns the distance that remains.
  function stepToward(opp, tx, tz, speed, dt) {
    const dx = tx - opp.x, dz = tz - opp.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > 0.01) {
      opp.x += (dx / dist) * speed * dt;
      opp.z += (dz / dist) * speed * dt;
      opp.heading = Math.atan2(dx, dz);
    }
    keepOutOfBuildings(opp);
    clampInside(opp);
    for (const other of opponents) {
      if (other === opp || other.knockedOut) continue;
      const ox = opp.x - other.x, oz = opp.z - other.z;
      const d2 = ox * ox + oz * oz;
      if (d2 < SEPARATION * SEPARATION && d2 > 1e-8) {
        const d = Math.sqrt(d2);
        const push = (SEPARATION - d) / d * 0.5;
        opp.x += ox * push;
        opp.z += oz * push;
      }
    }
    return Math.hypot(tx - opp.x, tz - opp.z);
  }

  // Fresh idle stroll destination near the opponent, on clear ground
  // inside the city. Null means stand still for a while instead.
  function pickWanderTarget(opp) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const angle = nextRand() * Math.PI * 2;
      const dist = 3 + nextRand() * 7;
      const x = Math.max(bounds.minX + 2, Math.min(bounds.maxX - 2, opp.x + Math.sin(angle) * dist));
      const z = Math.max(bounds.minZ + 2, Math.min(bounds.maxZ - 2, opp.z + Math.cos(angle) * dist));
      if (groundIsClear(x, z, colliders, BODY_RADIUS + 0.5)) return { x, z };
    }
    return null;
  }

  // The player's punch. Edge-triggered on F, one attempt per press,
  // gated by the punch cooldown. A hit needs the opponent in front
  // of the player (120-degree cone around player.yaw) and within
  // PUNCH_RANGE. The nearest such opponent takes PUNCH_DAMAGE, is
  // shoved back, and flashes red briefly.
  //
  // Wanted decision: a punch is assault, so it costs a wanted star —
  // but only ONCE per opponent, on the first punch that lands on
  // them. Four punches to knock one opponent out would otherwise be
  // four stars for a single street fight, which punishes the fight
  // itself instead of the crime of starting it; one star per
  // opponent also keeps the heat proportional (max 3 stars from the
  // three street opponents) and matches how stealing a car is a
  // single +1. The per-opponent `flagged` flag enforces it.
  function tryPunch(player) {
    if (punchTimer > 0) return;
    punchTimer = PUNCH_COOLDOWN;
    const px = player.pos.x, pz = player.pos.z;
    const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
    const reach = Math.cos(PUNCH_HALF_ANGLE);
    let best = null, bestD = Infinity;
    for (const opp of opponents) {
      if (opp.knockedOut) continue;
      const dx = opp.x - px, dz = opp.z - pz;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > PUNCH_RANGE || d >= bestD) continue;
      if (d > 0.01 && (dx * fx + dz * fz) / d < reach) continue;
      best = opp;
      bestD = d;
    }
    if (!best) return;
    best.hp -= PUNCH_DAMAGE;
    best.flashTimer = FLASH_TIME;
    best.swingTimer = 0; // the hit interrupts any swing of their own
    const kx = best.x - px, kz = best.z - pz;
    const kd = Math.hypot(kx, kz) || 1;
    best.x += (kx / kd) * KNOCKBACK;
    best.z += (kz / kd) * KNOCKBACK;
    keepOutOfBuildings(best);
    clampInside(best);
    if (!best.flagged) {
      best.flagged = true;
      if (addWanted) addWanted(1);
    }
    if (best.hp <= 0 && !best.paid) {
      best.hp = 0;
      best.knockedOut = true;
      best.paid = true;
      knockouts += 1;
      best.mesh.rotation.x = -Math.PI / 2; // laid flat on the ground
      best.mesh.rotation.y = best.heading;
      best.mesh.position.set(best.x, 0.35, best.z);
      if (onKnockout) onKnockout({ name: best.name, reward: KNOCKOUT_REWARD, index: best.index });
    }
  }

  function update(dt, player, input, driving) {
    dt = Math.min(dt, 0.05);
    if (dt <= 0) return;
    if (punchTimer > 0) punchTimer -= dt;
    // While driving there is no punching at all — and no brawling with
    // a car. Opponents stand down until the player is on foot again.
    const fDown = !!(input && input.keys && input.keys.has(PUNCH_KEY));
    if (!driving && fDown && !prevF) tryPunch(player);
    prevF = fDown;
    const px = player && player.pos ? player.pos.x : 0;
    const pz = player && player.pos ? player.pos.z : 0;
    for (const opp of opponents) {
      if (opp.knockedOut) continue;
      if (opp.attackTimer > 0) opp.attackTimer -= dt;
      if (opp.swingTimer > 0) opp.swingTimer -= dt;
      const dx = px - opp.x, dz = pz - opp.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (!driving && dist < AGGRO_RANGE) {
        if (dist > ATTACK_RANGE) {
          stepToward(opp, px, pz, CHASE_SPEED, dt);
        } else {
          opp.heading = Math.atan2(dx, dz);
          if (opp.attackTimer <= 0) {
            opp.attackTimer = ATTACK_COOLDOWN;
            opp.swingTimer = 0.35;
            const dmg = ATTACK_DAMAGE_MIN +
              Math.floor(nextRand() * (ATTACK_DAMAGE_MAX - ATTACK_DAMAGE_MIN + 1));
            health = Math.max(0, health - dmg);
          }
        }
      } else if (!opp.target) {
        // Idle: stand a while, then stroll to a nearby clear spot.
        if (opp.idleTimer > 0) opp.idleTimer -= dt;
        else {
          opp.target = pickWanderTarget(opp);
          if (!opp.target) opp.idleTimer = 1 + nextRand() * 2;
        }
      } else {
        const left = stepToward(opp, opp.target.x, opp.target.z, WANDER_SPEED, dt);
        if (left < 0.5) {
          opp.target = null;
          opp.idleTimer = 1 + nextRand() * 3;
        }
      }
      // Hit flash: red jacket while the timer runs, then back to normal.
      if (opp.flashTimer > 0) {
        opp.flashTimer -= dt;
        opp.jacketMat.emissive.setHex(0xdd2222);
        opp.jacketMat.emissiveIntensity = 0.9;
      } else {
        opp.jacketMat.emissive.setHex(0x000000);
        opp.jacketMat.emissiveIntensity = 0;
      }
      // Swing animation: right arm snaps forward, then settles back.
      const guard = -0.9;
      opp.armR.rotation.x = opp.swingTimer > 0
        ? guard - 1.1 * Math.sin((0.35 - opp.swingTimer) / 0.35 * Math.PI)
        : guard;
      opp.armL.rotation.x = guard;
      opp.mesh.position.set(opp.x, 0, opp.z);
      opp.mesh.rotation.y = opp.heading;
    }
  }

  function getHealth() { return health; }
  function getKnockouts() { return knockouts; }
  function getOpponents() {
    return opponents.map((o) => ({
      name: o.name, x: +o.x.toFixed(2), z: +o.z.toFixed(2),
      hp: o.hp, maxHp: OPP_MAX_HP, knockedOut: o.knockedOut,
    }));
  }

  return { update, getHealth, getKnockouts, getOpponents };
}
