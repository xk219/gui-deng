/* 夜行归灯 —— 收集机制互动作品
 * 世界：雪原；目标：把 6 根灯芯送回灯座。
 * 核心规则：影子只追光——携带越多，影子追猎范围越大、速度越快；
 *          灯座一次只收 3 根，收完冷却 6 秒。
 */
(() => {
  'use strict';

  const WORLD = { w: 1800, h: 1300 };
  const ALTAR = { x: 900, y: 650, r: 82 };
  const TOTAL_CORES = 6;
  const MAX_CARRY = 6;
  const DEPOSIT_PER_GO = 3;   // 灯座一次最多接收
  const COOLDOWN = 6;         // 秒
  const PLAYER_SPEED = 212;

  const CORE_SPOTS = [
    { x: 250, y: 250 }, { x: 1520, y: 300 }, { x: 300, y: 1060 },
    { x: 1500, y: 1080 }, { x: 900, y: 165 }, { x: 900, y: 1140 },
  ];

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const el = {
    hud: document.getElementById('hud'),
    carry: document.getElementById('hudCarry'),
    altar: document.getElementById('hudAltar'),
    sockets: document.getElementById('hudSockets'),
    pillCarry: document.getElementById('pillCarry'),
    menu: document.getElementById('overlayMenu'),
    win: document.getElementById('overlayWin'),
    pause: document.getElementById('overlayPause'),
    winStats: document.getElementById('winStats'),
    toast: document.getElementById('toast'),
    touchpad: document.getElementById('touchpad'),
    btnStart: document.getElementById('btnStart'),
    btnAgain: document.getElementById('btnAgain'),
    btnResume: document.getElementById('btnResume'),
    btnRestart: document.getElementById('btnRestart'),
    btnPause: document.getElementById('btnPause'),
    btnSound: document.getElementById('btnSound'),
  };

  let VW = 960, VH = 600, DPR = 1;
  function fitCanvas() {
    const rect = canvas.getBoundingClientRect();
    const cssW = rect.width || 960;
    const cssH = cssW * (600 / 960);
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    VW = cssW; VH = cssH;
    canvas.width = Math.round(cssW * DPR);
    canvas.height = Math.round(cssH * DPR);
  }
  window.addEventListener('resize', fitCanvas);

  // ---------------- 状态 ----------------
  const S = {
    mode: 'menu',            // menu | playing | paused | won
    t: 0,
    carried: 0,
    deposited: 0,
    trips: 0,
    stolen: 0,
    altarCd: 0,
    pulse: 0,
    shake: 0,
    player: { x: ALTAR.x, y: ALTAR.y + 150, invuln: 0, moving: false, face: 1 },
    cores: [],
    shadows: [],
    flakes: [],
    cam: { x: 0, y: 0 },
  };

  const keys = Object.create(null);
  const touch = { up: false, down: false, left: false, right: false };

  // ---------------- 音效 ----------------
  let AC = null, soundOn = true;
  function audio() {
    if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AC = null; } }
    return AC;
  }
  function tone(freq, dur, type = 'sine', gain = 0.06, delay = 0) {
    const ac = audio(); if (!ac || !soundOn) return;
    const t0 = ac.currentTime + delay;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(ac.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  const sfx = {
    pick: () => { tone(680, .16, 'sine', .05); tone(1020, .22, 'sine', .04, .05); },
    deposit: () => { tone(392, .5, 'triangle', .05); tone(523, .55, 'triangle', .045, .06); tone(784, .5, 'sine', .035, .12); },
    pulse: () => { tone(180, .7, 'sine', .05); },
    steal: () => { tone(200, .28, 'sawtooth', .05); tone(120, .4, 'sawtooth', .04, .08); },
    win: () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, .9, 'sine', .05, i * .13)); },
  };

  // ---------------- 初始化 ----------------
  function resetRun() {
    S.t = 0; S.carried = 0; S.deposited = 0; S.trips = 0; S.stolen = 0;
    S.altarCd = 0; S.pulse = 0; S.shake = 0;
    S.player = { x: ALTAR.x, y: ALTAR.y + 150, invuln: 0, moving: false, face: 1 };
    S.cores = CORE_SPOTS.map(p => ({ x: p.x, y: p.y, phase: Math.random() * 6.28, taken: false }));
    S.shadows = [];
    for (let i = 0; i < 4; i++) S.shadows.push(makeShadow(i));
    S.flakes = Array.from({ length: 90 }, () => ({
      x: Math.random() * WORLD.w, y: Math.random() * WORLD.h,
      s: .5 + Math.random() * 1.6, v: 12 + Math.random() * 26, d: Math.random() * 6.28,
    }));
    S.cam.x = S.player.x - VW / 2; S.cam.y = S.player.y - VH / 2;
  }

  function makeShadow(i) {
    const edge = i % 4;
    let x, y;
    if (edge === 0) { x = 100 + Math.random() * 200; y = 100 + Math.random() * (WORLD.h - 200); }
    else if (edge === 1) { x = WORLD.w - 100 - Math.random() * 200; y = 100 + Math.random() * (WORLD.h - 200); }
    else if (edge === 2) { x = 100 + Math.random() * (WORLD.w - 200); y = 100 + Math.random() * 160; }
    else { x = 100 + Math.random() * (WORLD.w - 200); y = WORLD.h - 100 - Math.random() * 160; }
    return { x, y, vx: 0, vy: 0, mode: 'wander', stun: 0, flee: 0, wob: Math.random() * 6.28, eye: 0 };
  }

  function startGame() {
    resetRun();
    S.mode = 'playing';
    el.menu.classList.remove('show');
    el.win.classList.remove('show');
    el.pause.classList.remove('show');
    el.hud.hidden = false;
    el.touchpad.hidden = !window.matchMedia('(pointer: coarse)').matches;
    audio();
    syncHud();
    fitCanvas();
    toast('先去最近的灯芯看看');
  }

  // ---------------- 规则数值 ----------------
  const lightRadius = () => 196 + S.carried * 50;
  const aggroRadius = () => (S.carried > 0 ? 150 + S.carried * 82 : 0);
  const shadowSpeed = () => 64 + S.carried * 25;

  // ---------------- 输入 ----------------
  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    keys[k] = true;
    if (k === 'p') { if (S.mode === 'playing') pauseGame(); else if (S.mode === 'paused') resumeGame(); }
  });
  window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

  el.touchpad.querySelectorAll('button').forEach(b => {
    const d = b.dataset.dir;
    const on = e => { e.preventDefault(); touch[d] = true; };
    const off = e => { e.preventDefault(); touch[d] = false; };
    b.addEventListener('pointerdown', on);
    b.addEventListener('pointerup', off);
    b.addEventListener('pointercancel', off);
    b.addEventListener('pointerleave', off);
  });

  function axis() {
    let dx = 0, dy = 0;
    if (keys['arrowleft'] || keys['a'] || touch.left) dx -= 1;
    if (keys['arrowright'] || keys['d'] || touch.right) dx += 1;
    if (keys['arrowup'] || keys['w'] || touch.up) dy -= 1;
    if (keys['arrowdown'] || keys['s'] || touch.down) dy += 1;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len, active: dx !== 0 || dy !== 0 };
  }

  // ---------------- 更新 ----------------
  function update(dt) {
    S.t += dt;
    const p = S.player;
    const a = axis();
    p.moving = a.active;
    if (a.active) p.face = a.x !== 0 ? Math.sign(a.x) : p.face;
    p.x = clamp(p.x + a.x * PLAYER_SPEED * dt, 40, WORLD.w - 40);
    p.y = clamp(p.y + a.y * PLAYER_SPEED * dt, 40, WORLD.h - 40);
    if (p.invuln > 0) p.invuln -= dt;

    // 捡灯芯
    for (const c of S.cores) {
      if (c.taken) continue;
      if (S.carried >= MAX_CARRY) break;
      if (dist(p, c) < 34) {
        c.taken = true;
        S.carried++;
        sfx.pick();
        burst(c.x, c.y, '#ffd98a', 12);
        syncHud();
        if (S.carried >= 3) toast('带得越多，影子越快——' + S.carried + ' 根了');
      }
    }

    // 灯座存入
    if (S.altarCd > 0) S.altarCd = Math.max(0, S.altarCd - dt);
    if (S.pulse > 0) S.pulse = Math.max(0, S.pulse - dt);
    if (dist(p, ALTAR) < ALTAR.r && S.carried > 0 && S.altarCd <= 0) {
      const n = Math.min(S.carried, DEPOSIT_PER_GO);
      S.carried -= n;
      S.deposited += n;
      S.trips++;
      S.altarCd = COOLDOWN;
      S.pulse = 3.2;
      sfx.deposit(); sfx.pulse();
      burst(ALTAR.x, ALTAR.y, '#ffe3a3', 26);
      syncHud();
      toast('存入 ' + n + ' 根 · 灯座冷却 6 秒');
      // 光柱把附近的影子推开
      for (const s of S.shadows) if (dist(s, ALTAR) < 360) s.flee = Math.max(s.flee, 3.4);
      if (S.deposited >= TOTAL_CORES) win();
    }

    // 影子
    const aggro = aggroRadius(), spd = shadowSpeed();
    for (const s of S.shadows) {
      if (s.stun > 0) { s.stun -= dt; continue; }
      if (s.flee > 0) {
        s.flee -= dt;
        const ang = Math.atan2(s.y - p.y, s.x - p.x);
        s.x += Math.cos(ang) * spd * 1.15 * dt;
        s.y += Math.sin(ang) * spd * 1.15 * dt;
        s.x = clamp(s.x, 30, WORLD.w - 30); s.y = clamp(s.y, 30, WORLD.h - 30);
        continue;
      }
      const d = dist(s, p);
      const chasing = S.carried > 0 && d < aggro;
      s.mode = chasing ? 'chase' : 'wander';
      let tx, ty, sp;
      if (chasing) { tx = p.x; ty = p.y; sp = spd; }
      else {
        s.wob += dt * 0.6;
        tx = s.x + Math.cos(s.wob) * 120; ty = s.y + Math.sin(s.wob * 1.3) * 120; sp = 44;
      }
      const ang = Math.atan2(ty - s.y, tx - s.x);
      s.x += Math.cos(ang) * sp * dt;
      s.y += Math.sin(ang) * sp * dt;
      s.x = clamp(s.x, 24, WORLD.w - 24);
      s.y = clamp(s.y, 24, WORLD.h - 24);
      s.eye = chasing ? 1 : Math.max(0, s.eye - dt * 2);

      if (chasing && d < 30 && p.invuln <= 0 && S.carried > 0) steal(s);
    }

    // 粒子 / 雪花
    for (const f of S.flakes) {
      f.y += f.v * dt; f.x += Math.sin(S.t * .6 + f.d) * 10 * dt;
      if (f.y > WORLD.h) { f.y = -10; f.x = Math.random() * WORLD.w; }
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const q = particles[i];
      q.x += q.vx * dt; q.y += q.vy * dt; q.life -= dt;
      if (q.life <= 0) particles.splice(i, 1);
    }
    if (S.shake > 0) S.shake = Math.max(0, S.shake - dt * 2.4);

    // 摄像机
    const tx = clamp(p.x - VW / 2, 0, Math.max(0, WORLD.w - VW));
    const ty = clamp(p.y - VH / 2, 0, Math.max(0, WORLD.h - VH));
    S.cam.x += (tx - S.cam.x) * Math.min(1, dt * 6);
    S.cam.y += (ty - S.cam.y) * Math.min(1, dt * 6);
  }

  function steal(s) {
    S.carried--; S.stolen++;
    S.player.invuln = 1.6;
    S.shake = 1;
    sfx.steal();
    syncHud();
    // 灯芯被丢回雪原（不在灯座附近）
    let nx = 0, ny = 0, guard = 0;
    do {
      const ang = Math.random() * Math.PI * 2, r = 420 + Math.random() * 320;
      nx = clamp(S.player.x + Math.cos(ang) * r, 80, WORLD.w - 80);
      ny = clamp(S.player.y + Math.sin(ang) * r, 80, WORLD.h - 80);
      guard++;
    } while (dist({ x: nx, y: ny }, ALTAR) < 260 && guard < 30);
    S.cores.push({ x: nx, y: ny, phase: Math.random() * 6.28, taken: false, fresh: 2.5 });
    s.stun = 1.1; s.flee = 1.8;
    const ang = Math.atan2(S.player.y - s.y, S.player.x - s.x);
    S.player.x = clamp(S.player.x + Math.cos(ang) * 26, 40, WORLD.w - 40);
    S.player.y = clamp(S.player.y + Math.sin(ang) * 26, 40, WORLD.h - 40);
    toast('影子叼走了一根灯芯');
  }

  function win() {
    S.mode = 'won';
    sfx.win();
    el.winStats.textContent = '用了 ' + Math.round(S.t) + ' 秒 · 存灯 ' + S.trips + ' 次' +
      (S.stolen ? ' · 被影子叼走 ' + S.stolen + ' 次' : ' · 一根没丢');
    el.win.classList.add('show');
    el.hud.hidden = true;
  }

  // ---------------- 绘制 ----------------
  const particles = [];
  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 40 + Math.random() * 150;
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: .5 + Math.random() * .6, color });
    }
  }

  function draw() {
    const dpr = DPR;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, VW, VH);

    const shakeX = S.shake ? (Math.random() - .5) * 10 * S.shake : 0;
    const shakeY = S.shake ? (Math.random() - .5) * 10 * S.shake : 0;

    // 背景
    const g = ctx.createLinearGradient(0, 0, 0, VH);
    g.addColorStop(0, '#0a1424'); g.addColorStop(1, '#060b14');
    ctx.fillStyle = g; ctx.fillRect(0, 0, VW, VH);

    ctx.save();
    ctx.translate(-S.cam.x + shakeX, -S.cam.y + shakeY);

    drawSnowfield();
    drawAltar();
    for (const c of S.cores) if (!c.taken) drawCore(c);
    for (const s of S.shadows) drawShadow(s);
    drawPlayer();
    for (const q of particles) {
      const a = Math.max(0, q.life);
      ctx.globalAlpha = a;
      ctx.fillStyle = q.color;
      ctx.beginPath(); ctx.arc(q.x, q.y, 2.4, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
    drawSnow();
    ctx.restore();

    drawLightMask();
    if (S.mode === 'playing' || S.mode === 'paused') drawEdgeHint();
  }

  function drawSnowfield() {
    ctx.fillStyle = '#0e1b2e';
    ctx.fillRect(0, 0, WORLD.w, WORLD.h);
    // 雪面纹理
    ctx.save();
    for (let i = 0; i < 140; i++) {
      const x = (i * 137.5) % WORLD.w, y = (i * 271.3) % WORLD.h;
      ctx.fillStyle = i % 3 ? 'rgba(150,190,230,.030)' : 'rgba(200,225,255,.048)';
      ctx.beginPath(); ctx.ellipse(x, y, 90 + (i % 5) * 34, 30 + (i % 4) * 12, i * .7, 0, 6.283); ctx.fill();
    }
    ctx.restore();
    // 边界
    ctx.strokeStyle = 'rgba(120,170,220,.10)'; ctx.lineWidth = 4;
    ctx.strokeRect(6, 6, WORLD.w - 12, WORLD.h - 12);
  }

  function drawAltar() {
    const { x, y, r } = ALTAR;
    // 光晕
    const glow = ctx.createRadialGradient(x, y, 10, x, y, r * 3.2);
    const p = S.pulse > 0 ? Math.min(1, S.pulse / 3.2) : 0;
    glow.addColorStop(0, `rgba(255,207,107,${0.14 + p * 0.22})`);
    glow.addColorStop(.5, 'rgba(255,207,107,.05)');
    glow.addColorStop(1, 'rgba(255,207,107,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(x, y, r * 3.2, 0, 6.283); ctx.fill();

    // 石座
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283);
    ctx.fillStyle = 'rgba(30,44,64,.9)'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,207,107,.35)'; ctx.stroke();

    // 冷却环
    if (S.altarCd > 0) {
      ctx.beginPath();
      ctx.arc(x, y, r + 12, -Math.PI / 2, -Math.PI / 2 + (S.altarCd / COOLDOWN) * 6.283);
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,207,107,.55)'; ctx.stroke();
    }

    // 6 个灯位
    for (let i = 0; i < TOTAL_CORES; i++) {
      const ang = -Math.PI / 2 + (i / TOTAL_CORES) * 6.283;
      const cx = x + Math.cos(ang) * (r * .58), cy = y + Math.sin(ang) * (r * .58);
      const lit = i < S.deposited;
      ctx.beginPath(); ctx.arc(cx, cy, 11, 0, 6.283);
      ctx.fillStyle = lit ? '#ffd98a' : 'rgba(255,255,255,.10)';
      ctx.fill();
      if (lit) {
        const lg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 42);
        lg.addColorStop(0, 'rgba(255,217,138,.5)'); lg.addColorStop(1, 'rgba(255,217,138,0)');
        ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(cx, cy, 42, 0, 6.283); ctx.fill();
      }
    }
    // 中央灯
    const litAll = S.deposited >= TOTAL_CORES;
    const cr = litAll ? 26 : 14;
    const cg = ctx.createRadialGradient(x, y, 0, x, y, cr * 3);
    cg.addColorStop(0, litAll ? 'rgba(255,240,190,.95)' : 'rgba(255,207,107,.55)');
    cg.addColorStop(1, 'rgba(255,207,107,0)');
    ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(x, y, cr * 3, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#fff6d8'; ctx.beginPath(); ctx.arc(x, y, cr * .55, 0, 6.283); ctx.fill();
  }

  function drawCore(c) {
    const pulse = 1 + Math.sin(S.t * 3 + c.phase) * .16;
    const r = 13 * pulse;
    const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, 46);
    g.addColorStop(0, 'rgba(255,235,180,.95)');
    g.addColorStop(.35, 'rgba(255,207,107,.45)');
    g.addColorStop(1, 'rgba(255,207,107,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x, c.y, 46, 0, 6.283); ctx.fill();
    ctx.fillStyle = '#fff2cf';
    ctx.beginPath(); ctx.arc(c.x, c.y, r * .6, 0, 6.283); ctx.fill();
    ctx.strokeStyle = 'rgba(255,231,178,.55)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(c.x, c.y, r * 1.5, 0, 6.283); ctx.stroke();
    if (c.fresh > 0) c.fresh -= 1 / 60;
  }

  function drawShadow(s) {
    const d = dist(s, S.player);
    const lr = lightRadius();
    let a = clamp((lr + 90 - d) / 220, 0, 1);
    if (s.mode === 'chase') a = Math.max(a, .55);
    if (a <= 0.02) return;
    ctx.save();
    ctx.globalAlpha = 0.35 + a * 0.6;
    // 身体
    const wob = Math.sin(S.t * 3 + s.wob) * 4;
    ctx.beginPath();
    ctx.ellipse(s.x, s.y + 6 + wob, 20, 15, 0, 0, 6.283);
    ctx.fillStyle = '#04060c'; ctx.fill();
    ctx.beginPath();
    ctx.arc(s.x, s.y - 6 + wob * .5, 13, 0, 6.283);
    ctx.fillStyle = '#04060c'; ctx.fill();
    // 眼睛
    const eyeA = s.mode === 'chase' ? 1 : .35 + s.eye * .5;
    ctx.fillStyle = s.mode === 'chase' ? 'rgba(255,110,90,.95)' : 'rgba(150,175,205,.55)';
    ctx.beginPath(); ctx.arc(s.x - 5, s.y - 7 + wob * .5, 2.2 * eyeA, 0, 6.283); ctx.fill();
    ctx.beginPath(); ctx.arc(s.x + 5, s.y - 7 + wob * .5, 2.2 * eyeA, 0, 6.283); ctx.fill();
    ctx.restore();
  }

  function drawPlayer() {
    const p = S.player;
    const bobbing = p.moving ? Math.sin(S.t * 12) * 2 : Math.sin(S.t * 2.4) * 1.1;
    const lx = p.x + 17, ly = p.y - 6 + bobbing;

    // 提灯光晕
    const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, 64);
    lg.addColorStop(0, 'rgba(255,244,214,.95)');
    lg.addColorStop(.28, 'rgba(255,214,140,.55)');
    lg.addColorStop(1, 'rgba(255,207,107,0)');
    ctx.fillStyle = lg; ctx.beginPath(); ctx.arc(lx, ly, 64, 0, 6.283); ctx.fill();

    // 脚下阴影
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.beginPath(); ctx.ellipse(p.x, p.y + 20, 15, 6, 0, 0, 6.283); ctx.fill();

    ctx.save();
    ctx.translate(p.x, p.y + bobbing);

    // 斗篷
    const cg = ctx.createLinearGradient(-16, -8, 14, 24);
    cg.addColorStop(0, '#48678c'); cg.addColorStop(1, '#1a2739');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.moveTo(-11, -4); ctx.quadraticCurveTo(-20, 16, -17, 24);
    ctx.lineTo(13, 24); ctx.quadraticCurveTo(18, 12, 11, -4);
    ctx.closePath(); ctx.fill();

    // 兜帽 + 头
    const hg = ctx.createLinearGradient(-10, -22, 10, -4);
    hg.addColorStop(0, '#5c7fa6'); hg.addColorStop(1, '#22354b');
    ctx.fillStyle = hg;
    ctx.beginPath(); ctx.arc(0, -10, 10.5, 0, 6.283); ctx.fill();
    ctx.fillStyle = 'rgba(240,215,175,.9)';
    ctx.beginPath(); ctx.arc(1.5, -8.5, 5.2, 0, 6.283); ctx.fill();

    // 提灯侧暖边光
    ctx.strokeStyle = 'rgba(255,214,140,.55)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, -10, 10.5, -1.15, 0.55); ctx.stroke();

    // 手提灯绳
    ctx.strokeStyle = 'rgba(150,120,80,.9)'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(10, -2); ctx.lineTo(17, -6); ctx.stroke();
    ctx.restore();

    // 提灯本体
    ctx.fillStyle = '#2a2118';
    ctx.beginPath(); ctx.roundRect ? ctx.roundRect(lx - 5, ly - 6, 10, 13, 3) : ctx.rect(lx - 5, ly - 6, 10, 13);
    ctx.fill();
    ctx.fillStyle = '#fff3cf';
    ctx.beginPath(); ctx.arc(lx, ly, 3.6, 0, 6.283); ctx.fill();

    // 携带的灯芯绕圈
    for (let i = 0; i < S.carried; i++) {
      const ang = S.t * 1.6 + (i / Math.max(1, S.carried)) * 6.283;
      const rr = 28 + (i % 2) * 7;
      const cx = p.x + Math.cos(ang) * rr, cy = p.y - 8 + Math.sin(ang) * rr * .62;
      const cg2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, 12);
      cg2.addColorStop(0, 'rgba(255,246,216,.95)'); cg2.addColorStop(1, 'rgba(255,207,107,0)');
      ctx.fillStyle = cg2; ctx.beginPath(); ctx.arc(cx, cy, 12, 0, 6.283); ctx.fill();
      ctx.fillStyle = '#fff8e6'; ctx.beginPath(); ctx.arc(cx, cy, 2.8, 0, 6.283); ctx.fill();
    }

    if (p.invuln > 0) {
      ctx.strokeStyle = `rgba(255,120,110,${0.35 + Math.sin(S.t * 20) * .2})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, 28, 0, 6.283); ctx.stroke();
    }
  }

  function drawSnow() {
    ctx.fillStyle = 'rgba(220,235,255,.5)';
    for (const f of S.flakes) {
      ctx.globalAlpha = .25 + f.s * .22;
      ctx.beginPath(); ctx.arc(f.x, f.y, f.s, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawLightMask() {
    const p = S.player;
    const sx = p.x - S.cam.x, sy = p.y - S.cam.y;
    const r = lightRadius();
    const g = ctx.createRadialGradient(sx, sy, r * .28, sx, sy, r);
    g.addColorStop(0, 'rgba(3,6,12,0)');
    g.addColorStop(.55, 'rgba(3,6,12,.30)');
    g.addColorStop(.85, 'rgba(3,6,12,.80)');
    g.addColorStop(1, 'rgba(2,4,9,.90)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VW, VH);

    // 灯座自身的光
    const ax = ALTAR.x - S.cam.x, ay = ALTAR.y - S.cam.y;
    const ar = 240 + S.pulse * 60;
    const ag = ctx.createRadialGradient(ax, ay, 10, ax, ay, ar);
    ag.addColorStop(0, `rgba(255,207,107,${.16 + (S.pulse > 0 ? .18 : 0)})`);
    ag.addColorStop(1, 'rgba(255,207,107,0)');
    ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(ax, ay, ar, 0, 6.283); ctx.fill();

    // 暗角
    const vg = ctx.createRadialGradient(VW / 2, VH / 2, Math.min(VW, VH) * .35, VW / 2, VH / 2, Math.max(VW, VH) * .78);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.42)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, VW, VH);
  }

  let hintT = 0;
  function drawEdgeHint() {
    // 屏幕边缘指示最近的灯芯方向
    hintT += 1 / 60;
    let best = null, bd = 1e9;
    for (const c of S.cores) if (!c.taken) { const d = dist(c, S.player); if (d < bd) { bd = d; best = c; } }
    if (!best) return;
    const sx = best.x - S.cam.x, sy = best.y - S.cam.y;
    if (sx > 20 && sx < VW - 20 && sy > 20 && sy < VH - 20) return;
    const ang = Math.atan2(best.y - S.player.y, best.x - S.player.x);
    const cx = VW / 2 + Math.cos(ang) * (VW / 2 - 34);
    const cy = VH / 2 + Math.sin(ang) * (VH / 2 - 34);
    ctx.save();
    ctx.globalAlpha = .55 + Math.sin(hintT * 3) * .2;
    ctx.translate(cx, cy); ctx.rotate(ang);
    ctx.fillStyle = 'rgba(255,207,107,.9)';
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-7, 6); ctx.lineTo(-7, -6); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // ---------------- HUD ----------------
  function syncHud() {
    el.carry.textContent = S.carried;
    el.altar.textContent = S.deposited;
    el.pillCarry.classList.toggle('danger', S.carried >= 3);
    el.sockets.innerHTML = '';
    for (let i = 0; i < TOTAL_CORES; i++) {
      const i2 = document.createElement('i');
      if (i < S.deposited) i2.className = 'on';
      el.sockets.appendChild(i2);
    }
  }

  let toastTimer = 0;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2200);
  }

  // ---------------- 流程控制 ----------------
  function pauseGame() {
    if (S.mode !== 'playing') return;
    S.mode = 'paused'; el.pause.classList.add('show');
  }
  function resumeGame() {
    if (S.mode !== 'paused') return;
    S.mode = 'playing'; el.pause.classList.remove('show');
    last = performance.now();
  }

  el.btnStart.addEventListener('click', startGame);
  el.btnAgain.addEventListener('click', startGame);
  el.btnResume.addEventListener('click', resumeGame);
  el.btnRestart.addEventListener('click', () => { el.pause.classList.remove('show'); startGame(); });
  el.btnPause.addEventListener('click', pauseGame);
  el.btnSound.addEventListener('click', () => {
    soundOn = !soundOn;
    el.btnSound.textContent = soundOn ? '音效 开' : '音效 关';
    el.btnSound.setAttribute('aria-pressed', String(soundOn));
  });

  // ---------------- 主循环 ----------------
  let last = 0;
  function loop(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    if (S.mode === 'playing') update(dt);
    draw();
    requestAnimationFrame(loop);
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  fitCanvas();
  resetRun();
  requestAnimationFrame(t => { last = t; loop(t); });

  // 调试/自动化测试接口（不影响正常玩法）
  window.__game = {
    S, start: startGame, update, draw, win, syncHud,
    moveTo(x, y) { S.player.x = x; S.player.y = y; },
    step(n = 1) { for (let i = 0; i < n; i++) update(1 / 60); },
    get info() {
      return {
        mode: S.mode, carried: S.carried, deposited: S.deposited,
        coresLeft: S.cores.filter(c => !c.taken).length, shadows: S.shadows.length,
        cd: +S.altarCd.toFixed(2), radius: lightRadius(),
      };
    },
  };
})();
