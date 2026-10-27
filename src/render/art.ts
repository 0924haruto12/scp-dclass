import { EndingType, OptionalItemId } from '../core/types';

/**
 * Shared vector art for the terminal UI (inline SVG) and the trial canvas (Path2D).
 * Every icon is defined once on a 64x64 grid so both renderers draw the same shapes.
 */
export interface ArtPath {
  d: string;
  fill?: string;
  stroke?: string;
  width?: number;
  dash?: [number, number];
}

export interface ArtText {
  text: string;
  x: number;
  y: number;
  size: number;
  fill: string;
}

export type ArtShape = ArtPath | ArtText;

const rect = (x: number, y: number, w: number, h: number, rx = 0): string =>
  rx <= 0
    ? `M${x} ${y}h${w}v${h}h${-w}z`
    : `M${x + rx} ${y}h${w - 2 * rx}a${rx} ${rx} 0 0 1 ${rx} ${rx}v${h - 2 * rx}a${rx} ${rx} 0 0 1 ${-rx} ${rx}h${
        -(w - 2 * rx)
      }a${rx} ${rx} 0 0 1 ${-rx} ${-rx}v${-(h - 2 * rx)}a${rx} ${rx} 0 0 1 ${rx} ${-rx}z`;

const circle = (cx: number, cy: number, r: number): string =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;

export type IconId =
  | 'collection_box'
  | 'supplied_badge'
  | 'supervisor_badge'
  | 'rope_recorder'
  | 'water_cooler'
  | 'envelope'
  | 'notebook'
  | 'pencil'
  | 'paper_strip'
  | 'small_mirror'
  | 'camera'
  | 'emergency_light'
  | 'cellmates'
  | 'footsteps'
  | 'phase_shift'
  | 'intercom'
  | 'report'
  | 'document'
  | 'pause'
  | 'clock'
  | 'white_door'
  | 'terminal'
  | 'tray'
  | 'cabinet'
  | 'record_board';

export const ICONS: Record<IconId, { label: string; shapes: ArtShape[] }> = {
  collection_box: {
    label: '回収箱',
    shapes: [
      { d: 'M12 22l20-10 20 10v24l-20 10-20-10z', fill: '#92400e', stroke: '#fbbf24' },
      { d: 'M12 22l20 10 20-10M32 32v24', stroke: '#fbbf24', width: 2 },
    ],
  },
  supplied_badge: {
    label: '支給名札',
    shapes: [
      { d: rect(10, 14, 44, 30, 3), fill: '#fbbf24' },
      { d: 'M18 22h28M18 30h20', stroke: '#11161f', width: 3 },
      { d: 'M22 44l-6 12 16-6 16 6-6-12', fill: '#d97706' },
    ],
  },
  supervisor_badge: {
    label: '監督用名札',
    shapes: [
      { d: rect(10, 14, 44, 30, 3), fill: '#f59e0b' },
      { d: 'M18 22h28', stroke: '#11161f', width: 3 },
      { d: 'M22 44l-6 12 16-6 16 6-6-12', fill: '#b45309' },
      { text: 'SUP-30', x: 15, y: 38, size: 10, fill: '#11161f' },
    ],
  },
  rope_recorder: {
    label: 'ロープと記録器',
    shapes: [
      { d: 'M18 42c-8-4-8-16 0-20s24-4 24 4-12 14-20 10', stroke: '#d6d3c8', width: 4 },
      { d: 'M34 14l12 36', stroke: '#64748b', width: 3 },
      { d: rect(38, 40, 16, 14, 2), fill: '#1e293b', stroke: '#64748b' },
    ],
  },
  water_cooler: {
    label: '給水器',
    shapes: [
      { d: rect(18, 8, 28, 34, 3), fill: '#1e293b', stroke: '#64748b' },
      { d: 'M24 16h16M24 24h16', stroke: '#38bdf8', width: 2 },
      { d: 'M44 12h6v12h-6', fill: '#0c1017', stroke: '#64748b' },
      { d: 'M32 42c-5 7-5 10 0 12 5-2 5-5 0-12z', fill: '#38bdf8' },
      { d: 'M14 56h36', stroke: '#64748b', width: 2 },
    ],
  },
  envelope: {
    label: '封筒',
    shapes: [
      { d: 'M8 18h48v30H8z', fill: '#d6d3c8', stroke: '#64748b' },
      { d: 'M8 18l24 17 24-17', stroke: '#64748b', width: 2 },
      { d: 'M20 8h24v10H20z', fill: '#b8b2a4', stroke: '#64748b' },
    ],
  },
  notebook: {
    label: '携帯ノート',
    shapes: [
      { d: 'M16 10h32v44H16z', fill: '#d6d3c8', stroke: '#64748b' },
      { d: 'M24 20h16M24 28h16M24 36h10', stroke: '#64748b', width: 2 },
      { d: 'M16 10l-6 8v36h6', fill: '#b8b2a4', stroke: '#64748b' },
    ],
  },
  pencil: {
    label: '鉛筆の芯',
    shapes: [
      { d: 'M18 46L46 18l6 6-28 28z', fill: '#fbbf24', stroke: '#64748b' },
      { d: 'M18 46l-4 10 10-4z', fill: '#d6d3c8', stroke: '#64748b' },
      { d: 'M46 18l4-4 6 6-4 4z', fill: '#ef4444' },
    ],
  },
  paper_strip: {
    label: '検査紙片',
    shapes: [
      { d: 'M14 12h36v40H14z', fill: '#d6d3c8', stroke: '#64748b' },
      { d: 'M20 20h24M20 28h24M20 36h16', stroke: '#64748b', width: 2 },
      { d: 'M40 12l10 10v30', fill: '#b8b2a4', stroke: '#64748b' },
    ],
  },
  small_mirror: {
    label: '小型鏡',
    shapes: [
      { d: circle(32, 32, 20), fill: '#1e293b', stroke: '#94a3b8', width: 2 },
      { d: 'M20 40c8-12 16-12 24 0', stroke: '#38bdf8', width: 3 },
      { d: circle(32, 32, 4), fill: '#e2e8f0' },
    ],
  },
  camera: {
    label: '監視カメラ',
    shapes: [
      { d: rect(10, 20, 36, 20, 3), fill: '#1e293b', stroke: '#64748b' },
      { d: 'M46 26l10-6v20l-10-6z', fill: '#11161f', stroke: '#64748b' },
      { d: circle(24, 30, 5), fill: '#0c1017', stroke: '#38bdf8' },
      { d: circle(24, 30, 2), fill: '#38bdf8' },
      { d: 'M20 44h24', stroke: '#64748b', width: 3 },
    ],
  },
  emergency_light: {
    label: '青い非常灯',
    shapes: [
      {
        d: 'M32 6v10M32 48v10M6 32h10M48 32h10M14 14l7 7M43 43l7 7M14 50l7-7M43 21l7-7',
        stroke: '#38bdf8',
        width: 3,
      },
      { d: circle(32, 32, 12), fill: '#0c1017', stroke: '#38bdf8', width: 2 },
      { d: circle(32, 32, 4), fill: '#38bdf8' },
    ],
  },
  cellmates: {
    label: '同房者',
    shapes: [
      {
        d: 'M14 52c0-12 6-22 12-22s12 10 12 22M38 52c0-12 6-22 12-22s12 10 12 22',
        fill: '#1e293b',
        stroke: '#64748b',
      },
      { d: circle(26, 18, 6), fill: '#1e293b', stroke: '#64748b' },
      { d: circle(50, 18, 6), fill: '#1e293b', stroke: '#64748b' },
      { d: 'M12 56h40', stroke: '#64748b', width: 2 },
    ],
  },
  footsteps: {
    label: '追従足音',
    shapes: [
      { d: 'M20 12h8v16h-8zM36 36h8v16h-8z', fill: '#94a3b8' },
      { d: 'M28 20h8v16h-8zM44 44h8v16h-8z', fill: '#38bdf8' },
      { d: 'M16 8h32', stroke: '#64748b', width: 2, dash: [3, 3] },
    ],
  },
  phase_shift: {
    label: '位相切替',
    shapes: [
      { d: 'M14 22h36M14 42h36', stroke: '#64748b', width: 3 },
      { d: 'M22 14l-8 8 8 8M42 34l8 8-8 8', stroke: '#38bdf8', width: 3 },
      { d: 'M32 6v52', stroke: '#3d4f69', dash: [3, 3] },
    ],
  },
  intercom: {
    label: '担当官の声',
    shapes: [
      { d: 'M12 44h40M12 34h40M12 24h40', stroke: '#3d4f69', width: 3 },
      { d: 'M20 14v40M28 14v40M36 14v40M44 14v40', stroke: '#38bdf8', width: 2 },
      { d: 'M12 54h40', stroke: '#f59e0b', width: 2 },
    ],
  },
  report: {
    label: '事後報告',
    shapes: [
      { d: rect(14, 10, 36, 46, 3), fill: '#d6d3c8', stroke: '#64748b' },
      { d: rect(24, 6, 16, 8, 2), fill: '#64748b' },
      { d: 'M20 24h24M20 31h24M20 38h14', stroke: '#64748b', width: 2 },
      { d: circle(42, 46, 6), stroke: '#ef4444', width: 2 },
    ],
  },
  document: {
    label: '交付文書',
    shapes: [
      { d: 'M16 8h24l10 10v38H16z', fill: '#d6d3c8', stroke: '#64748b' },
      { d: 'M40 8v10h10', fill: '#b8b2a4', stroke: '#64748b' },
      { d: 'M22 26h22M22 33h22', stroke: '#64748b', width: 2 },
      { d: rect(22, 40, 18, 5), fill: '#090b0e' },
    ],
  },
  pause: {
    label: '設定・ポーズ',
    shapes: [
      { d: rect(10, 10, 44, 44, 8), fill: '#1e293b', stroke: '#64748b', width: 2 },
      { d: `${rect(24, 20, 6, 24)}${rect(34, 20, 6, 24)}`, fill: '#e2e8f0' },
    ],
  },
  clock: {
    label: '手元時計',
    shapes: [
      { d: circle(32, 32, 20), fill: '#0c1017', stroke: '#94a3b8', width: 2 },
      { d: 'M32 14v4M32 46v4M14 32h4M46 32h4', stroke: '#64748b', width: 2 },
      { d: 'M32 32V19M32 32l9 6', stroke: '#e2e8f0', width: 3 },
      { d: circle(32, 32, 3), fill: '#f59e0b' },
    ],
  },
  white_door: {
    label: '白い扉',
    shapes: [
      { d: 'M10 58h44', stroke: '#64748b', width: 2 },
      { d: rect(18, 6, 28, 52, 2), fill: '#e5e7eb', stroke: '#94a3b8', width: 2 },
      { d: rect(23, 12, 18, 18), stroke: '#cbd5e1' },
      { d: circle(40, 36, 2.5), fill: '#64748b' },
    ],
  },
  terminal: {
    label: '機械照合端末',
    shapes: [
      { d: rect(12, 10, 40, 30, 3), fill: '#11161f', stroke: '#64748b', width: 2 },
      { d: rect(17, 15, 30, 20), fill: '#0c1017', stroke: '#283344' },
      { d: 'M21 21h18', stroke: '#38bdf8', width: 2 },
      { d: 'M21 29h12', stroke: '#ef4444', width: 2 },
      { d: 'M26 40h12v8H26z', fill: '#1e293b', stroke: '#64748b' },
      { d: 'M18 54h28', stroke: '#64748b', width: 3 },
    ],
  },
  tray: {
    label: '返却トレイ',
    shapes: [
      { d: rect(22, 22, 20, 12, 2), fill: '#fbbf24' },
      { d: 'M26 28h12', stroke: '#11161f', width: 2 },
      { d: 'M8 34h48l-6 14H14z', fill: '#1e293b', stroke: '#64748b', width: 2 },
    ],
  },
  cabinet: {
    label: '無許可キャビネット',
    shapes: [
      { d: rect(14, 8, 36, 48, 2), fill: '#11161f', stroke: '#ef4444', width: 2 },
      { d: 'M32 8v48', stroke: '#7f1d1d', width: 2, dash: [3, 3] },
      { d: 'M27 30v6M37 30v6', stroke: '#94a3b8', width: 2 },
      { d: circle(44, 15, 2.5), fill: '#ef4444' },
    ],
  },
  record_board: {
    label: '内部記録板',
    shapes: [
      { d: rect(14, 10, 36, 44, 2), fill: '#92400e', stroke: '#fbbf24', width: 2 },
      { d: rect(24, 6, 16, 8, 2), fill: '#64748b' },
      { d: 'M20 24h24M20 32h24M20 40h16', stroke: '#fde68a', width: 2 },
    ],
  },
};

/** Brand mark: a watching eye crossed by a redaction bar. Also used as the favicon. */
export const BRAND_MARK: ArtShape[] = [
  { d: rect(2, 2, 60, 60, 10), fill: '#0c1017', stroke: '#f59e0b', width: 3 },
  { d: 'M10 32c8-12 36-12 44 0-8 12-36 12-44 0z', stroke: '#f59e0b', width: 3 },
  { d: circle(32, 32, 7), fill: '#38bdf8' },
  { d: rect(8, 29, 48, 6), fill: '#090b0e' },
  { d: circle(50, 14, 3), fill: '#ef4444' },
];

export const OBJECT_ICONS: Record<string, IconId> = {
  'obj-t101-scuff': 'footsteps',
  'obj-t101-camera': 'camera',
  'obj-t101-box': 'collection_box',
  'obj-t204-counter': 'supplied_badge',
  'obj-t204-booth': 'intercom',
  'obj-t204-terminal': 'terminal',
  'obj-t204-tray': 'tray',
  'obj-t204-restricted': 'cabinet',
  'obj-t309-clock': 'clock',
  'obj-t309-window': 'rope_recorder',
  'obj-t309-open-main': 'white_door',
  'obj-t309-board': 'record_board',
};

export const ITEM_ICONS: Record<OptionalItemId, IconId> = {
  pencil: 'pencil',
  paper_strip: 'paper_strip',
  small_mirror: 'small_mirror',
};

export const ENDING_VISUALS: Record<
  EndingType,
  { seal: string; tone: 'red' | 'amber' | 'green' | 'gray'; color: string; icon: IconId }
> = {
  escape_attempt: { seal: '01', tone: 'red', color: '#ef4444', icon: 'supervisor_badge' },
  termination_shortage: { seal: '02', tone: 'amber', color: '#f59e0b', icon: 'report' },
  certified_useful: { seal: '03', tone: 'gray', color: '#94a3b8', icon: 'notebook' },
  termination_standard: { seal: '04', tone: 'gray', color: '#94a3b8', icon: 'document' },
};

const escapeAttr = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const shapeToSvg = (shape: ArtShape): string => {
  if ('text' in shape) {
    return `<text x="${shape.x}" y="${shape.y}" fill="${shape.fill}" font-size="${shape.size}" font-family="ui-monospace, monospace" font-weight="700">${escapeAttr(
      shape.text
    )}</text>`;
  }
  return `<path d="${shape.d}" fill="${shape.fill ?? 'none'}"${
    shape.stroke ? ` stroke="${shape.stroke}" stroke-width="${shape.width ?? 1}"` : ''
  }${shape.dash ? ` stroke-dasharray="${shape.dash.join(' ')}"` : ''}/>`;
};

const shapesToSvg = (shapes: ArtShape[], size: number, className: string, label?: string): string =>
  `<svg class="${className}" width="${size}" height="${size}" viewBox="0 0 64 64" ${
    label ? `role="img" aria-label="${escapeAttr(label)}"` : 'aria-hidden="true" focusable="false"'
  }>${shapes.map(shapeToSvg).join('')}</svg>`;

/**
 * Inline SVG markup for an icon. Decorative by default (aria-hidden) so button names stay unchanged;
 * pass `label` only when the icon carries meaning on its own.
 */
export function iconSvg(id: IconId, size = 20, options: { label?: string; className?: string } = {}): string {
  return shapesToSvg(ICONS[id].shapes, size, `ntk-icon ${options.className ?? ''}`.trim(), options.label);
}

export function brandMarkSvg(size = 34): string {
  return shapesToSvg(BRAND_MARK, size, 'ntk-brand-mark');
}

export function brandMarkDataUrl(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${BRAND_MARK.map(shapeToSvg).join(
    ''
  )}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function endingSealSvg(ending: EndingType): string {
  const { seal, color } = ENDING_VISUALS[ending];
  return `<svg class="ending-seal" width="92" height="92" viewBox="0 0 96 96" aria-hidden="true" focusable="false">
    <circle cx="48" cy="48" r="42" fill="none" stroke="${color}" stroke-width="3"/>
    <circle cx="48" cy="48" r="34" fill="none" stroke="${color}" stroke-width="1" stroke-dasharray="2 3"/>
    <text x="48" y="40" text-anchor="middle" fill="${color}" font-size="10" font-family="ui-monospace, monospace" letter-spacing="2">END</text>
    <text x="48" y="66" text-anchor="middle" fill="${color}" font-size="26" font-weight="800" font-family="ui-monospace, monospace">${seal}</text>
  </svg>`;
}

const pathCache = new WeakMap<ArtPath, Path2D>();

const pathFor = (shape: ArtPath): Path2D => {
  let path = pathCache.get(shape);
  if (!path) {
    path = new Path2D(shape.d);
    pathCache.set(shape, path);
  }
  return path;
};

/** Draws an icon centred on (cx, cy) at the given pixel size. */
export function drawIcon(
  ctx: CanvasRenderingContext2D,
  id: IconId,
  cx: number,
  cy: number,
  size: number,
  alpha = 1
): void {
  const scale = size / 64;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(scale, scale);
  for (const shape of ICONS[id].shapes) {
    if ('text' in shape) {
      ctx.fillStyle = shape.fill;
      ctx.font = `700 ${shape.size}px ui-monospace, monospace`;
      ctx.fillText(shape.text, shape.x, shape.y);
      continue;
    }
    const path = pathFor(shape);
    if (shape.fill) {
      ctx.fillStyle = shape.fill;
      ctx.fill(path);
    }
    if (shape.stroke) {
      ctx.strokeStyle = shape.stroke;
      ctx.lineWidth = shape.width ?? 1;
      ctx.setLineDash(shape.dash ?? []);
      ctx.stroke(path);
    }
  }
  ctx.restore();
}

// Scene illustrations (HTML only). IDs are prefixed so they do not collide with other inline SVG.

export const SCENE_TITLE_CORRIDOR = `
<svg class="scene-art title-art" viewBox="0 0 320 230" role="img" aria-label="収容区画の廊下。監視カメラが稼働し、背後に足音の跡が続いている">
  <defs>
    <linearGradient id="ntk-corridor-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#161d28"/><stop offset="1" stop-color="#090b0e"/></linearGradient>
    <radialGradient id="ntk-corridor-cone" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#38bdf8" stop-opacity=".24"/><stop offset="1" stop-color="#38bdf8" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="320" height="230" fill="url(#ntk-corridor-grad)"/>
  <path d="M0 190 L320 150 L320 230 L0 230 Z" fill="#0c1017"/>
  <path d="M0 190 L320 150" stroke="#3d4f69" stroke-width="2"/>
  <path d="M0 210 L320 170" stroke="#161d28" stroke-width="2"/>
  <path d="M30 184 L55 182 M95 176 L120 174 M165 168 L190 166 M235 160 L260 158" stroke="#283344" stroke-width="2"/>
  <rect x="236" y="74" width="48" height="82" rx="3" fill="#11161f" stroke="#3d4f69"/>
  <rect x="244" y="84" width="32" height="62" fill="#0c1017" stroke="#283344"/>
  <circle cx="252" cy="115" r="3" fill="#38bdf8"/>
  <path d="M260 115 L284 115" stroke="#38bdf8" stroke-width="2"/>
  <circle cx="118" cy="160" r="30" fill="url(#ntk-corridor-cone)"/>
  <circle cx="118" cy="160" r="5" fill="#f97316" stroke="#e2e8f0" stroke-width="1.5"/>
  <path d="M118 160 L155 142 L162 154 Z" fill="#38bdf8" opacity=".22"/>
  <path d="M98 174 q6 4 12 0 M107 182 q6 4 12 0 M121 190 q6 4 12 0" stroke="#64748b" stroke-width="2" fill="none"/>
  <rect x="36" y="38" width="104" height="20" rx="3" fill="#0c1017" stroke="#283344"/>
  <text x="44" y="52" fill="#f59e0b" font-size="10" font-family="ui-monospace, monospace">CAM-101 ACTIVE</text>
  <circle cx="131" cy="48" r="3" fill="#ef4444" class="rec-blink"/>
  <path d="M152 116 l12 8 l-12 8 z" fill="#ef4444" opacity=".6"/>
  <text x="18" y="216" fill="#64748b" font-size="10" font-family="ui-monospace, monospace">SITE-19 / SECTOR ██</text>
</svg>`;

export const SCENE_INTERCOM = `
<svg class="scene-art" viewBox="0 0 320 120" role="img" aria-label="試験室のインターホン">
  <rect width="320" height="120" fill="#0c1017"/>
  <rect x="20" y="26" width="280" height="56" rx="4" fill="#11161f" stroke="#3d4f69"/>
  <circle cx="52" cy="54" r="12" fill="#1e293b" stroke="#64748b"/>
  <path d="M46 54h12M52 48v12" stroke="#94a3b8" stroke-width="2"/>
  <path d="M84 48h150M84 60h110" stroke="#3d4f69" stroke-width="4"/>
  <path d="M84 74h180" stroke="#283344" stroke-width="3"/>
  <path d="M20 96h280" stroke="#283344"/>
  <path d="M244 38v32M252 38v32M260 38v32M268 38v32" stroke="#38bdf8" stroke-width="2"/>
  <circle cx="284" cy="36" r="3" fill="#22c55e" class="rec-blink"/>
  <text x="22" y="110" fill="#64748b" font-size="9" font-family="ui-monospace, monospace">INTERCOM / CH-A</text>
</svg>`;

export const SCENE_BUNK_ENVELOPE = `
<svg class="scene-art" viewBox="0 0 360 150" role="img" aria-label="寝台の下に隠した封筒">
  <rect width="360" height="150" fill="#0c1017"/>
  <path d="M30 112h300" stroke="#3d4f69" stroke-width="4"/>
  <path d="M50 112v22M310 112v22" stroke="#3d4f69" stroke-width="4"/>
  <path d="M46 96h268v16H46z" fill="#161d28" stroke="#283344"/>
  <path d="M80 96V70h200v26" fill="#11161f" stroke="#283344"/>
  <path d="M132 108h96v22h-96z" fill="#d6d3c8" stroke="#64748b"/>
  <path d="M132 108l48 14 48-14" fill="none" stroke="#64748b" stroke-width="2"/>
  <path d="M160 100h40v8h-40z" fill="#b8b2a4" stroke="#64748b"/>
  <path d="M46 128h268" stroke="#090b0e" stroke-width="8"/>
  <text x="52" y="144" fill="#64748b" font-size="10" font-family="ui-monospace, monospace">UNDER BUNK / MAX 3 ITEMS</text>
</svg>`;
