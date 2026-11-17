// The player: a simple low-poly figure that walks, runs, jumps and
// collides with the city's building footprints.
import * as THREE from 'three';
import { CONFIG } from './config.js';

const HALF = 0.4; // half-width of the player's ground footprint

// Build the figure: torso, head, legs and arms in plain flat colours.
// The mesh is NOT added to the scene here; main.js does that.
export function createPlayerMesh() {
  const figure = new THREE.Group();

  const skin = new THREE.MeshLambertMaterial({ color: 0xe8b88a });
  const shirt = new THREE.MeshLambertMaterial({ color: 0x2e8b8b });
  const pants = new THREE.MeshLambertMaterial({ color: 0x33415c });
  const hair = new THREE.MeshLambertMaterial({ color: 0x2a2118 });

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.85, 0.4), shirt);
  torso.position.y = 1.05;
  figure.add(torso);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.42), skin);
  head.position.y = 1.72;
  figure.add(head);

  const hairTop = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.46), hair);
  hairTop.position.y = 1.98;
  figure.add(hairTop);

  const legGeo = new THREE.BoxGeometry(0.26, 0.62, 0.3);
  const legL = new THREE.Mesh(legGeo, pants);
  legL.position.set(-0.18, 0.31, 0);
  figure.add(legL);
  const legR = new THREE.Mesh(legGeo, pants);
  legR.position.set(0.18, 0.31, 0);
  figure.add(legR);

  const armGeo = new THREE.BoxGeometry(0.2, 0.7, 0.24);
  const armL = new THREE.Mesh(armGeo, shirt);
  armL.position.set(-0.48, 1.05, 0);
  figure.add(armL);
  const armR = new THREE.Mesh(armGeo, shirt);
  armR.position.set(0.48, 1.05, 0);
  figure.add(armR);

  return figure;
}

export function createPlayer(spawn, colliders, bounds) {
  const mesh = createPlayerMesh();
  const pos = new THREE.Vector3(spawn.x, 0, spawn.z);
  let yaw = 0; // facing direction, radians around Y
  let velY = 0;
  let grounded = true;

  function overlapsAny(x, z) {
    for (const c of colliders) {
      if (x + HALF > c.minX && x - HALF < c.maxX && z + HALF > c.minZ && z - HALF < c.maxZ) {
        return c;
      }
    }
    return null;
  }

  function update(dt, input, cameraYaw) {
    const keys = input.keys;

    // WASD relative to where the camera is looking. Camera forward on the
    // ground plane is (-sin(yaw), -cos(yaw)); right is (cos(yaw), -sin(yaw)).
    const sin = Math.sin(cameraYaw);
    const cos = Math.cos(cameraYaw);
    const fwdX = -sin;
    const fwdZ = -cos;
    const rightX = cos;
    const rightZ = -sin;

    let mx = 0;
    let mz = 0;
    if (keys.has('KeyW')) { mx += fwdX; mz += fwdZ; }
    if (keys.has('KeyS')) { mx -= fwdX; mz -= fwdZ; }
    if (keys.has('KeyD')) { mx += rightX; mz += rightZ; }
    if (keys.has('KeyA')) { mx -= rightX; mz -= rightZ; }

    const len = Math.hypot(mx, mz);
    if (len > 0) {
      mx /= len;
      mz /= len;
      const running = keys.has('ShiftLeft') || keys.has('ShiftRight');
      const speed = running ? CONFIG.player.runSpeed : CONFIG.player.walkSpeed;
      const stepX = mx * speed * dt;
      const stepZ = mz * speed * dt;

      // Axis-separated AABB resolution: move one axis, push out, then the other.
      pos.x += stepX;
      const hitX = overlapsAny(pos.x, pos.z);
      if (hitX) {
        pos.x = stepX > 0 ? hitX.minX - HALF : hitX.maxX + HALF;
      }
      pos.z += stepZ;
      const hitZ = overlapsAny(pos.x, pos.z);
      if (hitZ) {
        pos.z = stepZ > 0 ? hitZ.minZ - HALF : hitZ.maxZ + HALF;
      }

      // Face the direction of travel.
      const targetYaw = Math.atan2(mx, mz);
      let diff = targetYaw - yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      yaw += diff * Math.min(1, dt * 12);
    }

    // Jump + simple gravity; the ground plane is y = 0.
    if (keys.has('Space') && grounded) {
      velY = CONFIG.player.jumpSpeed;
      grounded = false;
    }
    if (!grounded) {
      velY -= CONFIG.player.gravity * dt;
      pos.y += velY * dt;
      if (pos.y <= 0) {
        pos.y = 0;
        velY = 0;
        grounded = true;
      }
    }

    // Stay inside the city.
    pos.x = Math.max(bounds.minX + HALF, Math.min(bounds.maxX - HALF, pos.x));
    pos.z = Math.max(bounds.minZ + HALF, Math.min(bounds.maxZ - HALF, pos.z));

    mesh.position.copy(pos);
    mesh.rotation.y = yaw;
  }

  return { mesh, pos, get yaw() { return yaw; }, update };
}
