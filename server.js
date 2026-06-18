/* =========================================================================
   GUSANOS ONLINE — Servidor autoritativo
   Express + Socket.io. El servidor simula toda la física y reparte
   snapshots a 30 Hz. Los clientes solo envían inputs y renderizan.
   ========================================================================= */

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

/* ----------------------------- Constantes ------------------------------ */
const WORLD_W = 1600;
const WORLD_H = 700;
const TICK_MS = 33;                 // ~30 Hz
const GRAVITY = 0.35;
const WORM_R = 13;
const MOVE_SPEED = 2.3;
const VINNY_SPEED = 1.15;           // Vinny es "muy lento"
const JUMP_VY = -7.2;
const MAX_STEP = 16;                // altura de escalón que puede trepar
const PROJ_R = 3;
const EXPLOSION_R = 48;
const MAX_DMG = 52;
const TURN_TIME = 30;               // segundos por turno
const SETTLE_TIME = 1200;           // ms de "asentamiento" tras explosión
const MAX_POWER = 15;               // velocidad máxima del disparo

const CHARACTERS = ['antonio', 'kun', 'dani', 'vinny'];

/* --------------------------- Terreno (PRNG) ---------------------------- */
// Determinista: cliente y servidor generan la MISMA silueta con la semilla.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Altura del suelo por columna (y donde empieza lo sólido).
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
    // bordes un poco más altos para que no se caigan al instante
    const edge = Math.min(x, WORLD_W - x) / 220;
    if (edge < 1) y -= (1 - edge) * 60;
    h[x] = Math.max(120, Math.min(WORLD_H - 40, y));
  }
  return h;
}

/* ------------------------------- Rooms --------------------------------- */
const rooms = new Map();

function makeRoom(id) {
  return {
    id,
    hostId: null,
    players: new Map(),     // socketId -> {id,name,character,ready}
    state: 'lobby',         // lobby | playing | over
    seed: 0,
    terrain: null,          // Uint8Array máscara de colisión (1 = sólido)
    worms: [],              // gusanos en juego
    order: [],              // orden de turnos (socketIds)
    turnIdx: 0,
    phase: 'aim',           // aim | projectile | settle
    wind: 0,
    projectile: null,
    turnEndsAt: 0,
    settleUntil: 0,
    loop: null,
    inputs: new Map(),      // socketId -> {left,right,jump,angle}
  };
}

function getRoom(id) {
  if (!rooms.has(id)) rooms.set(id, makeRoom(id));
  return rooms.get(id);
}

/* --------------------------- Máscara terreno --------------------------- */
function buildTerrainMask(seed) {
  const h = buildHeightmap(seed);
  const mask = new Uint8Array(WORLD_W * WORLD_H);
  for (let x = 0; x < WORLD_W; x++) {
    const top = Math.floor(h[x]);
    for (let y = top; y < WORLD_H; y++) mask[y * WORLD_W + x] = 1;
  }
  return mask;
}

function solidAt(room, x, y) {
  x = x | 0; y = y | 0;
  if (x < 0 || x >= WORLD_W || y < 0 || y >= WORLD_H) return false;
  return room.terrain[y * WORLD_W + x] === 1;
}

function carveCrater(room, cx, cy, r) {
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(WORLD_W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(WORLD_H - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r2) room.terrain[y * WORLD_W + x] = 0;
    }
  }
}

/* ------------------------------ Lobby ---------------------------------- */
function lobbyPayload(room) {
  return {
    room: room.id,
    hostId: room.hostId,
    state: room.state,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, character: p.character,
    })),
    taken: [...room.players.values()].map(p => p.character).filter(Boolean),
  };
}

function broadcastLobby(room) {
  io.to(room.id).emit('lobby', lobbyPayload(room));
}

/* --------------------------- Inicio de partida ------------------------- */
function startGame(room) {
  const players = [...room.players.values()].filter(p => p.character);
  if (players.length < 2) return;

  room.seed = (Math.random() * 1e9) | 0;
  room.terrain = buildTerrainMask(room.seed);
  room.state = 'playing';
  room.worms = [];
  room.order = [];

  // posiciones iniciales repartidas en X
  const slots = players.length;
  players.forEach((p, i) => {
    const x = Math.floor(WORLD_W * (i + 1) / (slots + 1));
    let y = 100;
    // dejar caer hasta encontrar suelo
    while (y < WORLD_H && !solidAt(room, x, y + WORM_R + 1)) y += 2;
    room.worms.push({
      id: p.id, name: p.name, char: p.character,
      x, y: y - WORM_R, vx: 0, vy: 0,
      hp: 100, alive: true, facing: 1, angle: -Math.PI / 4, onGround: false,
    });
    room.order.push(p.id);
  });

  room.turnIdx = 0;
  room.phase = 'aim';
  newWind(room);
  room.turnEndsAt = Date.now() + TURN_TIME * 1000;

  io.to(room.id).emit('gameStart', {
    seed: room.seed, width: WORLD_W, height: WORLD_H,
    worms: room.worms.map(serializeWorm),
  });

  if (room.loop) clearInterval(room.loop);
  room.loop = setInterval(() => tick(room), TICK_MS);
}

function newWind(room) {
  room.wind = Math.round((Math.random() * 2 - 1) * 100) / 100;
}

function currentTurnId(room) {
  return room.order[room.turnIdx];
}

function aliveWorms(room) {
  return room.worms.filter(w => w.alive);
}

/* ----------------------------- Turnos ---------------------------------- */
function nextTurn(room) {
  const alive = aliveWorms(room);
  if (alive.length <= 1) {
    room.state = 'over';
    if (room.loop) { clearInterval(room.loop); room.loop = null; }
    io.to(room.id).emit('gameOver', {
      winner: alive[0] ? { name: alive[0].name, char: alive[0].char } : null,
    });
    return;
  }
  // avanzar al siguiente jugador vivo
  let guard = 0;
  do {
    room.turnIdx = (room.turnIdx + 1) % room.order.length;
    guard++;
  } while (!room.worms.find(w => w.id === currentTurnId(room) && w.alive) && guard < 50);

  room.phase = 'aim';
  room.projectile = null;
  newWind(room);
  room.turnEndsAt = Date.now() + TURN_TIME * 1000;
}

/* ------------------------ Física de un gusano -------------------------- */
function moveWormHorizontal(room, w, dir) {
  const speed = w.char === 'vinny' ? VINNY_SPEED : MOVE_SPEED;
  const nx = w.x + dir * speed;
  // comprobar columna en la nueva X a la altura de los pies
  const feetY = w.y + WORM_R;
  // buscar la superficie cercana en nx
  let targetY = w.y;
  let blocked = false;
  if (solidAt(room, nx, feetY)) {
    // hay subida: intentar trepar hasta MAX_STEP
    let climbed = 0;
    while (climbed <= MAX_STEP && solidAt(room, nx, feetY - climbed)) climbed++;
    if (climbed <= MAX_STEP) targetY = w.y - climbed;
    else blocked = true;
  } else {
    // bajada o plano: mantener
    targetY = w.y;
  }
  if (!blocked && nx > WORM_R && nx < WORLD_W - WORM_R) {
    w.x = nx;
    w.y = targetY;
  }
  w.facing = dir;
}

function applyWormPhysics(room, w) {
  if (!w.alive) return;
  // gravedad si no hay suelo justo debajo
  const groundBelow = solidAt(room, w.x, w.y + WORM_R + 1);
  if (!groundBelow) {
    w.vy += GRAVITY;
    w.y += w.vy;
    w.onGround = false;
    // colisión al caer
    while (solidAt(room, w.x, w.y + WORM_R)) { w.y -= 1; w.vy = 0; w.onGround = true; }
  } else {
    if (w.vy > 0) w.vy = 0;
    w.onGround = true;
    // asentar sobre la superficie
    let s = 0;
    while (solidAt(room, w.x, w.y + WORM_R) && s < WORM_R) { w.y -= 1; s++; }
  }
  // knockback horizontal residual
  if (Math.abs(w.vx) > 0.05) {
    const nx = w.x + w.vx;
    if (nx > WORM_R && nx < WORLD_W - WORM_R && !solidAt(room, nx, w.y)) w.x = nx;
    w.vx *= 0.85;
  } else w.vx = 0;
  // caída al vacío
  if (w.y > WORLD_H + 40) { w.alive = false; w.hp = 0; }
}

/* ---------------------------- Disparo ---------------------------------- */
function fire(room, power) {
  const w = room.worms.find(x => x.id === currentTurnId(room));
  if (!w || !w.alive || room.phase !== 'aim') return;
  const p = Math.max(2, Math.min(MAX_POWER, power));
  room.projectile = {
    x: w.x + Math.cos(w.angle) * (WORM_R + 6),
    y: w.y + Math.sin(w.angle) * (WORM_R + 6),
    vx: Math.cos(w.angle) * p,
    vy: Math.sin(w.angle) * p,
    owner: w.id,
  };
  room.phase = 'projectile';
}

function explode(room, x, y) {
  carveCrater(room, x, y, EXPLOSION_R);
  io.to(room.id).emit('boom', { x, y, r: EXPLOSION_R });
  // daño + empuje
  for (const w of room.worms) {
    if (!w.alive) continue;
    const dx = w.x - x, dy = w.y - y;
    const dist = Math.hypot(dx, dy);
    if (dist < EXPLOSION_R + WORM_R) {
      const t = Math.max(0, 1 - dist / (EXPLOSION_R + WORM_R));
      w.hp -= Math.round(MAX_DMG * t);
      const push = 9 * t;
      const nrm = dist || 1;
      w.vx += (dx / nrm) * push;
      w.vy += (dy / nrm) * push - push * 0.4;
      if (w.hp <= 0) { w.hp = 0; w.alive = false; }
    }
  }
  room.projectile = null;
  room.phase = 'settle';
  room.settleUntil = Date.now() + SETTLE_TIME;
}

function stepProjectile(room) {
  const pr = room.projectile;
  if (!pr) return;
  const steps = 3; // sub-pasos para no atravesar terreno
  for (let i = 0; i < steps; i++) {
    pr.vy += GRAVITY / steps;
    pr.vx += room.wind * 0.03 / steps;
    pr.x += pr.vx / steps;
    pr.y += pr.vy / steps;

    if (pr.x < 0 || pr.x > WORLD_W || pr.y > WORLD_H) {
      // se perdió fuera del mundo
      room.projectile = null;
      room.phase = 'settle';
      room.settleUntil = Date.now() + 400;
      return;
    }
    if (solidAt(room, pr.x, pr.y)) { explode(room, pr.x, pr.y); return; }
    for (const w of room.worms) {
      if (!w.alive || w.id === pr.owner) continue;
      if (Math.hypot(w.x - pr.x, w.y - pr.y) < WORM_R + PROJ_R) {
        explode(room, pr.x, pr.y); return;
      }
      // permitir auto-impacto solo tras alejarse un poco
    }
    // auto-impacto del que dispara (si se le cae encima)
    const ow = room.worms.find(w => w.id === pr.owner && w.alive);
    if (ow && Math.hypot(ow.x - pr.x, ow.y - pr.y) < WORM_R + PROJ_R &&
        Math.hypot(pr.vx, pr.vy) > 1.5) {
      explode(room, pr.x, pr.y); return;
    }
  }
}

/* ------------------------------ Loop ----------------------------------- */
function tick(room) {
  if (room.state !== 'playing') return;
  const now = Date.now();

  // aplicar input del jugador en turno
  if (room.phase === 'aim') {
    const turnId = currentTurnId(room);
    const w = room.worms.find(x => x.id === turnId && x.alive);
    const inp = room.inputs.get(turnId);
    if (w && inp) {
      if (typeof inp.angle === 'number') w.angle = inp.angle;
      if (inp.left && !inp.right) moveWormHorizontal(room, w, -1);
      else if (inp.right && !inp.left) moveWormHorizontal(room, w, 1);
      if (inp.jump && w.onGround) { w.vy = JUMP_VY; w.onGround = false; inp.jump = false; }
    }
    if (now > room.turnEndsAt) nextTurn(room);
  }

  if (room.phase === 'projectile') stepProjectile(room);

  // física de todos los gusanos
  for (const w of room.worms) applyWormPhysics(room, w);

  if (room.phase === 'settle' && now > room.settleUntil) {
    // esperar a que los gusanos toquen suelo antes de pasar turno
    const moving = aliveWorms(room).some(w => !w.onGround || Math.abs(w.vy) > 0.5);
    if (!moving) nextTurn(room);
  }

  // comprobar fin por muertes durante asentamiento
  if (room.state === 'playing' && aliveWorms(room).length <= 1 && room.phase !== 'aim') {
    nextTurn(room);
  }

  io.to(room.id).emit('state', snapshot(room));
}

/* --------------------------- Serialización ----------------------------- */
function serializeWorm(w) {
  return {
    id: w.id, name: w.name, char: w.char,
    x: Math.round(w.x), y: Math.round(w.y),
    hp: w.hp, alive: w.alive, facing: w.facing,
    angle: Math.round(w.angle * 100) / 100,
  };
}

function snapshot(room) {
  return {
    worms: room.worms.map(serializeWorm),
    projectile: room.projectile
      ? { x: Math.round(room.projectile.x), y: Math.round(room.projectile.y) }
      : null,
    wind: room.wind,
    turnId: currentTurnId(room),
    phase: room.phase,
    timeLeft: Math.max(0, Math.ceil((room.turnEndsAt - Date.now()) / 1000)),
  };
}

/* ----------------------------- Sockets --------------------------------- */
io.on('connection', (socket) => {

  socket.on('joinRoom', ({ room, name, character }) => {
    room = String(room || 'sala1').trim().toLowerCase().slice(0, 20) || 'sala1';
    name = String(name || 'Jugador').trim().slice(0, 14) || 'Jugador';
    const r = getRoom(room);

    if (r.state !== 'lobby') {
      socket.emit('errorMsg', { msg: 'La partida ya ha empezado en esa sala.' });
      return;
    }
    if (r.players.size >= 4 && !r.players.has(socket.id)) {
      socket.emit('errorMsg', { msg: 'La sala está llena (4 jugadores).' });
      return;
    }
    // personaje único por sala
    let chosen = CHARACTERS.includes(character) ? character : null;
    const taken = new Set([...r.players.values()].map(p => p.character).filter(Boolean));
    if (chosen && taken.has(chosen)) chosen = null;
    if (!chosen) chosen = CHARACTERS.find(c => !taken.has(c)) || null;
    if (!chosen) { socket.emit('errorMsg', { msg: 'No hay personajes libres.' }); return; }

    socket.join(room);
    socket.data.room = room;
    r.players.set(socket.id, { id: socket.id, name, character: chosen });
    r.inputs.set(socket.id, { left: false, right: false, jump: false, angle: -0.78 });
    if (!r.hostId) r.hostId = socket.id;

    socket.emit('joined', { id: socket.id, character: chosen });
    broadcastLobby(r);
  });

  socket.on('pickCharacter', ({ character }) => {
    const room = socket.data.room; if (!room) return;
    const r = getRoom(room);
    if (r.state !== 'lobby') return;
    const me = r.players.get(socket.id); if (!me) return;
    if (!CHARACTERS.includes(character)) return;
    const taken = new Set([...r.players.values()]
      .filter(p => p.id !== socket.id).map(p => p.character));
    if (taken.has(character)) {
      socket.emit('errorMsg', { msg: 'Ese personaje ya está cogido.' });
      return;
    }
    me.character = character;
    broadcastLobby(r);
  });

  socket.on('startGame', () => {
    const room = socket.data.room; if (!room) return;
    const r = getRoom(room);
    if (socket.id !== r.hostId) return;
    if (r.state !== 'lobby') return;
    const ready = [...r.players.values()].filter(p => p.character).length;
    if (ready < 2) { socket.emit('errorMsg', { msg: 'Hacen falta al menos 2 jugadores.' }); return; }
    startGame(r);
  });

  socket.on('input', (data) => {
    const room = socket.data.room; if (!room) return;
    const r = getRoom(room);
    const inp = r.inputs.get(socket.id); if (!inp) return;
    if (typeof data.left === 'boolean') inp.left = data.left;
    if (typeof data.right === 'boolean') inp.right = data.right;
    if (data.jump === true) inp.jump = true;
    if (typeof data.angle === 'number') inp.angle = data.angle;
  });

  socket.on('fire', ({ power }) => {
    const room = socket.data.room; if (!room) return;
    const r = getRoom(room);
    if (r.state !== 'playing') return;
    if (socket.id !== currentTurnId(r)) return;
    fire(r, Number(power) || 8);
  });

  socket.on('disconnect', () => {
    const room = socket.data.room; if (!room) return;
    const r = rooms.get(room); if (!r) return;
    const wasHost = r.hostId === socket.id;
    r.players.delete(socket.id);
    r.inputs.delete(socket.id);

    // matar su gusano si está jugando
    const w = r.worms.find(x => x.id === socket.id);
    if (w && w.alive) { w.alive = false; w.hp = 0; }

    if (r.state === 'playing' && currentTurnId(r) === socket.id) nextTurn(r);

    if (r.players.size === 0) {
      if (r.loop) clearInterval(r.loop);
      rooms.delete(room);
      return;
    }
    if (wasHost) r.hostId = [...r.players.keys()][0];
    broadcastLobby(r);
  });
});

server.listen(PORT, () => {
  console.log(`\n  🐛 Gusanos Online corriendo en  http://localhost:${PORT}\n`);
});
