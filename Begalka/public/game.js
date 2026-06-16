(() => {
  "use strict";

  const canvas = document.getElementById("viewport");
  const ctx = canvas.getContext("2d");

  const создатьКнопку = document.getElementById("createBtn");
  const присоединитьсяКнопку = document.getElementById("joinBtn");
  const полеИмени = document.getElementById("playerName");
  const полеКода = document.getElementById("roomCodeInput");
  const строкаСтатуса = document.getElementById("statusLine");
  const полосаЗдоровья = document.getElementById("healthFill");
  const значениеЗдоровья = document.getElementById("healthValue");
  const значениеКомнаты = document.getElementById("roomValue");
  const значениеВрагов = document.getElementById("enemiesValue");
  const значениеДвери = document.getElementById("doorValue");
  const списокОчков = document.getElementById("scoreList");
  const окноПобеды = document.getElementById("victoryOverlay");
  const заголовокПобеды = document.getElementById("victoryTitle");
  const текстПобеды = document.getElementById("victoryText");

  const УГОЛ_ОБЗОРА = Math.PI / 3;
  const ЧУВСТВИТЕЛЬНОСТЬ_МЫШИ = 0.0029;
  const ИНТЕРВАЛ_ВВОДА_МС = 33;
  const МАКС_ДАЛЬНОСТЬ_ЛУЧА = 36;

  let вебСокет = null;
  let данныеКарты = null;
  let последнееСостояние = null;
  let кодКомнаты = "";
  let локальныйId = "";
  let подключен = false;
  let локальныйВидГотов = false;
  let последнийВыстрел = 0;
  let последнийУрон = 0;
  let кнопкаМышиНажата = false;
  let дельтаПоворота = 0;
  let касаниеX = null;
  let победительПоказан = "";

  let отдачаОружия = 0;
  let вспышкаДула = 0;
  let вспышкаУрона = 0;
  let времяПоследнегоКадра = performance.now();
  let буферГлубины = new Float32Array(1);

  const клавиши = Object.create(null);
  const локальныйВид = {
    x: 1.5,
    y: 1.5,
    угол: 0
  };

  const текстуры = {
    стена: создатьТекстуруСтены(),
    дверь: создатьТекстуруДвери(),
    враг: создатьТекстуруВрага(),
    игрок: создатьТекстуруИгрока(),
    оружие: создатьТекстуруОружия()
  };

  function ограничить(значение, мин, макс) {
    return Math.max(мин, Math.min(макс, значение));
  }

  function интерполяция(а, б, т) {
    return а + (б - а) * т;
  }

  function нормализоватьУгол(угол) {
    let next = угол;
    while (next > Math.PI) {
      next -= Math.PI * 2;
    }
    while (next < -Math.PI) {
      next += Math.PI * 2;
    }
    return next;
  }

  function интерполяцияУгла(а, б, т) {
    const дельта = нормализоватьУгол(б - а);
    return нормализоватьУгол(а + дельта * т);
  }

  function адресВебСокета() {
    const протокол = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${протокол}//${window.location.host}`;
  }

  function установитьСтатус(текст, тип = "info") {
    строкаСтатуса.textContent = текст;
    строкаСтатуса.classList.toggle("error", тип === "error");
  }

  function отправить(данные) {
    if (вебСокет && вебСокет.readyState === WebSocket.OPEN) {
      вебСокет.send(JSON.stringify(данные));
    }
  }

  function запроситьПодключение(тип) {
    const имя = (полеИмени.value || "Игрок").trim() || "Игрок";
    const код = (полеКода.value || "").trim().toUpperCase();

    if (тип === "join_room" && !код) {
      установитьСтатус("Введите код комнаты.", "error");
      return;
    }

    подключен = false;
    данныеКарты = null;
    последнееСостояние = null;
    локальныйВидГотов = false;
    победительПоказан = "";
    окноПобеды.classList.remove("visible");

    if (вебСокет) {
      вебСокет.onclose = null;
      вебСокет.close();
    }

    вебСокет = new WebSocket(адресВебСокета());
    установитьСтатус("Подключение к серверу...");

    вебСокет.onopen = () => {
      if (тип === "create_room") {
        отправить({ type: типу, name: имя });
      } else {
        отправить({ type: типу, name: имя, roomCode: код });
      }
    };

    вебСокет.onmessage = (событие) => {
      let сообщение;
      try {
        сообщение = JSON.parse(событие.data);
      } catch (_err) {
        return;
      }
      обработатьСообщение(сообщение);
    };

    вебСокет.onclose = () => {
      if (подключен) {
        установитьСтатус("Отключено от сервера.", "error");
      }
      подключен = false;
      локальныйВидГотов = false;
    };

    вебСокет.onerror = () => {
      установитьСтатус("Ошибка сети. Попробуйте снова.", "error");
    };
  }

  function обработатьСообщение(сообщение) {
    if (!сообщение || typeof сообщение.type !== "string") {
      return;
    }

    if (сообщение.type === "joined") {
      подключен = true;
      кодКомнаты = сообщение.roomCode || "";
      локальныйId = сообщение.playerId || "";
      данныеКарты = сообщение.map || null;
      значениеКомнаты.textContent = кодКомнаты || "----";
      установитьСтатус(`Подключено к комнате ${кодКомнаты}.`);
      return;
    }

    if (сообщение.type === "state") {
      последнееСостояние = сообщение;
      if (сообщение.you) {
        локальныйId = сообщение.you;
      }
      синхронизироватьИгрока();
      обновитьИнтерфейс();
      обновитьПобеду();
      return;
    }

    if (сообщение.type === "error") {
      установитьСтатус(сообщение.message || "Ошибка сервера.", "error");
    }
  }

  function синхронизироватьИгрока() {
    if (!последнееСостояние || !Array.isArray(последнееСостояние.players)) {
      return;
    }
    const я = последнееСостояние.players.find((игрок) => игрок.id === локальныйId);
    if (!я) {
      return;
    }

    if (!локальныйВидГотов) {
      локальныйВид.x = я.x;
      локальныйВид.y = я.y;
      локальныйВид.угол = я.угол;
      локальныйВидГотов = true;
    }

    if (я.lastShotAt > последнийВыстрел) {
      последнийВыстрел = я.lastShotAt;
      отдачаОружия = 20;
      вспышкаДула = 0.09;
    }
    if (я.lastDamagedAt > последнийУрон) {
      последнийУрон = я.lastDamagedAt;
      вспышкаУрона = 0.22;
    }
  }

  function обновитьПобеду() {
    if (!последнееСостояние || !последнееСостояние.winnerId) {
      окноПобеды.classList.remove("visible");
      победительПоказан = "";
      return;
    }

    const этоЯ = последнееСостояние.winnerId === локальныйId;
    заголовокПобеды.textContent = этоЯ ? "Победа!" : "Игрок вышел";
    текстПобеды.textContent = этоЯ
      ? "Вы достигли выхода. Новый раунд начнётся скоро."
      : `${последнееСостояние.winnerName || "Игрок"} достиг выхода.`;

    if (победительПоказан !== последнееСостояние.winnerId) {
      победительПоказан = последнееСостояние.winnerId;
    }
    окноПобеды.classList.add("visible");
  }

  function обновитьИнтерфейс() {
    if (!последнееСостояние) {
      return;
    }

    значениеКомнаты.textContent = последнееСостояние.roomCode || кодКомнаты || "----";
    значениеВрагов.textContent = String(последнееСостояние.enemiesRemaining ?? 0);
    значениеДвери.textContent = `${Math.round(((последнееСостояние.door && последнееСостояние.door.progress) || 0) * 100)}%`;

    const я = последнееСостояние.players.find((игрок) => игрок.id === локальныйId);
    if (я) {
      const проц = ограничить((я.hp / Math.max(1, я.maxHp)) * 100, 0, 100);
      полосаЗдоровья.style.width = `${проц}%`;
      значениеЗдоровья.textContent = я.alive ? `${Math.round(я.hp)} HP` : "Возрождение";
    }

    списокОчков.innerHTML = "";
    const отсортированные = [...последнееСостояние.players].sort((а, б) => б.kills - а.kills || а.deaths - б.deaths);
    for (const игрок of отсортированные) {
      const li = document.createElement("li");
      const имя = document.createElement("span");
      const стат = document.createElement("span");
      имя.textContent = игрок.name;
      стат.textContent = `${игрок.kills}K / ${игрок.deaths}D`;
      if (игрок.id === локальныйId) {
        имя.className = "me";
      }
      li.appendChild(имя);
      li.appendChild(стат);
      списокОчков.appendChild(li);
    }
  }

  function этоДверь(tileX, tileY) {
    if (!последнееСостояние || !последнееСостояние.door) {
      return false;
    }
    return tileX === последнееСостояние.door.x && tileY === последнееСостояние.door.y;
  }

  function этоСтена(tileX, tileY) {
    if (!данныеКарты) {
      return true;
    }
    if (tileX < 0 || tileY < 0 || tileX >= данныеКарты.width || tileY >= данныеКарты.height) {
      return true;
    }
    const ряд = данныеКарты.rows[tileY];
    if (!ряд) {
      return true;
    }
    if (ряд.charAt(tileX) === "#") {
      return true;
    }
    if (этоДверь(tileX, tileY)) {
      return ((последнееСостояние && последнееСостояние.door && последнееСостояние.door.progress) || 0) < 1;
    }
    return false;
  }

  function пуститьЛуч(originX, originY, rayDirX, rayDirY) {
    let mapX = Math.floor(originX);
    let mapY = Math.floor(originY);

    const safeDirX = rayDirX === 0 ? 1e-9 : rayDirX;
    const safeDirY = rayDirY === 0 ? 1e-9 : rayDirY;
    const deltaDistX = Math.abs(1 / safeDirX);
    const deltaDistY = Math.abs(1 / safeDirY);

    let stepX = 0;
    let stepY = 0;
    let sideDistX = 0;
    let sideDistY = 0;

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
    let distance = МАКС_ДАЛЬНОСТЬ_ЛУЧА;
    let wallX = 0;
    let hitType = "wall";
    let loops = 0;

    while (!hit && loops < 80) {
      loops += 1;
      if (sideDistX < sideDistY) {
        sideDistX += deltaDistX;
        mapX += stepX;
        side = 0;
      } else {
        sideDistY += deltaDistY;
        mapY += stepY;
        side = 1;
      }

      if (этоСтена(mapX, mapY)) {
        hit = true;
        hitType = этоДверь(mapX, mapY) ? "door" : "wall";
      }
    }

    if (hit) {
      if (side === 0) {
        distance = (mapX - originX + (1 - stepX) * 0.5) / safeDirX;
        wallX = originY + distance * safeDirY;
      } else {
        distance = (mapY - originY + (1 - stepY) * 0.5) / safeDirY;
        wallX = originX + distance * safeDirX;
      }
      wallX -= Math.floor(wallX);
      if ((side === 0 && rayDirX > 0) || (side === 1 && rayDirY < 0)) {
        wallX = 1 - wallX;
      }
    }

    return {
      distance: ограничить(Math.abs(distance), 0.0001, МАКС_ДАЛЬНОСТЬ_ЛУЧА),
      texX: wallX,
      side,
      hitType
    };
  }

  function нарисоватьНебоИПол(width, height, time) {
    const небо = ctx.createLinearGradient(0, 0, 0, height * 0.52);
    небо.addColorStop(0, "#1e4f6a");
    небо.addColorStop(0.38, "#113445");
    небо.addColorStop(1, "#0b1d29");
    ctx.fillStyle = небо;
    ctx.fillRect(0, 0, width, height * 0.52);

    const glowRadius = 180 + Math.sin(time * 0.4) * 25;
    const glow = ctx.createRadialGradient(width * 0.68, height * 0.16, 10, width * 0.68, height * 0.16, glowRadius);
    glow.addColorStop(0, "rgba(255, 191, 112, 0.26)");
    glow.addColorStop(1, "rgba(255, 191, 112, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, width, height * 0.6);

    const пол = ctx.createLinearGradient(0, height * 0.5, 0, height);
    пол.addColorStop(0, "#132734");
    пол.addColorStop(1, "#071018");
    ctx.fillStyle = пол;
    ctx.fillRect(0, height * 0.5, width, height * 0.5);
  }

  function нарисоватьСтены(width, height) {
    const stride = width > 1100 ? 2 : 1;
    const halfFov = УГОЛ_ОБЗОРА * 0.5;

    for (let x = 0; x < width; x += stride) {
      const camera = (x / width) * 2 - 1;
      const rayAngle = локальныйВид.угол + camera * halfFov;
      const rayDirX = Math.cos(rayAngle);
      const rayDirY = Math.sin(rayAngle);

      const hit = пуститьЛуч(локальныйВид.x, локальныйВид.y, rayDirX, rayDirY);
      const correctedDistance = hit.distance * Math.cos(rayAngle - локальныйВид.угол);
      const lineHeight = Math.min(height * 1.8, height / Math.max(0.0001, correctedDistance));
      const drawY = Math.floor((height - lineHeight) * 0.5);
      const texture = hit.hitType === "door" ? текстуры.дверь : текстуры.стена;
      const sourceX = Math.floor(hit.texX * (texture.width - 1));
      const shade = ограничить(correctedDistance / 10 + (hit.side ? 0.12 : 0.02), 0, 0.84);

      ctx.drawImage(texture, sourceX, 0, 1, texture.height, x, drawY, stride, lineHeight);
      ctx.fillStyle = `rgba(0,0,0,${shade})`;
      ctx.fillRect(x, drawY, stride, lineHeight);

      for (let i = 0; i < stride && x + i < буферГлубины.length; i += 1) {
        буферГлубины[x + i] = correctedDistance;
      }
    }
  }

  function нарисоватьВрагов(width, height) {
    if (!последнееСостояние || !Array.isArray(последнееСостояние.enemies)) {
      return;
    }
    const visibleEnemies = последнееСостояние.enemies
      .filter((enemy) => enemy.alive)
      .map((enemy) => {
        const dx = enemy.x - локальныйВид.x;
        const dy = enemy.y - локальныйВид.y;
        return {
          enemy,
          dist: Math.hypot(dx, dy),
          angle: нормализоватьУгол(Math.atan2(dy, dx) - локальныйВид.угол)
        };
      })
      .sort((a, b) => b.dist - a.dist);

    for (const item of visibleEnemies) {
      if (Math.abs(item.angle) > УГОЛ_ОБЗОРА * 0.72) {
        continue;
      }
      const screenX = (0.5 + item.angle / УГОЛ_ОБЗОРА) * width;
      const size = ограничить(height / Math.max(0.2, item.dist), 24, height * 0.9);
      const drawX = screenX - size * 0.5;
      const drawY = height * 0.5 - size * 0.56;
      const centerColumn = ограничить(Math.floor(screenX), 0, width - 1);
      const wallDepth = буферГлубины[centerColumn] || МАКС_ДАЛЬНОСТЬ_ЛУЧА;

      if (wallDepth + 0.1 < item.dist) {
        continue;
      }

      ctx.globalAlpha = ограничить(1 - item.dist / 15, 0.2, 1);
      ctx.drawImage(текстуры.враг, drawX, drawY, size, size);

      if (item.enemy.hitFlash > 0) {
        ctx.fillStyle = `rgba(255, 86, 86, ${ограничить(item.enemy.hitFlash, 0, 1) * 0.6})`;
        ctx.fillRect(drawX, drawY, size, size);
      }

      const hpRatio = ограничить(item.enemy.hp / Math.max(1, item.enemy.maxHp), 0, 1);
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(drawX, drawY - 10, size, 5);
      ctx.fillStyle = "rgba(110, 240, 224, 0.95)";
      ctx.fillRect(drawX, drawY - 10, size * hpRatio, 5);
      ctx.globalAlpha = 1;
    }
  }

  function нарисоватьДругихИгроков(width, height) {
    if (!последнееСостояние || !Array.isArray(последнееСостояние.players)) {
      return;
    }

    const others = последнееСостояние.players
      .filter((player) => player.id !== локальныйId && player.alive)
      .map((player) => {
        const dx = player.x - локальныйВид.x;
        const dy = player.y - локальныйВид.y;
        return {
          player,
          dist: Math.hypot(dx, dy),
          angle: нормализоватьУгол(Math.atan2(dy, dx) - локальныйВид.угол)
        };
      })
      .sort((a, b) => b.dist - a.dist);

    for (const item of others) {
      if (Math.abs(item.angle) > УГОЛ_ОБЗОРА * 0.75) {
        continue;
      }

      const screenX = (0.5 + item.angle / УГОЛ_ОБЗОРА) * width;
      const spriteHeight = ограничить(height / Math.max(0.25, item.dist) * 1.25, 42, height * 0.95);
      const spriteWidth = spriteHeight * (текстуры.игрок.width / текстуры.игрок.height);
      const drawX = screenX - spriteWidth * 0.5;
      const drawY = height * 0.5 - spriteHeight * 0.72;

      const centerColumn = ограничить(Math.floor(screenX), 0, width - 1);
      const wallDepth = буферГлубины[centerColumn] || МАКС_ДАЛЬНОСТЬ_ЛУЧА;
      if (wallDepth + 0.08 < item.dist) {
        continue;
      }

      ctx.globalAlpha = ограничить(1 - item.dist / 22, 0.26, 1);
      ctx.drawImage(текстуры.игрок, drawX, drawY, spriteWidth, spriteHeight);
      ctx.globalAlpha = 1;

      const hpRatio = ограничить(item.player.hp / Math.max(1, item.player.maxHp), 0, 1);
      ctx.fillStyle = "rgba(0,0,0,0.52)";
      ctx.fillRect(drawX, drawY - 12, spriteWidth, 5);
      ctx.fillStyle = "rgba(110, 240, 224, 0.95)";
      ctx.fillRect(drawX, drawY - 12, spriteWidth * hpRatio, 5);
    }
  }

  function нарисоватьСтрелкуВниз(x, y, size, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y + size);
    ctx.lineTo(x - size, y - size * 0.6);
    ctx.lineTo(x + size, y - size * 0.6);
    ctx.closePath();
    ctx.fill();
  }

  function нарисоватьСтрелкуВбок(x, y, size, rightSide, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    if (rightSide) {
      ctx.moveTo(x + size, y);
      ctx.lineTo(x - size, y - size * 0.75);
      ctx.lineTo(x - size, y + size * 0.75);
    } else {
      ctx.moveTo(x - size, y);
      ctx.lineTo(x + size, y - size * 0.75);
      ctx.lineTo(x + size, y + size * 0.75);
    }
    ctx.closePath();
    ctx.fill();
  }

  function нарисоватьМеткиИгроков(width, height) {
    if (!последнееСостояние || !Array.isArray(последнееСостояние.players)) {
      return;
    }

    const others = последнееСостояние.players.filter((player) => player.id !== локальныйId && player.alive);
    if (others.length === 0) {
      return;
    }

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "700 13px Rajdhani";

    const halfFov = УГОЛ_ОБЗОРА * 0.5;
    const edgeX = 24;
    const offscreenY = 56;

    for (const player of others) {
      const dx = player.x - локальныйВид.x;
      const dy = player.y - локальныйВид.y;
      const dist = Math.hypot(dx, dy);
      const angle = нормализоватьУгол(Math.atan2(dy, dx) - локальныйВид.угол);
      const label = `${player.name} ${dist.toFixed(1)}м`;
      const markerColor = "rgba(110, 240, 224, 0.96)";

      if (Math.abs(angle) <= halfFov) {
        const screenX = (0.5 + angle / УГОЛ_ОБЗОРА) * width;
        const pseudoSize = ограничить(height / Math.max(0.25, dist), 20, height * 0.66);
        const topY = height * 0.5 - pseudoSize * 0.56;
        const markerY = ограничить(topY - 22, 24, height - 34);

        нарисоватьСтрелкуВниз(screenX, markerY, 9, markerColor);
        ctx.fillStyle = "rgba(4, 12, 18, 0.74)";
        const textWidth = ctx.measureText(label).width + 12;
        ctx.fillRect(screenX - textWidth * 0.5, markerY - 26, textWidth, 16);
        ctx.fillStyle = "rgba(230, 250, 255, 0.96)";
        ctx.fillText(label, screenX, markerY - 18);
      } else {
        const rightSide = angle > 0;
        const markerX = rightSide ? width - edgeX : edgeX;
        нарисоватьСтрелкуВбок(markerX, offscreenY, 11, rightSide, markerColor);

        const textX = rightSide ? markerX - 44 : markerX + 44;
        ctx.textAlign = rightSide ? "right" : "left";
        ctx.fillStyle = "rgba(4, 12, 18, 0.78)";
        const textWidth = ctx.measureText(label).width + 10;
        const boxX = rightSide ? textX - textWidth : textX;
        ctx.fillRect(boxX, offscreenY - 8, textWidth, 16);
        ctx.fillStyle = "rgba(230, 250, 255, 0.96)";
        ctx.fillText(label, textX + (rightSide ? -5 : 5), offscreenY);
        ctx.textAlign = "center";
      }
    }

    ctx.restore();
  }

  function текущийФакторДвижения() {
    const forward = (клавиши.KeyW || клавиши.ArrowUp ? 1 : 0) + (клавиши.KeyS || клавиши.ArrowDown ? 1 : 0);
    const strafe = (клавиши.KeyA ? 1 : 0) + (клавиши.KeyD ? 1 : 0);
    return ограничить(forward + strafe, 0, 1);
  }

  function нарисоватьОружие(width, height, time) {
    const moveFactor = текущийФакторДвижения();
    const bobX = Math.cos(time * 10) * 4.2 * moveFactor;
    const bobY = Math.sin(time * 12) * 6.2 * moveFactor;
    const kickOffset = отдачаОружия;

    const scale = ограничить(width / 980, 0.8, 1.3);
    const weaponWidth = текстуры.оружие.width * scale;
    const weaponHeight = текстуры.оружие.height * scale;
    const weaponX = width * 0.5 - weaponWidth * 0.5 + bobX;
    const weaponY = height - weaponHeight + bobY + kickOffset;

    ctx.drawImage(текстуры.оружие, weaponX, weaponY, weaponWidth, weaponHeight);

    if (вспышкаДула > 0) {
      const alpha = ограничить(вспышкаДула / 0.09, 0, 1);
      const flashX = weaponX + weaponWidth * 0.8;
      const flashY = weaponY + weaponHeight * 0.38;
      const flash = ctx.createRadialGradient(flashX, flashY, 4, flashX, flashY, 72);
      flash.addColorStop(0, `rgba(255, 225, 160, ${0.8 * alpha})`);
      flash.addColorStop(1, "rgba(255, 225, 160, 0)");
      ctx.fillStyle = flash;
      ctx.fillRect(flashX - 80, flashY - 80, 160, 160);
    }
  }

  function нарисоватьПрицел(width, height) {
    const cx = width * 0.5;
    const cy = height * 0.5;
    ctx.strokeStyle = "rgba(233, 247, 250, 0.86)";
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

  function нарисоватьПриглашение(width, height) {
    ctx.fillStyle = "rgba(4, 10, 16, 0.58)";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "rgba(228, 242, 247, 0.9)";
    ctx.font = "600 24px Oxanium";
    ctx.textAlign = "center";
    ctx.fillText("Создайте или присоединитесь к игре", width / 2, height / 2 - 14);
    ctx.font = "500 14px Rajdhani";
    ctx.fillStyle = "rgba(143, 169, 180, 0.95)";
    ctx.fillText("WASD — движение, мышь — взгляд, клик — выстрел", width / 2, height / 2 + 14);
  }

  function изменитьРазмерХолста() {
    const width = Math.max(1, Math.floor(canvas.clientWidth));
    const height = Math.max(1, Math.floor(canvas.clientHeight));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      буферГлубины = new Float32Array(width);
    }
  }

  function обновитьЛокальныйВид(dt) {
    отдачаОружия = Math.max(0, отдачаОружия - 52 * dt);
    вспышкаДула = Math.max(0, вспышкаДула - dt);
    вспышкаУрона = Math.max(0, вспышкаУрона - dt);

    if (!последнееСостояние || !локальныйВидГотов) {
      return;
    }
    const я = последнееСостояние.players.find((player) => player.id === локальныйId);
    if (!я) {
      return;
    }

    const smooth = ограничить(dt * 12, 0, 1);
    локальныйВид.x = интерполяция(локальныйВид.x, я.x, smooth);
    локальныйВид.y = интерполяция(локальныйВид.y, я.y, smooth);
    локальныйВид.угол = интерполяцияУгла(локальныйВид.угол, я.угол, smooth);
  }

  function отрисоватьКадр(nowMs) {
    изменитьРазмерХолста();
    const width = canvas.width;
    const height = canvas.height;
    const nowSec = nowMs * 0.001;
    const dt = Math.min(0.05, (nowMs - времяПоследнегоКадра) * 0.001);
    времяПоследнегоКадра = nowMs;

    обновитьЛокальныйВид(dt);
    нарисоватьНебоИПол(width, height, nowSec);

    if (подключен && данныеКарты && последнееСостояние && локальныйВидГотов) {
      нарисоватьСтены(width, height);
      нарисоватьДругихИгроков(width, height);
      нарисоватьВрагов(width, height);
      нарисоватьОружие(width, height, nowSec);
      нарисоватьПрицел(width, height);
      нарисоватьМеткиИгроков(width, height);
    } else {
      нарисоватьПриглашение(width, height);
    }

    if (вспышкаУрона > 0) {
      ctx.fillStyle = `rgba(255, 70, 70, ${вспышкаУрона * 0.35})`;
      ctx.fillRect(0, 0, width, height);
    }

    requestAnimationFrame(отрисоватьКадр);
  }

  function создатьТекстуруСтены() {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const g = c.getContext("2d");
    g.fillStyle = "#7d8a91";
    g.fillRect(0, 0, 64, 64);

    g.fillStyle = "#67727a";
    for (let y = 0; y < 64; y += 16) {
      for (let x = 0; x < 64; x += 16) {
        if ((x + y) % 32 === 0) {
          g.fillRect(x, y, 16, 16);
        }
      }
    }

    g.strokeStyle = "rgba(40, 50, 58, 0.75)";
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

  function создатьТекстуруДвери() {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const g = c.getContext("2d");

    const grad = g.createLinearGradient(0, 0, 64, 64);
    grad.addColorStop(0, "#e7ac4c");
    grad.addColorStop(1, "#8f5b1f");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);

    g.strokeStyle = "rgba(42, 25, 7, 0.7)";
    g.lineWidth = 2;
    for (let i = 8; i <= 56; i += 8) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i, 64);
      g.stroke();
    }
    return c;
  }

  function создатьТекстуруВрага() {
    const c = document.createElement("canvas");
    c.width = 96;
    c.height = 96;
    const g = c.getContext("2d");

    g.clearRect(0, 0, 96, 96);
    const body = g.createRadialGradient(48, 42, 8, 48, 42, 36);
    body.addColorStop(0, "#f6fffb");
    body.addColorStop(1, "#48907f");
    g.fillStyle = body;
    g.beginPath();
    g.ellipse(48, 45, 28, 34, 0, 0, Math.PI * 2);
    g.fill();

    g.fillStyle = "#0c1b20";
    g.beginPath();
    g.arc(38, 40, 5, 0, Math.PI * 2);
    g.arc(58, 40, 5, 0, Math.PI * 2);
    g.fill();

    g.strokeStyle = "#10252c";
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(32, 60);
    g.quadraticCurveTo(48, 70, 64, 60);
    g.stroke();

    return c;
  }

  function создатьТекстуруИгрока() {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 96;
    const g = c.getContext("2d");

    g.clearRect(0, 0, 64, 96);

    const px = 4;
    const fillPx = (x, y, w, h, color) => {
      g.fillStyle = color;
      g.fillRect(x * px, y * px, w * px, h * px);
    };

    fillPx(5, 1, 6, 6, "#d8a57d");
    fillPx(5, 1, 6, 2, "#6d4f38");
    fillPx(5, 7, 2, 1, "#c78f65");
    fillPx(9, 7, 2, 1, "#c78f65");

    fillPx(4, 7, 8, 6, "#2f7ec0");
    fillPx(3, 7, 1, 6, "#2f7ec0");
    fillPx(12, 7, 1, 6, "#2f7ec0");
    fillPx(4, 11, 8, 2, "#245f93");

    fillPx(4, 13, 4, 8, "#4e7ba8");
    fillPx(8, 13, 4, 8, "#4a739a");

    fillPx(3, 13, 1, 8, "#d8a57d");
    fillPx(12, 13, 1, 8, "#d8a57d");

    g.strokeStyle = "rgba(10,16,20,0.55)";
    g.lineWidth = 2;
    g.strokeRect(5 * px, 1 * px, 6 * px, 6 * px);
    g.strokeRect(4 * px, 7 * px, 8 * px, 6 * px);
    g.strokeRect(4 * px, 13 * px, 8 * px, 8 * px);

    return c;
  }

  function создатьТекстуруОружия() {
    const c = document.createElement("canvas");
    c.width = 300;
    c.height = 170;
    const g = c.getContext("2d");

    const body = g.createLinearGradient(0, 0, 300, 0);
    body.addColorStop(0, "#2a3238");
    body.addColorStop(1, "#0f1317");
    g.fillStyle = body;
    g.beginPath();
    g.moveTo(28, 96);
    g.lineTo(208, 78);
    g.lineTo(274, 88);
    g.lineTo(262, 122);
    g.lineTo(112, 130);
    g.lineTo(36, 130);
    g.closePath();
    g.fill();

    g.fillStyle = "#1f2429";
    g.fillRect(144, 94, 56, 20);

    g.fillStyle = "#7bc1ff";
    g.fillRect(176, 84, 40, 7);

    g.fillStyle = "#ffb14d";
    g.fillRect(250, 93, 32, 11);

    g.fillStyle = "#171b20";
    g.beginPath();
    g.moveTo(96, 108);
    g.lineTo(120, 108);
    g.lineTo(126, 150);
    g.lineTo(102, 150);
    g.closePath();
    g.fill();

    return c;
  }

  создатьКнопку.addEventListener("click", () => запроситьПодключение("create_room"));
  присоединитьсяКнопку.addEventListener("click", () => запроситьПодключение("join_room"));
  полеКода.addEventListener("input", () => {
    полеКода.value = полеКода.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
  });

  window.addEventListener("keydown", (event) => {
    клавиши[event.code] = true;
    if (event.code === "Space") {
      event.preventDefault();
    }
  });

  window.addEventListener("keyup", (event) => {
    клавиши[event.code] = false;
  });

  window.addEventListener("blur", () => {
    for (const key of Object.keys(клавиши)) {
      клавиши[key] = false;
    }
    кнопкаМышиНажата = false;
    дельтаПоворота = 0;
  });

  canvas.addEventListener("click", () => {
    if (подключен && document.pointerLockElement !== canvas && canvas.requestPointerLock) {
      canvas.requestPointerLock().catch(() => {});
    }
  });

  document.addEventListener("mousemove", (event) => {
    if (document.pointerLockElement === canvas) {
      дельтаПоворота += event.movementX * ЧУВСТВИТЕЛЬНОСТЬ_МЫШИ;
    }
  });

  window.addEventListener("mousedown", (event) => {
    if (event.button === 0) {
      кнопкаМышиНажата = true;
    }
  });
  window.addEventListener("mouseup", (event) => {
    if (event.button === 0) {
      кнопкаМышиНажата = false;
    }
  });

  canvas.addEventListener(
    "touchstart",
    (event) => {
      if (event.touches.length > 0) {
        касаниеX = event.touches[0].clientX;
      }
      кнопкаМышиНажата = true;
      event.preventDefault();
    },
    { passive: false }
  );

  canvas.addEventListener(
    "touchmove",
    (event) => {
      if (event.touches.length > 0 && касаниеX !== null) {
        const nextX = event.touches[0].clientX;
        дельтаПоворота += (nextX - касаниеX) * 0.004;
        касаниеX = nextX;
      }
      event.preventDefault();
    },
    { passive: false }
  );

  canvas.addEventListener(
    "touchend",
    (event) => {
      кнопкаМышиНажата = false;
      if (event.touches.length === 0) {
        касаниеX = null;
      }
      event.preventDefault();
    },
    { passive: false }
  );

  setInterval(() => {
    if (!подключен || !вебСокет || вебСокет.readyState !== WebSocket.OPEN) {
      return;
    }

    const вперед = (клавиши.KeyW || клавиши.ArrowUp ? 1 : 0) + (клавиши.KeyS || клавиши.ArrowDown ? -1 : 0);
    const вбок = (клавиши.KeyD ? 1 : 0) + (клавиши.KeyA ? -1 : 0);
    const поворот = (клавиши.ArrowRight ? 1 : 0) + (клавиши.ArrowLeft ? -1 : 0);
    const огонь = Boolean(кнопкаМышиНажата || клавиши.Space);

    отправить({
      type: "input",
      input: {
        forward: вперед,
        strafe: вбок,
        turn: поворот,
        turnDelta: ограничить(дельтаПоворота, -0.65, 0.65),
        fire: огонь
      }
    });
    дельтаПоворота = 0;
  }, ИНТЕРВАЛ_ВВОДА_МС);

  установитьСтатус("Создайте комнату или присоединитесь к существующей.");
  requestAnimationFrame(отрисоватьКадр);
})();