/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import { ENDING_VISUALS } from '../src/render/art';
import rendererSource from '../src/render/canvasRenderer.ts?raw';
import appSource from '../src/ui/app.ts?raw';

describe('グラフィックの情報開示ポリシー', () => {
  it('有用認定を成功の色で祝わない（消耗品として残る結末なので）', () => {
    expect(ENDING_VISUALS.certified_useful.tone).not.toBe('green');
    expect(ENDING_VISUALS.certified_useful.color).not.toBe('#22c55e');
  });

  it('観測窓で確認するまでは、白い扉の部屋数・接続順・最奥の情報を表示しない', () => {
    expect(rendererSource).not.toContain("['E', '?', '?', 'P']");
    expect(rendererSource).toContain('未確認（観測窓で確認）');
  });

  it('残り時間のゲージと警告アイコンを使わず、前兆は知覚記録として表示する', () => {
    expect(rendererSource).not.toContain('remaining <= 20');
    expect(rendererSource).not.toContain('Timer bar');
    expect(rendererSource).not.toContain('Warning triangle');
    expect(rendererSource).toContain('【知覚記録】');
  });

  it('安全圏の答えを非常灯のラベルに書かない', () => {
    expect(rendererSource).not.toContain('固定点・退避安全圏');
    expect(rendererSource).toContain("ctx.fillText('青い非常灯',");
  });

  it('カメラの監視範囲を実測の円ではなく、カメラの存在を示す表示にする', () => {
    expect(rendererSource).not.toMatch(/ctx\.arc\(zoneX, zoneY/);
    expect(rendererSource).toContain('CAM-204 [REC]');
  });
});

describe('実験画面UIの情報開示ポリシー', () => {
  it('割当作業パネルは召集時の通達だけを表示し、途中で有効になった指示を目的として扱わない', () => {
    const start = appSource.indexOf('private renderTrialObjective(');
    const end = appSource.indexOf('private getObjectActionLabel(');
    const body = appSource.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(body).toContain('trial.instructions[0]');
    expect(body).not.toContain('activeInst');
  });

  it('白い扉の内部周期は開発用ログを有効にしたときだけ表示する', () => {
    const occurrences = appSource.split('内部周期').length - 1;
    const devOnly = appSource.split('[DEV] 内部周期').length - 1;
    expect(occurrences).toBeGreaterThan(0);
    expect(devOnly).toBe(occurrences);
  });
});
