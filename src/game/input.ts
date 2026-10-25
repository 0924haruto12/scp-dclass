// キーボード＋マウス。移動と視線は独立した入力にする（仕様案6.1）。
// 割当はここに集め、実装中に変更できるようにする。

import type { HeldInput } from '../core/runner';

export const KEYMAP = {
  up: ['KeyW'],
  down: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  faceUp: ['ArrowUp'],
  faceDown: ['ArrowDown'],
  faceLeft: ['ArrowLeft'],
  faceRight: ['ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
  slowHold: ['KeyC'],
  slowToggle: ['KeyV'],
  interact: ['KeyE', 'Space'],
  notes: ['Tab', 'KeyN'],
  pause: ['Escape', 'KeyP'],
  respond1: ['Digit1', 'Numpad1'],
  respond2: ['Digit2', 'Numpad2'],
  respond3: ['Digit3', 'Numpad3'],
  respond4: ['Digit4', 'Numpad4'],
  dev: ['F3'],
} as const;

export type Action = keyof typeof KEYMAP;

const BLOCK_DEFAULT = new Set<string>(['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F3']);

export class Input {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private facing = 0;
  private pointer: { clientX: number; clientY: number } | null = null;
  slowToggled = false;
  enabled = false;

  constructor(private readonly toWorld: (clientX: number, clientY: number) => { x: number; y: number }) {
    window.addEventListener('keydown', (ev) => {
      if (!this.enabled) return;
      if (isTyping(ev.target)) return;
      if (BLOCK_DEFAULT.has(ev.code)) ev.preventDefault();
      if (!ev.repeat) this.pressed.add(ev.code);
      this.down.add(ev.code);
      if (!ev.repeat && (KEYMAP.slowToggle as readonly string[]).includes(ev.code)) this.slowToggled = !this.slowToggled;
    });
    window.addEventListener('keyup', (ev) => {
      this.down.delete(ev.code);
    });
    window.addEventListener('mousemove', (ev) => {
      this.pointer = { clientX: ev.clientX, clientY: ev.clientY };
    });
    window.addEventListener('blur', () => this.releaseAll());
  }

  /** フォーカス喪失や画面切替で、押しっぱなしの扱いを残さない */
  releaseAll(): void {
    this.down.clear();
    this.pressed.clear();
  }

  isDown(action: Action): boolean {
    return KEYMAP[action].some((code) => this.down.has(code));
  }

  /** 押された瞬間を1回だけ取り出す */
  take(action: Action): boolean {
    let hit = false;
    for (const code of KEYMAP[action]) {
      if (this.pressed.delete(code)) hit = true;
    }
    return hit;
  }

  clearPressed(): void {
    this.pressed.clear();
  }

  held(player: { x: number; y: number }): HeldInput {
    const moveX = (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0);
    const moveY = (this.isDown('down') ? 1 : 0) - (this.isDown('up') ? 1 : 0);
    const fx = (this.isDown('faceRight') ? 1 : 0) - (this.isDown('faceLeft') ? 1 : 0);
    const fy = (this.isDown('faceDown') ? 1 : 0) - (this.isDown('faceUp') ? 1 : 0);
    if (fx !== 0 || fy !== 0) {
      this.facing = Math.atan2(fy, fx);
      this.pointer = null;
    } else if (this.pointer) {
      const w = this.toWorld(this.pointer.clientX, this.pointer.clientY);
      if (Math.hypot(w.x - player.x, w.y - player.y) > 0.2) this.facing = Math.atan2(w.y - player.y, w.x - player.x);
    }
    return {
      moveX,
      moveY,
      run: this.isDown('run'),
      slow: this.isDown('slowHold') || this.slowToggled,
      facing: this.facing,
    };
  }

  resetFacing(angle: number): void {
    this.facing = angle;
    this.pointer = null;
  }
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}
