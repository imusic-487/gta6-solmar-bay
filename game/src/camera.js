// Third-person follow camera for Solmar Bay.
// Orbits the player on mouse-drag deltas and smooth-lerps into place.
// setPose() parks the camera for a fixed shot; while locked, update() is a no-op.
import * as THREE from 'three';
import { CONFIG } from './config.js';

const HEAD_HEIGHT = 1.6;

export function createCamera() {
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  const dist = CONFIG.camera.distance;
  // Start pitched so the lens sits about CONFIG.camera.height above the ground.
  let yaw = 0;
  let pitch = Math.asin(Math.min(0.9, Math.max(0.05, (CONFIG.camera.height - HEAD_HEIGHT) / dist)));
  let locked = false;

  function desiredPos(player) {
    const horiz = dist * Math.cos(pitch);
    return new THREE.Vector3(
      player.pos.x + Math.sin(yaw) * horiz,
      player.pos.y + HEAD_HEIGHT + dist * Math.sin(pitch),
      player.pos.z + Math.cos(yaw) * horiz
    );
  }

  function update(dt, player, mouseDX, mouseDY) {
    if (locked) return;
    yaw -= mouseDX * 0.005;
    pitch = Math.max(
      CONFIG.camera.minPitch,
      Math.min(CONFIG.camera.maxPitch, pitch + mouseDY * 0.005)
    );
    const target = desiredPos(player);
    const t = 1 - Math.exp(-10 * dt);
    camera.position.lerp(target, t);
    camera.lookAt(player.pos.x, player.pos.y + HEAD_HEIGHT, player.pos.z);
  }

  // Slice 2 chase camera: follow behind the car along its heading,
  // smoothed, looking ahead of the car. On-foot update() is untouched.
  function updateDriving(dt, car) {
    if (locked || !car) return;
    const fwdX = Math.sin(car.heading);
    const fwdZ = Math.cos(car.heading);
    const target = new THREE.Vector3(
      car.x - fwdX * 9,
      4.2,
      car.z - fwdZ * 9
    );
    const t = 1 - Math.exp(-6 * dt);
    camera.position.lerp(target, t);
    camera.lookAt(car.x + fwdX * 6, 1.2, car.z + fwdZ * 6);
  }

  function setPose(pos, lookAt) {
    camera.position.copy(pos);
    camera.lookAt(lookAt);
    locked = true;
  }

  return {
    camera,
    get yaw() { return yaw; },
    get pitch() { return pitch; },
    update,
    updateDriving,
    setPose,
  };
}
