// Solmar Bay — the deterministic screenshot scenes behind ?shot=<name>&seed=1.
// Each scene puts the player and the camera at a fixed place and plays the
// real game forward a fixed number of steps, so the frame is what a short
// session really looks like and the same seed always gives the same frame.
import { PLACES } from './config.js';

const STEP = 1 / 60;

/** A fixed script of synthetic input: walk forward, optionally with a turn. */
function scriptedInput(forward, strafe, running) {
  return {
    moveAxes: () => ({ forward, strafe }),
    running: () => running,
    consumeDrag: () => ({ yaw: 0, pitch: 0 }),
  };
}

/**
 * Stage one shot and return nothing: the caller renders a few frames and then
 * sets window.__shotReady. `game` is the object main.js builds and exposes
 * as window.__game.
 */
export function stageShot(name, game) {
  const { player, camera, hud } = game;
  game.startGame();
  if (name === 'title') {
    // Start screen over the skyline: player on the plaza, camera high and
    // looking north across the blocks toward the distant towers.
    player.reset(PLACES.plaza.x, PLACES.plaza.z + 18, Math.PI);
    camera.pose(player.position, Math.PI, 0.28, 34, 12);
    game.setState('title');
    return;
  }
  if (name === 'street') {
    // Third person on foot on a main street: walk north for a few seconds so
    // the figure is mid-stride, camera following behind.
    player.reset(PLACES.mainStreet.x + 4, PLACES.mainStreet.z + 60, 0);
    camera.snapTo(player.position);
    camera.yaw = 0;
    camera.pitch = 0.3;
    const input = scriptedInput(1, 0, false);
    for (let i = 0; i < 3.2 / STEP; i += 1) {
      player.update(STEP, input, camera.yaw, game.colliders);
      camera.apply(player.position, STEP);
    }
    return;
  }
  if (name === 'waterfront') {
    // On the sand facing the water, camera behind the player, city behind.
    player.reset(PLACES.beach.x, PLACES.beach.z + 8, 0);
    camera.pose(player.position, Math.PI, 0.22, 11, 4);
    const input = scriptedInput(1, 0, false);
    for (let i = 0; i < 1.2 / STEP; i += 1) {
      player.update(STEP, input, camera.yaw, game.colliders);
      camera.apply(player.position, STEP);
    }
    return;
  }
  // skyline (and any unknown name): a high view over the whole city, looking
  // north from above the beach side toward the distant towers.
  player.reset(PLACES.plaza.x, PLACES.plaza.z, Math.PI * 0.75);
  camera.pose(player.position, Math.PI, 0.62, 110, 40);
}
