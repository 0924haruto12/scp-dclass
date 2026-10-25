import { ROOM } from '../core/constants.js';

export function cameraFor(trial, width) {
  const scale = Math.max(38, Math.min(66, width / 17));
  const halfWidth = width / (2 * scale);
  const x = Math.min(
    ROOM.maxX - halfWidth + 1.2,
    Math.max(halfWidth - 1.2, trial.player.x),
  );
  return { x, y: 0, scale };
}

function corridorGradient(ctx, width, height) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, '#08090b');
  gradient.addColorStop(0.5, '#101216');
  gradient.addColorStop(1, '#08090b');
  return gradient;
}

export function renderTrial(ctx, trial, { width, height, time }) {
  const { x: camX, y: camY, scale } = cameraFor(trial, width);
  const approach = trial.follow.mode === 'approach';
  const danger = trial.follow.danger;
  const shake = approach ? Math.sin(time * 42) * danger * 1.4 : 0;
  const sx = (x) => (x - camX) * scale + width / 2 + shake;
  const sy = (y) => (y - camY) * scale + height / 2;

  ctx.save();
  ctx.fillStyle = corridorGradient(ctx, width, height);
  ctx.fillRect(0, 0, width, height);

  // 壁
  ctx.fillStyle = '#0a0b0d';
  ctx.fillRect(0, 0, width, sy(-ROOM.halfWidth));
  ctx.fillRect(0, sy(ROOM.halfWidth), width, height);

  // 壁のパネル目地
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.045)';
  ctx.lineWidth = 1;
  for (let x = 2; x < ROOM.maxX; x += 3) {
    ctx.beginPath();
    ctx.moveTo(sx(x), sy(-ROOM.halfWidth));
    ctx.lineTo(sx(x), sy(-ROOM.halfWidth - 1.1));
    ctx.moveTo(sx(x), sy(ROOM.halfWidth));
    ctx.lineTo(sx(x), sy(ROOM.halfWidth + 1.1));
    ctx.stroke();
  }

  // 天井の照明
  for (let x = 4; x < ROOM.maxX; x += 6) {
    const lx = sx(x);
    const ly = sy(-ROOM.halfWidth - 0.55);
    const glow = ctx.createRadialGradient(lx, ly, 0, lx, ly, 1.6 * scale);
    glow.addColorStop(0, 'rgba(214, 198, 160, 0.16)');
    glow.addColorStop(1, 'rgba(214, 198, 160, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(lx, ly, 1.6 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(228, 214, 180, 0.5)';
    ctx.fillRect(lx - 0.18 * scale, ly - 2, 0.36 * scale, 4);
  }

  // 床
  ctx.fillStyle = '#15171b';
  ctx.fillRect(sx(ROOM.minX), sy(-ROOM.halfWidth), (ROOM.maxX - ROOM.minX) * scale, ROOM.halfWidth * 2 * scale);

  // 照明の床反射
  for (let x = 4; x < ROOM.maxX; x += 6) {
    const lx = sx(x);
    const ly = sy(0);
    const pool = ctx.createRadialGradient(lx, ly, 0, lx, ly, 2.4 * scale);
    pool.addColorStop(0, 'rgba(214, 198, 160, 0.05)');
    pool.addColorStop(1, 'rgba(214, 198, 160, 0)');
    ctx.fillStyle = pool;
    ctx.beginPath();
    ctx.ellipse(lx, ly, 2.4 * scale, 1.25 * scale, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 床の目地
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.035)';
  ctx.lineWidth = 1;
  for (let x = ROOM.minX; x <= ROOM.maxX; x += 2) {
    ctx.beginPath();
    ctx.moveTo(sx(x), sy(-ROOM.halfWidth));
    ctx.lineTo(sx(x), sy(ROOM.halfWidth));
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(sx(ROOM.minX), sy(0));
  ctx.lineTo(sx(ROOM.maxX), sy(0));
  ctx.stroke();

  // 擦り跡（一定間隔）
  ctx.strokeStyle = 'rgba(180, 165, 140, 0.14)';
  ctx.lineWidth = 1.5;
  for (let x = 4.2; x < 22; x += 2.1) {
    const y = 0.55;
    ctx.beginPath();
    ctx.moveTo(sx(x), sy(y - 0.12));
    ctx.lineTo(sx(x + 0.55), sy(y + 0.12));
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx(x + 0.15), sy(-y - 0.1));
    ctx.lineTo(sx(x + 0.6), sy(-y + 0.1));
    ctx.stroke();
  }

  // 壁の縁
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(sx(ROOM.minX), sy(-ROOM.halfWidth));
  ctx.lineTo(sx(ROOM.maxX), sy(-ROOM.halfWidth));
  ctx.moveTo(sx(ROOM.minX), sy(ROOM.halfWidth));
  ctx.lineTo(sx(ROOM.maxX), sy(ROOM.halfWidth));
  ctx.stroke();

  // 赤線と青線
  const line = (x, color, alpha) => {
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx(x), sy(-ROOM.halfWidth + 0.05));
    ctx.lineTo(sx(x), sy(ROOM.halfWidth - 0.05));
    ctx.stroke();
    ctx.globalAlpha = 1;
  };
  line(ROOM.redLineX, '#c2453b', 0.55);
  line(ROOM.blueLineX, '#6d8ba6', 0.55);

  // 入口の扉
  ctx.fillStyle = '#0c0d10';
  ctx.strokeStyle = trial.flags.blockedExitWarned && approach ? '#8e332b' : '#3a3f48';
  ctx.lineWidth = 2;
  ctx.fillRect(sx(-0.4), sy(-0.95), 0.45 * scale, 1.9 * scale);
  ctx.strokeRect(sx(-0.4), sy(-0.95), 0.45 * scale, 1.9 * scale);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.font = `${Math.max(9, scale * 0.22)}px monospace`;
  ctx.fillText('A-01', sx(-0.32), sy(1.22));

  // 扉脇の斜線表示（出口の目印）
  ctx.save();
  ctx.strokeStyle = 'rgba(201, 162, 74, 0.32)';
  ctx.lineWidth = 2;
  for (let y = -0.9; y < 0.9; y += 0.22) {
    ctx.beginPath();
    ctx.moveTo(sx(-0.58), sy(y));
    ctx.lineTo(sx(-0.44), sy(y + 0.16));
    ctx.stroke();
  }
  ctx.restore();

  // 回収箱
  if (!trial.box.collected) {
    const size = 0.55 * scale;
    const bx = sx(trial.box.x);
    const by = sy(trial.box.y);
    const halo = ctx.createRadialGradient(bx, by, 0, bx, by, 2.1 * scale);
    halo.addColorStop(0, 'rgba(201, 162, 74, 0.12)');
    halo.addColorStop(1, 'rgba(201, 162, 74, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(bx, by, 2.1 * scale, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(bx, by);
    ctx.fillStyle = '#2a2418';
    ctx.strokeStyle = '#c9a24a';
    ctx.lineWidth = 1.5;
    ctx.fillRect(-size / 2, -size / 2, size, size);
    ctx.strokeRect(-size / 2, -size / 2, size, size);
    ctx.strokeStyle = 'rgba(201, 162, 74, 0.4)';
    ctx.beginPath();
    ctx.moveTo(-size / 2, 0);
    ctx.lineTo(size / 2, 0);
    ctx.stroke();
    ctx.restore();
  }

  // 接近中の気配（画面表示の前兆）
  if (approach) {
    const px = sx(trial.player.x - Math.cos(trial.player.facing) * 1.5);
    const py = sy(trial.player.y - Math.sin(trial.player.facing) * 1.5);
    const radius = (1.1 + danger * 0.12) * scale;
    const gradient = ctx.createRadialGradient(px, py, 0, px, py, radius);
    gradient.addColorStop(0, `rgba(0, 0, 0, ${0.25 + danger * 0.08})`);
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // プレイヤー
  const playerX = sx(trial.player.x);
  const playerY = sy(trial.player.y);
  const radius = 0.32 * scale;
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.beginPath();
  ctx.ellipse(playerX + 3, playerY + 5, radius * 1.05, radius * 0.75, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#d8d1c2';
  ctx.beginPath();
  ctx.arc(playerX, playerY, radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#9e9688';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.strokeStyle = '#f0e9d9';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(playerX, playerY);
  ctx.lineTo(
    playerX + Math.cos(trial.player.facing) * radius * 1.5,
    playerY + Math.sin(trial.player.facing) * radius * 1.5,
  );
  ctx.stroke();
  ctx.restore();

  // 暗がり
  const fog = ctx.createRadialGradient(playerX, playerY, 2.5 * scale, playerX, playerY, 9.5 * scale);
  fog.addColorStop(0, 'rgba(3, 4, 6, 0)');
  fog.addColorStop(0.55, 'rgba(3, 4, 6, 0.25)');
  fog.addColorStop(1, 'rgba(3, 4, 6, 0.8)');
  ctx.fillStyle = fog;
  ctx.fillRect(0, 0, width, height);

  // 線の名前は暗がりの上に置く（初見でも区間を確認できるように）
  ctx.font = `${Math.max(9, Math.min(12, scale * 0.18))}px monospace`;
  ctx.fillStyle = 'rgba(194, 69, 59, 0.72)';
  ctx.fillText('赤線', sx(ROOM.redLineX) + 6, sy(-ROOM.halfWidth + 0.32));
  ctx.fillStyle = 'rgba(130, 160, 188, 0.75)';
  ctx.fillText('青線', sx(ROOM.blueLineX) + 6, sy(-ROOM.halfWidth + 0.32));

  // 接近時の赤い脈
  if (approach) {
    const pulse = 0.18 + Math.sin(time * 9) * 0.05 + danger * 0.06;
    const vignette = ctx.createRadialGradient(
      width / 2,
      height / 2,
      Math.min(width, height) * 0.25,
      width / 2,
      height / 2,
      Math.max(width, height) * 0.72,
    );
    vignette.addColorStop(0, 'rgba(120, 20, 16, 0)');
    vignette.addColorStop(1, `rgba(120, 20, 16, ${Math.max(0, pulse)})`);
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  }

  ctx.restore();
  return { camX, camY, scale };
}
