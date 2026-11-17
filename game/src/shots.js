// Solmar Bay staged shots: four fixed camera poses for the entry screenshots.
// Each pose parks the follow camera with setPose(), so the frame is identical
// on every run. The player is reset to the city spawn for the three in-game
// shots; the title shot leaves the start overlay up. Synchronous only — the
// caller flags window.__shotReady as soon as this returns.
export function setupShot(name, ctx) {
  const { camera, player, city, THREE, setState } = ctx;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);

  function placePlayer() {
    if (player && player.pos && city && city.spawn) {
      player.pos.set(city.spawn.x, 0, city.spawn.z);
    }
  }

  if (name === 'title') {
    // High, wide skyline from the south-east, city spread out below.
    camera.setPose(V(150, 95, 215), V(-10, 18, -30));
    return;
  }

  if (name === 'street') {
    // Street level, just behind and above the player, looking south down the road.
    placePlayer();
    setState('play');
    camera.setPose(V(3, 4.5, -10), V(0, 1.4, 40));
    return;
  }

  if (name === 'waterfront') {
    // Low on the south beach, sand in the foreground, looking straight north
    // down the central road at the player, city rising behind them.
    placePlayer();
    setState('play');
    camera.setPose(V(0, 3, 176), V(0, 2, 0));
    return;
  }

  if (name === 'skyline') {
    // Elevated from the north-west, skyline against the golden-hour sun.
    placePlayer();
    setState('play');
    camera.setPose(V(-190, 85, -150), V(20, 18, 20));
    return;
  }

  if (name === 'busy-street') {
    // Slice 3 cover: above the x=52 road looking north up it — traffic
    // in both lanes, a pedestrian on the far sidewalk, parked cars
    // ahead. The camera sits over the road so no tower blocks the view.
    player.pos.set(44, 0, 30);
    if (player.mesh) player.mesh.position.copy(player.pos);
    setState('play');
    camera.setPose(V(52, 6, 42), V(48, 1.2, -50));
    return;
  }

  if (name === 'street-life') {
    // Slice 3 sidewalk shot: just behind a pedestrian strolling the
    // block edge south, the player ahead of them, oncoming traffic in
    // the lane to the west. Camera stays west of the block's towers.
    player.pos.set(60, 0, -18);
    if (player.mesh) player.mesh.position.copy(player.pos);
    setState('play');
    camera.setPose(V(62, 3, -42), V(58, 1.5, -8));
    return;
  }

  if (name === 'drive-traffic') {
    // Slice 3 driving shot: steal the car parked on the x=52 road and
    // drive north into oncoming traffic — the chase camera + speed HUD
    // take over. The scratch driver enters with E and holds W.
    const cars = (typeof window !== 'undefined' && window.__game && window.__game.cars) || [];
    const anchor = { x: 56, z: -52 };
    let car = null, best = Infinity;
    for (const c of cars) {
      const d = (c.x - anchor.x) * (c.x - anchor.x) + (c.z - anchor.z) * (c.z - anchor.z);
      if (d < best) { best = d; car = c; }
    }
    if (car) {
      player.pos.set(car.x + 2.5, 0, car.z);
      if (player.mesh) player.mesh.position.copy(player.pos);
    } else {
      placePlayer();
    }
    setState('play');
    return;
  }

  if (name === 'drive-avenue' || name === 'drive-north') {
    // Slice 2 driving shot: park the player beside a central-avenue car
    // (clear of spawn) and start play. The scratch driver enters with E
    // and holds W; the chase camera + speed HUD take over. The camera is
    // deliberately NOT locked here so updateDriving() can follow the car.
    const cars = (typeof window !== 'undefined' && window.__game && window.__game.cars) || [];
    const anchor = name === 'drive-avenue' ? { x: 4, z: -104 } : { x: -4, z: 104 };
    let car = null, best = Infinity;
    for (const c of cars) {
      const d = (c.x - anchor.x) * (c.x - anchor.x) + (c.z - anchor.z) * (c.z - anchor.z);
      if (d < best) { best = d; car = c; }
    }
    if (car) {
      // Stand beside the car, within E range (4 m), still on the road.
      player.pos.set(car.x + 2.5, 0, car.z);
      if (player.mesh) player.mesh.position.copy(player.pos);
    } else {
      placePlayer();
    }
    setState('play');
    return;
  }

  if (name === 'chase') {
    // Slice 4 chase shot: park the player beside a central-avenue car
    // and start play. The scratch driver steals it with E (+1 wanted),
    // waits for a patrol car to close in, and shoots mid-pursuit — the
    // chase camera + wanted stars take over. The camera is deliberately
    // NOT locked here so updateDriving() can follow the car.
    const cars = (typeof window !== 'undefined' && window.__game && window.__game.cars) || [];
    const anchor = { x: 4, z: -104 };
    let car = null, best = Infinity;
    for (const c of cars) {
      const d = (c.x - anchor.x) * (c.x - anchor.x) + (c.z - anchor.z) * (c.z - anchor.z);
      if (d < best) { best = d; car = c; }
    }
    if (car) {
      player.pos.set(car.x + 2.5, 0, car.z);
      if (player.mesh) player.mesh.position.copy(player.pos);
    } else {
      placePlayer();
    }
    setState('play');
    return;
  }

  // Unknown name: fall back to the title framing.
  camera.setPose(V(150, 95, 215), V(-10, 18, -30));
}
