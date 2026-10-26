import { GameState, Trial, WhiteDoorRoomId } from '../core/types';
import { getWhiteDoorSequence } from '../core/trials';
import { drawIcon, OBJECT_ICONS } from './art';

const COLORS = {
  void: '#090b0e',
  wall: '#0f141b',
  wallEdge: '#2a3441',
  floor: '#161b22',
  tile: '#1d242e',
  label: '#4a5568',
  text: '#cbd5e1',
  muted: '#94a3b8',
  cyan: '#38bdf8',
  blue: '#3b82f6',
  red: '#ef4444',
  amber: '#f59e0b',
  green: '#22c55e',
};

const MONO = '"JetBrains Mono", "SFMono-Regular", ui-monospace, monospace';
const SANS = '"Hiragino Kaku Gothic ProN", "Noto Sans JP", system-ui, sans-serif';

export class TrialCanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /** Logical drawing size; the backing store is scaled for high-DPI screens. */
  private width: number;
  private height: number;
  private scanlines: CanvasPattern | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Canvas 2D context not available');
    }
    this.ctx = context;
    this.width = canvas.width;
    this.height = canvas.height;

    const dpr = Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1));
    if (dpr !== 1) {
      canvas.width = Math.round(this.width * dpr);
      canvas.height = Math.round(this.height * dpr);
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  public render(state: GameState): void {
    const trial = state.trial;
    const ctx = this.ctx;

    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = COLORS.void;
    ctx.fillRect(0, 0, this.width, this.height);

    if (!trial) {
      this.renderIdleScreen(state);
      this.renderFeedOverlay(state, null);
      return;
    }

    if (trial.roomCode === 'T-101') {
      this.renderT101(state, trial);
    } else if (trial.roomCode === 'T-204') {
      this.renderT204(state, trial);
    } else if (trial.roomCode === 'T-309') {
      this.renderT309(state, trial);
    }

    this.renderFeedOverlay(state, trial);
    this.renderHUD(state, trial);
  }

  private renderIdleScreen(state: GameState): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#11161d';
    ctx.fillRect(20, 20, this.width - 40, this.height - 40);
    ctx.strokeStyle = COLORS.wallEdge;
    ctx.strokeRect(20, 20, this.width - 40, this.height - 40);
    drawIcon(ctx, 'camera', this.width / 2, this.height / 2 - 10, 56, 0.7);

    ctx.fillStyle = '#8fa3b8';
    ctx.font = `13px ${MONO}`;
    ctx.fillText(
      `SITE-19 SURVEILLANCE FEED // CYCLE: ${state.cycle.cycleId} // DAY ${state.cycle.day}`,
      40,
      52
    );
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.label;
    ctx.fillText('NO SIGNAL', this.width / 2, this.height / 2 + 40);
    ctx.textAlign = 'left';
  }

  // ---------------------------------------------------------------------------
  // T-101 — corridor
  // ---------------------------------------------------------------------------

  private renderT101(state: GameState, trial: Trial): void {
    const ctx = this.ctx;
    const width = this.width;
    const height = this.height;

    // Map 0..24m to x: 70 .. width-70
    const leftPad = 70;
    const rightPad = 70;
    const trackWidth = width - leftPad - rightPad;
    const scaleX = trackWidth / 24;
    const centerY = height * 0.5;
    const halfCorridorPx = 68;
    const top = centerY - halfCorridorPx;
    const bottom = centerY + halfCorridorPx;

    const toPxX = (x: number) => leftPad + x * scaleX;
    const toPxY = (y: number) => centerY + y * 32;

    // Wall bands
    ctx.fillStyle = COLORS.wall;
    ctx.fillRect(leftPad - 12, top - 14, trackWidth + 24, 14);
    ctx.fillRect(leftPad - 12, bottom, trackWidth + 24, 14);
    ctx.strokeStyle = COLORS.wallEdge;
    ctx.lineWidth = 1;
    for (let m = 0; m <= 24; m += 4) {
      const gx = toPxX(m);
      ctx.beginPath();
      ctx.moveTo(gx, top - 14);
      ctx.lineTo(gx, top);
      ctx.moveTo(gx, bottom);
      ctx.lineTo(gx, bottom + 14);
      ctx.stroke();
    }

    // Corridor floor and tiles every 2m
    ctx.fillStyle = COLORS.floor;
    ctx.fillRect(leftPad, top, trackWidth, halfCorridorPx * 2);
    ctx.strokeStyle = COLORS.tile;
    for (let m = 0; m <= 24; m += 2) {
      const gx = toPxX(m);
      ctx.beginPath();
      ctx.moveTo(gx, top);
      ctx.lineTo(gx, bottom);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(leftPad, centerY);
    ctx.lineTo(leftPad + trackWidth, centerY);
    ctx.stroke();

    // Distance labels under the south wall
    ctx.fillStyle = COLORS.label;
    ctx.font = `10px ${MONO}`;
    ctx.textAlign = 'center';
    for (let m = 0; m <= 24; m += 4) {
      if (m === 8 || m === 16) continue;
      ctx.fillText(`${m}m`, toPxX(m), bottom + 28);
    }

    // Blue Line at 8m and Red Line at 16m
    this.drawFloorLine(toPxX(8), top, bottom, COLORS.blue, '#60a5fa', '青線 8m', bottom + 28);
    this.drawFloorLine(toPxX(16), top, bottom, COLORS.red, '#f87171', '赤線 16m', bottom + 28);

    // Exit door at 0m — lit green once the objective is carried
    const exitOpen = trial.player.carryingObjective;
    ctx.fillStyle = exitOpen ? '#14532d' : '#1e293b';
    ctx.fillRect(leftPad - 12, centerY - 38, 12, 76);
    ctx.strokeStyle = exitOpen ? COLORS.green : '#475569';
    ctx.lineWidth = 2;
    ctx.strokeRect(leftPad - 12, centerY - 38, 12, 76);
    ctx.fillStyle = exitOpen ? COLORS.green : '#64748b';
    ctx.beginPath();
    ctx.arc(leftPad - 6, centerY - 46, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLORS.text;
    ctx.font = `11px ${SANS}`;
    ctx.fillText('出入口', leftPad - 6, bottom + 44);
    ctx.textAlign = 'left';

    // Camera on the north wall with wiring and watched cone (5.2: カメラ位置・稼働ランプ・配線を事前に見せる)
    const camX = toPxX(12);
    const camY = top + 10;
    ctx.strokeStyle = '#7f1d1d';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(leftPad, top - 6);
    ctx.quadraticCurveTo((leftPad + camX) / 2, top + 2, camX - 10, camY);
    ctx.stroke();

    const coneGrad = ctx.createLinearGradient(camX, camY, camX, bottom);
    coneGrad.addColorStop(0, 'rgba(239, 68, 68, 0.16)');
    coneGrad.addColorStop(1, 'rgba(239, 68, 68, 0.03)');
    ctx.fillStyle = coneGrad;
    ctx.beginPath();
    ctx.moveTo(camX, camY);
    ctx.lineTo(camX - 90, bottom);
    ctx.lineTo(camX + 90, bottom);
    ctx.closePath();
    ctx.fill();

    drawIcon(ctx, 'camera', camX, camY, 26);
    if (Math.floor(trial.externalClock * 2) % 2 === 0) {
      ctx.fillStyle = COLORS.red;
      ctx.beginPath();
      ctx.arc(camX + 15, camY - 7, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#fca5a5';
    ctx.font = `10px ${MONO}`;
    ctx.fillText('CAM-101 [REC]', camX + 22, camY + 4);

    // Scuff marks & torn slip at 9m
    const scuff = trial.interactables.find((o) => o.id === 'obj-t101-scuff');
    const scuffX = toPxX(9);
    const scuffY = toPxY(0.6);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      ctx.moveTo(scuffX - 18 + i * 9, scuffY - 8 + (i % 2) * 6);
      ctx.lineTo(scuffX - 10 + i * 9, scuffY - 4 + (i % 2) * 6);
    }
    ctx.stroke();
    drawIcon(ctx, 'paper_strip', scuffX + 14, scuffY + 2, 16, 0.85);
    this.drawObjectLabel('擦り跡・回収票', scuffX, scuffY + 24, scuff?.inspected ?? false);

    // Collection box at 24m (if not carried yet)
    if (!trial.player.carryingObjective) {
      const boxX = toPxX(24) - 16;
      drawIcon(ctx, 'collection_box', boxX, centerY, 34);
      ctx.fillStyle = '#fef08a';
      ctx.font = `11px ${SANS}`;
      ctx.textAlign = 'center';
      ctx.fillText('回収箱', boxX, centerY - 22);
      ctx.textAlign = 'left';
    }

    // Corridor walls
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 3;
    ctx.strokeRect(leftPad, top, trackWidth, halfCorridorPx * 2);

    const px = toPxX(trial.player.x);
    const py = toPxY(trial.player.y);

    // Darken outside the player's vision cone (1: 視界の外は暗く、音だけが届く)
    this.renderVisionConeOverlay(
      px,
      py,
      trial.player.facingAngle,
      230,
      Math.PI * 0.58,
      state.subject.inventory.includes('small_mirror')
    );

    // Acoustic ripples (音紋) — visible outside the vision cone, never through walls
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

      // Follower footprints, alternating left/right half a beat behind
      const stride = Math.floor(trial.externalClock * 4) % 2;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const fx = soundSourceX - i * 14;
        const fy = soundSourceY + ((i + stride) % 2 === 0 ? -7 : 7);
        ctx.moveTo(fx - 5, fy);
        ctx.quadraticCurveTo(fx, fy + 4, fx + 5, fy);
      }
      ctx.stroke();

      ctx.fillStyle = rippleColor;
      ctx.font = `11px ${SANS}`;
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

    this.drawPlayerToken(px, py, trial.player.facingAngle, {
      carrying: trial.player.carryingObjective,
    });
  }

  private drawFloorLine(
    x: number,
    top: number,
    bottom: number,
    color: string,
    labelColor: string,
    label: string,
    labelY: number
  ): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = labelColor;
    ctx.font = `11px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText(label, x, labelY);
    ctx.textAlign = 'left';
  }

  // ---------------------------------------------------------------------------
  // T-204 — interview room
  // ---------------------------------------------------------------------------

  private renderT204(state: GameState, trial: Trial): void {
    const ctx = this.ctx;
    const leftPad = 70;
    const topPad = 55;
    const roomW = this.width - 140;
    const roomH = this.height - 110;

    const toPxX = (x: number) => leftPad + (x / 16) * roomW;
    const toPxY = (y: number) => topPad + ((y + 2.5) / 5.0) * roomH;

    // Floor with 1-unit tiles
    ctx.fillStyle = COLORS.floor;
    ctx.fillRect(leftPad, topPad, roomW, roomH);
    ctx.strokeStyle = COLORS.tile;
    ctx.lineWidth = 1;
    for (let u = 1; u < 16; u++) {
      ctx.beginPath();
      ctx.moveTo(toPxX(u), topPad);
      ctx.lineTo(toPxX(u), topPad + roomH);
      ctx.stroke();
    }
    for (let v = -2; v <= 2; v++) {
      ctx.beginPath();
      ctx.moveTo(leftPad, toPxY(v));
      ctx.lineTo(leftPad + roomW, toPxY(v));
      ctx.stroke();
    }
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 3;
    ctx.strokeRect(leftPad, topPad, roomW, roomH);

    // Entrance on the west wall
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(leftPad - 10, toPxY(0) - 26, 10, 52);
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 2;
    ctx.strokeRect(leftPad - 10, toPxY(0) - 26, 10, 52);

    // Partition wall for the interview booth
    const boothX = toPxX(8.5);
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(boothX, topPad);
    ctx.lineTo(boothX, topPad + roomH * 0.35);
    ctx.moveTo(boothX, topPad + roomH * 0.65);
    ctx.lineTo(boothX, topPad + roomH);
    ctx.stroke();

    // Camera surveillance zone around the restricted cabinet (x=14.5, y=-1.3)
    const zoneX = toPxX(14.5);
    const zoneY = toPxY(-1.3);
    ctx.fillStyle = 'rgba(239, 68, 68, 0.12)';
    ctx.beginPath();
    ctx.arc(zoneX, zoneY, 48, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLORS.red;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    drawIcon(ctx, 'camera', zoneX - 50, topPad + 12, 22);
    ctx.fillStyle = '#fca5a5';
    ctx.font = `10px ${MONO}`;
    ctx.fillText('CAM-204 監視範囲', zoneX - 36, topPad - 6);

    // Interactables drawn as floor plates with their icon
    for (const obj of trial.interactables) {
      const ox = toPxX(obj.x);
      const oy = toPxY(obj.y);
      let iconId = OBJECT_ICONS[obj.id] ?? 'document';
      let iconAlpha = 1;
      if (obj.id === 'obj-t204-counter' && trial.badge.wearingSuppliedBadge) {
        // The badge is on the subject; the counter only holds the transfer slip.
        iconId = 'document';
      }
      if (obj.id === 'obj-t204-tray' && !trial.badge.badgeReturned) {
        iconAlpha = 0.45;
      }
      this.drawObjectPlate(ox, oy, obj.restricted ? COLORS.red : obj.inspected ? COLORS.cyan : '#334155');
      drawIcon(ctx, iconId, ox, oy, 28, iconAlpha);
      this.drawObjectLabel(obj.label.split('（')[0].split(' [')[0], ox, oy + 30, obj.inspected);
    }

    // Terminal readout once checked: biometric ID vs presented slip
    if (trial.badge.rationTerminalChecked) {
      const tx = toPxX(11.5) + 26;
      const ty = toPxY(1.2) - 40;
      ctx.fillStyle = 'rgba(12, 16, 23, 0.94)';
      ctx.fillRect(tx, ty, 132, 38);
      ctx.strokeStyle = COLORS.wallEdge;
      ctx.lineWidth = 1;
      ctx.strokeRect(tx, ty, 132, 38);
      ctx.font = `10px ${MONO}`;
      ctx.fillStyle = COLORS.cyan;
      ctx.fillText(`生体ID: ${state.subject.originalNumber}`, tx + 7, ty + 15);
      if (trial.badge.reverified) {
        ctx.fillStyle = COLORS.green;
        ctx.fillText('再照合: 訂正済', tx + 7, ty + 30);
      } else {
        ctx.fillStyle = COLORS.red;
        const slip = `提示票: ${trial.badge.suppliedBadgeNumber}`;
        ctx.fillText(slip, tx + 7, ty + 30);
        const slipWidth = ctx.measureText(slip).width;
        ctx.strokeStyle = COLORS.red;
        ctx.beginPath();
        ctx.moveTo(tx + 7, ty + 26);
        ctx.lineTo(tx + 7 + slipWidth, ty + 26);
        ctx.stroke();
      }
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
    this.drawPlayerToken(px, py, trial.player.facingAngle, {
      carrying: false,
      badgeText: trial.badge.wearingSuppliedBadge ? trial.badge.suppliedBadgeNumber : undefined,
    });
  }

  // ---------------------------------------------------------------------------
  // T-309 — white door
  // ---------------------------------------------------------------------------

  private renderT309(state: GameState, trial: Trial): void {
    const ctx = this.ctx;
    const wd = trial.whiteDoor;
    const isOmen = trial.omen.active;

    const boxW = 360;
    const boxH = 196;
    const left = (this.width - boxW) / 2;
    const top = 80;

    const toPxX = (lx: number) => left + ((lx + 1.5) / 3.0) * boxW;
    const toPxY = (ly: number) => top + ((ly + 1.0) / 2.0) * boxH;

    // Room shell; the lights pulse red during the omen
    const pulse = isOmen ? 0.5 + 0.5 * Math.sin(trial.externalClock * 12) : 0;
    ctx.fillStyle = '#141a23';
    ctx.fillRect(left, top, boxW, boxH);
    ctx.strokeStyle = COLORS.tile;
    ctx.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(left + (boxW / 6) * i, top);
      ctx.lineTo(left + (boxW / 6) * i, top + boxH);
      ctx.stroke();
    }
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(left, top + (boxH / 4) * i);
      ctx.lineTo(left + boxW, top + (boxH / 4) * i);
      ctx.stroke();
    }
    if (isOmen) {
      ctx.fillStyle = `rgba(127, 29, 29, ${0.22 + pulse * 0.2})`;
      ctx.fillRect(left, top, boxW, boxH);
    }
    ctx.strokeStyle = isOmen ? '#f87171' : '#475569';
    ctx.lineWidth = 3;
    ctx.strokeRect(left, top, boxW, boxH);

    if (wd.mainSectorOpened) {
      this.renderT309MainSector(trial, left, top, boxW, boxH, toPxX, toPxY);
    } else {
      this.renderT309Anteroom(trial, left, top, boxW, boxH, toPxX, toPxY);
    }

    // Lights stutter during the omen: a brief blackout flicker over the room
    if (isOmen && pulse > 0.92) {
      ctx.fillStyle = 'rgba(5, 7, 10, 0.55)';
      ctx.fillRect(left, top, boxW, boxH);
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
    this.drawPlayerToken(px, py, trial.player.facingAngle, {
      carrying: trial.player.carryingObjective,
    });
  }

  private renderT309Anteroom(
    trial: Trial,
    left: number,
    top: number,
    boxW: number,
    boxH: number,
    toPxX: (lx: number) => number,
    toPxY: (ly: number) => number
  ): void {
    const ctx = this.ctx;
    const wd = trial.whiteDoor;

    // Side panel: location
    this.drawSidePanelTitle(24, top + 4, '現在地', 'T-309 前室');
    ctx.fillStyle = COLORS.muted;
    ctx.font = `11px ${SANS}`;
    ctx.fillText('安全区域', 24, top + 62);
    ctx.fillText('外部時計待機中', 24, top + 78);

    // Observation window cut into the north wall
    const winX = toPxX(0);
    ctx.fillStyle = '#0c1017';
    ctx.fillRect(winX - 54, top - 6, 108, 18);
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 2;
    ctx.strokeRect(winX - 54, top - 6, 108, 18);
    if (wd.windowDemoWatched) {
      const seq = getWhiteDoorSequence(wd.phase);
      ctx.fillStyle = COLORS.cyan;
      ctx.font = `10px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.fillText(seq.join(' – '), winX, top + 7);
      ctx.textAlign = 'left';
    } else {
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(winX - 44, top + 8);
      ctx.lineTo(winX - 30, top - 2);
      ctx.moveTo(winX + 10, top + 8);
      ctx.lineTo(winX + 24, top - 2);
      ctx.stroke();
    }

    // Severed rope from the previous subject, hanging below the window
    ctx.strokeStyle = '#d6d3c8';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(winX + 60, top + 14);
    ctx.quadraticCurveTo(winX + 80, top + 50, winX + 66, top + 78);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = COLORS.red;
    ctx.beginPath();
    ctx.moveTo(winX + 60, top + 74);
    ctx.lineTo(winX + 72, top + 82);
    ctx.moveTo(winX + 72, top + 74);
    ctx.lineTo(winX + 60, top + 82);
    ctx.stroke();

    for (const obj of trial.interactables.filter((i) => i.roomId === 'ANTEROOM')) {
      const ox = toPxX(obj.x);
      const oy = Math.max(top + 30, toPxY(obj.y));
      const iconId = OBJECT_ICONS[obj.id] ?? 'document';
      if (obj.id === 'obj-t309-open-main') {
        drawIcon(this.ctx, iconId, left + boxW - 20, top + boxH / 2, 56);
        this.drawObjectLabel('白い扉（本区画へ）', left + boxW - 30, top + boxH / 2 + 42, obj.inspected);
        continue;
      }
      this.drawObjectPlate(ox, oy + 6, obj.inspected ? COLORS.cyan : '#334155');
      drawIcon(this.ctx, iconId, ox, oy + 6, 28);
      this.drawObjectLabel(obj.label.replace('前室：', '').split('と')[0], ox, oy + 36, obj.inspected);
    }
  }

  private renderT309MainSector(
    trial: Trial,
    left: number,
    top: number,
    boxW: number,
    boxH: number,
    toPxX: (lx: number) => number,
    toPxY: (ly: number) => number
  ): void {
    const ctx = this.ctx;
    const wd = trial.whiteDoor;
    const seq = getWhiteDoorSequence(wd.phase);

    // Left panel: connection order (only known after watching the window demo)
    ctx.fillStyle = COLORS.muted;
    ctx.font = `10px ${MONO}`;
    ctx.fillText('接続順序', 24, top + 6);
    const chain: (WhiteDoorRoomId | '?')[] = wd.windowDemoWatched ? seq : ['E', '?', '?', 'P'];
    chain.forEach((room, i) => {
      const nx = 44;
      const ny = top + 28 + i * 42;
      const isHere = wd.windowDemoWatched && room === wd.currentRoom;
      if (i < chain.length - 1) {
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(nx, ny + 13);
        ctx.lineTo(nx, ny + 29);
        ctx.stroke();
      }
      ctx.fillStyle = isHere ? 'rgba(56, 189, 248, 0.25)' : '#0c1017';
      ctx.beginPath();
      ctx.arc(nx, ny, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = isHere ? COLORS.cyan : '#3d4f69';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = room === 'P' ? '#fbbf24' : isHere ? '#e0f2fe' : COLORS.muted;
      ctx.font = `bold 12px ${MONO}`;
      ctx.textAlign = 'center';
      ctx.fillText(room, nx, ny + 4);
      ctx.textAlign = 'left';
    });
    if (!wd.windowDemoWatched) {
      ctx.fillStyle = COLORS.label;
      ctx.font = `10px ${SANS}`;
      ctx.fillText('観測窓で未確認', 66, top + 74);
    }

    // Right panel: current room and recording board status
    this.drawSidePanelTitle(left + boxW + 22, top + 4, '現在地', `室 ${wd.currentRoom}`);
    drawIcon(
      ctx,
      'record_board',
      left + boxW + 36,
      top + 92,
      28,
      wd.recordingBoardCollected ? 1 : 0.45
    );
    ctx.fillStyle = wd.recordingBoardCollected ? '#fde68a' : COLORS.muted;
    ctx.font = `11px ${SANS}`;
    ctx.fillText(wd.recordingBoardCollected ? '記録板 回収済' : '記録板 未回収', left + boxW + 56, top + 96);

    // Doors: back toward the anteroom / previous room, forward to the next room
    const idx = seq.indexOf(wd.currentRoom);
    const doorY = top + boxH / 2;
    ctx.fillStyle = '#e5e7eb';
    ctx.fillRect(left - 5, doorY - 24, 6, 48);
    ctx.fillStyle = COLORS.label;
    ctx.font = `10px ${SANS}`;
    ctx.textAlign = 'left';
    ctx.fillText(idx <= 0 ? '← 帰還扉' : '← 手前', left + 6, doorY - 30);
    if (idx < seq.length - 1) {
      ctx.fillStyle = '#e5e7eb';
      ctx.fillRect(left + boxW - 1, doorY - 24, 6, 48);
      ctx.fillStyle = COLORS.label;
      ctx.textAlign = 'right';
      ctx.fillText('奥 →', left + boxW - 6, doorY - 30);
      ctx.textAlign = 'left';
    }

    // Guide rope along the floor; its far end is cut
    ctx.strokeStyle = 'rgba(214, 211, 200, 0.75)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(left + 4, top + boxH - 22);
    ctx.bezierCurveTo(
      left + boxW * 0.25,
      top + boxH - 34,
      left + boxW * 0.45,
      top + boxH - 10,
      left + boxW * 0.62,
      top + boxH - 24
    );
    ctx.stroke();
    ctx.setLineDash([]);
    if (wd.ropeInspected) {
      ctx.strokeStyle = COLORS.red;
      ctx.beginPath();
      ctx.moveTo(left + boxW * 0.62 - 5, top + boxH - 29);
      ctx.lineTo(left + boxW * 0.62 + 5, top + boxH - 19);
      ctx.moveTo(left + boxW * 0.62 + 5, top + boxH - 29);
      ctx.lineTo(left + boxW * 0.62 - 5, top + boxH - 19);
      ctx.stroke();
    }

    // Blue emergency light anchor (青い非常灯の固定点, radius 0.8)
    const cx = toPxX(0);
    const cy = toPxY(0);
    const rx = (0.8 / 3.0) * boxW;
    const glow = ctx.createRadialGradient(cx, cy, 4, cx, cy, rx);
    glow.addColorStop(0, wd.onAnchorPoint ? 'rgba(56, 189, 248, 0.42)' : 'rgba(56, 189, 248, 0.24)');
    glow.addColorStop(1, 'rgba(14, 165, 233, 0.04)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = COLORS.cyan;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    drawIcon(ctx, 'emergency_light', cx, cy - rx + 16, 22);

    ctx.fillStyle = '#7dd3fc';
    ctx.font = `11px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.fillText('青い非常灯 [固定点・退避安全圏]', cx, cy - rx - 8);
    ctx.textAlign = 'left';

    // Recording board in room P
    if (wd.currentRoom === 'P' && !wd.recordingBoardCollected) {
      const bx = toPxX(0.6) + 40;
      const by = toPxY(0);
      this.drawObjectPlate(bx, by, '#fbbf24');
      drawIcon(ctx, 'record_board', bx, by, 28);
      this.drawObjectLabel('記録板', bx, by + 30, false);
    }
  }

  private drawSidePanelTitle(x: number, y: number, caption: string, value: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = COLORS.muted;
    ctx.font = `10px ${MONO}`;
    ctx.fillText(caption, x, y + 2);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = `bold 20px ${MONO}`;
    ctx.fillText(value, x, y + 32);
  }

  // ---------------------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------------------

  private drawObjectPlate(x: number, y: number, edge: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(12, 16, 23, 0.85)';
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x - 19, y - 19, 38, 38, 5);
    ctx.fill();
    ctx.stroke();
  }

  private drawObjectLabel(label: string, x: number, y: number, inspected: boolean): void {
    const ctx = this.ctx;
    ctx.font = `11px ${SANS}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = inspected ? '#7dd3fc' : '#e2e8f0';
    ctx.fillText(inspected ? `✓ ${label}` : label, x, y);
    ctx.textAlign = 'left';
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

    ctx.save();
    // Darken outside vision cone (Section 1: 見下ろし2D＋視界コーン。視界の外は暗く、音だけが届く)
    ctx.fillStyle = 'rgba(5, 7, 10, 0.72)';
    ctx.beginPath();
    ctx.rect(0, 0, this.width, this.height);

    // Cut out main forward vision cone
    ctx.moveTo(px, py);
    ctx.arc(px, py, coneRadius, facingAngle - coneSpread / 2, facingAngle + coneSpread / 2, false);
    ctx.closePath();

    // Small personal ambient circle around feet
    ctx.moveTo(px + 28, py);
    ctx.arc(px, py, 28, 0, Math.PI * 2, false);

    // If holding small_mirror, add a narrow rear-peek sector
    if (hasSmallMirror) {
      ctx.moveTo(px, py);
      ctx.arc(px, py, 110, facingAngle + Math.PI - 0.28, facingAngle + Math.PI + 0.28, false);
      ctx.closePath();
    }

    ctx.fill('evenodd');

    // Faint flashlight tint inside the cone
    const light = ctx.createRadialGradient(px, py, 10, px, py, coneRadius);
    light.addColorStop(0, 'rgba(56, 189, 248, 0.10)');
    light.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.fillStyle = light;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.arc(px, py, coneRadius, facingAngle - coneSpread / 2, facingAngle + coneSpread / 2);
    ctx.closePath();
    ctx.fill();

    // Subtle vision cone border
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  private drawPlayerToken(
    px: number,
    py: number,
    facingAngle: number,
    options: { carrying: boolean; badgeText?: string }
  ): void {
    const ctx = this.ctx;

    // Ground shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    ctx.ellipse(px + 2, py + 4, 11, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(facingAngle);

    // Player body (D-Class orange jumpsuit dot)
    ctx.fillStyle = options.carrying ? '#facc15' : '#f97316';
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
    ctx.moveTo(11, -3);
    ctx.lineTo(15, 0);
    ctx.lineTo(11, 3);
    ctx.stroke();
    ctx.restore();

    if (options.carrying) {
      drawIcon(ctx, 'collection_box', px, py - 20, 16);
    }

    // Supplied badge worn on the chest: humans now read this number instead of the subject's own
    if (options.badgeText) {
      ctx.font = `bold 9px ${MONO}`;
      const w = ctx.measureText(options.badgeText).width + 8;
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(px - w / 2, py - 26, w, 13);
      ctx.fillStyle = '#11161f';
      ctx.textAlign = 'center';
      ctx.fillText(options.badgeText, px, py - 16);
      ctx.textAlign = 'left';
    }
  }

  /** Surveillance-feed finish: scanlines, vignette and the feed caption. */
  private renderFeedOverlay(state: GameState, trial: Trial | null): void {
    const ctx = this.ctx;
    if (!this.scanlines) {
      const tile = document.createElement('canvas');
      tile.width = 1;
      tile.height = 3;
      const tctx = tile.getContext('2d');
      if (tctx) {
        tctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
        tctx.fillRect(0, 0, 1, 1);
        this.scanlines = ctx.createPattern(tile, 'repeat');
      }
    }
    if (this.scanlines) {
      ctx.fillStyle = this.scanlines;
      ctx.fillRect(0, 0, this.width, this.height);
    }

    const vignette = ctx.createRadialGradient(
      this.width / 2,
      this.height / 2,
      this.height * 0.45,
      this.width / 2,
      this.height / 2,
      this.width * 0.62
    );
    vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignette.addColorStop(1, 'rgba(0, 0, 0, 0.5)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, this.width, this.height);

    if (!trial) return;
    ctx.font = `10px ${MONO}`;
    ctx.fillStyle = COLORS.label;
    ctx.fillText(
      `SITE-19 // FEED ${trial.roomCode} // DAY ${String(state.cycle.day).padStart(2, '0')}`,
      12,
      this.height - 9
    );
    const recOn = trial.status === 'active' && Math.floor(trial.externalClock * 2) % 2 === 0;
    ctx.fillStyle = recOn ? COLORS.red : '#4b1d1d';
    ctx.beginPath();
    ctx.arc(this.width - 52, this.height - 12, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = trial.status === 'active' ? '#fca5a5' : COLORS.label;
    ctx.fillText(trial.status === 'active' ? 'REC' : 'HOLD', this.width - 42, this.height - 9);
  }

  private renderHUD(state: GameState, trial: Trial): void {
    const ctx = this.ctx;
    const width = this.width;
    const remaining = Math.max(0, trial.externalTimeLimit - trial.externalClock);

    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    ctx.fillRect(0, 0, width, 34);
    ctx.strokeStyle = COLORS.wallEdge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 34.5);
    ctx.lineTo(width, 34.5);
    ctx.stroke();

    const modeLabel =
      trial.player.moveMode === 'run'
        ? '走行(4u/s)'
        : trial.player.moveMode === 'slow'
        ? '低速(1u/s)'
        : trial.player.moveMode === 'normal'
        ? '通常(2u/s)'
        : '停止(0u/s)';
    const badgeChanged = state.subject.displayedBadgeNumber !== state.subject.subjectId;

    ctx.font = `12px ${MONO}`;
    let x = 12;
    const segment = (text: string, color: string) => {
      ctx.fillStyle = color;
      ctx.fillText(text, x, 21);
      x += ctx.measureText(text).width + 14;
    };
    segment(`区画 ${trial.roomCode}`, COLORS.cyan);
    segment(`被験者表示 ${state.subject.displayedBadgeNumber}`, badgeChanged ? COLORS.amber : '#e2e8f0');
    segment(`移動 ${modeLabel}`, '#e2e8f0');
    segment(`低速固定 ${trial.player.slowToggle ? 'ON' : 'OFF'}`, trial.player.slowToggle ? COLORS.green : COLORS.muted);

    ctx.textAlign = 'right';
    ctx.fillStyle = remaining <= 20 ? '#f87171' : '#e2e8f0';
    ctx.fillText(`残り ${remaining.toFixed(1)}s`, width - 12, 21);
    ctx.textAlign = 'left';

    // Timer bar
    const ratio = trial.externalTimeLimit > 0 ? remaining / trial.externalTimeLimit : 0;
    ctx.fillStyle = remaining <= 20 ? COLORS.red : COLORS.cyan;
    ctx.fillRect(0, 32, width * ratio, 2);

    if (trial.omen.active) {
      const pulse = 0.82 + 0.1 * Math.sin(trial.externalClock * 10);
      ctx.fillStyle = `rgba(153, 27, 27, ${pulse})`;
      ctx.fillRect(14, 40, width - 28, 28);
      ctx.strokeStyle = '#f87171';
      ctx.strokeRect(14.5, 40.5, width - 29, 27);
      // Warning triangle
      ctx.fillStyle = '#fecaca';
      ctx.beginPath();
      ctx.moveTo(30, 47);
      ctx.lineTo(38, 61);
      ctx.lineTo(22, 61);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#7f1d1d';
      ctx.fillRect(29.2, 51, 1.6, 5);
      ctx.fillRect(29.2, 57.5, 1.6, 1.6);
      ctx.fillStyle = '#fecaca';
      ctx.font = `bold 12px ${SANS}`;
      ctx.fillText(`【知覚前兆】${trial.omen.text}`, 46, 58);
    }
  }
}
