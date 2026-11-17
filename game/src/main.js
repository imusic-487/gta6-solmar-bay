// Solmar Bay — bootstrap: renderer, city, player, camera, HUD, game loop.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { mulberry32 } from './random.js';
import { buildCity } from './city.js';
import { createInput } from './input.js';
import { createPlayer, createPlayerMesh } from './player.js';
import { createCamera } from './camera.js';
import { createHUD } from './hud.js';
import { setupShot } from './shots.js';

const container = document.getElementById('game-container');
const titleEl = document.getElementById('title');

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.colors.sky);
scene.fog = new THREE.Fog(CONFIG.colors.fog, 280, 640);

const rng = mulberry32(CONFIG.seed);
const city = buildCity(scene, rng);

const player = createPlayer(city.spawn, city.colliders, city.bounds);
scene.add(player.mesh);

const input = createInput();
const cameraRig = createCamera();
const hud = createHUD();

let cash = 0;
let wanted = 0;
let health = 100;

const game = {
  state: 'title',
  player,
  camera: cameraRig,
  city,
  hud,
  setState,
};
window.__game = game;

function setState(s) {
  game.state = s;
  if (s === 'play') titleEl.style.display = 'none';
  else titleEl.style.display = 'flex';
}

hud.setObjective('Explore Solmar Bay');

window.addEventListener('keydown', (e) => {
  if (e.code === 'Enter' && game.state === 'title') setState('play');
  if (e.code === 'KeyM') { /* audio stub — sound arrives in a later slice */ }
});
titleEl.addEventListener('click', () => {
  if (game.state === 'title') setState('play');
});

window.addEventListener('resize', () => {
  cameraRig.camera.aspect = window.innerWidth / window.innerHeight;
  cameraRig.camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
let shotFired = false;

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05);
  const mouse = input.consumeMouse();

  if (game.state === 'play') {
    player.update(dt, input, cameraRig.yaw);
    cameraRig.update(dt, player, mouse.dx, mouse.dy);
  } else {
    cameraRig.update(dt, player, 0, 0);
  }

  hud.update({ cash, wanted, health, playerPos: player.pos, yaw: player.yaw, city });

  renderer.render(scene, cameraRig.camera);

  if (shotName && !shotFired) {
    shotFired = true;
    setupShot(shotName, { camera: cameraRig, player, city, scene, THREE, setState });
    window.__shotReady = true;
  }
}

frame();
