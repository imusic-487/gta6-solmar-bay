// Solmar Bay — the on-foot player: a low-poly figure built from boxes, with a
// walk swing, camera-relative WASD movement, running, and AABB collision
// against the buildings' footprints.
import * as THREE from 'three';
import { CONFIG } from './config.js';

const SKIN = 0xc98d64;
const SHIRT = 0x4a7ba0;
const PANTS = 0x2e3440;
const SHOES = 0x1e1e24;
const HAIR = 0x2a1c12;

/** Build the figure: torso, head, arms and legs, each a box, grouped at the feet. */
function buildFigure() {
  const group = new THREE.Group();
  const mat = (color) => new THREE.MeshLambertMaterial({ color });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.34), mat(SHIRT));
  torso.position.y = 1.08;
  group.add(torso);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.38, 0.34), mat(SKIN));
  head.position.y = 1.62;
  group.add(head);
  const hair = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.36), mat(HAIR));
  hair.position.y = 1.83;
  group.add(hair);
  const mkLimb = (w, h, d, color, x, y) => {
    const limb = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    mesh.position.y = -h / 2;
    limb.add(mesh);
    limb.position.set(x, y, 0);
    group.add(limb);
    return limb;
  };
  const armL = mkLimb(0.16, 0.62, 0.18, SHIRT, -0.4, 1.4);
  const armR = mkLimb(0.16, 0.62, 0.18, SHIRT, 0.4, 1.4);
  const legL = mkLimb(0.22, 0.72, 0.24, PANTS, -0.16, 0.72);
  const legR = mkLimb(0.22, 0.72, 0.24, PANTS, 0.16, 0.72);
  return { group, armL, armR, legL, legR };
}

export function createPlayer(scene, startX, startZ) {
  const figure = buildFigure();
  scene.add(figure.group);
  const player = {
    group: figure.group,
    position: new THREE.Vector3(startX, 0, startZ),
    heading: 0, // radians, 0 faces -Z (north, into the city)
    walkPhase: 0,
    moving: false,
    speed: 0,
    limbs: figure,

    reset(x, z, heading) {
      player.position.set(x, 0, z);
      player.heading = heading;
      player.walkPhase = 0;
      player.group.position.copy(player.position);
      player.group.rotation.y = heading;
    },

    /**
     * Move from input, relative to the camera yaw. Collides against building
     * footprints axis by axis so the player slides along walls, and stays
     * inside the city bounds.
     */
    update(dt, input, cameraYaw, colliders) {
      const axes = input.moveAxes();
      const speed = input.running() ? CONFIG.player.walkSpeed * 2 : CONFIG.player.walkSpeed;
      let mx = 0;
      let mz = 0;
      if (axes.forward !== 0 || axes.strafe !== 0) {
        const sin = Math.sin(cameraYaw);
        const cos = Math.cos(cameraYaw);
        // Forward is away from the camera; strafe is to the camera's right.
        mx = -sin * axes.forward + cos * axes.strafe;
        mz = -cos * axes.forward - sin * axes.strafe;
        const len = Math.hypot(mx, mz);
        mx /= len;
        mz /= len;
      }
      const targetHeading = mx !== 0 || mz !== 0 ? Math.atan2(mx, mz) : player.heading;
      let turn = targetHeading - player.heading;
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;
      const maxTurn = CONFIG.player.turnSpeed * dt;
      player.heading += Math.max(-maxTurn, Math.min(maxTurn, turn));

      const moving = mx !== 0 || mz !== 0;
      player.moving = moving;
      player.speed = moving ? speed : 0;
      const step = speed * dt;
      const r = CONFIG.player.radius;
      const bounds = CONFIG.city;
      const blocked = (x, z) => {
        if (x < -bounds.boundX || x > bounds.boundX) return true;
        if (z < bounds.boundZMin || z > bounds.boundZMax) return true;
        for (let i = 0; i < colliders.length; i += 1) {
          const c = colliders[i];
          if (x + r > c.minX && x - r < c.maxX && z + r > c.minZ && z - r < c.maxZ) return true;
        }
        return false;
      };
      const nx = player.position.x + mx * step;
      if (!blocked(nx, player.position.z)) player.position.x = nx;
      const nz = player.position.z + mz * step;
      if (!blocked(player.position.x, nz)) player.position.z = nz;

      // Walk swing: legs and arms counter-swing, faster when running.
      if (moving) player.walkPhase += dt * (input.running() ? 13 : 9);
      const swing = moving ? Math.sin(player.walkPhase) * 0.55 : 0;
      player.limbs.legL.rotation.x = swing;
      player.limbs.legR.rotation.x = -swing;
      player.limbs.armL.rotation.x = -swing * 0.8;
      player.limbs.armR.rotation.x = swing * 0.8;
      const bob = moving ? Math.abs(Math.sin(player.walkPhase)) * 0.05 : 0;
      player.group.position.set(player.position.x, bob, player.position.z);
      player.group.rotation.y = player.heading;
    },
  };
  player.reset(startX, startZ, 0);
  return player;
}
