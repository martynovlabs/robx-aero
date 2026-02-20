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
const drone = { speed: 16, verticalSpeed: 8, pos: new THREE.Vector3(0, 3, 0) };
let draggingGate = null;

const defaultTrack = {
  name: 'Тренировочная 3D',
  gates: [
    { x: 14, y: 3, z: 0, r: 2.5 },
    { x: 28, y: 5, z: -8, r: 2.5 },
    { x: 44, y: 3, z: 6, r: 2.5 },
    { x: 60, y: 4, z: -4, r: 2.5 },
  ],
};

let currentTrack = structuredClone(defaultTrack);
let savedTracks = loadTracks();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050b17);
scene.fog = new THREE.Fog(0x050b17, 30, 180);

const camera = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 400);
camera.position.set(-8, 7, 12);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
container.appendChild(renderer.domElement);

const hemi = new THREE.HemisphereLight(0x9ecbff, 0x223344, 1.1);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 1.2);
dir.position.set(20, 40, 10);
dir.castShadow = true;
scene.add(dir);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(300, 300, 24, 24),
  new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.95, metalness: 0.05, wireframe: false })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const grid = new THREE.GridHelper(300, 80, 0x3b82f6, 0x1f2937);
scene.add(grid);

const droneGroup = new THREE.Group();
scene.add(droneGroup);

const body = new THREE.Mesh(
  new THREE.BoxGeometry(1.7, 0.4, 1.7),
  new THREE.MeshStandardMaterial({ color: 0x22d3ee, metalness: 0.4, roughness: 0.4 })
);
body.castShadow = true;
droneGroup.add(body);

for (const [x, z] of [[1.2, 1.2], [1.2, -1.2], [-1.2, 1.2], [-1.2, -1.2]]) {
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.7), new THREE.MeshStandardMaterial({ color: 0x94a3b8 }));
  arm.rotation.z = Math.PI / 2;
  arm.position.set(0, 0, 0);
  droneGroup.add(arm);
  const rotor = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.07, 8, 18), new THREE.MeshStandardMaterial({ color: 0xf8fafc }));
  rotor.rotation.x = Math.PI / 2;
  rotor.position.set(x, 0.2, z);
  droneGroup.add(rotor);
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
  drone.pos.set(0, 3, 0);
  droneGroup.position.copy(drone.pos);
  game.activeGate = 0;
  game.lapStartedAt = null;
}

function refreshTrackList() {
  trackList.innerHTML = '';
  savedTracks.forEach((track, index) => {
    const o = document.createElement('option');
    o.value = String(index);
    o.textContent = `${index + 1}. ${track.name}`;
    trackList.append(o);
  });
}

function buildTrackMeshes() {
  gateObjects.forEach((obj) => scene.remove(obj));
  gateObjects.length = 0;

  currentTrack.gates.forEach((gate, index) => {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(gate.r, 0.18, 16, 36),
      new THREE.MeshStandardMaterial({ color: index === 0 ? 0x38bdf8 : 0xf59e0b, emissive: 0x111111 })
    );
    ring.position.set(gate.x, gate.y, gate.z);
    ring.rotation.y = Math.PI / 2;
    ring.castShadow = true;
    ring.userData.gateIndex = index;
    gateObjects.push(ring);
    scene.add(ring);
  });
}

function updateGateColors() {
  gateObjects.forEach((ring, index) => {
    const passed = index < game.activeGate;
    const active = index === game.activeGate;
    ring.material.color.setHex(passed ? 0x10b981 : active ? 0x38bdf8 : 0xf59e0b);
    ring.material.emissive.setHex(active ? 0x163247 : 0x111111);
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

function updateDrone(dt) {
  const move = new THREE.Vector3();
  if (keys.has('w') || keys.has('arrowup')) move.x += 1;
  if (keys.has('s') || keys.has('arrowdown')) move.x -= 1;
  if (keys.has('a') || keys.has('arrowleft')) move.z += 1;
  if (keys.has('d') || keys.has('arrowright')) move.z -= 1;
  if (keys.has(' ')) move.y += 1;
  if (keys.has('shift')) move.y -= 1;

  if (move.lengthSq() > 0) move.normalize();

  drone.pos.x += move.x * drone.speed * dt;
  drone.pos.y += move.y * drone.verticalSpeed * dt;
  drone.pos.z += move.z * drone.speed * dt;

  drone.pos.y = THREE.MathUtils.clamp(drone.pos.y, 1.2, 30);
  drone.pos.x = THREE.MathUtils.clamp(drone.pos.x, -140, 140);
  drone.pos.z = THREE.MathUtils.clamp(drone.pos.z, -140, 140);
  droneGroup.position.copy(drone.pos);

  if (move.lengthSq() > 0) {
    const targetYaw = Math.atan2(-move.z, move.x);
    droneGroup.rotation.y = THREE.MathUtils.lerp(droneGroup.rotation.y, targetYaw, 0.08);
    droneGroup.rotation.z = THREE.MathUtils.lerp(droneGroup.rotation.z, move.z * 0.18, 0.08);
    droneGroup.rotation.x = THREE.MathUtils.lerp(droneGroup.rotation.x, -move.x * 0.1, 0.08);
  } else {
    droneGroup.rotation.x *= 0.9;
    droneGroup.rotation.z *= 0.9;
  }
}

function checkGates() {
  const gate = currentTrack.gates[game.activeGate];
  if (!gate || !game.running) return;

  const dist = drone.pos.distanceTo(new THREE.Vector3(gate.x, gate.y, gate.z));
  if (dist <= gate.r + 0.8) {
    if (game.activeGate === 0 && game.lapStartedAt === null) game.lapStartedAt = performance.now();
    game.activeGate += 1;
    updateGateColors();

    if (game.activeGate >= currentTrack.gates.length) {
      const lapMs = game.lapStartedAt ? performance.now() - game.lapStartedAt : 0;
      const lapSec = (lapMs / 1000).toFixed(2);
      game.running = false;
      setStatus(`Финиш! Время круга: ${lapSec} сек.`);
    } else {
      setStatus(`Ворота ${game.activeGate}/${currentTrack.gates.length} пройдены.`);
    }
  }
}

function updateCamera(dt) {
  const cameraOffset = new THREE.Vector3(-8, 5, 11);
  const worldOffset = cameraOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), droneGroup.rotation.y);
  const desired = drone.pos.clone().add(worldOffset);
  camera.position.lerp(desired, 1 - Math.exp(-4 * dt));
  camera.lookAt(drone.pos.x + 4, drone.pos.y + 1.2, drone.pos.z);
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.033);
  if (game.running) updateDrone(dt);
  checkGates();
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
  const gate = { x: point.x, y: 3.5, z: point.z, r: 2.5 };
  currentTrack.gates.push(gate);
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
  setStatus('Позиция коптера сброшена.');
});

newTrackBtn.addEventListener('click', () => {
  game.running = false;
  game.editorMode = true;
  currentTrack = { name: 'Новая 3D трасса', gates: [] };
  trackNameInput.value = currentTrack.name;
  resetDrone();
  buildTrackMeshes();
  setStatus('Редактор включен: клик добавляет кольца, Alt+перетаскивание двигает кольца.');
});

saveTrackBtn.addEventListener('click', () => {
  if (!currentTrack.gates.length) {
    setStatus('Добавьте хотя бы одни ворота перед сохранением.');
    return;
  }

  const name = trackNameInput.value.trim() || `3D трасса ${savedTracks.length + 1}`;
  currentTrack.name = name;
  const index = savedTracks.findIndex((t) => t.name === name);
  if (index >= 0) savedTracks[index] = structuredClone(currentTrack);
  else savedTracks.push(structuredClone(currentTrack));

  saveTracks();
  refreshTrackList();
  trackList.value = String(Math.max(0, savedTracks.findIndex((t) => t.name === name)));
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
