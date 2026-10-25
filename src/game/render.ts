// 見下ろし2Dの描画。視界コーンの外は暗くし、遮蔽を透視しない。
// 追従者の姿は描かない。視界内では足音の位置に埃だけを描く。
// 前兆の画面表示（方向の弧）は暗さの上に描くが、色で安全・危険を示さない。

import { followerPosition, isInViewCone, remainingSeconds, VIEW_RADIUS, type PacingTrialState } from '../core/pacing';
import { PACING } from '../core/params';

export interface Cue {
  type: 'ring' | 'pulse' | 'dust';
  x: number;
  y: number;
  strength: number;
  born: number;
}

export interface Effects {
  cues: Cue[];
  speakerAt: number;
}

export interface EndingFx {
  kind: 'survived' | 'death' | 'timeout';
  startedAt: number;
}

const PPU = 40;
const MARGIN_X = 40;
const VIEW_HALF = (50 * Math.PI) / 180;

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly dark: HTMLCanvasElement;
  private readonly darkCtx: CanvasRenderingContext2D;

  constructor(readonly canvas: HTMLCanvasElement) {
    canvas.width = MARGIN_X * 2 + PACING.corridorLength * PPU;
    canvas.height = 260;
    this.ctx = canvas.getContext('2d')!;
    this.dark = document.createElement('canvas');
    this.dark.width = canvas.width;
    this.dark.height = canvas.height;
    this.darkCtx = this.dark.getContext('2d')!;
  }

  private sx(x: number): number {
    return MARGIN_X + x * PPU;
  }

  private sy(y: number): number {
    return this.canvas.height / 2 + y * PPU;
  }

  screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * this.canvas.width;
    const py = ((clientY - rect.top) / rect.height) * this.canvas.height;
    return { x: (px - MARGIN_X) / PPU, y: (py - this.canvas.height / 2) / PPU };
  }

  draw(trial: PacingTrialState, fx: Effects, now: number, opts: { dev: boolean; ending: EndingFx | null }): void {
    const ctx = this.ctx;
    const { width, height } = this.canvas;
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, width, height);

    this.drawRoom(trial);
    this.drawDust(trial, fx, now);
    this.drawPlayer(trial);
    this.drawDarkness(trial);
    this.drawFixtures(trial, fx, now);
    this.drawCues(trial, fx, now);
    if (opts.dev) this.drawDev(trial);
    if (opts.ending) this.drawEnding(opts.ending, now);
  }

  private drawRoom(trial: PacingTrialState): void {
    const ctx = this.ctx;
    const L = PACING.corridorLength;
    const W = PACING.corridorHalfWidth;
    ctx.fillStyle = '#2b2c2a';
    ctx.fillRect(this.sx(0), this.sy(-W), L * PPU, W * 2 * PPU);
    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    ctx.lineWidth = 1;
    for (let x = 1; x < L; x++) {
      ctx.beginPath();
      ctx.moveTo(this.sx(x), this.sy(-W));
      ctx.lineTo(this.sx(x), this.sy(W));
      ctx.stroke();
    }

    // 床の区画線。色は線の識別のためで、安全・危険を示さない
    const line = (x: number, color: string) => {
      ctx.fillStyle = color;
      ctx.fillRect(this.sx(x) - 3, this.sy(-W), 6, W * 2 * PPU);
    };
    line(PACING.redLineX, '#7a2a26');
    line(PACING.blueLineX, '#2a3f78');

    ctx.fillStyle = 'rgba(15,14,12,0.55)';
    PACING.scuffMarks.forEach((x, i) => {
      const y = i % 2 === 0 ? -0.25 : 0.25;
      ctx.beginPath();
      ctx.ellipse(this.sx(x), this.sy(y), 9, 4, 0.3, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.save();
    ctx.translate(this.sx(PACING.slipX), this.sy(PACING.slipY));
    ctx.rotate(-0.4);
    ctx.fillStyle = '#b9b3a2';
    ctx.fillRect(-7, -5, 12, 9);
    ctx.fillStyle = '#2b2c2a';
    ctx.beginPath();
    ctx.moveTo(5, -5);
    ctx.lineTo(2, 0);
    ctx.lineTo(5, 4);
    ctx.fill();
    ctx.restore();

    if (!trial.player.hasBox) {
      ctx.fillStyle = '#6b5236';
      ctx.fillRect(this.sx(PACING.boxX) - 11, this.sy(0) - 11, 22, 22);
      ctx.strokeStyle = '#3d2f1f';
      ctx.strokeRect(this.sx(PACING.boxX) - 11, this.sy(0) - 11, 22, 22);
    }

    ctx.strokeStyle = '#8b8d88';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(this.sx(0), this.sy(-W));
    ctx.lineTo(this.sx(L), this.sy(-W));
    ctx.lineTo(this.sx(L), this.sy(W));
    ctx.lineTo(this.sx(0), this.sy(W));
    ctx.stroke();
    // 入口の扉
    ctx.strokeStyle = '#5f6b70';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(this.sx(0), this.sy(-W));
    ctx.lineTo(this.sx(0), this.sy(W));
    ctx.stroke();
  }

  private drawDust(trial: PacingTrialState, fx: Effects, now: number): void {
    const ctx = this.ctx;
    for (const cue of fx.cues) {
      if (cue.type !== 'dust') continue;
      const age = (now - cue.born) / 1000;
      if (age > 0.9) continue;
      if (!isInViewCone(trial, cue.x, cue.y)) continue;
      ctx.fillStyle = `rgba(200,195,180,${0.35 * (1 - age / 0.9)})`;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + cue.born;
        const r = 4 + age * 14;
        ctx.beginPath();
        ctx.arc(this.sx(cue.x) + Math.cos(a) * r, this.sy(cue.y) + Math.sin(a) * r * 0.6, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawPlayer(trial: PacingTrialState): void {
    const ctx = this.ctx;
    const p = trial.player;
    const x = this.sx(p.x);
    const y = this.sy(p.y);
    ctx.fillStyle = '#c9c4b5';
    ctx.beginPath();
    ctx.arc(x, y, PACING.playerRadius * PPU, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1b1b1b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(p.facing) * 12, y + Math.sin(p.facing) * 12);
    ctx.stroke();
    if (p.hasBox) {
      ctx.fillStyle = '#6b5236';
      ctx.fillRect(x + Math.cos(p.facing) * 8 - 6, y + Math.sin(p.facing) * 8 - 6, 12, 12);
    }
  }

  private drawDarkness(trial: PacingTrialState): void {
    const d = this.darkCtx;
    const p = trial.player;
    const x = this.sx(p.x);
    const y = this.sy(p.y);
    d.globalCompositeOperation = 'source-over';
    d.clearRect(0, 0, this.dark.width, this.dark.height);
    d.fillStyle = 'rgba(0,0,0,0.94)';
    d.fillRect(0, 0, this.dark.width, this.dark.height);
    d.globalCompositeOperation = 'destination-out';

    const ambient = d.createRadialGradient(x, y, 0, x, y, 1.8 * PPU);
    ambient.addColorStop(0, 'rgba(0,0,0,0.9)');
    ambient.addColorStop(1, 'rgba(0,0,0,0)');
    d.fillStyle = ambient;
    d.beginPath();
    d.arc(x, y, 1.8 * PPU, 0, Math.PI * 2);
    d.fill();

    const cone = d.createRadialGradient(x, y, 0, x, y, VIEW_RADIUS * PPU);
    cone.addColorStop(0, 'rgba(0,0,0,0.95)');
    cone.addColorStop(0.7, 'rgba(0,0,0,0.6)');
    cone.addColorStop(1, 'rgba(0,0,0,0)');
    d.fillStyle = cone;
    d.beginPath();
    d.moveTo(x, y);
    d.arc(x, y, VIEW_RADIUS * PPU, p.facing - VIEW_HALF, p.facing + VIEW_HALF);
    d.closePath();
    d.fill();
    this.ctx.drawImage(this.dark, 0, 0);
  }

  /** 暗くても位置が分かる設備: カメラの稼働ランプ、壁の時計、インターホン */
  private drawFixtures(trial: PacingTrialState, fx: Effects, now: number): void {
    const ctx = this.ctx;
    const W = PACING.corridorHalfWidth;
    const camX = this.sx(PACING.cameraX);
    const camY = this.sy(-W) - 2;
    ctx.fillStyle = '#3a3c3b';
    ctx.fillRect(camX - 8, camY - 10, 16, 8);
    ctx.fillStyle = Math.floor(now / 700) % 2 === 0 ? '#e0332b' : '#5a1512';
    ctx.beginPath();
    ctx.arc(camX + 10, camY - 6, 2.5, 0, Math.PI * 2);
    ctx.fill();

    const remain = Math.ceil(remainingSeconds(trial));
    const mm = String(Math.floor(remain / 60)).padStart(2, '0');
    const ss = String(remain % 60).padStart(2, '0');
    ctx.font = '14px "Courier New", monospace';
    ctx.fillStyle = '#c98a2b';
    ctx.textAlign = 'left';
    ctx.fillText(`${mm}:${ss}`, this.sx(0.2), this.sy(-W) - 10);

    const spX = this.sx(PACING.speakerX);
    const spY = this.sy(-W) - 6;
    const lit = now - fx.speakerAt < 400;
    ctx.fillStyle = lit ? '#9fb7a8' : '#3b403d';
    for (let i = 0; i < 3; i++) ctx.fillRect(spX - 6 + i * 5, spY - 6, 3, 8);
  }

  private drawCues(trial: PacingTrialState, fx: Effects, now: number): void {
    const ctx = this.ctx;
    const p = trial.player;
    const px = this.sx(p.x);
    const py = this.sy(p.y);
    for (const cue of fx.cues) {
      if (cue.type === 'dust') continue;
      const life = cue.type === 'pulse' ? 0.9 : 0.55;
      const age = (now - cue.born) / 1000;
      if (age > life) continue;
      const fade = 1 - age / life;
      const angle = Math.atan2(cue.y - p.y, cue.x - p.x);
      const radius = (cue.type === 'pulse' ? 26 + age * 30 : 22) as number;
      const span = cue.type === 'pulse' ? 0.7 : 0.4;
      ctx.strokeStyle = `rgba(230,228,220,${(0.25 + 0.6 * cue.strength) * fade})`;
      ctx.lineWidth = cue.type === 'pulse' ? 4 : 2 + cue.strength * 2;
      ctx.beginPath();
      ctx.arc(px, py, radius, angle - span, angle + span);
      ctx.stroke();
    }
  }

  private drawDev(trial: PacingTrialState): void {
    const ctx = this.ctx;
    const pos = followerPosition(trial);
    ctx.strokeStyle = '#d23cd2';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(this.sx(pos.x), this.sy(pos.y), 6, 0, Math.PI * 2);
    ctx.stroke();
  }

  private drawEnding(ending: EndingFx, now: number): void {
    const ctx = this.ctx;
    const t = Math.min(1, (now - ending.startedAt) / 1200);
    if (ending.kind === 'timeout') {
      const W = PACING.corridorHalfWidth;
      ctx.fillStyle = '#4a4d4f';
      ctx.fillRect(this.sx(0) - 6, this.sy(-W), 10, W * 2 * PPU * Math.min(1, t * 1.5));
    }
    const alpha = ending.kind === 'death' ? Math.min(1, t * 3) : t * 0.85;
    ctx.fillStyle = `rgba(0,0,0,${alpha})`;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
