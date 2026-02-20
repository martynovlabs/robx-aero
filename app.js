const canvas = document.getElementById('simCanvas');
const ctx = canvas.getContext('2d');

const statusEl = document.getElementById('status');
const startBtn = document.getElementById('startBtn');
const resetBtn = document.getElementById('resetBtn');
const newTrackBtn = document.getElementById('newTrackBtn');
const saveTrackBtn = document.getElementById('saveTrackBtn');
const trackNameInput = document.getElementById('trackName');
const trackList = document.getElementById('trackList');

const keys = new Set();
const drone = {
  x: 70,
  y: canvas.height / 2,
  radius: 12,
  speed: 2.8,
};

const game = {
  running: false,
  editorMode: false,
  activeGate: 0,
  lapStartedAt: null,
};

let draggingGate = null;

const defaultTrack = {
  name: 'Тренировочная',
  gates: [
    { x: 220, y: 120, r: 24 },
    { x: 410, y: 360, r: 24 },
    { x: 600, y: 180, r: 24 },
    { x: 760, y: 320, r: 24 },
  ],
};

let currentTrack = structuredClone(defaultTrack);
let savedTracks = loadTracks();

function loadTracks() {
  try {
    const raw = localStorage.getItem('quad_tracks');
    const data = raw ? JSON.parse(raw) : [defaultTrack];
    return data.length ? data : [defaultTrack];
  } catch {
    return [defaultTrack];
  }
}

function saveTracks() {
  localStorage.setItem('quad_tracks', JSON.stringify(savedTracks));
}

function setStatus(text) {
  statusEl.textContent = text;
}

function resetDrone() {
  drone.x = 70;
  drone.y = canvas.height / 2;
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

function loadTrack(index) {
  const selected = savedTracks[index];
  if (!selected) return;
  currentTrack = structuredClone(selected);
  trackNameInput.value = currentTrack.name;
  resetDrone();
  draw();
  setStatus(`Трасса «${currentTrack.name}» загружена.`);
}

function update() {
  if (game.running) {
    if (keys.has('w') || keys.has('arrowup')) drone.y -= drone.speed;
    if (keys.has('s') || keys.has('arrowdown')) drone.y += drone.speed;
    if (keys.has('a') || keys.has('arrowleft')) drone.x -= drone.speed;
    if (keys.has('d') || keys.has('arrowright')) drone.x += drone.speed;

    drone.x = Math.max(drone.radius, Math.min(canvas.width - drone.radius, drone.x));
    drone.y = Math.max(drone.radius, Math.min(canvas.height - drone.radius, drone.y));

    const gate = currentTrack.gates[game.activeGate];
    if (gate) {
      const dx = drone.x - gate.x;
      const dy = drone.y - gate.y;
      const dist = Math.hypot(dx, dy);
      if (dist < gate.r + drone.radius) {
        if (game.activeGate === 0 && game.lapStartedAt === null) {
          game.lapStartedAt = performance.now();
        }
        game.activeGate += 1;
        if (game.activeGate >= currentTrack.gates.length) {
          const lapMs = game.lapStartedAt ? performance.now() - game.lapStartedAt : 0;
          const lapSec = (lapMs / 1000).toFixed(2);
          game.running = false;
          setStatus(`Финиш! Время круга: ${lapSec} сек. Нажмите «Старт» для нового заезда.`);
        } else {
          setStatus(`Ворота ${game.activeGate}/${currentTrack.gates.length} пройдены.`);
        }
      }
    }
  }

  draw();
  requestAnimationFrame(update);
}

function drawGrid() {
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
  ctx.lineWidth = 1;

  for (let x = 0; x < canvas.width; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }

  for (let y = 0; y < canvas.height; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  ctx.font = '15px Inter, sans-serif';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(game.editorMode ? 'РЕЖИМ РЕДАКТОРА' : 'РЕЖИМ ПОЛЁТА', 16, 24);

  currentTrack.gates.forEach((gate, index) => {
    const passed = index < game.activeGate;
    const active = index === game.activeGate;

    ctx.strokeStyle = passed ? '#10b981' : active ? '#38bdf8' : '#f59e0b';
    ctx.lineWidth = active ? 5 : 3;

    ctx.beginPath();
    ctx.arc(gate.x, gate.y, gate.r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(String(index + 1), gate.x - 4, gate.y + 5);
  });

  ctx.fillStyle = '#22d3ee';
  ctx.beginPath();
  ctx.arc(drone.x, drone.y, drone.radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#67e8f9';
  ctx.lineWidth = 2;
  ctx.stroke();
}

window.addEventListener('keydown', (event) => {
  keys.add(event.key.toLowerCase());
});

window.addEventListener('keyup', (event) => {
  keys.delete(event.key.toLowerCase());
});

canvas.addEventListener('click', (event) => {
  if (!game.editorMode) return;

  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
  const y = ((event.clientY - rect.top) / rect.height) * canvas.height;

  currentTrack.gates.push({ x, y, r: 24 });
  draw();
  setStatus(`Добавлены ворота ${currentTrack.gates.length}.`);
});

canvas.addEventListener('mousedown', (event) => {
  if (!game.editorMode) return;

  const rect = canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * canvas.width;
  const y = ((event.clientY - rect.top) / rect.height) * canvas.height;

  draggingGate = currentTrack.gates.find((gate) => Math.hypot(gate.x - x, gate.y - y) <= gate.r + 8) || null;
});

window.addEventListener('mousemove', (event) => {
  if (!game.editorMode || !draggingGate) return;

  const rect = canvas.getBoundingClientRect();
  draggingGate.x = ((event.clientX - rect.left) / rect.width) * canvas.width;
  draggingGate.y = ((event.clientY - rect.top) / rect.height) * canvas.height;
  draw();
});

window.addEventListener('mouseup', () => {
  if (draggingGate) {
    setStatus('Ворота перемещены. Не забудьте сохранить трассу.');
  }
  draggingGate = null;
});

startBtn.addEventListener('click', () => {
  game.running = true;
  game.editorMode = false;
  game.activeGate = 0;
  game.lapStartedAt = null;
  setStatus(`Полет начат. Цель: ворота 1/${currentTrack.gates.length}.`);
});

resetBtn.addEventListener('click', () => {
  game.running = false;
  resetDrone();
  setStatus('Позиция коптера сброшена.');
});

newTrackBtn.addEventListener('click', () => {
  game.running = false;
  game.editorMode = true;
  currentTrack = {
    name: 'Новая трасса',
    gates: [],
  };
  trackNameInput.value = currentTrack.name;
  resetDrone();
  draw();
  setStatus('Режим редактора включен. Кликайте по полю для добавления ворот.');
});

saveTrackBtn.addEventListener('click', () => {
  if (!currentTrack.gates.length) {
    setStatus('Добавьте хотя бы одни ворота перед сохранением.');
    return;
  }

  const name = trackNameInput.value.trim() || `Трасса ${savedTracks.length + 1}`;
  currentTrack.name = name;

  const index = savedTracks.findIndex((track) => track.name === name);
  if (index >= 0) {
    savedTracks[index] = structuredClone(currentTrack);
  } else {
    savedTracks.push(structuredClone(currentTrack));
  }

  saveTracks();
  refreshTrackList();
  trackList.value = String(Math.max(0, savedTracks.findIndex((track) => track.name === name)));

  game.editorMode = false;
  setStatus(`Трасса «${name}» сохранена.`);
});

trackList.addEventListener('change', (event) => {
  const index = Number(event.target.value);
  game.editorMode = false;
  game.running = false;
  loadTrack(index);
});

refreshTrackList();
trackList.value = '0';
loadTrack(0);
update();
