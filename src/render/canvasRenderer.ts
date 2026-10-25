import { GameState, Trial } from '../core/types';
import { getWhiteDoorSequence } from '../core/trials';

export class TrialCanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 2D context not available');
    }
    this.ctx = context;
  }

  public render(state: GameState): void {
    const trial = state.trial;
    const { width, height } = this.canvas;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#090b0e';
    ctx.fillRect(0, 0, width, height);

    if (!trial) {
      this.renderIdleScreen(state);
      return;
    }

    if (trial.roomCode === 'T-101') {
      this.renderT101(state, trial);
    } else if (trial.roomCode === 'T-204') {
      this.renderT204(state, trial);
    } else if (trial.roomCode === 'T-309') {
      this.renderT309(state, trial);
    }

    this.renderHUD(state, trial);
  }

  private renderIdleScreen(state: GameState): void {
    const ctx = this.ctx;
    const { width, height } = this.canvas;
    ctx.fillStyle = '#11161d';
    ctx.fillRect(20, 20, width - 40, height - 40);
    ctx.strokeStyle = '#2a3441';
    ctx.strokeRect(20, 20, width - 40, height - 40);

    ctx.fillStyle = '#8fa3b8';
    ctx.font = '13px "JetBrains Mono", monospace';
    ctx.fillText(
      `SITE-19 SURVEILLANCE FEED // CYCLE: ${state.cycle.cycleId} // DAY ${state.cycle.day}`,
      40,
      52
    );
  }

  private renderT101(state: GameState, trial: Trial): void {
    const ctx = this.ctx;
    const { width, height } = this.canvas;

    // Map 0..24m to x: 70 .. width-70
    const leftPad = 70;
    const rightPad = 70;
    const trackWidth = width - leftPad - rightPad;
    const scaleX = trackWidth / 24;
    const centerY = height * 0.5;
    const halfCorridorPx = 68;

    const toPxX = (x: number) => leftPad + x * scaleX;
    const toPxY = (y: number) => centerY + y * 32;

    // Corridor floor
    ctx.fillStyle = '#161b22';
    ctx.fillRect(leftPad, centerY - halfCorridorPx, trackWidth, halfCorridorPx * 2);

    // Grid lines every 2m
    ctx.strokeStyle = '#212832';
    ctx.lineWidth = 1;
    for (let m = 0; m <= 24; m += 2) {
      const gx = toPxX(m);
      ctx.beginPath();
      ctx.moveTo(gx, centerY - halfCorridorPx);
      ctx.lineTo(gx, centerY + halfCorridorPx);
      ctx.stroke();

      ctx.fillStyle = '#4a5568';
      ctx.font = '10px monospace';
      ctx.fillText(`${m}m`, gx - 8, centerY + halfCorridorPx + 14);
    }

    // Blue Line at 8m and Red Line at 16m
    const blueX = toPxX(8);
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(blueX, centerY - halfCorridorPx);
    ctx.lineTo(blueX, centerY + halfCorridorPx);
    ctx.stroke();
    ctx.fillStyle = '#60a5fa';
    ctx.font = '11px sans-serif';
    ctx.fillText('青線 (8m)', blueX - 24, centerY - halfCorridorPx - 8);

    const redX = toPxX(16);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(redX, centerY - halfCorridorPx);
    ctx.lineTo(redX, centerY + halfCorridorPx);
    ctx.stroke();
    ctx.fillStyle = '#f87171';
    ctx.fillText('赤線 (16m)', redX - 26, centerY - halfCorridorPx - 8);

    // Exit door at 0m
    ctx.fillStyle = trial.player.carryingObjective ? '#22c55e' : '#64748b';
    ctx.fillRect(leftPad - 8, centerY - 36, 8, 72);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '11px sans-serif';
    ctx.fillText('出入口(0m)', leftPad - 24, centerY - halfCorridorPx - 8);

    // Camera wiring along north wall (Section 5.2: カメラの位置と稼働ランプ・配線を事前に見せる)
    const camX = toPxX(12);
    const camY = centerY - halfCorridorPx + 8;
    ctx.strokeStyle = '#7f1d1d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(leftPad, centerY - halfCorridorPx + 4);
    ctx.lineTo(camX, camY);
    ctx.stroke();

    // Camera cone indicator
    ctx.fillStyle = 'rgba(239, 68, 68, 0.06)';
    ctx.beginPath();
    ctx.moveTo(camX, camY);
    ctx.lineTo(camX - 90, centerY + halfCorridorPx);
    ctx.lineTo(camX + 90, centerY + halfCorridorPx);
    ctx.closePath();
    ctx.fill();

    // Camera body + active red lamp
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(camX, camY, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fca5a5';
    ctx.font = '10px monospace';
    ctx.fillText('CAM-101 [REC]', camX - 36, camY - 14);

    // Scuff marks & torn slip at 9m
    const scuffX = toPxX(9);
    const scuffY = toPxY(0.6);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 2;
    ctx.strokeRect(scuffX - 8, scuffY - 6, 16, 12);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px sans-serif';
    ctx.fillText('擦り跡・回収票', scuffX - 32, scuffY + 22);

    // Collection box at 24m (if not carried yet)
    if (!trial.player.carryingObjective) {
      const boxX = toPxX(24) - 14;
      ctx.fillStyle = '#eab308';
      ctx.fillRect(boxX - 10, centerY - 12, 20, 24);
      ctx.strokeStyle = '#fef08a';
      ctx.strokeRect(boxX - 10, centerY - 12, 20, 24);
      ctx.fillStyle = '#fef08a';
      ctx.font = '11px sans-serif';
      ctx.fillText('回収箱', boxX - 16, centerY - 18);
    }

    // Corridor walls
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 3;
    ctx.strokeRect(leftPad, centerY - halfCorridorPx, trackWidth, halfCorridorPx * 2);

    // Player coordinates
    const px = toPxX(trial.player.x);
    const py = toPxY(trial.player.y);

    // Apply Vision Cone darkness outside player's 95-degree sector
    this.renderVisionConeOverlay(
      px,
      py,
      trial.player.facingAngle,
      230,
      Math.PI * 0.58,
      state.subject.inventory.includes('small_mirror')
    );

    // Draw Acoustic Sound Ripples (音紋) - visible even outside the vision cone! (Section 1: 視界外にも音は届く。遮蔽物を透視しない)
    const echoDist =
      trial.gait.state === 'approaching'
        ? Math.max(0.6, 3.0 - trial.hazardTimer * 0.85)
        : trial.gait.state === 'retreating'
        ? 3.8
        : 3.0;
    const soundSourceX = toPxX(Math.max(0, trial.player.x - echoDist));
    const soundSourceY = py;

    if (
      trial.gait.state === 'approaching' ||
      trial.gait.state === 'retreating' ||
      trial.player.moveMode !== 'stop'
    ) {
      const rippleColor =
        trial.gait.state === 'approaching'
          ? 'rgba(239, 68, 68, 0.85)'
          : trial.gait.state === 'retreating'
          ? 'rgba(56, 189, 248, 0.7)'
          : 'rgba(148, 163, 184, 0.55)';
      const pulseRadius = 10 + ((trial.externalClock * 24) % 18);
      ctx.strokeStyle = rippleColor;
      ctx.lineWidth = trial.gait.state === 'approaching' ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.arc(soundSourceX, soundSourceY, pulseRadius, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(soundSourceX, soundSourceY, pulseRadius * 0.55, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = rippleColor;
      ctx.font = '11px sans-serif';
      ctx.fillText(
        trial.gait.state === 'approaching'
          ? '(( 接近足音！ ))'
          : trial.gait.state === 'retreating'
          ? '(( 足音が遠のく ))'
          : '(( 追従音 ))',
        soundSourceX - 36,
        soundSourceY - 22
      );
    }

    // Draw Player token
    this.drawPlayerToken(px, py, trial.player.facingAngle, trial.player.carryingObjective);
  }

  private renderT204(state: GameState, trial: Trial): void {
    const ctx = this.ctx;
    const { width, height } = this.canvas;
    const leftPad = 70;
    const topPad = 55;
    const roomW = width - 140;
    const roomH = height - 110;

    const toPxX = (x: number) => leftPad + (x / 16) * roomW;
    const toPxY = (y: number) => topPad + ((y + 2.5) / 5.0) * roomH;

    // Floor
    ctx.fillStyle = '#161b22';
    ctx.fillRect(leftPad, topPad, roomW, roomH);
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 3;
    ctx.strokeRect(leftPad, topPad, roomW, roomH);

    // Partition wall for Interview Booth
    const boothX = toPxX(8.5);
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(boothX, topPad);
    ctx.lineTo(boothX, topPad + roomH * 0.35);
    ctx.moveTo(boothX, topPad + roomH * 0.65);
    ctx.lineTo(boothX, topPad + roomH);
    ctx.stroke();

    // Camera surveillance zone around Restricted Cabinet (x=14.5, y=-1.3)
    const camX = toPxX(14.5);
    const camY = toPxY(-1.3);
    ctx.fillStyle = 'rgba(239, 68, 68, 0.14)';
    ctx.beginPath();
    ctx.arc(camX, camY, 48, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#fca5a5';
    ctx.font = '10px monospace';
    ctx.fillText('CAM-204 監視範囲', camX - 44, camY - 54);

    // Interactables
    for (const obj of trial.interactables) {
      const ox = toPxX(obj.x);
      const oy = toPxY(obj.y);
      ctx.fillStyle = obj.restricted
        ? '#991b1b'
        : obj.inspected
        ? '#1e3a8a'
        : '#0f766e';
      ctx.fillRect(ox - 16, oy - 12, 32, 24);
      ctx.strokeStyle = '#99f6e4';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(ox - 16, oy - 12, 32, 24);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '11px sans-serif';
      ctx.fillText(obj.label.split('（')[0], ox - 45, oy + 26);
    }

    const px = toPxX(trial.player.x);
    const py = toPxY(trial.player.y);
    this.renderVisionConeOverlay(
      px,
      py,
      trial.player.facingAngle,
      240,
      Math.PI * 0.62,
      state.subject.inventory.includes('small_mirror')
    );
    this.drawPlayerToken(px, py, trial.player.facingAngle, trial.badge.wearingSuppliedBadge);
  }

  private renderT309(state: GameState, trial: Trial): void {
    const ctx = this.ctx;
    const { width, height } = this.canvas;
    const wd = trial.whiteDoor;

    // Omen pulsing background
    const isOmen = trial.omen.active;
    const pulseAlpha = isOmen ? 0.14 + 0.1 * Math.sin(trial.externalClock * 12) : 0;

    const boxW = 360;
    const boxH = 220;
    const left = (width - boxW) / 2;
    const top = (height - boxH) / 2 + 10;

    ctx.fillStyle = isOmen ? `rgba(127, 29, 29, ${0.25 + pulseAlpha})` : '#141a23';
    ctx.fillRect(left, top, boxW, boxH);
    ctx.strokeStyle = isOmen ? '#f87171' : '#475569';
    ctx.lineWidth = 3;
    ctx.strokeRect(left, top, boxW, boxH);

    // Draw Topology Header
    const seq = getWhiteDoorSequence(wd.phase);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '12px monospace';
    ctx.fillText(
      wd.mainSectorOpened
        ? `現在地：室 ${wd.currentRoom}  |  接続順序：${
            wd.windowDemoWatched ? seq.join(' ↔ ') : '？'
          }  |  記録板：${wd.recordingBoardCollected ? '回収済' : '未回収'}`
        : '現在地：T-309 前室（安全区域・外部時計待機中）',
      left,
      top - 14
    );

    const toPxX = (lx: number) => left + ((lx + 1.5) / 3.0) * boxW;
    const toPxY = (ly: number) => top + ((ly + 1.0) / 2.0) * boxH;

    if (wd.mainSectorOpened) {
      // Draw Central Blue Emergency Light Anchor Point (青い非常灯の固定点, radius 0.8)
      const cx = toPxX(0);
      const cy = toPxY(0);
      const rx = (0.8 / 3.0) * boxW;
      ctx.fillStyle = wd.onAnchorPoint
        ? 'rgba(14, 165, 233, 0.28)'
        : 'rgba(14, 165, 233, 0.12)';
      ctx.beginPath();
      ctx.arc(cx, cy, rx, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      ctx.fillStyle = '#7dd3fc';
      ctx.font = '11px sans-serif';
      ctx.fillText('青い非常灯 [固定点・退避安全圏]', cx - 82, cy - rx - 8);

      // Recording board in room P
      if (wd.currentRoom === 'P' && !wd.recordingBoardCollected) {
        const bx = toPxX(0.6);
        const by = toPxY(0);
        ctx.fillStyle = '#eab308';
        ctx.fillRect(bx - 12, by - 12, 24, 24);
        ctx.fillStyle = '#fef08a';
        ctx.fillText('記録板', bx - 18, by - 16);
      }
    } else {
      // Anteroom objects
      for (const obj of trial.interactables.filter((i) => i.roomId === 'ANTEROOM')) {
        const ox = toPxX(obj.x);
        const oy = toPxY(obj.y);
        ctx.fillStyle = obj.inspected ? '#1d4ed8' : '#0f766e';
        ctx.fillRect(ox - 16, oy - 12, 32, 24);
        ctx.strokeStyle = '#99f6e4';
        ctx.strokeRect(ox - 16, oy - 12, 32, 24);
        ctx.fillStyle = '#e2e8f0';
        ctx.font = '11px sans-serif';
        ctx.fillText(obj.label.replace('前室：', ''), ox - 60, oy + 26);
      }
    }

    const px = toPxX(trial.player.x);
    const py = toPxY(trial.player.y);
    this.renderVisionConeOverlay(
      px,
      py,
      trial.player.facingAngle,
      220,
      Math.PI * 0.65,
      state.subject.inventory.includes('small_mirror')
    );
    this.drawPlayerToken(px, py, trial.player.facingAngle, trial.player.carryingObjective);
  }

  private renderVisionConeOverlay(
    px: number,
    py: number,
    facingAngle: number,
    coneRadius: number,
    coneSpread: number,
    hasSmallMirror: boolean
  ): void {
    const ctx = this.ctx;
    const { width, height } = this.canvas;

    ctx.save();
    // Darken outside vision cone (Section 1: 見下ろし2D＋視界コーン。視界の外は暗く、音だけが届く)
    ctx.fillStyle = 'rgba(5, 7, 10, 0.72)';
    ctx.beginPath();
    ctx.rect(0, 0, width, height);

    // Cut out main forward vision cone
    ctx.moveTo(px, py);
    ctx.arc(
      px,
      py,
      coneRadius,
      facingAngle - coneSpread / 2,
      facingAngle + coneSpread / 2,
      false
    );
    ctx.closePath();

    // Small personal ambient circle around feet
    ctx.moveTo(px + 28, py);
    ctx.arc(px, py, 28, 0, Math.PI * 2, false);

    // If holding small_mirror, add a narrow rear-peek sector!
    if (hasSmallMirror) {
      ctx.moveTo(px, py);
      ctx.arc(
        px,
        py,
        110,
        facingAngle + Math.PI - 0.28,
        facingAngle + Math.PI + 0.28,
        false
      );
      ctx.closePath();
    }

    ctx.fill('evenodd');

    // Subtle vision cone border
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.arc(
      px,
      py,
      coneRadius,
      facingAngle - coneSpread / 2,
      facingAngle + coneSpread / 2
    );
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  private drawPlayerToken(
    px: number,
    py: number,
    facingAngle: number,
    carrying: boolean
  ): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(facingAngle);

    // Player body (D-Class orange jumpsuit dot)
    ctx.fillStyle = carrying ? '#facc15' : '#f97316';
    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Direction indicator arrow
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(4, 0);
    ctx.lineTo(15, 0);
    ctx.stroke();

    ctx.restore();
  }

  private renderHUD(state: GameState, trial: Trial): void {
    const ctx = this.ctx;
    const { width } = this.canvas;
    const remaining = Math.max(0, trial.externalTimeLimit - trial.externalClock);

    // Top bar
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.fillRect(0, 0, width, 34);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '12px "JetBrains Mono", monospace';
    const modeLabel =
      trial.player.moveMode === 'run'
        ? '走行(4u/s)'
        : trial.player.moveMode === 'slow'
        ? '低速(1u/s)'
        : trial.player.moveMode === 'normal'
        ? '通常(2u/s)'
        : '停止(0u/s)';
    ctx.fillText(
      `区画: ${trial.roomCode} | 被験者表示: ${state.subject.displayedBadgeNumber} | 移動: ${modeLabel} [低速固定:${
        trial.player.slowToggle ? 'ON' : 'OFF'
      }] | 残り時間: ${remaining.toFixed(1)}s`,
      14,
      21
    );

    if (trial.omen.active) {
      ctx.fillStyle = 'rgba(153, 27, 27, 0.92)';
      ctx.fillRect(14, 40, width - 28, 28);
      ctx.fillStyle = '#fecaca';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(`【知覚前兆】${trial.omen.text}`, 24, 58);
    }
  }
}
