import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

const container = document.getElementById('sim3d');
const statusEl = document.getElementById('status');
const startBtn = document.getElementById('startBtn');
const resetBtn = document.getElementById('resetBtn');
const newTrackBtn = document.getElementById('newTrackBtn');
const saveTrackBtn = document.getElementById('saveTrackBtn');
const trackNameInput = document.getElementById('trackName');
const trackList = document.getElementById('trackList');

const keys = new Set();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

const game = { running: false, editorMode: false, activeGate: 0, lapStartedAt: null };

const flight = {
  mass: 1.35,
  gravity: 9.81,
  throttle: 0.57,
  minThrottle: 0.25,
  maxThrottle: 0.9,
  velocity: new THREE.Vector3(),
  angularVelocity: new THREE.Vector3(), // x=pitchRate, y=yawRate, z=rollRate
  drag: 0.18,
  angularDrag: 3.5,
  maxTilt: THREE.MathUtils.degToRad(35),
  maxYawRate: THREE.MathUtils.degToRad(110),
};

const pilotInput = {
  pitch: 0,
  roll: 0,
  yaw: 0,
  throttleAxis: 0,
};

const drone = {
  pos: new THREE.Vector3(0, 3, 0),
  prevPos: new THREE.Vector3(0, 3, 0),
};

let draggingGate = null;

const defaultTrack = {
  name: 'Тренировочная 3D',
  gates: [
    { x: 18, y: 4, z: 0, r: 2.5 },
    { x: 38, y: 8, z: -11, r: 2.8 },
    { x: 58, y: 5, z: 8, r: 2.5 },
    { x: 78, y: 7, z: -6, r: 2.8 },
  ],
};

let currentTrack = structuredClone(defaultTrack);
let savedTracks = loadTracks();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030712);
scene.fog = new THREE.Fog(0x030712, 50, 240);

const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 500);
camera.position.set(-8, 7, 12);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
container.appendChild(renderer.domElement);

const hemi = new THREE.HemisphereLight(0x9ecbff, 0x111827, 0.9);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(40, 50, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
scene.add(sun);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(500, 500, 32, 32),
  new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.97, metalness: 0.04 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

scene.add(new THREE.GridHelper(500, 120, 0x2563eb, 0x1e293b));

const droneGroup = new THREE.Group();
scene.add(droneGroup);

const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x1f2937, metalness: 0.6, roughness: 0.45 });
const accentMaterial = new THREE.MeshStandardMaterial({ color: 0x22d3ee, metalness: 0.45, roughness: 0.35 });

const frame = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.28, 0.85), frameMaterial);
frame.castShadow = true;
droneGroup.add(frame);

const stack = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.22, 0.6), accentMaterial);
stack.position.y = 0.25;
stack.castShadow = true;
droneGroup.add(stack);

const armGeom = new THREE.BoxGeometry(2.4, 0.08, 0.12);
const motors = [];
const rotors = [];
const armAngles = [Math.PI / 4, -Math.PI / 4, (3 * Math.PI) / 4, (-3 * Math.PI) / 4];
for (const angle of armAngles) {
  const arm = new THREE.Mesh(armGeom, frameMaterial);
  arm.rotation.y = angle;
  arm.castShadow = true;
  droneGroup.add(arm);

  const mx = Math.cos(angle) * 1.18;
  const mz = Math.sin(angle) * 1.18;

  const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.14, 16), frameMaterial);
  motor.position.set(mx, 0.06, mz);
  motor.castShadow = true;
  droneGroup.add(motor);
  motors.push(motor);

  const rotor = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 0.02, 24),
    new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.1, roughness: 0.6, transparent: true, opacity: 0.72 })
  );
  rotor.position.set(mx, 0.16, mz);
  rotor.castShadow = true;
  droneGroup.add(rotor);
  rotors.push(rotor);
}

const skidGeom = new THREE.TorusGeometry(0.72, 0.03, 12, 28, Math.PI);
for (const side of [-0.34, 0.34]) {
  const skid = new THREE.Mesh(skidGeom, frameMaterial);
  skid.rotation.set(Math.PI / 2, 0, Math.PI / 2);
  skid.position.set(0, -0.33, side);
  skid.castShadow = true;
  droneGroup.add(skid);
}

const gateObjects = [];
const clock = new THREE.Clock();

function setStatus(text) {
  statusEl.textContent = text;
}

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
  drone.prevPos.copy(drone.pos);
  droneGroup.position.copy(drone.pos);
  droneGroup.rotation.set(0, 0, 0);
  flight.velocity.set(0, 0, 0);
  flight.angularVelocity.set(0, 0, 0);
  flight.throttle = 0.57;
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

function updatePilotInput() {
  pilotInput.pitch = 0;
  pilotInput.roll = 0;
  pilotInput.yaw = 0;
  pilotInput.throttleAxis = 0;

  if (keys.has('w') || keys.has('arrowup')) pilotInput.pitch += 1;
  if (keys.has('s') || keys.has('arrowdown')) pilotInput.pitch -= 1;
  if (keys.has('a') || keys.has('arrowleft')) pilotInput.roll += 1;
  if (keys.has('d') || keys.has('arrowright')) pilotInput.roll -= 1;
  if (keys.has('q')) pilotInput.yaw += 1;
  if (keys.has('e')) pilotInput.yaw -= 1;
  if (keys.has(' ')) pilotInput.throttleAxis += 1;
  if (keys.has('shift')) pilotInput.throttleAxis -= 1;
}

function updateDronePhysics(dt) {
  updatePilotInput();

  flight.throttle = THREE.MathUtils.clamp(
    flight.throttle + pilotInput.throttleAxis * dt * 0.4,
    flight.minThrottle,
    flight.maxThrottle
  );

  const targetPitch = -pilotInput.pitch * flight.maxTilt;
  const targetRoll = pilotInput.roll * flight.maxTilt;
  const targetYawRate = pilotInput.yaw * flight.maxYawRate;

  droneGroup.rotation.x = THREE.MathUtils.damp(droneGroup.rotation.x, targetPitch, 6.5, dt);
  droneGroup.rotation.z = THREE.MathUtils.damp(droneGroup.rotation.z, targetRoll, 6.5, dt);
  flight.angularVelocity.y = THREE.MathUtils.damp(flight.angularVelocity.y, targetYawRate, 8, dt);
  droneGroup.rotation.y += flight.angularVelocity.y * dt;

  const thrustLocal = new THREE.Vector3(0, flight.throttle * flight.mass * flight.gravity * 2.1, 0);
  const thrustWorld = thrustLocal.applyEuler(droneGroup.rotation);
  const gravityForce = new THREE.Vector3(0, -flight.mass * flight.gravity, 0);
  const dragForce = flight.velocity.clone().multiplyScalar(-flight.drag * flight.velocity.length());

  const totalForce = thrustWorld.add(gravityForce).add(dragForce);
  const acceleration = totalForce.multiplyScalar(1 / flight.mass);
  flight.velocity.addScaledVector(acceleration, dt);
  drone.pos.addScaledVector(flight.velocity, dt);

  if (drone.pos.y < 0.8) {
    drone.pos.y = 0.8;
    flight.velocity.y = Math.max(0, flight.velocity.y * -0.12);
    flight.velocity.multiplyScalar(0.95);
  }

  drone.pos.x = THREE.MathUtils.clamp(drone.pos.x, -220, 220);
  drone.pos.z = THREE.MathUtils.clamp(drone.pos.z, -220, 220);

  drone.prevPos.copy(droneGroup.position);
  droneGroup.position.copy(drone.pos);

  const rotorSpeed = 40 + flight.throttle * 280;
  rotors.forEach((rotor, index) => {
    rotor.rotation.y += dt * rotorSpeed * (index % 2 === 0 ? 1 : -1);
  });
}

function checkGates() {
  const gate = currentTrack.gates[game.activeGate];
  if (!gate || !game.running) return;

  const dist = drone.pos.distanceTo(new THREE.Vector3(gate.x, gate.y, gate.z));
  if (dist <= gate.r + 0.9) {
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
  const desired = drone.pos.clone()
    .addScaledVector(forward, -9.5)
    .add(new THREE.Vector3(0, 4.2, 0));

  camera.position.lerp(desired, 1 - Math.exp(-5 * dt));
  const lookAt = drone.pos.clone().addScaledVector(forward, 8).add(new THREE.Vector3(0, 1.1, 0));
  camera.lookAt(lookAt);
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.033);

  if (game.running) {
    updateDronePhysics(dt);
    checkGates();
  } else {
    rotors.forEach((rotor, index) => {
      rotor.rotation.y += dt * 20 * (index % 2 === 0 ? 1 : -1);
    });
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

window.addEventListener('mouseup', () => {
  draggingGate = null;
});

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
