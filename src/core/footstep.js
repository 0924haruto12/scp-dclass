import { BASE_SPEED, GAIT, ROOM } from './constants.js';

// 歩調（通路試験）の判定だけを持つ。描画・音・DOM に依存しない。
// state はその場で更新し、起きた出来事を配列で返す。

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pushEvent(trial, events, type, payload = {}) {
  const event = { type, at: Number(trial.elapsed.toFixed(2)), ...payload };
  events.push(event);
  trial.events.push(event);
  if (trial.events.length > 240) trial.events.shift();
  return event;
}

export function createTrial({
  tolerance = 2.5,
  seed = 0,
  day = 1,
  subjectNumber = 'D-9341',
  speaker = '研究員A',
} = {}) {
  return {
    id: `GAIT-${day}-${seed >>> 0}`,
    roomCode: 'A-01',
    seed,
    day,
    subjectNumber,
    speaker,
    tolerance,
    phase: 'running',
    elapsed: 0,
    deadline: GAIT.deadlineSeconds,
    warned: false,
    nearBox: false,
    player: { x: ROOM.startX, y: 0, facing: 0 },
    box: { x: ROOM.boxX, y: 0, collected: false },
    follow: {
      mode: 'following',
      danger: 0,
      clear: 0,
      clearKind: null,
      backoff: 0,
      stopClears: 0,
      slowClears: 0,
    },
    load: {
      offered: false,
      reply: null,
      repliedAt: null,
      spanArmed: false,
      spanSatisfied: false,
      spanFailed: false,
    },
    flags: {
      blockedExitWarned: false,
      reachedExit: false,
    },
    outcome: null,
    death: null,
    stats: {
      maxSpeed: 0,
      approachCount: 0,
      distance: 0,
      ranSeconds: 0,
    },
    lastInput: { mode: 'idle', speed: 0 },
    events: [],
  };
}

export function replyToInstruction(trial, reply) {
  if (!trial.load.offered || trial.load.reply) return [];
  if (!['obey', 'delay', 'refuse', 'question'].includes(reply)) return [];

  trial.load.reply = reply;
  trial.load.repliedAt = trial.elapsed;

  const lines = {
    obey: '了解しました。',
    delay: '時間がありません。',
    refuse: '……その判断は記録します。',
    question: '質問は受け付けていません。',
  };

  const event = {
    type: 'intercom-reply',
    at: Number(trial.elapsed.toFixed(2)),
    reply,
    caption: `${trial.speaker}「${lines[reply]}」`,
    sound: 'intercom',
  };
  trial.events.push(event);
  return [event];
}

export function stepTrial(trial, input = {}) {
  const events = [];
  if (trial.phase !== 'running') return events;

  const dt = clamp(Number(input.dt) || 0, 0, 0.1);
  if (dt <= 0) return events;

  const moveX = Number(input.moveX) || 0;
  const moveY = Number(input.moveY) || 0;
  const moving = Math.hypot(moveX, moveY) > 0.01;
  const mode = moving ? input.mode || 'normal' : 'idle';
  const speed = moving ? BASE_SPEED[mode] ?? BASE_SPEED.normal : 0;

  trial.elapsed += dt;

  if (input.facing != null && Number.isFinite(input.facing)) {
    // 向きは速度と独立。振り返り自体に判定上の効果は持たせない。
    trial.player.facing = input.facing;
  } else if (moving) {
    trial.player.facing = Math.atan2(moveY, moveX);
  }

  if (moving) {
    const length = Math.hypot(moveX, moveY);
    const beforeX = trial.player.x;
    trial.player.x = clamp(
      trial.player.x + (moveX / length) * speed * dt,
      ROOM.playerMinX,
      ROOM.playerMaxX,
    );
    trial.player.y = clamp(
      trial.player.y + (moveY / length) * speed * dt,
      -ROOM.playerHalfWidth,
      ROOM.playerHalfWidth,
    );
    trial.stats.distance += Math.abs(trial.player.x - beforeX);
    if (mode === 'run') trial.stats.ranSeconds += dt;
  }

  trial.stats.maxSpeed = Math.max(trial.stats.maxSpeed, speed);
  trial.lastInput = { mode, speed };

  // 回収（任意入力）。近くにいれば自動では取らない。
  const distanceToBox = Math.hypot(trial.player.x - trial.box.x, trial.player.y - trial.box.y);
  trial.nearBox = !trial.box.collected && distanceToBox <= ROOM.collectRadius + 0.35;
  if (trial.nearBox && input.interact) {
    trial.box.collected = true;
    trial.nearBox = false;
    pushEvent(trial, events, 'collect', { caption: '箱を回収した。', sound: 'click' });
    trial.load.offered = true;
    pushEvent(trial, events, 'instruction', {
      caption: `${trial.speaker}「時間がありません。走ってください」`,
      sound: 'intercom',
      obligation: 'run-segment',
    });
  }

  updateFollow(trial, events, speed, mode, dt);

  if (trial.phase === 'running') {
    updateRunSpan(trial, events, speed);
  }

  if (trial.phase === 'running' && trial.box.collected && trial.player.x <= ROOM.exitX) {
    if (trial.follow.mode === 'approach') {
      if (!trial.flags.blockedExitWarned) {
        trial.flags.blockedExitWarned = true;
        pushEvent(trial, events, 'blocked-exit', {
          caption: '足音が背後のすぐ近くで止まらない。',
          sound: 'breath',
        });
      }
    } else {
      trial.flags.reachedExit = true;
      trial.phase = 'done';
      trial.outcome = 'survived';
      pushEvent(trial, events, 'exit', { caption: '入口の扉を抜けた。', sound: 'door' });
    }
  }

  if (trial.phase === 'running') {
    const remaining = trial.deadline - trial.elapsed;
    if (!trial.warned && remaining <= GAIT.deadlineWarningSeconds) {
      trial.warned = true;
      pushEvent(trial, events, 'deadline-warning', {
        caption: '入口のランプが赤く点滅し始めた。',
        sound: 'alarm',
      });
    }
    if (remaining <= 0) {
      trial.phase = 'done';
      trial.outcome = 'timeout';
      pushEvent(trial, events, 'timeout', {
        caption: '入口の遮蔽が閉じた。回収班が入ってくる。',
        sound: 'door',
      });
    }
  }

  return events;
}

function updateFollow(trial, events, speed, mode, dt) {
  const follow = trial.follow;

  if (follow.mode === 'following') {
    if (speed > trial.tolerance) {
      follow.mode = 'approach';
      follow.danger = 0;
      follow.clear = 0;
      trial.stats.approachCount += 1;
      pushEvent(trial, events, 'approach', {
        caption: '右後方から足音が重なり、間隔が詰まってきた。',
        sound: 'approach',
        speed,
      });
    }
    return;
  }

  if (follow.mode === 'approach') {
    const stopping = speed === 0;
    const slowWalking = mode === 'slow' && speed > 0 && speed <= BASE_SPEED.slow;

    if (stopping || slowWalking) {
      // 解除入力の継続中は危険時計を止める。停止と低速は別の継続として数える。
      const kind = stopping ? 'stop' : 'slow';
      if (follow.clearKind !== kind) {
        follow.clearKind = kind;
        follow.clear = 0;
      }
      follow.clear += dt;
      const required = stopping ? GAIT.stopClearSeconds : GAIT.slowClearSeconds;
      if (follow.clear >= required) {
        follow.mode = 'backoff';
        follow.backoff = 0;
        follow.danger = 0;
        follow.clear = 0;
        follow.clearKind = null;
        if (stopping) follow.stopClears += 1;
        else follow.slowClears += 1;
        pushEvent(trial, events, 'retreat', {
          caption: '足音が遠のいていく。',
          sound: 'retreat',
        });
      }
      return;
    }

    // 通常歩行に戻しただけでは解除しない。危険時計は元の値から再開する。
    follow.clear = 0;
    follow.clearKind = null;
    follow.danger = Math.min(GAIT.contactSeconds, follow.danger + dt);

    if (follow.danger >= GAIT.contactSeconds) {
      trial.phase = 'done';
      trial.outcome = 'died';
      trial.death = {
        at: Number(trial.elapsed.toFixed(2)),
        mode,
        speed,
        reason: 'follow-contact',
        danger: follow.danger,
      };
      pushEvent(trial, events, 'death', {
        caption: '首筋に冷たい接触。',
        sound: 'death',
      });
    }
    return;
  }

  if (follow.mode === 'backoff') {
    follow.backoff += dt;
    if (speed > trial.tolerance) {
      // 後退中に閾値を超えたら、後退を中断して新しい前兆付きの接近へ戻す。
      follow.mode = 'approach';
      follow.danger = 0;
      follow.clear = 0;
      follow.backoff = 0;
      trial.stats.approachCount += 1;
      pushEvent(trial, events, 'approach', {
        caption: '右後方から足音が重なり、間隔が詰まってきた。',
        sound: 'approach',
        speed,
      });
    } else if (follow.backoff >= GAIT.backoffSeconds) {
      follow.mode = 'following';
      follow.backoff = 0;
    }
  }
}

function updateRunSpan(trial, events, speed) {
  const load = trial.load;
  if (!trial.box.collected || load.spanSatisfied) return;

  const x = trial.player.x;
  const running = speed >= BASE_SPEED.run - 0.001;

  if (!load.spanArmed) {
    if (running && x >= ROOM.redLineX - 0.6 && x <= ROOM.redLineX + 0.2) {
      load.spanArmed = true;
      pushEvent(trial, events, 'run-span-start', { caption: '赤線を走って通過した。', silent: true });
    }
    return;
  }

  if (!running) {
    load.spanArmed = false;
    load.spanFailed = true;
    pushEvent(trial, events, 'run-span-fail', {
      caption: '赤線と青線の間で足が止まった。',
      sound: 'footstep',
      silent: true,
    });
    return;
  }

  if (x <= ROOM.blueLineX + 0.25) {
    load.spanArmed = false;
    load.spanSatisfied = true;
    pushEvent(trial, events, 'run-span-success', {
      caption: `${trial.speaker}「結構です」`,
      sound: 'intercom',
    });
  }
}

export function trialStatusLabel(trial) {
  if (trial.outcome === 'died') return '反応消失';
  if (trial.outcome === 'timeout') return '期限超過';
  if (trial.outcome === 'survived') return '退出';
  return '实验中';
}
