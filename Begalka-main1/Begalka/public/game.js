(() => {
  "use strict";

  const canvas = document.getElementById("viewport");
  const ctx = canvas.getContext("2d");

  // Константы
  const FOV = Math.PI / 3;                // угол обзора
  const MAX_DIST = 36;                    // максимальная дальность луча
  const MOUSE_SENSITIVITY = 0.0029;

  // Данные карты (статическая карта из финальной версии, но без врагов и двери)
  const MAP_DATA = {
    width: 19,
    height: 15,
    rows: [
      "###################",
      "#S....#.......E..#",
      "#.##.#.#####.###..#",
      "#....#.....#...#..#",
      "###.#####.#.#.#.###",
      "#...#...#.#.#.#...#",
      "#.#.#.#.#.#.#.###.#",
      "#.#...#...#...#...#",
      "#.#####.#####.#.#.#",
      "#.....#.....#.#.#.#",
      "#.###.#####.#.#.#.#",
      "#...#.....#.#...#.#",
      "###.#####.#.#####.#",
      "#E........#......S#",
      "###################"
    ]
  };

  // Состояние игрока (локальное)
  let player = {
    x: 1.5,
    y: 1.5,
    angle: 0
  };

  let depthBuffer = new Float32Array(1);
  let prevTime = performance.now();

  // Вспомогательные функции
  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalizeAngle(angle) {
    let a = angle;
    while (a > Math.PI) a -= 2 * Math.PI;
    while (a < -Math.PI) a += 2 * Math.PI;
    return a;
  }

  // Проверка стены
  function isWall(tileX, tileY) {
    if (tileX < 0 || tileY < 0 || tileX >= MAP_DATA.width || tileY >= MAP_DATA.height) {
      return true;
    }
    const row = MAP_DATA.rows[tileY];
    if (!row) return true;
    return row.charAt(tileX) === '#';
  }

  // Трассировка луча
  function castRay(originX, originY, rayDirX, rayDirY) {
    let mapX = Math.floor(originX);
    let mapY = Math.floor(originY);

    const safeX = rayDirX === 0 ? 1e-9 : rayDirX;
    const safeY = rayDirY === 0 ? 1e-9 : rayDirY;
    const deltaDistX = Math.abs(1 / safeX);
    const deltaDistY = Math.abs(1 / safeY);

    let stepX, stepY, sideDistX, sideDistY;
    if (rayDirX < 0) {
      stepX = -1;
      sideDistX = (originX - mapX) * deltaDistX;
    } else {
      stepX = 1;
      sideDistX = (mapX + 1 - originX) * deltaDistX;
    }
    if (rayDirY < 0) {
      stepY = -1;
      sideDistY = (originY - mapY) * deltaDistY;
    } else {
      stepY = 1;
      sideDistY = (mapY + 1 - originY) * deltaDistY;
    }

    let side = 0;
    let hit = false;
    let distance = MAX_DIST;
    let wallX = 0;
    let loops = 0;

    while (!hit && loops < 80) {
      loops++;
      if (sideDistX < sideDistY) {
        sideDistX += deltaDistX;
        mapX += stepX;
        side = 0;
      } else {
        sideDistY += deltaDistY;
        mapY += stepY;
        side = 1;
      }
      if (isWall(mapX, mapY)) {
        hit = true;
        if (side === 0) {
          distance = (mapX - originX + (1 - stepX) * 0.5) / safeX;
          wallX = originY + distance * safeY;
        } else {
          distance = (mapY - originY + (1 - stepY) * 0.5) / safeY;
          wallX = originX + distance * safeX;
        }
        wallX -= Math.floor(wallX);
        if ((side === 0 && rayDirX > 0) || (side === 1 && rayDirY < 0)) {
          wallX = 1 - wallX;
        }
      }
    }

    return {
      distance: clamp(Math.abs(distance), 0.0001, MAX_DIST),
      texX: wallX,
      side: side
    };
  }

  // Создание текстуры стены
  function createWallTexture() {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d');

    g.fillStyle = '#7d8a91';
    g.fillRect(0, 0, 64, 64);

    g.fillStyle = '#67727a';
    for (let y = 0; y < 64; y += 16) {
      for (let x = 0; x < 64; x += 16) {
        if ((x + y) % 32 === 0) {
          g.fillRect(x, y, 16, 16);
        }
      }
    }

    g.strokeStyle = 'rgba(40,50,58,0.75)';
    g.lineWidth = 2;
    for (let y = 0; y <= 64; y += 16) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(64, y);
      g.stroke();
    }
    for (let x = 0; x <= 64; x += 16) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, 64);
      g.stroke();
    }
    return c;
  }

  const wallTexture = createWallTexture();

  // Отрисовка неба и пола
  function drawSkyAndFloor(width, height, time) {
    const sky = ctx.createLinearGradient(0, 0, 0, height * 0.52);
    sky.addColorStop(0, '#1e4f6a');
    sky.addColorStop(0.38, '#113445');
    sky.addColorStop(1, '#0b1d29');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height * 0.52);

    const glowRadius = 180 + Math.sin(time * 0.4) * 25;
    const glow = ctx.createRadialGradient(width * 0.68, height * 0.16, 10, width * 0.68, height * 0.16, glowRadius);
    glow.addColorStop(0, 'rgba(255,191,112,0.26)');
    glow.addColorStop(1, 'rgba(255,191,112,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height * 0.6);

    const floor = ctx.createLinearGradient(0, height * 0.5, 0, height);
    floor.addColorStop(0, '#132734');
    floor.addColorStop(1, '#071018');
    ctx.fillStyle = floor;
    ctx.fillRect(0, height * 0.5, width, height * 0.5);
  }

  // Отрисовка стен
  function drawWalls(width, height) {
    const halfFov = FOV * 0.5;
    const stride = width > 1100 ? 2 : 1;
    depthBuffer = new Float32Array(width);

    for (let x = 0; x < width; x += stride) {
      const camera = (x / width) * 2 - 1;
      const rayAngle = player.angle + camera * halfFov;
      const dirX = Math.cos(rayAngle);
      const dirY = Math.sin(rayAngle);

      const hit = castRay(player.x, player.y, dirX, dirY);
      const correctedDist = hit.distance * Math.cos(rayAngle - player.angle);
      const lineHeight = Math.min(height * 1.8, height / Math.max(0.0001, correctedDist));
      const drawY = (height - lineHeight) * 0.5;
      const texX = Math.floor(hit.texX * (wallTexture.width - 1));
      const shade = clamp(correctedDist / 10 + (hit.side ? 0.12 : 0.02), 0, 0.84);

      ctx.drawImage(wallTexture, texX, 0, 1, wallTexture.height, x, drawY, stride, lineHeight);
      ctx.fillStyle = `rgba(0,0,0,${shade})`;
      ctx.fillRect(x, drawY, stride, lineHeight);

      for (let i = 0; i < stride && x + i < depthBuffer.length; i++) {
        depthBuffer[x + i] = correctedDist;
      }
    }
  }

  // Отрисовка прицела
  function drawCrosshair(width, height) {
    const cx = width * 0.5;
    const cy = height * 0.5;
    ctx.strokeStyle = 'rgba(233,247,250,0.86)';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy);
    ctx.lineTo(cx - 2, cy);
    ctx.moveTo(cx + 2, cy);
    ctx.lineTo(cx + 8, cy);
    ctx.moveTo(cx, cy - 8);
    ctx.lineTo(cx, cy - 2);
    ctx.moveTo(cx, cy + 2);
    ctx.lineTo(cx, cy + 8);
    ctx.stroke();
  }

  // Изменение размера холста
  function resizeCanvas() {
    const w = Math.max(1, Math.floor(canvas.clientWidth));
    const h = Math.max(1, Math.floor(canvas.clientHeight));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      depthBuffer = new Float32Array(w);
    }
  }

  // Обновление позиции игрока (локальное управление)
  function updatePlayer(dt) {
    // Управление с клавиатуры (WASD)
    let forward = 0, strafe = 0, turn = 0;
    if (keys['KeyW'] || keys['ArrowUp']) forward = 1;
    if (keys['KeyS'] || keys['ArrowDown']) forward = -1;
    if (keys['KeyD']) strafe = 1;
    if (keys['KeyA']) strafe = -1;
    if (keys['ArrowRight']) turn = 1;
    if (keys['ArrowLeft']) turn = -1;

    const speed = 2.7;
    const turnSpeed = 2.8;

    player.angle = normalizeAngle(player.angle + turn * turnSpeed * dt + mouseTurnDelta);
    mouseTurnDelta = 0;

    const sin = Math.sin(player.angle);
    const cos = Math.cos(player.angle);
    let dx = cos * forward + Math.cos(player.angle + Math.PI/2) * strafe;
    let dy = sin * forward + Math.sin(player.angle + Math.PI/2) * strafe;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }

    // Простейшая проверка столкновений (только по клеткам)
    const radius = 0.22;
    const newX = player.x + dx * speed * dt;
    const newY = player.y + dy * speed * dt;
    if (!isWall(Math.floor(newX + radius), Math.floor(player.y)) &&
        !isWall(Math.floor(newX - radius), Math.floor(player.y))) {
      player.x = newX;
    }
    if (!isWall(Math.floor(player.x), Math.floor(newY + radius)) &&
        !isWall(Math.floor(player.x), Math.floor(newY - radius))) {
      player.y = newY;
    }
  }

  // Состояние клавиш и мыши
  const keys = Object.create(null);
  let mouseTurnDelta = 0;

  // Обработчики ввода
  window.addEventListener('keydown', (e) => { keys[e.code] = true; });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('blur', () => {
    for (const k of Object.keys(keys)) keys[k] = false;
  });

  canvas.addEventListener('click', () => {
    if (canvas.requestPointerLock) canvas.requestPointerLock();
  });

  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === canvas) {
      mouseTurnDelta += e.movementX * MOUSE_SENSITIVITY;
    }
  });

  // Главный цикл
  function renderFrame(nowMs) {
    resizeCanvas();
    const width = canvas.width;
    const height = canvas.height;
    const nowSec = nowMs * 0.001;
    const dt = Math.min(0.05, (nowMs - prevTime) * 0.001);
    prevTime = nowMs;

    updatePlayer(dt);

    drawSkyAndFloor(width, height, nowSec);
    drawWalls(width, height);
    drawCrosshair(width, height);

    // Статусная строка
    document.getElementById('statusLine').textContent =
      `Позиция: (${player.x.toFixed(2)}, ${player.y.toFixed(2)})  Угол: ${(player.angle * 180 / Math.PI).toFixed(1)}°`;

    requestAnimationFrame(renderFrame);
  }

  // Запуск
  requestAnimationFrame(renderFrame);
})();