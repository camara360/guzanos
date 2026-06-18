# 🐛 Gusanos Online

Juego multijugador **online por turnos** estilo *Worms* para **hasta 4 jugadores simultáneos**.
Servidor autoritativo (Node + Socket.io) + cliente en Canvas. Terreno destructible,
viento, física de proyectiles y 4 personajes:

| Personaje | Rasgo | Detalle de juego |
|-----------|-------|------------------|
| **Antonio** | El calvo | velocidad normal |
| **Kun** | El de las gafas | velocidad normal |
| **Dani** | El barbudo | velocidad normal |
| **Vinny** | El lentorro | **se mueve a la mitad de velocidad** |

---

## ▶️ Jugar en local (probar entre pestañas)

Necesitas [Node.js 18+](https://nodejs.org).

```bash
npm install
npm start
```

Abre **http://localhost:3000**. Para simular varios jugadores, abre varias
pestañas/ventanas (o varios dispositivos en tu misma red usando la IP de tu PC,
p.ej. `http://192.168.1.50:3000`). Entrad todos a la **misma sala**, elegid
personaje y el anfitrión pulsa **¡Empezar partida!**.

---

## 🌍 Jugar online de verdad (que se unan desde internet)

El juego ya está listo para desplegar. Opciones gratuitas/sencillas:

### Render.com
1. Sube esta carpeta a un repo de GitHub.
2. En Render: **New → Web Service** → conecta el repo.
3. Build command: `npm install` · Start command: `npm start`.
4. Render te da una URL pública (`https://tu-juego.onrender.com`). Compártela
   y que cada jugador entre a la misma sala.

### Railway / Fly.io / Replit
Mismo principio: ejecuta `npm start`, expón el puerto que indica `process.env.PORT`
(ya está contemplado en el código).

> El servidor usa WebSockets vía Socket.io, soportado por todos esos hosts.

---

## 🎮 Controles

| Acción | Tecla |
|--------|-------|
| Mover | `A` / `D` o `←` / `→` |
| Saltar | `W` o `↑` |
| Apuntar | mover el **ratón** |
| Cargar potencia | **mantener `ESPACIO`** |
| Disparar | **soltar `ESPACIO`** |

En móvil/tablet: arrastra para apuntar, mantén pulsado el tablero para cargar y suelta para disparar.

Solo puedes actuar **en tu turno** (tu gusano se resalta con un aro dorado y una flecha).

---

## 🧩 Cómo funciona (arquitectura)

- **`server.js`** — Servidor autoritativo. Mantiene la máscara de colisión del
  terreno, simula la física a 30 Hz, gestiona turnos/viento/daño y envía
  *snapshots* a todos los clientes. Imposible hacer trampas desde el cliente.
- **`public/game.js`** — Solo renderiza el estado recibido y captura inputs.
  Genera el terreno a partir de la **misma semilla** que el servidor (determinista),
  así todos ven idéntico el mapa, y lo perfora al recibir cada explosión.
- **Salas** — Cada `sala` es una partida independiente. 4 jugadores máx. por sala,
  cada personaje único por sala.

## ⚙️ Ajustes rápidos (en `server.js`, sección "Constantes")

- `TURN_TIME` — segundos por turno (30 por defecto).
- `EXPLOSION_R` / `MAX_DMG` — radio y daño de la bazuca.
- `VINNY_SPEED` — lo lento que va Vinny.
- `WORLD_W` / `WORLD_H` — tamaño del mapa.

---

¡A reventar gusanos! 🎯
