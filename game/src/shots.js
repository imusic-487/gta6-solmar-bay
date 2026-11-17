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

  // Unknown name: fall back to the title framing.
  camera.setPose(V(150, 95, 215), V(-10, 18, -30));
}
