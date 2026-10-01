// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HtmlDocumentView } from '../src/ui/views/htmlView';
import type { DocumentContext } from '../src/ui/views/DocumentView';
import { DEFAULT_SETTINGS } from '../src/core/settings/Settings';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function fixture(mode: 'preview' | 'source' = 'preview', readBinary = vi.fn(async () => new ArrayBuffer(0))) {
  let text = 'previous markdown';
  const editor = {
    dom: document.createElement('div'),
    setLanguage: vi.fn(),
    setDoc: vi.fn((value: string) => { text = value; }),
    getDoc: vi.fn(() => text),
    getViewState: vi.fn(() => ({ anchor: 12, head: 12, scrollTop: 23 })),
    setViewState: vi.fn(), revealOffset: vi.fn(), focus: vi.fn(),
  };
  const preview = document.createElement('iframe');
  const context = {
    surfaces: { editor, preview }, settings: () => ({ ...DEFAULT_SETTINGS, htmlDefaultView: mode }),
    headingsOf: () => [{ level: 1, text: 'HTML', offset: 0 }], readBinary,
  } as unknown as DocumentContext;
  const view = new HtmlDocumentView('web/page.html', context);
  const load = (source: string) => view.load({ path: view.path, text: source, mtime: 1 });
  return { view, editor, preview, load };
}

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe('HTML表示の負荷とソース保持', () => {
  it('Blob文書は表示切替・破棄時に解放し、古い非同期結果も解放する', async () => {
    const create = vi.fn().mockReturnValueOnce('blob:document/1').mockReturnValueOnce('blob:document/2');
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    const { view, preview, load } = fixture();
    load('<h1>HTML</h1>');
    await flush();
    expect(preview.src).toBe('blob:document/1#shiorbit-h0');
    view.setMode('source');
    expect(revoke).toHaveBeenCalledWith('blob:document/1');
    view.setMode('preview');
    view.destroy();
    await flush();
    expect(revoke).toHaveBeenCalledWith('blob:document/2');
    expect(revoke).toHaveBeenCalledTimes(2);
  });
  it('プレビューではソースエディタを初期化せず、切替時に一度だけ正しい本文を渡す', async () => {
    const { view, editor, preview, load } = fixture();
    load('<h1>HTML</h1>');
    await flush();
    expect(editor.setDoc).not.toHaveBeenCalled();
    expect(view.contentToSave()).toBe('<h1>HTML</h1>');
    expect(preview.src).toMatch(/^data:text\/html/);
    view.setMode('source');
    expect(editor.setDoc).toHaveBeenCalledOnce();
    expect(editor.setLanguage).toHaveBeenCalledWith('html');
    expect(preview.hasAttribute('src')).toBe(false);
    editor.setDoc('<h1>Edited</h1>');
    view.setMode('preview');
    await flush();
    expect(decodeURIComponent(preview.src)).toContain('Edited');
    view.setMode('source');
    expect(view.contentToSave()).toBe('<h1>Edited</h1>');
    expect(editor.setDoc).toHaveBeenCalledTimes(2); // 初期化 + テスト内の編集
    view.destroy();
  });

  it('ソースモードの入力で非表示iframeを再生成しない', async () => {
    const { view, editor, preview, load } = fixture('source');
    const parse = vi.spyOn(DOMParser.prototype, 'parseFromString');
    load('<h1>HTML</h1>');
    for (let i = 0; i < 10; i++) { editor.setDoc(`<h1>${i}</h1>`); view.refreshPreview(); }
    await flush();
    expect(parse).not.toHaveBeenCalled();
    expect(preview.hasAttribute('src')).toBe(false);
    expect(view.contentToSave()).toBe('<h1>9</h1>');
    view.setMode('preview');
    await flush();
    expect(parse).toHaveBeenCalledOnce();
    expect(decodeURIComponent(preview.src)).toContain('<h1 id="shiorbit-h0">9</h1>');
    view.destroy();
  });

  it('同じ状態の復元や見出し選択では二重解析しない', async () => {
    const { view, preview, load } = fixture();
    const parse = vi.spyOn(DOMParser.prototype, 'parseFromString');
    load('<h1>HTML</h1>');
    view.restoreState({ offset: 0, scrollTop: 0, mode: 'preview' });
    view.reveal(0);
    view.refreshPreview();
    await flush();
    expect(parse).toHaveBeenCalledOnce();
    expect(preview.src.endsWith('#shiorbit-h0')).toBe(true);
    view.destroy();
  });

  it('外部更新・ソースモードでの状態復元でも古い共用エディタ本文を保存しない', async () => {
    const { view, editor, load } = fixture();
    load('<h1>HTML</h1>');
    view.applyExternal({ path: view.path, text: '<h1>External</h1>', mtime: 2 });
    expect(view.contentToSave()).toBe('<h1>External</h1>');
    view.restoreState({ offset: 8, scrollTop: 12, mode: 'source' });
    expect(editor.setDoc).toHaveBeenCalledWith('<h1>External</h1>');
    expect(editor.setViewState).toHaveBeenCalledWith({ anchor: 8, head: 8, scrollTop: 12 });
    expect(view.getState().mode).toBe('source');
    view.destroy();
    await flush();
  });

  it('画像読込中にモードを変えたら、旧プレビューを後から表示しない', async () => {
    let release!: (data: ArrayBuffer) => void;
    const binary = vi.fn(() => new Promise<ArrayBuffer>(resolve => { release = resolve; }));
    const { view, preview, load } = fixture('preview', binary);
    load('<img src="image.png">');
    await flush();
    expect(binary).toHaveBeenCalled();
    view.setMode('source');
    release(new ArrayBuffer(0));
    await flush();
    expect(preview.hasAttribute('src')).toBe(false);
    view.destroy();
  });
});
