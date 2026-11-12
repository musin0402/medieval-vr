import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { createHeightfield, WATER_LEVEL } from './heightfield.js';
import { World, CHUNK } from './world.js';
import { createSword } from './sword.js';

// ---------- Ajustes ----------
const SEED = 1337;
const WALK_SPEED = 3.4, RUN_SPEED = 7.0;
const SNAP_ANGLE = Math.PI / 6;      // giro por pasos (cómodo en VR)
const SWORD_TILT = 0.45;             // ajusta si la espada te queda muy inclinada
const EYE_HEIGHT = 1.7;              // solo modo escritorio

const loadingEl = document.getElementById('loading');
const barEl = document.getElementById('bar');
const hudEl = document.getElementById('hud');
const infoEl = document.getElementById('info');

// ---------- Renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation(1);
renderer.xr.setFramebufferScaleFactor(0.9);
document.body.appendChild(renderer.domElement);

const vrButton = VRButton.createButton(renderer);
document.body.appendChild(vrButton);

// ---------- Escena, cielo y luz ----------
const scene = new THREE.Scene();
const horizon = new THREE.Color(0xcfe3ef), zenith = new THREE.Color(0x4f86c6);
scene.background = horizon.clone();
scene.fog = new THREE.Fog(horizon, 70, 215);

scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x5a6a3c, 1.5));
const sunDir = new THREE.Vector3(0.55, 0.62, 0.35).normalize();
const sun = new THREE.DirectionalLight(0xfff0d2, 2.3);
sun.position.copy(sunDir).multiplyScalar(100);
scene.add(sun);

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(600, 24, 14),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uHorizon: { value: horizon }, uZenith: { value: zenith }, uSun: { value: sunDir } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      varying vec3 vDir; uniform vec3 uHorizon; uniform vec3 uZenith; uniform vec3 uSun;
      void main(){
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 c = mix(uHorizon, uZenith, pow(h, 0.55));
        float s = max(dot(normalize(vDir), normalize(uSun)), 0.0);
        c += vec3(1.0, 0.85, 0.55) * (pow(s, 600.0) * 2.0 + pow(s, 12.0) * 0.18);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  })
);
sky.renderOrder = -10; sky.frustumCulled = false;
scene.add(sky);

// ---------- Jugador (dolly) ----------
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 800);
const dolly = new THREE.Group();
dolly.add(camera);
scene.add(dolly);
camera.position.y = EYE_HEIGHT;

// Espada de escritorio (visible en pantalla normal)
const deskSword = createSword();
deskSword.position.set(0.32, -0.34, -0.5);
deskSword.rotation.set(1.0, 0.15, -0.1);
camera.add(deskSword);

// Mandos
const controllers = [];
const modelFactory = new XRControllerModelFactory();
let swordHand = null;
const vrSword = createSword();
vrSword.rotation.x = SWORD_TILT;

for (let i = 0; i < 2; i++) {
  const ctrl = renderer.xr.getController(i);
  ctrl.addEventListener('connected', (e) => {
    ctrl.userData.handedness = e.data.handedness;
    if (!swordHand && (e.data.handedness === 'right' || e.data.handedness === 'none')) {
      swordHand = ctrl;
      ctrl.add(vrSword);
      if (ctrl.userData.grip) ctrl.userData.grip.visible = false;
    }
  });
  ctrl.addEventListener('disconnected', () => {
    if (swordHand === ctrl) { ctrl.remove(vrSword); swordHand = null; }
  });
  dolly.add(ctrl);
  const grip = renderer.xr.getControllerGrip(i);
  grip.add(modelFactory.createControllerModel(grip));
  ctrl.userData.grip = grip;
  dolly.add(grip);
  controllers.push(ctrl);
}

renderer.xr.addEventListener('sessionstart', () => {
  deskSword.visible = false;
  camera.position.set(0, 0, 0); camera.rotation.set(0, 0, 0);
  hudEl.style.display = 'none';
});
renderer.xr.addEventListener('sessionend', () => {
  deskSword.visible = true;
  camera.position.set(0, EYE_HEIGHT, 0);
  hudEl.style.display = '';
});

// ---------- Mundo ----------
const hf = createHeightfield(SEED);
const world = new World(scene, hf);
const spawn = hf.findSpawn();
world.spawn = spawn;
dolly.position.set(spawn.x, spawn.y, spawn.z);
let groundY = spawn.y;

// ---------- Entrada de escritorio ----------
const keys = {};
let yaw = 0.8, pitch = 0;
window.addEventListener('keydown', (e) => { keys[e.code] = true; });
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
renderer.domElement.addEventListener('click', () => {
  if (!renderer.xr.isPresenting) {
    if (document.pointerLockElement !== renderer.domElement) renderer.domElement.requestPointerLock?.();
    else swing();
  }
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement === renderer.domElement) {
    yaw -= e.movementX * 0.0022;
    pitch = Math.max(-1.45, Math.min(1.45, pitch - e.movementY * 0.0022));
  }
});
let swingT = -1;
function swing() { if (swingT < 0) swingT = 0; }

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Movimiento ----------
const tmpV = new THREE.Vector3(), headPos = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
let snapLatch = false;

function applyMove(mx, mz, dt, speed) {
  // mx = derecha, mz = adelante, relativos a la dirección de la cabeza
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  cam.getWorldDirection(tmpV);
  let fx = tmpV.x, fz = tmpV.z;
  const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
  const dx = (fx * mz + -fz * mx) * speed * dt;
  const dz = (fz * mz + fx * mx) * speed * dt;
  let nx = dolly.position.x, nz = dolly.position.z;
  // Eje por eje: no entrar en aguas profundas
  if (hf.height(nx + dx, nz) > WATER_LEVEL - 0.7) nx += dx;
  if (hf.height(nx, nz + dz) > WATER_LEVEL - 0.7) nz += dz;
  // no escalar paredes casi verticales
  if (hf.slope(nx, nz, 1.5) > 1.6) { nx = dolly.position.x; nz = dolly.position.z; }
  [nx, nz] = world.collide(nx, nz, 0.35);
  dolly.position.x = nx; dolly.position.z = nz;
}

function readVR(dt) {
  const session = renderer.xr.getSession();
  if (!session) return;
  let mx = 0, mz = 0, turn = 0, run = false;
  for (const src of session.inputSources) {
    const gp = src.gamepad;
    if (!gp) continue;
    const a = gp.axes;
    const sx = a.length >= 4 ? a[2] : a[0], sy = a.length >= 4 ? a[3] : a[1];
    if (src.handedness === 'left') {
      if (Math.abs(sx) > 0.12) mx = sx;
      if (Math.abs(sy) > 0.12) mz = -sy;
      run = !!(gp.buttons[3] && gp.buttons[3].pressed);
    } else if (src.handedness === 'right') {
      turn = sx;
    }
  }
  if (mx || mz) applyMove(mx, mz, dt, run ? RUN_SPEED : WALK_SPEED);
  if (Math.abs(turn) > 0.7) {
    if (!snapLatch) {
      snapLatch = true;
      const ang = turn > 0 ? -SNAP_ANGLE : SNAP_ANGLE;
      renderer.xr.getCamera().getWorldPosition(headPos);
      const off = tmpV.copy(dolly.position).sub(headPos);
      off.applyAxisAngle(up, ang);
      dolly.position.x = headPos.x + off.x; dolly.position.z = headPos.z + off.z;
      dolly.rotation.y += ang;
    }
  } else snapLatch = false;
}

function readDesktop(dt) {
  dolly.rotation.y = yaw;
  camera.rotation.x = pitch;
  let mx = 0, mz = 0;
  if (keys.KeyW || keys.ArrowUp) mz += 1;
  if (keys.KeyS || keys.ArrowDown) mz -= 1;
  if (keys.KeyD || keys.ArrowRight) mx += 1;
  if (keys.KeyA || keys.ArrowLeft) mx -= 1;
  if (mx || mz) {
    const l = Math.hypot(mx, mz);
    applyMove(mx / l, mz / l, dt, keys.ShiftLeft || keys.ShiftRight ? RUN_SPEED : WALK_SPEED);
  }
  if (swingT >= 0) {
    swingT += dt / 0.35;
    const k = Math.sin(Math.min(swingT, 1) * Math.PI);
    deskSword.rotation.set(1.0 - k * 1.5, 0.15 + k * 0.5, -0.1 - k * 0.6);
    if (swingT >= 1) { swingT = -1; deskSword.rotation.set(1.0, 0.15, -0.1); }
  }
}

// ---------- Bucle ----------
const clock = new THREE.Clock();
let infoTimer = 0, started = false;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (renderer.xr.isPresenting) readVR(dt); else readDesktop(dt);

  // altura del suelo (suavizada)
  const target = hf.height(dolly.position.x, dolly.position.z);
  groundY += (Math.max(target, WATER_LEVEL - 0.7) - groundY) * Math.min(1, dt * 12);
  dolly.position.y = groundY;

  world.update(dolly.position.x, dolly.position.z, started ? 3.5 : 0);
  sky.position.copy(dolly.position);

  infoTimer += dt;
  if (infoTimer > 0.5) {
    infoTimer = 0;
    infoEl.textContent = `x ${dolly.position.x.toFixed(0)}  z ${dolly.position.z.toFixed(0)}  ·  alt ${groundY.toFixed(0)} m  ·  chunks ${world.chunkCount}`;
  }
  renderer.render(scene, camera);
}

(async function boot() {
  await world.prewarm(spawn.x, spawn.z, (p) => { barEl.style.width = (p * 100).toFixed(0) + '%'; });
  started = true;
  loadingEl.classList.add('done');
  setTimeout(() => { loadingEl.style.display = 'none'; }, 700);
  setTimeout(() => hudEl.classList.add('fade'), 12000);
  renderer.setAnimationLoop(frame);
})();

// Para depuración desde la consola
window.__game = { scene, world, hf, dolly, camera, renderer };
