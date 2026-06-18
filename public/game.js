/* =========================================================================
   GUSANOS ONLINE — Cliente
   Renderiza el estado que envía el servidor. No simula físicas.
   ========================================================================= */

const socket = io();

const WORLD_W = 1600;
const WORLD_H = 700;

/* Paleta por personaje */
const SKINS = {
  antonio: { body: '#5ec24b', dark: '#3f9133', name: 'Antonio' },
  kun:     { body: '#4aa3ff', dark: '#2f6fc4', name: 'Kun' },
  dani:    { body: '#ff9f43', dark: '#cc7a25', name: 'Dani' },
  vinny:   { body: '#b58bff', dark: '#8159d6', name: 'Vinny' },
};

/* ---------------- Terreno determinista (idéntico al servidor) ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function buildHeightmap(seed) {
  const rnd = mulberry32(seed);
  const base = WORLD_H * 0.62;
  const layers = [];
  for (let i = 0; i < 4; i++) {
    layers.push({
      amp: (18 + rnd() * 70) / (i + 1),
      freq: (0.6 + rnd() * 2.2) * (i + 1) / WORLD_W * Math.PI * 2,
      phase: rnd() * Math.PI * 2,
    });
  }
  const h = new Float32Array(WORLD_W);
  for (let x = 0; x < WORLD_W; x++) {
    let y = base;
    for (const l of layers) y += Math.sin(x * l.freq + l.phase) * l.amp;
    const edge = Math.min(x, WORLD_W - x) / 220;
    if (edge < 1) y -= (1 - edge) * 60;
    h[x] = Math.max(120, Math.min(WORLD_H - 40, y));
  }
  return h;
}

/* ---------------- Dibujo de un gusano (reutilizable) ------------------- */
function drawWorm(ctx, char, cx, cy, r, facing) {
  const skin = SKINS[char] || SKINS.antonio;
  ctx.save();
  ctx.translate(cx, cy);
  if (facing < 0) ctx.scale(-1, 1);

  // cuerpo (cápsula)
  ctx.fillStyle = skin.dark;
  ctx.beginPath(); ctx.ellipse(0, r * 0.55, r * 0.9, r * 0.7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = skin.body;
  ctx.beginPath(); ctx.ellipse(0, 0, r, r * 1.05, 0, 0, Math.PI * 2); ctx.fill();
  // brillo
  ctx.fillStyle = 'rgba(255,255,255,.25)';
  ctx.beginPath(); ctx.ellipse(-r * 0.3, -r * 0.4, r * 0.35, r * 0.45, 0, 0, Math.PI * 2); ctx.fill();

  // ojos
  const eyeY = -r * 0.15, eyeX = r * 0.32, er = r * 0.22;
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(eyeX - r * 0.35, eyeY, er, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(eyeX + r * 0.05, eyeY, er, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#14233b';
  const look = r * 0.07;
  ctx.beginPath(); ctx.arc(eyeX - r * 0.35 + look, eyeY, er * 0.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(eyeX + r * 0.05 + look, eyeY, er * 0.5, 0, Math.PI * 2); ctx.fill();

  // rasgos distintivos
  if (char === 'kun') {
    // gafas
    ctx.strokeStyle = '#14233b'; ctx.lineWidth = r * 0.12;
    ctx.beginPath(); ctx.arc(eyeX - r * 0.35, eyeY, er * 1.25, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(eyeX + r * 0.05, eyeY, er * 1.25, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(eyeX - r * 0.13, eyeY); ctx.lineTo(eyeX - r * 0.18, eyeY); ctx.stroke();
  }
  if (char === 'dani') {
    // barba
    ctx.fillStyle = '#5a3d1e';
    ctx.beginPath();
    ctx.moveTo(-r * 0.55, r * 0.15);
    ctx.quadraticCurveTo(0, r * 1.15, r * 0.7, r * 0.15);
    ctx.quadraticCurveTo(r * 0.4, r * 0.55, 0, r * 0.6);
    ctx.quadraticCurveTo(-r * 0.4, r * 0.55, -r * 0.55, r * 0.15);
    ctx.fill();
  }
  if (char === 'antonio') {
    // calvo: brillo extra en la coronilla
    ctx.fillStyle = 'rgba(255,255,255,.4)';
    ctx.beginPath(); ctx.ellipse(-r * 0.1, -r * 0.7, r * 0.3, r * 0.16, -0.3, 0, Math.PI * 2); ctx.fill();
  }
  if (char === 'vinny') {
    // caparazón de caracol + cara dormilona
    ctx.fillStyle = '#7a5cc0';
    ctx.beginPath(); ctx.arc(-r * 0.75, -r * 0.1, r * 0.55, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#4f3a85'; ctx.lineWidth = r * 0.1;
    ctx.beginPath(); ctx.arc(-r * 0.75, -r * 0.1, r * 0.3, 0, Math.PI * 1.6); ctx.stroke();
    // "zzz"
    ctx.fillStyle = '#14233b'; ctx.font = `bold ${r * 0.5}px Trebuchet MS`;
    ctx.fillText('z', r * 0.7, -r * 0.6);
  }
  ctx.restore();
}

/* Renderiza un gusano en una mini-card del lobby */
function paintPreview(canvas, char) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawWorm(ctx, char, canvas.width / 2, canvas.height / 2 + 6, 34, 1);
}

/* ============================ LOBBY UI ================================= */
const $ = (id) => document.getElementById(id);
const lobbyEl = $('lobby'), gameEl = $('game');
let myId = null, myChar = null, hostId = null, myRoom = null;
let selectedChar = 'antonio';

document.querySelectorAll('.char').forEach(btn => {
  paintPreview(btn.querySelector('canvas'), btn.dataset.char);
  btn.addEventListener('click', () => {
    if (btn.classList.contains('taken')) return;
    selectedChar = btn.dataset.char;
    document.querySelectorAll('.char').forEach(b => b.classList.toggle('selected', b === btn));
    if (myRoom) socket.emit('pickCharacter', { character: selectedChar });
  });
});
document.querySelector('.char[data-char="antonio"]').classList.add('selected');

$('joinBtn').addEventListener('click', () => {
  const name = $('nameInput').value.trim() || 'Jugador';
  const room = $('roomInput').value.trim() || 'sala1';
  socket.emit('joinRoom', { room, name, character: selectedChar });
});

$('startBtn').addEventListener('click', () => socket.emit('startGame'));
$('againBtn').addEventListener('click', () => location.reload());

socket.on('joined', ({ id, character }) => {
  myId = id; myChar = character; selectedChar = character; myRoom = $('roomInput').value.trim() || 'sala1';
  $('joinBtn').classList.add('hidden');
  $('lobbyWait').classList.remove('hidden');
  $('errorMsg').textContent = '';
});

socket.on('errorMsg', ({ msg }) => { $('errorMsg').textContent = msg; });

socket.on('lobby', (data) => {
  hostId = data.hostId;
  $('roomName').textContent = data.room;
  // marcar personajes cogidos por otros
  const takenByOthers = new Set(
    data.players.filter(p => p.id !== myId).map(p => p.character)
  );
  document.querySelectorAll('.char').forEach(b => {
    b.classList.toggle('taken', takenByOthers.has(b.dataset.char));
    b.classList.toggle('selected', b.dataset.char === myChar);
  });

  const list = $('playerList'); list.innerHTML = '';
  data.players.forEach(p => {
    const li = document.createElement('li');
    const cv = document.createElement('canvas'); cv.width = 60; cv.height = 60;
    paintPreview(cv, p.character);
    const nm = document.createElement('span'); nm.className = 'pname';
    nm.textContent = p.name + (p.id === myId ? ' (tú)' : '');
    li.appendChild(cv); li.appendChild(nm);
    if (p.id === data.hostId) {
      const tag = document.createElement('span'); tag.className = 'host-tag'; tag.textContent = 'ANFITRIÓN';
      li.appendChild(tag);
    }
    list.appendChild(li);
  });

  const enough = data.players.length >= 2;
  if (myId === hostId) {
    $('startBtn').classList.toggle('hidden', !enough);
    $('hostHint').classList.add('hidden');
  } else {
    $('startBtn').classList.add('hidden');
    $('hostHint').classList.remove('hidden');
  }
});

/* ============================ JUEGO =================================== */
const board = $('board');
const bctx = board.getContext('2d');
board.width = WORLD_W; board.height = WORLD_H;

let terrainCanvas = null, tctx = null;
let game = null;            // estado actual (snapshot)
let mouse = { x: WORLD_W / 2, y: WORLD_H / 2 };
let charging = false, power = 0;
let lastAngleSent = 0, lastAngleTime = 0;

function buildTerrainCanvas(seed) {
  terrainCanvas = document.createElement('canvas');
  terrainCanvas.width = WORLD_W; terrainCanvas.height = WORLD_H;
  tctx = terrainCanvas.getContext('2d');
  const h = buildHeightmap(seed);

  // tierra con degradado
  const grad = tctx.createLinearGradient(0, 0, 0, WORLD_H);
  grad.addColorStop(0, '#8a5a2b');
  grad.addColorStop(0.4, '#6e441f');
  grad.addColorStop(1, '#4a2c14');

  // recortar a la silueta
  tctx.beginPath();
  tctx.moveTo(0, WORLD_H);
  for (let x = 0; x < WORLD_W; x++) tctx.lineTo(x, h[x]);
  tctx.lineTo(WORLD_W, WORLD_H);
  tctx.closePath();
  tctx.fillStyle = grad; tctx.fill();

  // césped encima
  tctx.save();
  tctx.beginPath();
  tctx.moveTo(0, WORLD_H);
  for (let x = 0; x < WORLD_W; x++) tctx.lineTo(x, h[x]);
  tctx.lineTo(WORLD_W, WORLD_H);
  tctx.closePath();
  tctx.clip();
  tctx.strokeStyle = '#5ec24b'; tctx.lineWidth = 10;
  tctx.beginPath();
  for (let x = 0; x < WORLD_W; x++) (x === 0 ? tctx.moveTo(x, h[x]) : tctx.lineTo(x, h[x]));
  tctx.stroke();
  tctx.restore();
}

function carveTerrain(x, y, r) {
  if (!tctx) return;
  tctx.save();
  tctx.globalCompositeOperation = 'destination-out';
  tctx.beginPath(); tctx.arc(x, y, r, 0, Math.PI * 2); tctx.fill();
  tctx.restore();
  // borde quemado
  tctx.save();
  tctx.globalCompositeOperation = 'source-atop';
  tctx.strokeStyle = 'rgba(20,10,5,.6)'; tctx.lineWidth = 6;
  tctx.beginPath(); tctx.arc(x, y, r + 2, 0, Math.PI * 2); tctx.stroke();
  tctx.restore();
}

socket.on('gameStart', (data) => {
  lobbyEl.classList.add('hidden');
  gameEl.classList.remove('hidden');
  buildTerrainCanvas(data.seed);
  game = { worms: data.worms, projectile: null, wind: 0, turnId: null, phase: 'aim', timeLeft: 30 };
});

socket.on('state', (s) => { game = s; updateHud(); });

socket.on('boom', ({ x, y, r }) => {
  carveTerrain(x, y, r);
  explosions.push({ x, y, r, t: 0 });
});

socket.on('gameOver', ({ winner }) => {
  $('overlay').classList.remove('hidden');
  $('overlayTitle').textContent = winner ? '¡Victoria!' : 'Empate';
  $('overlaySub').textContent = winner
    ? `${winner.name} (${SKINS[winner.char].name}) es el último gusano en pie 🏆`
    : 'No queda nadie en pie…';
});

/* ----------------------------- HUD ------------------------------------ */
function updateHud() {
  if (!game) return;
  const turnWorm = game.worms.find(w => w.id === game.turnId);
  const isMine = game.turnId === myId;
  $('turnLabel').textContent = turnWorm
    ? (isMine ? '👉 ¡TU TURNO!' : `Turno de ${turnWorm.name} (${SKINS[turnWorm.char].name})`)
    : '—';
  $('turnLabel').style.color = isMine ? '#ffce3a' : '#eaf2ff';
  $('timer').textContent = game.timeLeft ?? '–';

  const w = Math.min(1, Math.abs(game.wind));
  const fill = $('windFill');
  fill.style.width = (w * 70) + 'px';
  if (game.wind >= 0) { fill.style.left = '50%'; fill.style.right = 'auto'; }
  else { fill.style.right = '50%'; fill.style.left = 'auto'; }
  $('windVal').textContent = (game.wind >= 0 ? '→ ' : '← ') + Math.abs(game.wind).toFixed(1);
}

/* --------------------------- Render loop ------------------------------ */
const explosions = [];
function render() {
  bctx.clearRect(0, 0, WORLD_W, WORLD_H);

  // cielo con nubes simples
  const sky = bctx.createLinearGradient(0, 0, 0, WORLD_H);
  sky.addColorStop(0, '#6ec6ff'); sky.addColorStop(1, '#bce9ff');
  bctx.fillStyle = sky; bctx.fillRect(0, 0, WORLD_W, WORLD_H);
  drawClouds();

  // agua al fondo
  bctx.fillStyle = 'rgba(40,120,200,.35)';
  bctx.fillRect(0, WORLD_H - 18, WORLD_W, 18);

  if (terrainCanvas) bctx.drawImage(terrainCanvas, 0, 0);

  if (game) {
    // gusanos
    for (const w of game.worms) {
      if (!w.alive) { drawTombstone(w.x, w.y); continue; }
      const isTurn = w.id === game.turnId;
      if (isTurn) {
        bctx.save();
        bctx.shadowColor = '#ffce3a'; bctx.shadowBlur = 22;
        bctx.beginPath(); bctx.arc(w.x, w.y, 18, 0, Math.PI * 2);
        bctx.strokeStyle = 'rgba(255,206,58,.9)'; bctx.lineWidth = 3; bctx.stroke();
        bctx.restore();
        // flecha indicadora
        const bob = Math.sin(Date.now() / 200) * 4;
        bctx.fillStyle = '#ffce3a';
        bctx.beginPath();
        bctx.moveTo(w.x, w.y - 34 + bob);
        bctx.lineTo(w.x - 8, w.y - 46 + bob);
        bctx.lineTo(w.x + 8, w.y - 46 + bob);
        bctx.fill();
      }
      drawWorm(bctx, w.char, w.x, w.y, 13, w.facing || 1);
      drawHealthBar(w);
    }

    // mira del jugador en turno (la del propio, calculada con el ratón)
    const turnWorm = game.worms.find(w => w.id === game.turnId && w.alive);
    if (turnWorm && game.phase === 'aim') {
      let ang = turnWorm.angle;
      if (game.turnId === myId) ang = Math.atan2(mouse.y - turnWorm.y, mouse.x - turnWorm.x);
      drawAim(turnWorm.x, turnWorm.y, ang);
    }

    // proyectil
    if (game.projectile) {
      bctx.fillStyle = '#222';
      bctx.beginPath(); bctx.arc(game.projectile.x, game.projectile.y, 5, 0, Math.PI * 2); bctx.fill();
      bctx.fillStyle = '#ff5d6c';
      bctx.beginPath(); bctx.arc(game.projectile.x, game.projectile.y, 2.5, 0, Math.PI * 2); bctx.fill();
    }
  }

  // explosiones (fx)
  for (let i = explosions.length - 1; i >= 0; i--) {
    const e = explosions[i]; e.t += 1;
    const p = e.t / 18;
    if (p >= 1) { explosions.splice(i, 1); continue; }
    bctx.save();
    bctx.globalAlpha = 1 - p;
    bctx.fillStyle = '#ffd95a';
    bctx.beginPath(); bctx.arc(e.x, e.y, e.r * (0.5 + p), 0, Math.PI * 2); bctx.fill();
    bctx.fillStyle = '#ff5d6c';
    bctx.beginPath(); bctx.arc(e.x, e.y, e.r * (0.3 + p * 0.6), 0, Math.PI * 2); bctx.fill();
    bctx.restore();
  }

  // barra de potencia
  if (charging && game && game.turnId === myId && game.phase === 'aim') {
    power = Math.min(100, power + 1.6);
    $('powerWrap').classList.remove('hidden');
    $('powerFill').style.width = power + '%';
  } else if (!charging) {
    $('powerWrap').classList.add('hidden');
  }

  requestAnimationFrame(render);
}

let clouds = [];
function drawClouds() {
  if (clouds.length === 0)
    for (let i = 0; i < 6; i++)
      clouds.push({ x: Math.random() * WORLD_W, y: 40 + Math.random() * 140, s: 0.2 + Math.random() * 0.3, w: 60 + Math.random() * 70 });
  bctx.fillStyle = 'rgba(255,255,255,.8)';
  for (const c of clouds) {
    c.x += c.s; if (c.x > WORLD_W + c.w) c.x = -c.w;
    bctx.beginPath();
    bctx.arc(c.x, c.y, c.w * 0.4, 0, Math.PI * 2);
    bctx.arc(c.x + c.w * 0.4, c.y + 6, c.w * 0.3, 0, Math.PI * 2);
    bctx.arc(c.x - c.w * 0.4, c.y + 8, c.w * 0.28, 0, Math.PI * 2);
    bctx.fill();
  }
}

function drawHealthBar(w) {
  const bw = 38, bh = 6, x = w.x - bw / 2, y = w.y - 28;
  bctx.fillStyle = 'rgba(0,0,0,.5)'; bctx.fillRect(x - 1, y - 1, bw + 2, bh + 2);
  const pct = Math.max(0, w.hp) / 100;
  bctx.fillStyle = pct > 0.5 ? '#5ec24b' : pct > 0.25 ? '#ffce3a' : '#ff5d6c';
  bctx.fillRect(x, y, bw * pct, bh);
  bctx.fillStyle = '#fff'; bctx.font = 'bold 11px Trebuchet MS'; bctx.textAlign = 'center';
  bctx.fillText(w.name, w.x, y - 4);
  bctx.textAlign = 'left';
}

function drawAim(x, y, ang) {
  bctx.save();
  bctx.strokeStyle = 'rgba(255,255,255,.55)';
  bctx.setLineDash([6, 8]); bctx.lineWidth = 2;
  bctx.beginPath(); bctx.moveTo(x, y);
  bctx.lineTo(x + Math.cos(ang) * 70, y + Math.sin(ang) * 70);
  bctx.stroke();
  bctx.setLineDash([]);
  const cx = x + Math.cos(ang) * 70, cy = y + Math.sin(ang) * 70;
  bctx.strokeStyle = '#ff5d6c'; bctx.lineWidth = 2.5;
  bctx.beginPath(); bctx.arc(cx, cy, 7, 0, Math.PI * 2); bctx.stroke();
  bctx.restore();
}

function drawTombstone(x, y) {
  bctx.save();
  bctx.fillStyle = '#9aa6b8';
  bctx.beginPath();
  bctx.moveTo(x - 9, y + 13);
  bctx.lineTo(x - 9, y - 4);
  bctx.arc(x, y - 4, 9, Math.PI, 0);
  bctx.lineTo(x + 9, y + 13);
  bctx.closePath(); bctx.fill();
  bctx.fillStyle = '#5a6678'; bctx.font = 'bold 11px Trebuchet MS'; bctx.textAlign = 'center';
  bctx.fillText('RIP', x, y + 2);
  bctx.textAlign = 'left';
  bctx.restore();
}

render();

/* --------------------------- Controles -------------------------------- */
function worldFromEvent(e) {
  const rect = board.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / rect.width * WORLD_W,
    y: (e.clientY - rect.top) / rect.height * WORLD_H,
  };
}

board.addEventListener('mousemove', (e) => {
  mouse = worldFromEvent(e);
  maybeSendAngle();
});
board.addEventListener('touchmove', (e) => {
  if (e.touches[0]) { mouse = worldFromEvent(e.touches[0]); maybeSendAngle(); }
}, { passive: true });

function maybeSendAngle() {
  if (!game || game.turnId !== myId) return;
  const w = game.worms.find(x => x.id === myId && x.alive);
  if (!w) return;
  const ang = Math.atan2(mouse.y - w.y, mouse.x - w.x);
  const now = Date.now();
  if (Math.abs(ang - lastAngleSent) > 0.02 && now - lastAngleTime > 40) {
    socket.emit('input', { angle: ang });
    lastAngleSent = ang; lastAngleTime = now;
  }
}

const keys = {};
document.addEventListener('keydown', (e) => {
  if (gameEl.classList.contains('hidden')) return;
  const k = e.key.toLowerCase();
  if ([' ', 'arrowleft', 'arrowright', 'arrowup'].includes(k)) e.preventDefault();
  if (keys[k]) return; keys[k] = true;

  const mine = game && game.turnId === myId && game.phase === 'aim';
  if (!mine) return;

  if (k === 'a' || k === 'arrowleft') socket.emit('input', { left: true });
  if (k === 'd' || k === 'arrowright') socket.emit('input', { right: true });
  if (k === 'w' || k === 'arrowup') socket.emit('input', { jump: true });
  if (k === ' ') { charging = true; power = 0; }
});

document.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  keys[k] = false;
  if (k === 'a' || k === 'arrowleft') socket.emit('input', { left: false });
  if (k === 'd' || k === 'arrowright') socket.emit('input', { right: false });
  if (k === ' ' && charging) {
    charging = false;
    const p = 2 + (power / 100) * 13;   // mapear 0-100 a 2-15
    socket.emit('fire', { power: p });
    power = 0;
    $('powerWrap').classList.add('hidden');
  }
});

/* Disparo táctil: toque largo en el board carga, soltar dispara */
let touchTimer = null;
board.addEventListener('touchstart', (e) => {
  if (!(game && game.turnId === myId && game.phase === 'aim')) return;
  if (e.touches[0]) mouse = worldFromEvent(e.touches[0]);
  charging = true; power = 0;
}, { passive: true });
board.addEventListener('touchend', () => {
  if (charging) {
    charging = false;
    const p = 2 + (power / 100) * 13;
    socket.emit('fire', { power: p });
    power = 0;
    $('powerWrap').classList.add('hidden');
  }
});
