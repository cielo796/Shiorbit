// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { App, type VaultSource } from '../src/ui/app';
import { MemoryAdapter, createDemoAdapter } from '../src/adapters/memory';

/**
 * UI の煙感知器。
 *
 * 型チェックでは分からない「起動時に例外で落ちる」を検出する。
 * CodeMirror は測定系 API を使うので jsdom 用に最小限のスタブを当てる。
 */
beforeAll(() => {
  const proto = Range.prototype as unknown as Record<string, unknown>;
  proto['getBoundingClientRect'] = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) });
  proto['getClientRects'] = () => Object.assign([], { item: () => null });
  (Element.prototype as unknown as Record<string, unknown>)['scrollIntoView'] = () => undefined;
  window.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never;
});

function source(): VaultSource {
  return {
    supported: false,
    unsupportedReason: '非対応ブラウザです',
    pick: () => Promise.resolve(new MemoryAdapter('X')),
    restore: () => Promise.resolve(null),
    hasSaved: () => Promise.resolve(false),
    demo: () => createDemoAdapter(),
  };
}

function sourceWithDemo(adapter: MemoryAdapter): VaultSource {
  return {
    ...source(),
    demo: () => Promise.resolve(adapter),
  };
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('App の起動', () => {
  it('ウェルカム画面を描画する', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    await new App(root, source()).start();

    expect(root.querySelector('.welcome')).not.toBeNull();
    expect(root.textContent).toContain('非対応ブラウザです');
  });

  it('Vault を開くとワークスペース・ツリー・インデックスが立ち上がる', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    await new App(root, source()).start();

    const openBtn = [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('デモモード'));
    expect(openBtn).toBeDefined();
    openBtn!.click();
    for (let i = 0; i < 8; i++) await tick();

    expect(root.querySelector('.workspace')).not.toBeNull();
    expect(root.querySelector('.tree')).not.toBeNull();
    // デモ Vault のノートがツリーに出る
    expect(root.textContent).toContain('Ollama');
    // インデックスが走ってステータスに反映される
    expect(root.querySelector('.status-index')?.textContent ?? '').toMatch(/ノート/);
    // 右ペインが存在する
    expect(root.querySelector('.rightbar')).not.toBeNull();
    // タブが4つ（ファイル / 検索 / タグ / 未解決）
    expect(root.querySelectorAll('.sidebar-tabs .tab')).toHaveLength(4);
  });

  it('ノートを開くとバックリンクと未解決リンクが出る', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    await new App(root, source()).start();

    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('デモモード'))!.click();
    for (let i = 0; i < 10; i++) await tick();

    // ツリーから Ollama を開く
    const row = [...root.querySelectorAll('.tree .row .label')].find((n) => n.textContent === 'Ollama');
    expect(row).toBeDefined();
    (row!.parentElement as HTMLElement).click();
    for (let i = 0; i < 10; i++) await tick();

    const right = root.querySelector('.rightbar')!;
    // LocalLLM から [[Ollama]] で参照されている
    expect(right.textContent).toContain('LocalLLM');
    // Ollama から出ている未解決リンク MCP が「リンク先」に並ぶ
    expect(right.querySelector('.outlink.unresolved')?.textContent).toContain('MCP');
  });

  it('HTML は安全なプレビューを既定表示し、ソースへ切り替えられる', async () => {
    const adapter = new MemoryAdapter('HTML');
    await adapter.write(
      'web/page.html',
      '<!doctype html>\n<html><head><title>Sample</title><style>h1{color:red}</style></head>' +
        '<body onclick="alert(1)"><h1>Preview</h1><script>window.pwned=true</script></body></html>',
    );
    const root = document.createElement('div');
    document.body.append(root);
    await new App(root, sourceWithDemo(adapter)).start();

    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('デモモード'))!.click();
    for (let i = 0; i < 10; i++) await tick();

    const row = [...root.querySelectorAll('.tree .row .label')].find((node) => node.textContent === 'page.html');
    expect(row).toBeDefined();
    (row!.parentElement as HTMLElement).click();
    for (let i = 0; i < 10; i++) await tick();

    expect(root.querySelector('.main-title')?.textContent).toBe('web/page.html');
    const preview = root.querySelector<HTMLIFrameElement>('.html-preview')!;
    expect(preview.style.display).toBe('');
    expect(preview.getAttribute('sandbox')).toBe('');
    expect(preview.src).toMatch(/^data:text\/html;charset=utf-8,/);
    const previewHtml = decodeURIComponent(preview.src.slice(preview.src.indexOf(',') + 1));
    expect(previewHtml).toContain('h1{color:red}');
    expect(previewHtml).not.toMatch(/<script|onclick/i);
    const editorShell = preview.previousElementSibling as HTMLElement;
    expect(editorShell.style.display).toBe('none');

    const sourceMode = [...root.querySelectorAll<HTMLButtonElement>('.html-view-mode')]
      .find((mode) => mode.textContent === 'ソース')!;
    sourceMode.click();
    expect(editorShell.style.display).toBe('');
    expect(root.querySelector('.cm-content')?.textContent).toContain('<h1>Preview</h1>');
  });

  it('ファイルツリーをMarkdown・HTML・両方で切り替えられる', async () => {
    const adapter = new MemoryAdapter('Filter');
    await adapter.write('notes/note.md', '# Markdown');
    await adapter.write('web/page.html', '<h1>HTML</h1>');
    const root = document.createElement('div');
    document.body.append(root);
    await new App(root, sourceWithDemo(adapter)).start();

    [...root.querySelectorAll('button')].find((button) => button.textContent?.includes('デモモード'))!.click();
    for (let i = 0; i < 10; i++) await tick();

    const labels = (): string[] => [...root.querySelectorAll('.tree .row .label')]
      .map((node) => node.textContent ?? '');
    const filter = (name: string): HTMLButtonElement => [...root.querySelectorAll<HTMLButtonElement>('.file-filter')]
      .find((button) => button.textContent === name)!;

    expect(labels()).toEqual(expect.arrayContaining(['note', 'page.html']));
    filter('MD').click();
    expect(labels()).toContain('note');
    expect(labels()).not.toContain('page.html');

    filter('HTML').click();
    expect(labels()).not.toContain('note');
    expect(labels()).toContain('page.html');

    filter('両方').click();
    expect(labels()).toEqual(expect.arrayContaining(['note', 'page.html']));
    expect(filter('両方').getAttribute('aria-pressed')).toBe('true');
  });

  it('未解決タブにまだ書いていないノートが並ぶ', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    await new App(root, source()).start();

    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('デモモード'))!.click();
    for (let i = 0; i < 10; i++) await tick();

    [...root.querySelectorAll('.sidebar-tabs .tab')].find((b) => b.textContent === '未解決')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 4; i++) await tick();

    const names = [...root.querySelectorAll('.unresolved-name')].map((n) => n.textContent);
    expect(names).toContain('グラフビュー');
    expect(names).toContain('MCP');
  });

  it('テーマが html 要素に反映される', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    await new App(root, source()).start();
    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('デモモード'))!.click();
    for (let i = 0; i < 10; i++) await tick();

    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('タグタブにタグが集計される', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    await new App(root, source()).start();
    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('デモモード'))!.click();
    for (let i = 0; i < 10; i++) await tick();

    [...root.querySelectorAll('.sidebar-tabs .tab')]
      .find((b) => b.textContent === 'タグ')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 4; i++) await tick();

    const names = [...root.querySelectorAll('.tag-name')].map((n) => n.textContent);
    expect(names).toContain('#ai');
    expect(names).toContain('#llm');
  });

  it('コマンドパレットが開き、コマンドが並ぶ', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    await new App(root, source()).start();
    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('デモモード'))!.click();
    for (let i = 0; i < 10; i++) await tick();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true }));
    for (let i = 0; i < 4; i++) await tick();

    const titles = [...document.querySelectorAll('.modal-row-title')].map((n) => n.textContent);
    expect(titles.some((t) => t?.includes('今日のノート'))).toBe(true);
    expect(titles.some((t) => t?.includes('Live Preview'))).toBe(true);
    document.querySelector('.modal-overlay')?.remove();
  });

  it('Live Preview が [[ ]] を隠して表示名だけ見せる', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    await new App(root, source()).start();
    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('デモモード'))!.click();
    for (let i = 0; i < 10; i++) await tick();

    // 「ようこそ」には [[AI/Ollama|Ollama のノート]] がある
    const row = [...root.querySelectorAll('.tree .row .label')].find((n) => n.textContent === 'ようこそ');
    (row!.parentElement as HTMLElement).click();
    for (let i = 0; i < 12; i++) await tick();

    const links = [...root.querySelectorAll('.cm-wikilink')].map((n) => n.textContent);
    // 別名リンクは表示名だけが見える（[[ や AI/Ollama| は隠れている）
    expect(links).toContain('Ollama のノート');
    expect(links.some((t) => t?.includes('[['))).toBe(false);
  });

  it('右ペインにローカルグラフが出る', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    await new App(root, source()).start();
    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('デモモード'))!.click();
    for (let i = 0; i < 10; i++) await tick();

    const pane = root.querySelector('.rightbar .pane-graph');
    expect(pane).not.toBeNull();
    expect(pane!.querySelector('canvas')).not.toBeNull();
    // 深さ切替が 1 / 2 / 3
    expect([...pane!.querySelectorAll('.depth')].map((b) => b.textContent)).toEqual(['1', '2', '3']);
    expect(pane!.querySelector('.depth.active')?.textContent).toBe('2');
  });

  it('ノートを開くとローカルグラフに周辺のつながりが出る', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    await new App(root, source()).start();
    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('デモモード'))!.click();
    for (let i = 0; i < 10; i++) await tick();

    expect(root.querySelector('.graph-count')?.textContent).toContain('ノートを開くと');

    const row = [...root.querySelectorAll('.tree .row .label')].find((n) => n.textContent === 'Ollama');
    (row!.parentElement as HTMLElement).click();
    for (let i = 0; i < 12; i++) await tick();

    // Ollama - LocalLLM - ようこそ … と未解決の MCP がつながっている
    expect(root.querySelector('.graph-count')?.textContent).toMatch(/\d+ ノート \/ \d+ リンク/);
  });

  it('Ctrl+G で全体グラフが開き、Esc で閉じる', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    await new App(root, source()).start();
    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('デモモード'))!.click();
    for (let i = 0; i < 10; i++) await tick();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true }));
    for (let i = 0; i < 6; i++) await tick();

    const modal = document.querySelector('.graph-modal');
    expect(modal).not.toBeNull();
    expect(modal!.querySelector('.graph-search')).not.toBeNull();
    expect(modal!.textContent).toContain('未解決リンクも表示');
    expect(document.querySelector('.graph-status')?.textContent).toMatch(/\d+ ノート \/ \d+ リンク/);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    for (let i = 0; i < 4; i++) await tick();
    expect(document.querySelector('.graph-modal')).toBeNull();
  });

  it('Markdown ツールバーが記号を挿入する', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    await new App(root, source()).start();
    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('デモモード'))!.click();
    for (let i = 0; i < 10; i++) await tick();

    const toolbar = root.querySelector('.md-toolbar');
    expect(toolbar).not.toBeNull();
    expect([...toolbar!.querySelectorAll('.md-key')].map((b) => b.textContent)).toContain('[[');

    // ノートを開いてから見出しボタンを押す
    const row = [...root.querySelectorAll('.tree .row .label')].find((n) => n.textContent === 'ようこそ');
    (row!.parentElement as HTMLElement).click();
    for (let i = 0; i < 12; i++) await tick();

    const before = root.querySelector('.cm-content')?.textContent ?? '';
    const bold = [...toolbar!.querySelectorAll('.md-key')].find((b) => b.textContent === 'B')!;
    bold.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 4; i++) await tick();

    const after = root.querySelector('.cm-content')?.textContent ?? '';
    expect(after.length).toBeGreaterThan(before.length);
    expect(after).toContain('**');
  });

  it('ボトムナビでタブを開き、もう一度押すと閉じる', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    await new App(root, source()).start();
    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('デモモード'))!.click();
    for (let i = 0; i < 10; i++) await tick();

    const nav = root.querySelector('.mobile-nav');
    expect(nav).not.toBeNull();
    expect(nav!.querySelectorAll('.nav-item')).toHaveLength(5);

    const workspace = root.querySelector('.workspace')!;
    const tagsBtn = [...nav!.querySelectorAll('.nav-item')].find((b) =>
      b.textContent?.includes('タグ'),
    )!;

    tagsBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 4; i++) await tick();
    expect(workspace.classList.contains('drawer-open')).toBe(true);
    expect(root.querySelectorAll('.tag-name').length).toBeGreaterThan(0);

    tagsBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    for (let i = 0; i < 4; i++) await tick();
    expect(workspace.classList.contains('drawer-open')).toBe(false);
  });
});
