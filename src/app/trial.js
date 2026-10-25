import { BASE_SPEED } from '../core/constants.js';
import { replyToInstruction, stepTrial } from '../core/footstep.js';
import { renderTrial } from './render.js';

const FIXED_STEP = 1 / 60;
const MOVEMENT_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);

export function createTrialRunner({
  canvas,
  audio,
  onCaption,
  onInstruction,
  onComplete,
  onPauseRequest,
  onHud,
  onAutosave,
}) {
  const ctx = canvas.getContext('2d');
  let trial = null;
  let raf = 0;
  let last = 0;
  let acc = 0;
  let time = 0;
  let externalPaused = false;
  let instructionShown = false;
  let finishAt = null;
  let keys = new Set();
  let interact = false;
  let slowToggle = false;
  let facing = Math.PI;
  let camera = { x: 12, scale: 52 };
  let playerStepClock = 0;
  let followStepClock = 0.28;
  let autosaveClock = 0;
  let lastHud = 0;
  let lastPointerAt = 0;

  function isFormTarget(event) {
    const target = event.target;
    return (
      target &&
      target.tagName &&
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName.toUpperCase())
    );
  }

  function isPaused() {
    if (!trial) return true;
    if (externalPaused || document.hidden) return true;
    if (trial.outcome) return true;
    if (trial.load.offered && !trial.load.reply) return true;
    return false;
  }

  function onKeyDown(event) {
    if (!trial || isFormTarget(event)) return;

    if (event.code === 'Tab') {
      if (!isPaused()) {
        event.preventDefault();
        onPauseRequest?.('notebook');
      }
      return;
    }
    if (event.code === 'Escape') {
      if (!isPaused()) {
        event.preventDefault();
        onPauseRequest?.('pause');
      }
      return;
    }
    if (isPaused()) return;
    if (event.code === 'KeyE') {
      event.preventDefault();
      interact = true;
      return;
    }
    if (event.code === 'KeyC') {
      event.preventDefault();
      slowToggle = !slowToggle;
      return;
    }
    if (
      event.code === 'ShiftLeft' ||
      event.code === 'ShiftRight' ||
      event.code === 'KeyZ'
    ) {
      keys.add(event.code);
      return;
    }
    if (MOVEMENT_KEYS.has(event.code)) {
      event.preventDefault();
      keys.add(event.code);
    }
  }

  function onKeyUp(event) {
    keys.delete(event.code);
  }

  function onBlur() {
    keys.clear();
  }

  function onPointerMove(event) {
    if (!trial || !camera.scale) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    const wx = (px - rect.width / 2) / camera.scale + camera.x;
    const wy = (py - rect.height / 2) / camera.scale;
    const dx = wx - trial.player.x;
    const dy = wy - trial.player.y;
    if (Math.hypot(dx, dy) > 0.3) {
      facing = Math.atan2(dy, dx);
      lastPointerAt = performance.now();
    }
  }

  function onPointerDown(event) {
    if (!trial || isPaused()) return;
    onPointerMove(event);
    interact = true;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerdown', onPointerDown);

  function readInput(dt) {
    const up = keys.has('KeyW') || keys.has('ArrowUp');
    const down = keys.has('KeyS') || keys.has('ArrowDown');
    const left = keys.has('KeyA') || keys.has('ArrowLeft');
    const right = keys.has('KeyD') || keys.has('ArrowRight');
    const moveX = (right ? 1 : 0) - (left ? 1 : 0);
    const moveY = (down ? 1 : 0) - (up ? 1 : 0);
    const moving = moveX !== 0 || moveY !== 0;
    const shift = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const slowHold = keys.has('KeyZ');

    if (moving && performance.now() - lastPointerAt > 1400) {
      facing = Math.atan2(moveY, moveX);
    }

    const mode = !moving ? 'idle' : shift ? 'run' : slowHold || slowToggle ? 'slow' : 'normal';
    const input = {
      dt,
      moveX,
      moveY,
      mode,
      facing,
      interact,
    };
    interact = false;
    return input;
  }

  function processEvents(events) {
    for (const event of events) {
      if (event.caption && !event.silent) onCaption?.(event.caption);
      switch (event.sound) {
        case 'approach':
          audio.approachAlert();
          break;
        case 'retreat':
          audio.retreat();
          break;
        case 'intercom':
          audio.intercom();
          break;
        case 'alarm':
          audio.alarm();
          break;
        case 'death':
          audio.death();
          break;
        case 'click':
          audio.collect();
          break;
        case 'door':
          audio.door();
          break;
        case 'breath':
          audio.breath();
          break;
        case 'footstep':
          audio.followStep({});
          break;
        default:
          break;
      }
    }
  }

  function scheduleAudio(dt, input) {
    const mode = trial.follow.mode;
    const speed = input.mode === 'idle' ? 0 : BASE_SPEED[input.mode] ?? 0;

    if (speed > 0) {
      playerStepClock -= dt;
      if (playerStepClock <= 0) {
        audio.playerStep(speed);
        playerStepClock = speed >= 4 ? 0.27 : speed >= 2 ? 0.44 : 0.7;
      }
    } else {
      playerStepClock = 0;
    }

    if (mode === 'following' && speed === 0) {
      followStepClock = 0.28;
      return;
    }

    followStepClock -= dt;
    if (followStepClock > 0) return;

    if (mode === 'approach') {
      const danger = trial.follow.danger;
      audio.followStep({
        intensity: 0.12 + danger * 0.14,
        pan: -0.32,
        frequency: 170,
      });
      followStepClock = Math.max(0.13, 0.3 - danger * 0.05);
      return;
    }

    if (mode === 'backoff') {
      const fade = Math.max(0, 1 - trial.follow.backoff);
      audio.followStep({ intensity: 0.07 * fade, pan: -0.45, frequency: 340 });
      followStepClock = 0.4;
      return;
    }

    audio.followStep({
      intensity: speed >= 4 ? 0.1 : 0.045,
      pan: -0.32,
      frequency: speed >= 4 ? 280 : 220,
    });
    followStepClock = speed >= 4 ? 0.38 : 0.55;
  }

  function stepOnce(dt) {
    if (!trial) return;
    const input = readInput(dt);
    const events = stepTrial(trial, input);
    processEvents(events);
    scheduleAudio(dt, input);

    if (trial.load.offered && !trial.load.reply && !instructionShown) {
      instructionShown = true;
      onInstruction?.(trial);
    }

    if (trial.outcome && finishAt == null) {
      finishAt = time + (trial.outcome === 'died' ? 1.15 : 0.5);
    }
  }

  function ensureSize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(320, canvas.clientWidth || 960);
    const height = Math.round(width * (9 / 16));
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    return { width, height, dpr };
  }

  function draw() {
    if (!trial) return;
    const { width, height, dpr } = ensureSize();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    camera = renderTrial(ctx, trial, { width, height, time });
  }

  function updateHud(now) {
    if (now - lastHud < 90) return;
    lastHud = now;
    const remaining = Math.max(0, trial.deadline - trial.elapsed);
    onHud?.({
      day: trial.day,
      remaining,
      collected: trial.box.collected,
      slow: slowToggle || keys.has('KeyZ'),
      mode: trial.follow.mode,
      prompt: trial.nearBox ? 'E 箱を回収する' : null,
      warning: remaining <= 10,
    });
  }

  function loop(timestamp) {
    raf = 0;
    if (!trial) return;
    const now = timestamp || performance.now();
    const delta = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    time += delta;

    if (!isPaused()) {
      acc += delta;
      let steps = 0;
      while (acc >= FIXED_STEP && steps < 4 && !isPaused()) {
        stepOnce(FIXED_STEP);
        acc -= FIXED_STEP;
        steps += 1;
      }
      if (steps >= 4) acc = 0;

      autosaveClock += delta;
      if (autosaveClock >= 4) {
        autosaveClock = 0;
        onAutosave?.();
      }
    }

    draw();
    updateHud(now);

    if (finishAt != null && time >= finishAt) {
      const finished = trial;
      trial = null;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      keys.clear();
      onComplete?.(finished);
      return;
    }

    raf = requestAnimationFrame(loop);
  }

  function start(nextTrial) {
    trial = nextTrial;
    externalPaused = false;
    instructionShown = false;
    finishAt = null;
    acc = 0;
    time = 0;
    last = performance.now();
    keys.clear();
    interact = false;
    slowToggle = false;
    facing = nextTrial.player?.facing ?? 0;
    playerStepClock = 0;
    followStepClock = 0.28;
    autosaveClock = 0;
    lastPointerAt = 0;
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    trial = null;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    keys.clear();
  }

  function setPaused(paused) {
    externalPaused = Boolean(paused);
    if (!externalPaused) {
      last = performance.now();
      acc = 0;
    }
  }

  function reply(replyValue) {
    if (!trial) return;
    const events = replyToInstruction(trial, replyValue);
    processEvents(events);
  }

  function getTrial() {
    return trial;
  }

  function isRunning() {
    return Boolean(trial);
  }

  if (new URLSearchParams(window.location.search).has('debug')) {
    window.__ntkDebug = () => ({
      keys: Array.from(keys),
      slowToggle,
      paused: isPaused(),
      externalPaused,
      trial: trial
        ? {
            x: Number(trial.player.x.toFixed(2)),
            y: Number(trial.player.y.toFixed(2)),
            elapsed: Number(trial.elapsed.toFixed(2)),
            phase: trial.phase,
            outcome: trial.outcome,
            mode: trial.follow.mode,
            danger: Number(trial.follow.danger.toFixed(2)),
            clear: Number(trial.follow.clear.toFixed(2)),
            backoff: Number(trial.follow.backoff.toFixed(2)),
            collected: trial.box.collected,
            span: trial.load.spanSatisfied,
            reply: trial.load.reply,
            lastInput: trial.lastInput,
          }
        : null,
    });
  }

  return { start, stop, setPaused, reply, getTrial, isRunning };
}
