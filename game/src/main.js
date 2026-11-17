// Solmar Bay — slice 1: a playable 3D coastal city on foot with a
// third-person camera, a start screen and a minimap HUD. Static files, no
// network, three.js vendored under game/vendor/.
//
// Boot: build the renderer, lights and city, wire input, then run the loop.
// ?shot=<name>&seed=<n> stages a fixed scene for screenshots instead of the
// title screen; window.__game exposes the live state for drivers and tests,
// and window.__shotReady turns true once a staged scene has rendered.
import * as THREE from 'three';
import { CONFIG, PLACES } from './config.js';
import { buildCity } from './city.js';
import { createPlayer } from './player.js';
import { createCamera } from './camera.js';
import { createInput } from './input.js';
import { createHud } from './hud.js';
import { stageShot } from './shots.js';

const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
const seed = Number(params.get('seed')) || CONFIG.seed;

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.light.skyBackground);
scene.fog = new THREE.Fog(CONFIG.light.fogColor, CONFIG.light.fogNear, CONFIG.light.fogFar);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 900);
scene.add(camera);

// Fixed golden-hour light: a warm low sun and a soft sky fill.
const sun = new THREE.DirectionalLight(CONFIG.light.sunColor, CONFIG.light.sunIntensity);
sun.position.set(...CONFIG.light.sunPosition);
scene.add(sun);
const sky = new THREE.HemisphereLight(
  CONFIG.light.skyColor,
  CONFIG.light.groundColor,
  CONFIG.light.hemisphereIntensity,
);
scene.add(sky);

const city = buildCity(scene, seed);
const player = createPlayer(scene, PLACES.plaza.x, PLACES.plaza.z + 18);
const follow = createCamera(camera);
const input = createInput(canvas);
const hud = createHud(city.minimap);

const game = {
  state: 'title', // title | playing
  colliders: city.colliders,
  player,
  camera: follow,
  hud,
  cash: CONFIG.hud.cash,
  clockMinutes: CONFIG.light.clockStartMinutes,
  seed,
  startGame() {
    if (game.state !== 'playing') {
      game.state = 'playing';
      hud.showGame();
      hud.setCash(game.cash);
      hud.setClock(game.clockMinutes);
      hud.setObjective(CONFIG.hud.objective);
    }
  },
  setState(state) {
    game.state = state;
    if (state === 'title') hud.showTitle();
    else hud.showGame();
  },
};

window.__game = {
  get state() {
    return game.state;
  },
  get playerX() {
    return player.position.x;
  },
  get playerZ() {
    return player.position.z;
  },
  get playerHeading() {
    return player.heading;
  },
  get cash() {
    return game.cash;
  },
  get clockMinutes() {
    return game.clockMinutes;
  },
  get colliders() {
    return game.colliders.length;
  },
};
window.__shotReady = false;

function startFromTitle() {
  if (game.state === 'title') game.startGame();
}
canvas.addEventListener('click', startFromTitle);
window.addEventListener('keydown', (event) => {
  if (event.code === 'Enter' || event.code === 'Space') startFromTitle();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
let framesRendered = 0;

if (shotName) {
  stageShot(shotName, game);
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (game.state === 'playing') {
    player.update(dt, input, follow.yaw, game.colliders);
    follow.update(dt, input, player.position);
    game.clockMinutes += CONFIG.light.minutesPerSecond * dt;
    hud.setClock(game.clockMinutes);
    hud.drawMinimap(player.position, player.heading);
  } else if (!shotName) {
    // On the title screen the camera rests where the boot pose put it; keep
    // rendering so the city stays alive behind it. A staged shot holds its
    // own pose instead, so the frame stays exactly as staged.
    follow.apply(player.position, dt);
  }
  renderer.render(scene, camera);
  framesRendered += 1;
  if (shotName && framesRendered >= 3) window.__shotReady = true;
}

if (game.state === 'title') hud.showTitle();
animate();
