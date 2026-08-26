// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
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

  it('アウトラインに見出しが並び、クリックすると該当位置へ移動する', async () => {
    const adapter = new MemoryAdapter('Outline');
    await adapter.write('long.md', '# 概要\n本文\n\n## 詳細\n詳しい本文\n\n### 補足\n追記');
    const root = document.createElement('div');
    document.body.append(root);
    await new App(root, sourceWithDemo(adapter)).start();

    [...root.querySelectorAll('button')].find((button) => button.textContent?.includes('デモモード'))!.click();
    for (let i = 0; i < 10; i++) await tick();
    const row = [...root.querySelectorAll('.tree .row .label')].find((node) => node.textContent === 'long');
    (row!.parentElement as HTMLElement).click();
    for (let i = 0; i < 10; i++) await tick();

    const headings = [...root.querySelectorAll<HTMLElement>('.outline-item')];
    expect(headings.map((heading) => heading.textContent)).toEqual(['概要', '詳細', '補足']);
    headings[1]!.click();
    for (let i = 0; i < 2; i++) await tick();
    expect(root.querySelector('.outline-item.active')?.textContent).toBe('詳細');
    expect(root.querySelector('.cm-activeLine')?.textContent).toContain('## 詳細');
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

    const htmlHeading = [...root.querySelectorAll<HTMLElement>('.outline-item')]
      .find((heading) => heading.textContent === 'Preview');
    expect(htmlHeading).toBeDefined();
    htmlHeading!.click();
    // プレビューのままで、見出しへのフラグメントだけを送る。
    expect(editorShell.style.display).toBe('none');
    expect(preview.style.display).toBe('');
    expect(preview.src.endsWith('#shiorbit-h0')).toBe(true);
    expect(root.querySelector('.outline-item.active')?.textContent).toBe('Preview');

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

  it('設定からフォルダを変更し、記憶した設定だけを解除できる', async () => {
    const first = new MemoryAdapter('最初のフォルダ');
    const second = new MemoryAdapter('変更後のフォルダ');
    await first.write('first.md', '# 消えない');
    await second.write('second.html', '<h1>こちらも消えない</h1>');
    let remembered = true;
    const forget = vi.fn(async () => { remembered = false; });
    const pick = vi.fn(async () => second);
    const vaultSource: VaultSource = {
      supported: true,
      unsupportedReason: '',
      pick,
      restore: async () => first,
      hasSaved: async () => remembered,
      forget,
      demo: () => createDemoAdapter(),
    };
    const root = document.createElement('div');
    document.body.append(root);
    await new App(root, vaultSource).start();

    [...root.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '⚙')!.click();
    const changeButton = [...document.querySelectorAll<HTMLButtonElement>('.settings-modal button')]
      .find((button) => button.textContent === 'フォルダを変更');
    const forgetButton = [...document.querySelectorAll<HTMLButtonElement>('.settings-modal button')]
      .find((button) => button.textContent === '設定を解除');
    expect(changeButton).toBeDefined();
    expect(forgetButton).toBeDefined();
    expect(document.querySelector('.settings-modal')?.textContent).toContain('ノートやフォルダは削除されません');

    changeButton!.click();
    for (let i = 0; i < 8; i++) await tick();
    expect(pick).toHaveBeenCalledOnce();
    expect(root.querySelector('.vault-name')?.textContent).toBe('変更後のフォルダ');

    [...root.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '⚙')!.click();
    // Electron には window.confirm/prompt が無いため、確認はアプリ内ダイアログで行う。
    const confirm = vi.spyOn(window, 'confirm');
    [...document.querySelectorAll<HTMLButtonElement>('.settings-modal button')]
      .find((button) => button.textContent === '設定を解除')!.click();
    for (let i = 0; i < 4; i++) await tick();

    const confirmDialog = document.querySelector('.confirm-dialog')!;
    expect(confirmDialog.textContent).toContain('ノートやフォルダ自体は削除されません');
    [...confirmDialog.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '解除する')!.click();
    for (let i = 0; i < 4; i++) await tick();

    expect(confirm).not.toHaveBeenCalled();
    expect(forget).toHaveBeenCalledOnce();
    expect(root.querySelector('.welcome')).not.toBeNull();
    expect(root.textContent).not.toContain('前回のフォルダを開く');
    expect(await first.read('first.md')).toContain('消えない');
    expect(await second.read('second.html')).toContain('こちらも消えない');
    confirm.mockRestore();
  });

  it('ノート名の変更前に影響範囲を表示し、リンクを追従させる', async () => {
    const adapter = new MemoryAdapter('Rename UI');
    await adapter.write('AI/Ollama.md', '# Ollama');
    await adapter.write('AI/Guide.md', '[[Ollama]] と [[AI/Ollama|別名]]');
    const root = document.createElement('div');
    document.body.append(root);
    await new App(root, sourceWithDemo(adapter)).start();
    [...root.querySelectorAll('button')].find((button) => button.textContent?.includes('デモモード'))!.click();
    for (let i = 0; i < 10; i++) await tick();

    const ollama = [...root.querySelectorAll('.tree .row')]
      .find((row) => row.querySelector('.label')?.textContent === 'Ollama')!;
    const prompt = vi.spyOn(window, 'prompt');
    ollama.querySelector<HTMLButtonElement>('.rename')!.click();
    for (let i = 0; i < 5; i++) await tick();

    const promptModal = document.querySelector('.prompt-dialog')!;
    const nameInput = promptModal.querySelector<HTMLInputElement>('.dialog-input')!;
    expect(nameInput.value).toBe('AI/Ollama.md');
    nameInput.value = 'AI/Llama.md';
    nameInput.dispatchEvent(new Event('input'));
    [...promptModal.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '次へ')!.click();
    for (let i = 0; i < 5; i++) await tick();

    expect(prompt).not.toHaveBeenCalled();
    const modal = document.querySelector('.rename-modal')!;
    expect(modal.textContent).toContain('1 件のノートの 2 か所を書き換えます');
    expect(modal.textContent).toContain('AI/Guide.md');
    [...modal.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '変更する')!.click();
    for (let i = 0; i < 10; i++) await tick();

    expect(await adapter.exists('AI/Ollama.md')).toBe(false);
    expect(await adapter.read('AI/Guide.md')).toBe('[[Llama]] と [[AI/Llama|別名]]');
    expect(root.textContent).toContain('Llama');
    prompt.mockRestore();
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
  it('新規作成ダイアログで HTML とフォルダを作れる', async () => {
    const adapter = new MemoryAdapter('New UI');
    await adapter.write('AI/Ollama.md', '# Ollama');
    const root = document.createElement('div');
    document.body.append(root);
    await new App(root, sourceWithDemo(adapter)).start();
    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('デモモード'))!.click();
    for (let i = 0; i < 10; i++) await tick();

    // Electron には window.prompt が無いので、新規作成もアプリ内ダイアログで完結する。
    const prompt = vi.spyOn(window, 'prompt');
    [...root.querySelectorAll<HTMLButtonElement>('.sidebar-head button')]
      .find((b) => b.textContent === '+')!.click();
    for (let i = 0; i < 3; i++) await tick();
    expect(prompt).not.toHaveBeenCalled();

    const dialog = document.querySelector('.new-document-dialog')!;
    const input = dialog.querySelector<HTMLInputElement>('.dialog-input')!;
    [...dialog.querySelectorAll<HTMLButtonElement>('.dialog-kind')]
      .find((b) => b.textContent === 'HTML')!.click();
    input.value = 'Guide';
    input.dispatchEvent(new Event('input'));
    expect(dialog.querySelector('.dialog-preview')?.textContent).toBe('作成先: Guide.html');

    [...dialog.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent === '作成')!.click();
    for (let i = 0; i < 12; i++) await tick();

    expect(await adapter.read('Guide.html')).toContain('<!doctype html>');
    expect(document.querySelector('.new-document-dialog')).toBeNull();

    // フォルダ行の ＋ は、そのフォルダを作成先にする。
    const aiRow = [...root.querySelectorAll('.tree .row')]
      .find((row) => row.querySelector('.label')?.textContent === 'AI')!;
    aiRow.querySelector<HTMLButtonElement>('.create')!.click();
    for (let i = 0; i < 3; i++) await tick();

    const folderDialog = document.querySelector('.new-document-dialog')!;
    const folderInput = folderDialog.querySelector<HTMLInputElement>('.dialog-input')!;
    [...folderDialog.querySelectorAll<HTMLButtonElement>('.dialog-kind')]
      .find((b) => b.textContent === 'フォルダ')!.click();
    folderInput.value = 'LLM';
    folderInput.dispatchEvent(new Event('input'));
    expect(folderDialog.querySelector('.dialog-preview')?.textContent).toBe('作成先: AI/LLM');
    [...folderDialog.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent === '作成')!.click();
    for (let i = 0; i < 12; i++) await tick();

    // 空のフォルダもツリーに出る。
    expect([...root.querySelectorAll('.tree .label')].some((l) => l.textContent === 'LLM')).toBe(true);
    prompt.mockRestore();
  });
  it('Ctrl と +／0 で表示倍率が変わり、設定に残る', async () => {
    const adapter = new MemoryAdapter('Zoom UI');
    await adapter.write('note.md', '# note');
    const root = document.createElement('div');
    document.body.append(root);
    await new App(root, sourceWithDemo(adapter)).start();
    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('デモモード'))!.click();
    for (let i = 0; i < 10; i++) await tick();

    const style = document.documentElement.style;
    expect(style.getPropertyValue('--ui-font-size')).toBe('14px');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', ctrlKey: true }));
    for (let i = 0; i < 6; i++) await tick();
    expect(style.getPropertyValue('--ui-font-size')).toBe('15.4px');
    expect(style.getPropertyValue('--editor-font-size')).toBe('16px');
    expect(await adapter.read('.shiorbit/settings.json')).toContain('"zoom": 1.1');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: '0', ctrlKey: true }));
    for (let i = 0; i < 6; i++) await tick();
    expect(style.getPropertyValue('--ui-font-size')).toBe('14px');
  });

  it('設定は保存前に反映され、閉じると元へ戻る', async () => {
    const adapter = new MemoryAdapter('Settings UI');
    await adapter.write('note.md', '# note');
    const root = document.createElement('div');
    document.body.append(root);
    await new App(root, sourceWithDemo(adapter)).start();
    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('デモモード'))!.click();
    for (let i = 0; i < 10; i++) await tick();

    [...root.querySelectorAll<HTMLButtonElement>('.sidebar-head button')]
      .find((b) => b.textContent === '⚙')!.click();
    const modal = document.querySelector('.settings-modal')!;
    const editorSize = [...modal.querySelectorAll<HTMLInputElement>('input[type="number"]')]
      .find((input) => input.getAttribute('aria-label') === 'エディタの文字サイズ')!;

    // 範囲外は反映せず、理由を出す。
    editorSize.value = '900';
    editorSize.dispatchEvent(new Event('input'));
    for (let i = 0; i < 3; i++) await tick();
    expect(modal.textContent).toContain('の範囲で入れてください');
    expect(document.documentElement.style.getPropertyValue('--editor-font-size')).toBe('14.5px');

    // 範囲内はその場で反映する（保存はまだ）。
    editorSize.value = '20';
    editorSize.dispatchEvent(new Event('input'));
    for (let i = 0; i < 3; i++) await tick();
    expect(document.documentElement.style.getPropertyValue('--editor-font-size')).toBe('20px');
    expect(await adapter.exists('.shiorbit/settings.json')).toBe(false);

    // Esc で閉じるとプレビューは捨てられる。
    modal.parentElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    for (let i = 0; i < 4; i++) await tick();
    expect(document.querySelector('.settings-modal')).toBeNull();
    expect(document.documentElement.style.getPropertyValue('--editor-font-size')).toBe('14.5px');
  });
  it('ノートを切り替えて戻ると、読んでいた位置に戻る', async () => {
    const adapter = new MemoryAdapter('Scroll UI');
    const long = Array.from({ length: 60 }, (_, i) => `## 見出し ${i}\n\n本文 ${i}`).join('\n\n');
    await adapter.write('long.md', long);
    await adapter.write('other.md', '# other');
    const root = document.createElement('div');
    document.body.append(root);
    await new App(root, sourceWithDemo(adapter)).start();
    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('デモモード'))!.click();
    for (let i = 0; i < 10; i++) await tick();

    const open = async (label: string): Promise<void> => {
      const row = [...root.querySelectorAll('.tree .row')]
        .find((node) => node.querySelector('.label')?.textContent === label)!;
      (row as HTMLElement).click();
      for (let i = 0; i < 8; i++) await tick();
    };

    await open('long');
    // アウトラインの途中の見出しへ移動しておく。
    const heading = [...root.querySelectorAll<HTMLElement>('.outline-item')]
      .find((item) => item.textContent === '見出し 30')!;
    heading.click();
    for (let i = 0; i < 4; i++) await tick();
    const moved = root.querySelector('.outline-item.active')?.textContent;
    expect(moved).toBe('見出し 30');

    await open('other');
    await open('long');

    // 先頭ではなく、離れたときの位置が復元される。
    expect(root.querySelector('.outline-item.active')?.textContent).toBe('見出し 30');
  });
  it('![[...]] が画像とノートの中身に展開される', async () => {
    const originalCreate = URL.createObjectURL;
    URL.createObjectURL = (): string => 'blob:test/img';

    const adapter = new MemoryAdapter('Embed UI');
    await adapter.writeBinary('img/logo.png', new ArrayBuffer(8));
    await adapter.write('Parts/Note.md', '# Note\n\n## 実行環境\n\nOllama を使う。\n');
    await adapter.write('main.md', 'ここに置く\n\n![[logo.png]]\n\n![[Note#実行環境]]\n\n終わり\n');

    const root = document.createElement('div');
    document.body.append(root);
    await new App(root, sourceWithDemo(adapter)).start();
    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('デモモード'))!.click();
    for (let i = 0; i < 10; i++) await tick();

    const row = [...root.querySelectorAll('.tree .row')]
      .find((node) => node.querySelector('.label')?.textContent === 'main')!;
    (row as HTMLElement).click();
    for (let i = 0; i < 14; i++) await tick();

    const image = root.querySelector<HTMLImageElement>('.cm-embed-image');
    expect(image).not.toBeNull();
    expect(image!.src).toBe('blob:test/img');

    const note = root.querySelector('.cm-embed-note');
    expect(note?.textContent).toContain('Ollama を使う。');
    // 指定した節だけを出す。
    expect(note?.textContent).not.toContain('# Note');

    URL.createObjectURL = originalCreate;
  });
});
