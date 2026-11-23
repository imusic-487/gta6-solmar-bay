// Solmar Bay — courier missions + thin story (slice 5).
//
//   const missions = createMissions(scene, city, { onComplete });
//   Returns { update, getCompleted, getTotal, getCurrentIndex, getCurrent,
//             getCurrentTarget, getMissions, getObjectiveText, isComplete,
//             resetCurrent, setCompleted, marker }.
//   resetCurrent() (slice 7) — no state change: re-place the marker on
//   the current delivery's target, for respawn after a failed run.
//   setCompleted(n) (slice 8) — jump the route to a saved progress
//   count (0..3) and re-place the marker; 3 hides it (free roam).
//
//   createMissions(scene, city, options?)
//     scene — THREE.Scene; city — buildCity() result ({ bounds }); the
//     targets below sit on road centre lines, so they need nothing from
//     the city except an optional bounds sanity check. options is an
//     optional object; options.onComplete(mission) is called once per
//     finished mission with { name, brief, x, z, reward, index } — the
//     wiring session uses it to add mission.reward to the cash total.
//     This module never touches game state itself.
//
//   missions.update(dt, roadUser)
//     Step every play frame. roadUser is the player object
//     ({ pos: { x, z } }) or a driven car ({ x, z }), the same
//     convention as traffic.update / police.update. When the road user
//     comes within ARRIVE_DIST of the active target the mission
//     completes, the marker moves to the next target, and onComplete
//     fires. After the last mission the marker hides and the route is
//     done. Call only while playing, like the other per-frame updates.
//
//   Getters (all cheap, safe to call every frame):
//     getCompleted() — missions finished so far (0..3).
//     getTotal() — 3. getCurrentIndex() — 0-based active mission, or 3
//     when the route is done. getCurrent() — the active mission object
//     ({ name, brief, x, z, reward, index }) or null when done.
//     getCurrentTarget() — { x, z } of the active marker, or null.
//     getMissions() — a copy of all three mission definitions.
//     getObjectiveText() — the HUD line, e.g. "1/3 — First Pickup:
//     collect the parcel at the north junction". The wiring session
//     pushes it into hud.setObjective() each frame (or when it
//     changes). isComplete() — true once all three are done.
//     marker — the THREE.Group holding the active marker meshes, for
//     screenshots and tests.
//
//   The story, in full: a new courier signs on with Bayline Couriers,
//   a small Solmar Bay delivery outfit, and runs one route across the
//   city — a pickup, a cross-town drop, and a last run to the old pier
//   road. It is told only through the one-line brief per mission and
//   the HUD objective text. No dialogue, no cutscenes, no timers, no
//   combat, no multi-stop chains: each mission is simply "reach the
//   glowing marker". All people, places and names are original fiction
//   for Solmar Bay.

import * as THREE from 'three';

const ARRIVE_DIST = 5;       // metres — generous so walking and driving both count
const MARKER_GOLD = 0xffc93f;
const TOTAL = 3;

// The route. Every target is a road-centre intersection, verified
// against the seeded city: each sits 17+ m from the nearest building
// collider and 48+ m from the nearest parked car, reachable on foot
// and by car. M1 is a short walk north of spawn (0,0); M2 is a
// cross-town drive to the south-east; M3 is the far south-west corner.
const ROUTE = [
  {
    name: 'First Pickup',
    brief: 'Bayline Couriers has your first job: collect the parcel waiting at the north junction.',
    x: 0, z: -52, reward: 150,
  },
  {
    name: 'Cross-Town Delivery',
    brief: 'The parcel goes to a client on the far south-east side — a car will get you there faster.',
    x: 104, z: 104, reward: 250,
  },
  {
    name: 'The Last Run',
    brief: 'One last drop at the old pier road, south-west corner — finish the route and the day is yours.',
    x: -156, z: 156, reward: 400,
  },
];

export function createMissions(scene, city, options) {
  const onComplete = options && typeof options.onComplete === 'function'
    ? options.onComplete
    : null;
  const bounds = (city && city.bounds) || null;

  // Sanity check only: the targets are fixed road intersections, but
  // warn loudly if one ever lands outside the city bounds.
  if (bounds) {
    for (const m of ROUTE) {
      if (m.x < bounds.minX || m.x > bounds.maxX || m.z < bounds.minZ || m.z > bounds.maxZ) {
        console.warn('[missions] target outside bounds:', m.name, m.x, m.z);
      }
    }
  }

  let completed = 0;         // missions finished so far
  let animTime = 0;          // drives the marker pulse / bob

  // The marker, built fresh here: a glowing flat ring on the road, a
  // tall soft beam of light above it, and a small gold octahedron
  // bobbing in the beam. One group, repositioned per mission.
  const marker = new THREE.Group();

  const ringMat = new THREE.MeshBasicMaterial({
    color: MARKER_GOLD, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.2, 3.0, 40), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  marker.add(ring);

  const beamMat = new THREE.MeshBasicMaterial({
    color: MARKER_GOLD, transparent: true, opacity: 0.16,
    depthWrite: false, side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 1.0, 14, 12, 1, true), beamMat);
  beam.position.y = 7;
  marker.add(beam);

  const beaconMat = new THREE.MeshBasicMaterial({ color: MARKER_GOLD });
  const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.7), beaconMat);
  beacon.position.y = 3;
  marker.add(beacon);

  function placeMarker() {
    const m = ROUTE[completed];
    if (!m) {
      marker.visible = false;
      return;
    }
    marker.position.set(m.x, 0, m.z);
    marker.visible = true;
  }
  placeMarker();
  scene.add(marker);

  // Read the road user's ground position either way it can arrive:
  // a player object ({ pos: { x, z } }) or a plain { x, z } car.
  function userPos(roadUser) {
    if (!roadUser) return null;
    if (roadUser.pos && typeof roadUser.pos.x === 'number' && typeof roadUser.pos.z === 'number') {
      return { x: roadUser.pos.x, z: roadUser.pos.z };
    }
    if (typeof roadUser.x === 'number' && typeof roadUser.z === 'number') {
      return { x: roadUser.x, z: roadUser.z };
    }
    return null;
  }

  function update(dt, roadUser) {
    dt = Math.min(dt, 0.05);
    if (dt <= 0) return;
    animTime += dt;

    // Idle animation for the active marker: ring breathes, beam
    // shimmers, beacon bobs and turns. Runs even when the route is
    // done (marker hidden, so nothing shows) to keep the math simple.
    const pulse = 1 + 0.08 * Math.sin(animTime * 3);
    ring.scale.set(pulse, pulse, 1);
    ringMat.opacity = 0.7 + 0.2 * Math.sin(animTime * 3);
    beamMat.opacity = 0.12 + 0.06 * Math.sin(animTime * 2);
    beacon.position.y = 3 + 0.4 * Math.sin(animTime * 2);
    beacon.rotation.y += dt * 1.5;

    if (completed >= TOTAL) return;

    const pos = userPos(roadUser);
    if (!pos) return;
    const target = ROUTE[completed];
    const dx = pos.x - target.x, dz = pos.z - target.z;
    if (dx * dx + dz * dz > ARRIVE_DIST * ARRIVE_DIST) return;

    // Arrival: count it, pay out through the callback, move the marker.
    const done = { name: target.name, brief: target.brief, x: target.x, z: target.z, reward: target.reward, index: completed };
    completed += 1;
    placeMarker();
    if (onComplete) onComplete(done);
  }

  // Slice 8 respawn reset: no state change — just put the marker back
  // on the current delivery's target (same as placeMarker), so the
  // interrupted run picks up from the start after a failed screen.
  function resetCurrent() {
    placeMarker();
  }

  // Slice 8 Continue: jump the route to a saved progress count
  // (0..3) and re-place the marker on that delivery's target — or
  // hide it when the route is done (completed 3 = free roam).
  function setCompleted(n) {
    const v = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : 0;
    completed = Math.max(0, Math.min(TOTAL, v));
    placeMarker();
  }

  function getCompleted() { return completed; }
  function getTotal() { return TOTAL; }
  function getCurrentIndex() { return completed; }
  function isComplete() { return completed >= TOTAL; }

  function getCurrent() {
    if (completed >= TOTAL) return null;
    const m = ROUTE[completed];
    return { name: m.name, brief: m.brief, x: m.x, z: m.z, reward: m.reward, index: completed };
  }

  function getCurrentTarget() {
    const cur = getCurrent();
    return cur ? { x: cur.x, z: cur.z } : null;
  }

  function getMissions() {
    return ROUTE.map((m, i) => ({ name: m.name, brief: m.brief, x: m.x, z: m.z, reward: m.reward, index: i }));
  }

  function getObjectiveText() {
    if (completed >= TOTAL) {
      return '3/3 — Route complete! All Bayline deliveries done.';
    }
    const m = ROUTE[completed];
    return completed + '/3 — ' + m.name + ': ' + m.brief;
  }

  return {
    update,
    getCompleted,
    getTotal,
    getCurrentIndex,
    getCurrent,
    getCurrentTarget,
    getMissions,
    getObjectiveText,
    isComplete,
    resetCurrent,
    setCompleted,
    marker,
  };
}
