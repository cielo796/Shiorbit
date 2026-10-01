import { describe, expect, it } from 'vitest';
import { MemoryAdapter } from '../src/adapters/memory';
import { VaultService } from '../src/core/vault/VaultService';
import { DEFAULT_SETTINGS, LIMITS, Settings, normalize } from '../src/core/settings/Settings';

function newSettings(): Settings {
  return new Settings(new VaultService(new MemoryAdapter('Zoom'), { mtimeToleranceMs: 0 }));
}

describe('表示に関する設定の検証', () => {
  it('範囲外の数値は端へ丸める', () => {
    expect(normalize({ zoom: 9 }).zoom).toBe(LIMITS.zoom.max);
    expect(normalize({ zoom: 0.01 }).zoom).toBe(LIMITS.zoom.min);
    expect(normalize({ editorFontSize: 3 }).editorFontSize).toBe(LIMITS.editorFontSize.min);
    expect(normalize({ pollInterval: 10 }).pollInterval).toBe(LIMITS.pollInterval.min);
  });

  it('数値でない値は既定値に戻す', () => {
    expect(normalize({ zoom: 'big' }).zoom).toBe(DEFAULT_SETTINGS.zoom);
    expect(normalize({ autoSaveDelay: Number.NaN }).autoSaveDelay).toBe(DEFAULT_SETTINGS.autoSaveDelay);
  });

  it('HTML の既定表示は preview か source だけ', () => {
    expect(normalize({ htmlDefaultView: 'source' }).htmlDefaultView).toBe('source');
    expect(normalize({ htmlDefaultView: 'なにか' }).htmlDefaultView).toBe('preview');
  });
});

describe('設定のプレビュー', () => {
  it('preview は反映するが保存はしない', async () => {
    const settings = newSettings();
    await settings.load();

    let seen = 0;
    settings.onChange(() => seen++);
    settings.preview({ zoom: 1.5 });

    expect(settings.data.zoom).toBe(1.5);
    expect(seen).toBe(1);
  });

  it('discardPreview で保存済みの値へ戻る', async () => {
    const settings = newSettings();
    await settings.load();
    await settings.update({ zoom: 1.2 });

    settings.preview({ zoom: 2 });
    expect(settings.data.zoom).toBe(2);

    settings.discardPreview();
    expect(settings.data.zoom).toBe(1.2);
  });

  it('preview したあとの update は preview 分を引きずらない', async () => {
    const settings = newSettings();
    await settings.load();

    settings.preview({ zoom: 2, uiFontSize: 20 });
    await settings.update({ zoom: 1.1 });

    expect(settings.data.zoom).toBe(1.1);
    expect(settings.data.uiFontSize).toBe(DEFAULT_SETTINGS.uiFontSize);
  });
});
