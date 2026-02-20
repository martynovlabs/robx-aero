import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

const container = document.getElementById('sim3d');
const statusEl = document.getElementById('status');
const startBtn = document.getElementById('startBtn');
const resetBtn = document.getElementById('resetBtn');
const newTrackBtn = document.getElementById('newTrackBtn');
const saveTrackBtn = document.getElementById('saveTrackBtn');
const trackNameInput = document.getElementById('trackName');
const trackList = document.getElementById('trackList');
const telemetrySpeedEl = document.getElementById('telemetrySpeed');
const telemetryAltEl = document.getElementById('telemetryAlt');
const telemetryThrottleEl = document.getElementById('telemetryThrottle');
const telemetryModeEl = document.getElementById('telemetryMode');

const keys = new Set();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

const game = { running: false, editorMode: false, activeGate: 0, lapStartedAt: null };
const flight = {
  mass: 1.45,
  gravity: 9.81,
  throttle: 0.62,
  minThrottle: 0.22,
  maxThrottle: 0.95,
  velocity: new THREE.Vector3(),
  angularVelocity: new THREE.Vector3(),
  inertia: new THREE.Vector3(0.022, 0.028, 0.022),
  linearDrag: 0.07,
  angularDamping: 2.4,
  maxRate: {
    pitch: THREE.MathUtils.degToRad(185),
    roll: THREE.MathUtils.degToRad(185),
    yaw: THREE.MathUtils.degToRad(150),
  },
  rateKp: new THREE.Vector3(0.09, 0.12, 0.09),
  rateKd: new THREE.Vector3(0.018, 0.022, 0.018),
  motorMaxThrust: 9.4,
  batterySag: 1,
};

const input = { pitch: 0, roll: 0, yaw: 0, throttleAxis: 0 };
const drone = { pos: new THREE.Vector3(0, 3.2, 0) };

const motorMix = [
  { roll: +1, pitch: +1, yaw: -1 },
  { roll: -1, pitch: +1, yaw: +1 },
  { roll: -1, pitch: -1, yaw: -1 },
  { roll: +1, pitch: -1, yaw: +1 },
];

let draggingGate = null;

const defaultTrack = {
  name: 'Тренировочная 3D',
  gates: [
    { x: 18, y: 4, z: 0, r: 2.6 },
    { x: 40, y: 8, z: -12, r: 2.8 },
    { x: 63, y: 5, z: 9, r: 2.6 },
    { x: 86, y: 7, z: -8, r: 2.8 },
  ],
};

let currentTrack = structuredClone(defaultTrack);
let savedTracks = loadTracks();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050812);
scene.fog = new THREE.Fog(0x050812, 80, 340);

const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 700);
camera.position.set(-10, 6, 12);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
container.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xbcd7ff, 0x111827, 0.84));
const sun = new THREE.DirectionalLight(0xffffff, 1.45);
sun.position.set(80, 110, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(800, 800),
  new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.97, metalness: 0.03 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
scene.add(new THREE.GridHelper(800, 170, 0x1d4ed8, 0x1e293b));

for (let i = 0; i < 40; i += 1) {
  const h = 4 + Math.random() * 24;
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(6, h, 6),
    new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.8, metalness: 0.2 })
  );
  box.position.set((Math.random() - 0.5) * 460, h / 2, (Math.random() - 0.5) * 460);
  box.castShadow = true;
  box.receiveShadow = true;
  scene.add(box);
}

const droneGroup = new THREE.Group();
scene.add(droneGroup);
const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x1f2937, metalness: 0.62, roughness: 0.4 });
const accentMaterial = new THREE.MeshStandardMaterial({ color: 0x22d3ee, metalness: 0.42, roughness: 0.35 });

const fuselage = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.1, 6, 14), frameMaterial);
fuselage.rotation.z = Math.PI / 2;
fuselage.castShadow = true;
droneGroup.add(fuselage);

const topPlate = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.12, 0.65), accentMaterial);
topPlate.position.y = 0.18;
topPlate.castShadow = true;
droneGroup.add(topPlate);

const armGeom = new THREE.BoxGeometry(2.45, 0.09, 0.12);
const armAngles = [Math.PI / 4, -Math.PI / 4, (3 * Math.PI) / 4, (-3 * Math.PI) / 4];
const rotors = [];
for (const angle of armAngles) {
  const arm = new THREE.Mesh(armGeom, frameMaterial);
  arm.rotation.y = angle;
  arm.castShadow = true;
  droneGroup.add(arm);

  const mx = Math.cos(angle) * 1.2;
  const mz = Math.sin(angle) * 1.2;

  const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.16, 16), frameMaterial);
  motor.position.set(mx, 0.08, mz);
  motor.castShadow = true;
  droneGroup.add(motor);

  const prop = new THREE.Mesh(
    new THREE.CylinderGeometry(0.52, 0.52, 0.018, 30),
    new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.58, metalness: 0.12, transparent: true, opacity: 0.72 })
  );
  prop.position.set(mx, 0.17, mz);
  prop.castShadow = true;
  droneGroup.add(prop);
  rotors.push(prop);
}

const skidGeom = new THREE.TorusGeometry(0.74, 0.03, 12, 28, Math.PI);
for (const side of [-0.34, 0.34]) {
  const skid = new THREE.Mesh(skidGeom, frameMaterial);
  skid.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  skid.position.set(0, -0.34, side);
  skid.castShadow = true;
  droneGroup.add(skid);
}

const gateObjects = [];
const clock = new THREE.Clock();

function setStatus(text) { statusEl.textContent = text; }

function loadTracks() {
  try {
    const raw = localStorage.getItem('quad_tracks_3d');
    const parsed = raw ? JSON.parse(raw) : [defaultTrack];
    return parsed.length ? parsed : [defaultTrack];
  } catch {
    return [defaultTrack];
  }
}

function saveTracks() {
  localStorage.setItem('quad_tracks_3d', JSON.stringify(savedTracks));
}

function resetDrone() {
  drone.pos.set(0, 3.2, 0);
  droneGroup.position.copy(drone.pos);
  droneGroup.rotation.set(0, 0, 0);
  flight.velocity.set(0, 0, 0);
  flight.angularVelocity.set(0, 0, 0);
  flight.throttle = 0.62;
  flight.batterySag = 1;
  game.activeGate = 0;
  game.lapStartedAt = null;
}

function refreshTrackList() {
  trackList.innerHTML = '';
  savedTracks.forEach((track, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `${index + 1}. ${track.name}`;
    trackList.append(option);
  });
}

function buildTrackMeshes() {
  gateObjects.forEach((obj) => {
    obj.geometry.dispose();
    obj.material.dispose();
    scene.remove(obj);
  });
  gateObjects.length = 0;

  currentTrack.gates.forEach((gate, index) => {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(gate.r, 0.2, 18, 44),
      new THREE.MeshStandardMaterial({ color: index === 0 ? 0x38bdf8 : 0xf59e0b, emissive: 0x111111 })
    );
    ring.position.set(gate.x, gate.y, gate.z);
    ring.rotation.y = Math.PI / 2;
    ring.castShadow = true;
    ring.userData.gateIndex = index;
    scene.add(ring);
    gateObjects.push(ring);
  });
}

function updateGateColors() {
  gateObjects.forEach((ring, index) => {
    const passed = index < game.activeGate;
    const active = index === game.activeGate;
    ring.material.color.setHex(passed ? 0x10b981 : active ? 0x38bdf8 : 0xf59e0b);
    ring.material.emissive.setHex(active ? 0x17314a : 0x111111);
  });
}

function loadTrack(index) {
  const selected = savedTracks[index];
  if (!selected) return;
  currentTrack = structuredClone(selected);
  trackNameInput.value = currentTrack.name;
  resetDrone();
  buildTrackMeshes();
  updateGateColors();
  setStatus(`Трасса «${currentTrack.name}» загружена.`);
}

function resizeRenderer() {
  const { clientWidth, clientHeight } = container;
  renderer.setSize(clientWidth, clientHeight);
  camera.aspect = clientWidth / clientHeight;
  camera.updateProjectionMatrix();
}

function updateInput() {
  input.pitch = 0;
  input.roll = 0;
  input.yaw = 0;
  input.throttleAxis = 0;

  if (keys.has('w') || keys.has('arrowup')) input.pitch += 1;
  if (keys.has('s') || keys.has('arrowdown')) input.pitch -= 1;
  if (keys.has('a') || keys.has('arrowleft')) input.roll += 1;
  if (keys.has('d') || keys.has('arrowright')) input.roll -= 1;
  if (keys.has('q')) input.yaw += 1;
  if (keys.has('e')) input.yaw -= 1;
  if (keys.has(' ')) input.throttleAxis += 1;
  if (keys.has('shift')) input.throttleAxis -= 1;
}

function updatePhysics(dt) {
  updateInput();

  flight.throttle = THREE.MathUtils.clamp(flight.throttle + input.throttleAxis * dt * 0.45, flight.minThrottle, flight.maxThrottle);
  flight.batterySag = Math.max(0.86, flight.batterySag - dt * 0.0017);

  const desiredRates = new THREE.Vector3(
    input.pitch * flight.maxRate.pitch,
    input.yaw * flight.maxRate.yaw,
    input.roll * flight.maxRate.roll
  );

  const rateError = desiredRates.clone().sub(flight.angularVelocity);
  const torqueCmd = new THREE.Vector3(
    rateError.x * flight.rateKp.x - flight.angularVelocity.x * flight.rateKd.x,
    rateError.y * flight.rateKp.y - flight.angularVelocity.y * flight.rateKd.y,
    rateError.z * flight.rateKp.z - flight.angularVelocity.z * flight.rateKd.z
  );

  const motorOutputs = motorMix.map((mix) => THREE.MathUtils.clamp(
    flight.throttle
      + torqueCmd.z * mix.roll * 0.19
      + torqueCmd.x * mix.pitch * 0.19
      + torqueCmd.y * mix.yaw * 0.12,
    0,
    1
  ));

  const totalThrust = motorOutputs.reduce((sum, m) => sum + (m * m) * flight.motorMaxThrust * flight.batterySag, 0);

  const rollTorque = (motorOutputs[0] - motorOutputs[1] - motorOutputs[2] + motorOutputs[3]) * 0.16;
  const pitchTorque = (motorOutputs[0] + motorOutputs[1] - motorOutputs[2] - motorOutputs[3]) * 0.16;
  const yawTorque = (-motorOutputs[0] + motorOutputs[1] - motorOutputs[2] + motorOutputs[3]) * 0.08;

  const angularAccel = new THREE.Vector3(
    (pitchTorque / flight.inertia.x) - flight.angularVelocity.x * flight.angularDamping,
    (yawTorque / flight.inertia.y) - flight.angularVelocity.y * flight.angularDamping,
    (rollTorque / flight.inertia.z) - flight.angularVelocity.z * flight.angularDamping
  );

  flight.angularVelocity.addScaledVector(angularAccel, dt);
  droneGroup.rotateX(flight.angularVelocity.x * dt);
  droneGroup.rotateY(flight.angularVelocity.y * dt);
  droneGroup.rotateZ(flight.angularVelocity.z * dt);

  const thrustWorld = new THREE.Vector3(0, totalThrust, 0).applyQuaternion(droneGroup.quaternion);
  const gravityForce = new THREE.Vector3(0, -flight.mass * flight.gravity, 0);
  const dragForce = flight.velocity.clone().multiplyScalar(-flight.linearDrag * flight.velocity.length());

  const acceleration = thrustWorld.add(gravityForce).add(dragForce).multiplyScalar(1 / flight.mass);
  flight.velocity.addScaledVector(acceleration, dt);
  drone.pos.addScaledVector(flight.velocity, dt);

  if (drone.pos.y < 0.75) {
    drone.pos.y = 0.75;
    flight.velocity.y = Math.max(0, -flight.velocity.y * 0.16);
    flight.velocity.multiplyScalar(0.92);
  }

  drone.pos.x = THREE.MathUtils.clamp(drone.pos.x, -360, 360);
  drone.pos.z = THREE.MathUtils.clamp(drone.pos.z, -360, 360);
  droneGroup.position.copy(drone.pos);

  motorOutputs.forEach((m, i) => {
    rotors[i].rotation.y += dt * (80 + m * 850) * (i % 2 === 0 ? 1 : -1);
    rotors[i].material.opacity = 0.5 + m * 0.35;
  });

  telemetrySpeedEl.textContent = `${flight.velocity.length().toFixed(1)} м/с`;
  telemetryAltEl.textContent = `${drone.pos.y.toFixed(1)} м`;
  telemetryThrottleEl.textContent = `${Math.round(flight.throttle * 100)}%`;
  telemetryModeEl.textContent = game.running ? 'ARMED' : 'IDLE';
}

function checkGates() {
  const gate = currentTrack.gates[game.activeGate];
  if (!gate || !game.running) return;

  const dist = drone.pos.distanceTo(new THREE.Vector3(gate.x, gate.y, gate.z));
  if (dist <= gate.r + 0.85) {
    if (game.activeGate === 0 && game.lapStartedAt === null) game.lapStartedAt = performance.now();
    game.activeGate += 1;
    updateGateColors();

    if (game.activeGate >= currentTrack.gates.length) {
      const lapMs = game.lapStartedAt ? performance.now() - game.lapStartedAt : 0;
      game.running = false;
      setStatus(`Финиш! Время круга: ${(lapMs / 1000).toFixed(2)} сек.`);
    } else {
      setStatus(`Ворота ${game.activeGate}/${currentTrack.gates.length} пройдены.`);
    }
  }
}

function updateCamera(dt) {
  const forward = new THREE.Vector3(1, 0, 0).applyQuaternion(droneGroup.quaternion);
  const desired = drone.pos.clone().addScaledVector(forward, -11).add(new THREE.Vector3(0, 5.2, 0));
  camera.position.lerp(desired, 1 - Math.exp(-4.5 * dt));
  camera.lookAt(drone.pos.clone().addScaledVector(forward, 14).add(new THREE.Vector3(0, 1.5, 0)));
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.033);

  if (game.running) {
    updatePhysics(dt);
    checkGates();
  } else {
    rotors.forEach((rotor, i) => {
      rotor.rotation.y += dt * 42 * (i % 2 === 0 ? 1 : -1);
    });
    telemetryModeEl.textContent = game.editorMode ? 'EDIT' : 'IDLE';
  }

  updateCamera(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function getPointerGround(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const point = new THREE.Vector3();
  raycaster.ray.intersectPlane(floorPlane, point);
  return point;
}

renderer.domElement.addEventListener('click', (event) => {
  if (!game.editorMode || event.altKey) return;
  const point = getPointerGround(event);
  currentTrack.gates.push({ x: point.x, y: 4, z: point.z, r: 2.6 });
  buildTrackMeshes();
  updateGateColors();
  setStatus(`Добавлено колец: ${currentTrack.gates.length}.`);
});

renderer.domElement.addEventListener('mousedown', (event) => {
  if (!game.editorMode || !event.altKey) return;
  pointer.x = (event.offsetX / renderer.domElement.clientWidth) * 2 - 1;
  pointer.y = -(event.offsetY / renderer.domElement.clientHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects(gateObjects)[0];
  draggingGate = hit ? currentTrack.gates[hit.object.userData.gateIndex] : null;
});

window.addEventListener('mousemove', (event) => {
  if (!game.editorMode || !draggingGate) return;
  const point = getPointerGround(event);
  draggingGate.x = point.x;
  draggingGate.z = point.z;
  buildTrackMeshes();
  updateGateColors();
});

window.addEventListener('mouseup', () => { draggingGate = null; });
window.addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()));
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('resize', resizeRenderer);

startBtn.addEventListener('click', () => {
  if (!currentTrack.gates.length) {
    setStatus('Добавьте ворота, чтобы начать полёт.');
    return;
  }
  game.running = true;
  game.editorMode = false;
  game.activeGate = 0;
  game.lapStartedAt = null;
  updateGateColors();
  setStatus(`Полет начат. Цель: ворота 1/${currentTrack.gates.length}.`);
});

resetBtn.addEventListener('click', () => {
  game.running = false;
  resetDrone();
  updateGateColors();
  setStatus('Коптер сброшен в стартовую позицию.');
});

newTrackBtn.addEventListener('click', () => {
  game.running = false;
  game.editorMode = true;
  currentTrack = { name: 'Новая 3D трасса', gates: [] };
  trackNameInput.value = currentTrack.name;
  resetDrone();
  buildTrackMeshes();
  setStatus('Редактор: клик добавляет кольцо, Alt + перетаскивание двигает кольцо.');
});

saveTrackBtn.addEventListener('click', () => {
  if (!currentTrack.gates.length) {
    setStatus('Добавьте хотя бы одни ворота перед сохранением.');
    return;
  }

  const name = trackNameInput.value.trim() || `3D трасса ${savedTracks.length + 1}`;
  currentTrack.name = name;
  const index = savedTracks.findIndex((track) => track.name === name);
  if (index >= 0) savedTracks[index] = structuredClone(currentTrack);
  else savedTracks.push(structuredClone(currentTrack));

  saveTracks();
  refreshTrackList();
  trackList.value = String(Math.max(0, savedTracks.findIndex((track) => track.name === name)));
  game.editorMode = false;
  setStatus(`Трасса «${name}» сохранена.`);
});

trackList.addEventListener('change', (event) => {
  game.running = false;
  game.editorMode = false;
  loadTrack(Number(event.target.value));
});

resizeRenderer();
refreshTrackList();
trackList.value = '0';
loadTrack(0);
resetDrone();
animate();
