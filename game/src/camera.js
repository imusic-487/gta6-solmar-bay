// Solmar Bay — the third-person camera. It orbits on mouse drag, sits behind
// the player at a fixed distance, and eases toward its target so the follow
// feels smooth instead of locked to the player.
import * as THREE from 'three';
import { CONFIG } from './config.js';

export function createCamera(camera) {
  const follow = {
    yaw: 0, // radians; 0 looks north (-Z) from behind the player
    pitch: 0.32,
    distance: CONFIG.camera.distance,
    // A smoothed copy of the player's position, so the camera trails slightly.
    target: new THREE.Vector3(0, 1.4, 0),
    snapped: false,

    snapTo(playerPos) {
      follow.target.set(playerPos.x, 1.4, playerPos.z);
      follow.snapped = true;
    },

    /** Place the camera for a staged shot: fixed yaw/pitch/offset, no easing. */
    pose(playerPos, yaw, pitch, distance, height) {
      follow.yaw = yaw;
      follow.pitch = pitch;
      follow.distance = distance;
      follow.target.set(playerPos.x, height, playerPos.z);
      follow.snapped = true;
      follow.positionCamera();
    },

    update(dt, input, playerPos) {
      const drag = input.consumeDrag();
      follow.yaw += drag.yaw;
      follow.pitch = Math.max(
        CONFIG.camera.minPitch,
        Math.min(CONFIG.camera.maxPitch, follow.pitch + drag.pitch),
      );
      follow.apply(playerPos, dt);
    },

    apply(playerPos, dt) {
      const goal = new THREE.Vector3(playerPos.x, 1.4, playerPos.z);
      if (!follow.snapped) {
        follow.target.copy(goal);
        follow.snapped = true;
      } else {
        const k = 1 - Math.exp(-CONFIG.camera.followLerp * dt);
        follow.target.lerp(goal, k);
      }
      follow.positionCamera();
    },

    /** Put the camera at its yaw/pitch/distance from the current target. */
    positionCamera() {
      const cp = Math.cos(follow.pitch);
      const sp = Math.sin(follow.pitch);
      const offset = new THREE.Vector3(
        Math.sin(follow.yaw) * cp,
        sp,
        Math.cos(follow.yaw) * cp,
      ).multiplyScalar(follow.distance);
      camera.position.copy(follow.target).add(offset);
      camera.lookAt(follow.target.x, follow.target.y + 0.4, follow.target.z);
    },
  };
  return follow;
}
