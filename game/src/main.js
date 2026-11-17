// Solmar Bay — bootstrap: renderer, city, player, camera, HUD, game loop.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { mulberry32 } from './random.js';
import { buildCity } from './city.js';
import { createCars, updateCar, nearestCar } from './cars.js';
import { createTraffic } from './traffic.js';
import { createPedestrians } from './pedestrians.js';
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
const { cars } = createCars(scene, city, rng);
const traffic = createTraffic(scene, city, rng);
const { peds, update: updatePeds } = createPedestrians(scene, city, rng);

const player = createPlayer(city.spawn, city.colliders, city.bounds);
scene.add(player.mesh);

const input = createInput();
const cameraRig = createCamera();
const hud = createHUD();

let cash = 0;
let wanted = 0;
let health = 100;

// Slice 2 driving state: on foot until E enters a nearby car.
let driving = false;
let currentCar = null;
let prevE = false;

const game = {
  state: 'title',
  player,
  camera: cameraRig,
  city,
  cars,
  traffic,
  peds,
  get driving() { return driving; },
  get currentCar() { return currentCar; },
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
    // E is edge-triggered: enter the nearest car on foot, exit while driving.
    const eDown = input.keys.has('KeyE');
    if (eDown && !prevE) {
      if (!driving) {
        const car = nearestCar(cars, player.pos.x, player.pos.z, 4);
        if (car) {
          driving = true;
          currentCar = car;
          car.speed = 0;
          player.mesh.visible = false;
          hud.setObjective('Drive — WASD to drive, E to get out');
        }
      } else {
        const car = currentCar;
        driving = false;
        currentCar = null;
        car.speed = 0;
        // Place the player beside the car (right side, perpendicular to heading).
        player.pos.set(car.x + Math.cos(car.heading) * 2.5, 0, car.z - Math.sin(car.heading) * 2.5);
        player.mesh.position.copy(player.pos);
        player.mesh.visible = true;
        hud.setObjective('Explore Solmar Bay');
      }
    }
    prevE = eDown;
    // Slice 3: traffic + pedestrians run every play frame. While driving
    // the car is the obstacle other road users react to, not the player.
    const roadUser = driving && currentCar ? currentCar : player;
    traffic.update(dt, roadUser, cars);
    updatePeds(dt, roadUser, [...cars, ...traffic.cars]);
    if (driving && currentCar) {
      updateCar(currentCar, input, dt, city.colliders, city.bounds, [...cars, ...traffic.cars]);
      cameraRig.updateDriving(dt, currentCar);
    } else {
      player.update(dt, input, cameraRig.yaw);
      cameraRig.update(dt, player, mouse.dx, mouse.dy);
    }
  } else {
    cameraRig.update(dt, player, 0, 0);
  }

  hud.update({ cash, wanted, health, playerPos: driving && currentCar ? currentCar : player.pos, yaw: player.yaw, city, driving, speed: driving && currentCar ? currentCar.speed : 0 });

  renderer.render(scene, cameraRig.camera);

  if (shotName && !shotFired) {
    shotFired = true;
    setupShot(shotName, { camera: cameraRig, player, city, scene, THREE, setState });
    window.__shotReady = true;
  }
}

frame();
