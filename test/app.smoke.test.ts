// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { App, type VaultSource } from '../src/ui/app';
import { MemoryAdapter, createDemoAdapter } from '../src/adapters/memory';
import { originalPathOf } from '../src/core/vault/trash';

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

function internalMove(source: Element, target: Element): void {
  const data = new Map<string, string>();
  const transfer = {
    types: [] as string[],
    dropEffect: 'none',
    effectAllowed: 'none',
    setData(type: string, value: string) {
      data.set(type, value);
      transfer.types = [...data.keys()];
    },
    getData(type: string) {
      return data.get(type) ?? '';
    },
  };
  for (const [element, type] of [[source, 'dragstart'], [target, 'dragover'], [target, 'drop']] as const) {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: transfer });
    element.dispatchEvent(event);
  }
}

describe('App の起動', () => {
  it('フォルダ開閉を保存し、再起動相当の新しいAppでも親子の状態を復元する', async () => {
    const adapter = new MemoryAdapter('Folder state');
    await adapter.mkdir('A/Child');
    await adapter.mkdir('B');
    const vaultSource = { ...source(), restore: async () => adapter };
    const root = document.createElement('div');
    document.body.append(root);
    await new App(root, vaultSource).start();
    const row = (host: Element, path: string) => host.querySelector<HTMLElement>(`.row[data-path="${path}"]`)!;
    expect(row(root, 'A').getAttribute('aria-expanded')).toBe('false');
    row(root, 'A').click();
    row(root, 'A/Child').click();
    row(root, 'A').click();
    for (let i = 0; i < 20; i++) await tick();
    const saved = JSON.parse(await adapter.read('.shiorbit/workspace.json'));
    expect(saved.expandedFolders).toEqual(['A/Child']);
    await adapter.mkdir('New');
    const reopened = document.createElement('div');
    document.body.append(reopened);
    await new App(reopened, vaultSource).start();
    expect(row(reopened, 'A').getAttribute('aria-expanded')).toBe('false');
    expect(row(reopened, 'B').getAttribute('aria-expanded')).toBe('false');
    expect(row(reopened, 'New').getAttribute('aria-expanded')).toBe('false');
    row(reopened, 'A').click();
    expect(row(reopened, 'A/Child').getAttribute('aria-expanded')).toBe('true');
  });
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
    // タブが5つ（ファイル / 検索 / タグ / 未解決 / ごみ箱）
    expect(root.querySelectorAll('.sidebar-tabs .tab')).toHaveLength(5);
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
    expect(root.querySelector<HTMLElement>('.md-toolbar')?.dataset.language).toBe('html');
    expect(root.querySelector('.md-toolbar')?.textContent).not.toContain('[[');
  });

  it('HTMLプレビューで文書からの相対画像をVaultから読み込む', async () => {
    const adapter = new MemoryAdapter('HTML image');
    await adapter.write('web/page.html', '<h1>画像</h1><img src="images/photo.png" alt="写真">');
    await adapter.writeBinary('web/images/photo.png', new Uint8Array([1, 2, 3]).buffer);
    const originalCreate = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:shiorbit/photo');

    try {
      const root = document.createElement('div');
      document.body.append(root);
      await new App(root, sourceWithDemo(adapter)).start();
      [...root.querySelectorAll('button')].find((button) => button.textContent?.includes('デモモード'))!.click();
      for (let i = 0; i < 10; i++) await tick();

      const row = [...root.querySelectorAll('.tree .row .label')]
        .find((node) => node.textContent === 'page.html');
      (row!.parentElement as HTMLElement).click();
      for (let i = 0; i < 10; i++) await tick();

      const preview = root.querySelector<HTMLIFrameElement>('.html-preview')!;
      const previewHtml = decodeURIComponent(preview.src.slice(preview.src.indexOf(',') + 1));
      expect(previewHtml).toContain('src="blob:shiorbit/photo"');
      expect(URL.createObjectURL).toHaveBeenCalledOnce();
    } finally {
      URL.createObjectURL = originalCreate;
    }
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

  it('ノート名を確認画面なしで変更し、リンクを追従させる', async () => {
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
    expect(nameInput.value).toBe('Ollama.md');
    expect(promptModal.textContent).toContain('現在のフォルダ内で名前だけ変更します');
    nameInput.value = '別フォルダ/Llama.md';
    nameInput.dispatchEvent(new Event('input'));
    expect(promptModal.textContent).toContain('フォルダは変更できません');
    expect([...promptModal.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '変更')!.disabled).toBe(true);

    nameInput.value = 'Llama.md';
    nameInput.dispatchEvent(new Event('input'));
    [...promptModal.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === '変更')!.click();
    for (let i = 0; i < 10; i++) await tick();

    expect(prompt).not.toHaveBeenCalled();
    expect(document.querySelector('.rename-modal')).toBeNull();
    expect(await adapter.exists('AI/Ollama.md')).toBe(false);
    expect(await adapter.read('AI/Guide.md')).toBe('[[Llama]] と [[AI/Llama|別名]]');
    expect(root.textContent).toContain('Llama');
    prompt.mockRestore();
  });

  it('ツリー内のドラッグで既存ノートを移動し、リンクを追従させる', async () => {
    const adapter = new MemoryAdapter('Move UI');
    await adapter.write('AI/Ollama.md', '# Ollama');
    await adapter.write('AI/Guide.md', '[[Ollama]] と [[AI/Ollama|別名]]');
    await adapter.mkdir('Archive');
    const root = document.createElement('div');
    document.body.append(root);
    await new App(root, sourceWithDemo(adapter)).start();
    [...root.querySelectorAll('button')].find((button) => button.textContent?.includes('デモモード'))!.click();
    for (let i = 0; i < 10; i++) await tick();

    const row = (path: string): HTMLElement => [...root.querySelectorAll<HTMLElement>('.tree .row')]
      .find((element) => element.dataset['path'] === path)!;
    internalMove(row('AI/Ollama.md'), row('Archive').querySelector('.label')!);
    for (let i = 0; i < 12; i++) await tick();

    expect(await adapter.exists('AI/Ollama.md')).toBe(false);
    expect(await adapter.exists('Archive/Ollama.md')).toBe(true);
    expect(await adapter.read('AI/Guide.md')).toBe('[[Ollama]] と [[Archive/Ollama|別名]]');
    expect(row('Archive/Ollama.md')).toBeDefined();
    expect(document.querySelector('.rename-modal')).toBeNull();
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
  it.each([
    ['Markdown', 'New', 'New.md'],
    ['HTML', 'New', 'New.html'],
    ['Base', 'New', 'New.base'],
    ['Canvas', 'New', 'New.canvas'],
    ['フォルダ', 'New', 'New'],
    ['Markdown', 'test/作業メモ', 'test/作業メモ.md'],
  ])('左上の＋は別フォルダのノートを開いていてもルートに作る（%s: %s）', async (kind, name, filename) => {
    const adapter = new MemoryAdapter('Root creation UI');
    await adapter.write('Other/Nested/Current.md', '# Current');
    const root = document.createElement('div');
    document.body.append(root);
    await new App(root, sourceWithDemo(adapter)).start();
    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('デモモード'))!.click();
    for (let i = 0; i < 10; i++) await tick();

    root.querySelector<HTMLElement>('.row[data-path="Other/Nested/Current.md"]')!.click();
    for (let i = 0; i < 10; i++) await tick();
    expect(root.querySelector('.main-title')?.textContent).toBe('Other/Nested/Current.md');
    const createAtRoot = [...root.querySelectorAll<HTMLButtonElement>('.sidebar-head button')]
      .find((b) => b.textContent === '+')!;
    expect(createAtRoot.title).toBe('「Root creation UI」の直下に新規作成');
    expect(createAtRoot.getAttribute('aria-label')).toBe(createAtRoot.title);
    createAtRoot.click();

    const dialog = document.querySelector('.new-document-dialog')!;
    expect(dialog.querySelector('.dialog-preview')?.textContent)
      .toBe('名前を入力すると Vault のルートに作成します。');
    [...dialog.querySelectorAll<HTMLButtonElement>('.dialog-kind')]
      .find((b) => b.textContent === kind)!.click();
    const input = dialog.querySelector<HTMLInputElement>('.dialog-input')!;
    input.value = name;
    input.dispatchEvent(new Event('input'));
    expect(dialog.querySelector('.dialog-preview')?.textContent).toBe(`作成先: ${filename}`);
    dialog.querySelector<HTMLButtonElement>('.primary')!.click();
    for (let i = 0; i < 12; i++) await tick();

    expect(await adapter.exists(filename)).toBe(true);
    expect(await adapter.exists(`Other/Nested/${filename}`)).toBe(false);
    expect(await adapter.read('Other/Nested/Current.md')).toBe('# Current');
    expect(root.querySelector(`.row[data-path="${filename}"]`)).not.toBeNull();
    expect(document.querySelector('.new-document-dialog')).toBeNull();
    if (kind !== 'フォルダ') expect(root.querySelector('.main-title')?.textContent).toBe(filename);
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
    const submit = dialog.querySelector<HTMLButtonElement>('.primary')!;
    expect(input.required).toBe(true);
    expect(submit.disabled).toBe(true);
    expect(submit.title).toBe('名前を入力してください');
    [...dialog.querySelectorAll<HTMLButtonElement>('.dialog-kind')]
      .find((b) => b.textContent === 'HTML')!.click();
    input.value = 'Guide';
    input.dispatchEvent(new Event('input'));
    expect(dialog.querySelector('.dialog-preview')?.textContent).toBe('作成先: Guide.html');
    expect(submit.disabled).toBe(false);
    expect(submit.title).toBe('Guide.html を作成');

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
  it.each([
    ['Markdownを新規作成…', 'Markdown', 'New.md'],
    ['HTMLを新規作成…', 'HTML', 'New.html'],
    ['サブフォルダを作成…', 'フォルダ', 'New'],
  ])('フォルダの右クリックから %s を正しい作成先で実行する', async (label, kind, filename) => {
    const adapter = new MemoryAdapter('Folder menu UI');
    await adapter.write('Other/Current.md', '# Current');
    await adapter.mkdir('Projects/Notes');
    const root = document.createElement('div');
    document.body.append(root);
    await new App(root, sourceWithDemo(adapter)).start();
    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('デモモード'))!.click();
    for (let i = 0; i < 10; i++) await tick();

    root.querySelector<HTMLElement>('.row[data-path="Other/Current.md"]')!.click();
    for (let i = 0; i < 8; i++) await tick();
    root.querySelector('.row[data-path="Projects/Notes"]')!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    [...document.querySelectorAll<HTMLButtonElement>('.context-menu-item')]
      .find((button) => button.textContent === label)!.click();
    await tick();

    const dialog = document.querySelector('.new-document-dialog')!;
    expect(dialog.querySelector('.dialog-kind.active')?.textContent).toBe(kind);
    const input = dialog.querySelector<HTMLInputElement>('.dialog-input')!;
    input.value = 'New';
    input.dispatchEvent(new Event('input'));
    expect(dialog.querySelector('.dialog-preview')?.textContent).toBe(`作成先: Projects/Notes/${filename}`);
    dialog.querySelector<HTMLButtonElement>('.primary')!.click();
    for (let i = 0; i < 12; i++) await tick();

    expect(await adapter.exists(`Projects/Notes/${filename}`)).toBe(true);
    expect(await adapter.exists(`Other/${filename}`)).toBe(false);
    if (kind === 'HTML') expect(await adapter.read(`Projects/Notes/${filename}`)).toContain('<!doctype html>');
    if (kind === 'Markdown') expect(await adapter.read(`Projects/Notes/${filename}`)).toBe('# New\n\n');
    expect(root.querySelector(`.row[data-path="Projects/Notes/${filename}"]`)).not.toBeNull();
    expect(document.querySelector('.context-menu')).toBeNull();
  });

  it('フォルダの右クリックからごみ箱を選んでも確認をキャンセルすれば何も消さない', async () => {
    const adapter = new MemoryAdapter('Folder trash UI');
    await adapter.write('Notes/Keep.md', '# Keep');
    const root = document.createElement('div');
    document.body.append(root);
    await new App(root, sourceWithDemo(adapter)).start();
    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('デモモード'))!.click();
    for (let i = 0; i < 10; i++) await tick();
    root.querySelector('.row[data-path="Notes"]')!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    [...document.querySelectorAll<HTMLButtonElement>('.context-menu-item')]
      .find((button) => button.textContent === 'ごみ箱へ移す…')!.click();
    await tick();
    const dialog = document.querySelector('.dialog')!;
    expect(dialog.textContent).toContain('「Notes」をごみ箱へ移します');
    expect(await adapter.read('Notes/Keep.md')).toBe('# Keep');
    [...dialog.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent === 'キャンセル')!.click();
    for (let i = 0; i < 3; i++) await tick();
    expect(await adapter.read('Notes/Keep.md')).toBe('# Keep');
    expect(await adapter.exists('.trash')).toBe(false);
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
  it('.base を開くと表が出て、列ヘッダで並べ替えられる', async () => {
    const adapter = new MemoryAdapter('Bases UI');
    await adapter.write('Books/A.md', ['---', 'status: 読了', 'rating: 5', '---', '# A'].join('\n'));
    await adapter.write('Books/B.md', ['---', 'status: 読了', 'rating: 3', '---', '# B'].join('\n'));
    await adapter.write('Books/C.md', ['---', 'status: 未読', '---', '# C'].join('\n'));
    await adapter.write('読書.base', [
      'name: 読書リスト',
      'from:',
      '  folder: Books',
      'where:',
      '  - property: status',
      '    op: equals',
      '    value: 読了',
      'columns:',
      '  - property: file.name',
      '    label: タイトル',
      '  - property: rating',
      'sort:',
      '  property: rating',
      '  order: desc',
    ].join('\n'));

    const root = document.createElement('div');
    document.body.append(root);
    await new App(root, sourceWithDemo(adapter)).start();
    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('デモモード'))!.click();
    for (let i = 0; i < 12; i++) await tick();

    const row = [...root.querySelectorAll('.tree .row')]
      .find((node) => node.querySelector('.label')?.textContent === '読書.base')!;
    (row as HTMLElement).click();
    for (let i = 0; i < 10; i++) await tick();

    expect(root.querySelector('.bases-name')?.textContent).toBe('読書リスト');
    // 並べ替えのたびに表を組み直すので、都度引き直す。
    const table = (): Element => root.querySelector('.bases-table')!;
    const names = (): string[] =>
      [...table().querySelectorAll('tbody tr')].map((tr) => tr.querySelector('td')!.textContent!);

    // where で 未読 が外れ、sort: desc で rating の高い順。
    expect(names()).toEqual(['A', 'B']);
    // 並び替え中の列には向きの印が付く。
    expect([...table().querySelectorAll('thead th')].map((th) => th.textContent))
      .toEqual(['タイトル', 'rating▼']);

    // 列ヘッダのクリックで昇順に切り替わる。
    [...table().querySelectorAll<HTMLButtonElement>('.bases-sort')]
      .find((b) => b.textContent?.startsWith('rating'))!.click();
    for (let i = 0; i < 3; i++) await tick();
    expect(names()).toEqual(['B', 'A']);

    // 行をクリックするとそのノートが開く。
    root.querySelector<HTMLElement>('.bases-row')!.click();
    for (let i = 0; i < 10; i++) await tick();
    expect(root.querySelector('.main-title')?.textContent).toBe('Books/B.md');
    expect(root.querySelector<HTMLElement>('.bases-view')?.style.display).toBe('none');
  });
  it('.canvas を開くとカードが並び、追加すると保存される', async () => {
    const adapter = new MemoryAdapter('Canvas UI');
    await adapter.write('AI/Ollama.md', '# Ollama');
    await adapter.write('board.canvas', JSON.stringify({
      nodes: [
        { id: 'a1', type: 'text', x: 0, y: 0, width: 260, height: 120, text: '構想' },
        { id: 'a2', type: 'file', file: 'AI/Ollama.md', x: 320, y: 0, width: 300, height: 200 },
      ],
      edges: [{ id: 'e1', fromNode: 'a1', fromSide: 'right', toNode: 'a2', toSide: 'left' }],
    }));

    const root = document.createElement('div');
    document.body.append(root);
    await new App(root, sourceWithDemo(adapter)).start();
    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('デモモード'))!.click();
    for (let i = 0; i < 12; i++) await tick();

    const row = [...root.querySelectorAll('.tree .row')]
      .find((node) => node.querySelector('.label')?.textContent === 'board.canvas')!;
    (row as HTMLElement).click();
    for (let i = 0; i < 12; i++) await tick();

    const view = root.querySelector<HTMLElement>('.canvas-view')!;
    expect(view.style.display).toBe('');
    expect(view.querySelectorAll('.canvas-node')).toHaveLength(2);
    // 座標は Obsidian と同じ扱い。
    const first = view.querySelector<HTMLElement>('[data-node="a1"]')!;
    expect(first.style.left).toBe('0px');
    expect(view.querySelector<HTMLElement>('[data-node="a2"]')!.style.left).toBe('320px');
    expect(view.querySelectorAll('.canvas-edge')).toHaveLength(1);
    expect(view.querySelector('.canvas-text')).not.toBeNull();

    // file ノードの見出しから元ノートへ移動できる。
    expect(view.querySelector('.canvas-file-title')?.textContent).toBe('AI/Ollama.md');

    // カードを足すと .canvas に書き戻る（自動保存に載る）。
    const canvasView = view as HTMLElement & { dispatchEvent: (e: Event) => boolean };
    canvasView.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    for (let i = 0; i < 20; i++) await tick();
    await new Promise((r) => setTimeout(r, 600));
    for (let i = 0; i < 10; i++) await tick();

    const saved = JSON.parse(await adapter.read('board.canvas')) as { nodes: unknown[] };
    expect(saved.nodes).toHaveLength(3);
  });
  it('削除はごみ箱へ移り、そこから元に戻せる', async () => {
    const adapter = new MemoryAdapter('Trash UI');
    await adapter.write('AI/Ollama.md', '# Ollama');
    const root = document.createElement('div');
    document.body.append(root);
    await new App(root, sourceWithDemo(adapter)).start();
    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('デモモード'))!.click();
    for (let i = 0; i < 12; i++) await tick();

    const row = [...root.querySelectorAll('.tree .row')]
      .find((node) => node.querySelector('.label')?.textContent === 'Ollama')!;
    row.querySelector<HTMLButtonElement>('.del')!.click();
    for (let i = 0; i < 4; i++) await tick();

    const dialog = document.querySelector('.confirm-dialog')!;
    expect(dialog.textContent).toContain('ごみ箱へ移します');
    [...dialog.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent === 'ごみ箱へ移す')!.click();
    for (let i = 0; i < 14; i++) await tick();

    // 実体は消えていない。
    expect(await adapter.exists('AI/Ollama.md')).toBe(false);
    const trashed = await adapter.list('.trash', true);
    expect(trashed.map((e) => originalPathOf(e.path))).toContain('AI/Ollama.md');
    expect([...root.querySelectorAll('.tree .label')].some((l) => l.textContent === 'Ollama')).toBe(false);

    // ごみ箱タブから戻す。
    [...root.querySelectorAll<HTMLButtonElement>('.sidebar-tabs .tab')]
      .find((b) => b.textContent === 'ごみ箱')!.click();
    for (let i = 0; i < 10; i++) await tick();

    const trashRow = root.querySelector('.cleanup-row')!;
    expect(trashRow.textContent).toContain('AI/Ollama.md');
    [...trashRow.querySelectorAll<HTMLButtonElement>('button')]
      .find((b) => b.textContent === '戻す')!.click();
    for (let i = 0; i < 20; i++) await tick();

    expect(await adapter.read('AI/Ollama.md')).toBe('# Ollama');
    expect(root.querySelector('.cleanup-row')).toBeNull();
  });
  it('複数のノートをタブで開き、閉じて隣へ移る', async () => {
    const adapter = new MemoryAdapter('Tabs UI');
    await adapter.write('a.md', '# A');
    await adapter.write('b.md', '# B');
    const root = document.createElement('div');
    document.body.append(root);
    await new App(root, sourceWithDemo(adapter)).start();
    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('デモモード'))!.click();
    for (let i = 0; i < 12; i++) await tick();

    const open = async (label: string): Promise<void> => {
      const row = [...root.querySelectorAll('.tree .row')]
        .find((node) => node.querySelector('.label')?.textContent === label)!;
      (row as HTMLElement).click();
      for (let i = 0; i < 10; i++) await tick();
    };

    // 1枚だけのときは帯を出さない。
    await open('a');
    expect(root.querySelector<HTMLElement>('.tab-strip')?.style.display).toBe('none');

    await open('b');
    const tabs = (): string[] =>
      [...root.querySelectorAll('.tab-item .tab-label')].map((node) => node.textContent!);
    expect(tabs()).toEqual(['a', 'b']);
    expect(root.querySelector('.tab-item.active .tab-label')?.textContent).toBe('b');
    expect(root.querySelector('.main-title')?.textContent).toBe('b.md');

    // タブをクリックすると切り替わる。
    [...root.querySelectorAll('.tab-item')]
      .find((item) => item.textContent?.startsWith('a'))!
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    for (let i = 0; i < 10; i++) await tick();
    expect(root.querySelector('.main-title')?.textContent).toBe('a.md');

    // ✕ で閉じると、残ったタブへ移る。1枚になったので帯はまた消える。
    const close = root.querySelector<HTMLButtonElement>('.tab-item.active .tab-close')!;
    close.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    close.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    close.focus();
    // 実操作では押してから離すまでに非同期の更新が入る。
    for (let i = 0; i < 10; i++) await tick();
    expect(root.querySelector('.tab-item.active .tab-close')).toBe(close);
    expect(tabs()).toEqual(['a', 'b']);
    close.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    close.click();
    for (let i = 0; i < 12; i++) await tick();
    expect(tabs()).toEqual(['b']);
    expect(root.querySelector<HTMLElement>('.tab-strip')?.style.display).toBe('none');
    expect(root.querySelector('.main-title')?.textContent).toBe('b.md');
  });

  it('画面を分割して2つのノートを並べ、構成を保存する', async () => {
    const adapter = new MemoryAdapter('Split UI');
    await adapter.write('a.md', '# A');
    await adapter.write('b.md', '# B');
    const root = document.createElement('div');
    document.body.append(root);
    await new App(root, sourceWithDemo(adapter)).start();
    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('デモモード'))!.click();
    for (let i = 0; i < 12; i++) await tick();

    const rowFor = (label: string): HTMLElement =>
      [...root.querySelectorAll('.tree .row')]
        .find((node) => node.querySelector('.label')?.textContent === label)! as HTMLElement;

    rowFor('a').click();
    for (let i = 0; i < 10; i++) await tick();

    // Ctrl+\ で分割。
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '\\', ctrlKey: true }));
    for (let i = 0; i < 8; i++) await tick();
    expect(root.querySelectorAll('.document-pane')).toHaveLength(2);
    expect(root.querySelector('.document-panes')?.classList.contains('split')).toBe(true);

    rowFor('b').click();
    for (let i = 0; i < 12; i++) await tick();

    // 分割後は2枚のエディタが並ぶ。
    expect(root.querySelectorAll('.cm-editor')).toHaveLength(2);

    // 構成が Vault に残る。
    await new Promise((r) => setTimeout(r, 1000));
    for (let i = 0; i < 10; i++) await tick();
    const saved = JSON.parse(await adapter.read('.shiorbit/workspace.json')) as {
      panes: Array<{ tabs: string[] }>;
    };
    expect(saved.panes).toHaveLength(2);
    expect(saved.panes.flatMap((pane) => pane.tabs).sort()).toEqual(['a.md', 'b.md']);
  });
  it('タブの右クリックから左右のタブをまとめて閉じる', async () => {
    const adapter = new MemoryAdapter('Tab menu UI');
    for (const name of ['a', 'b', 'c', 'd']) await adapter.write(`${name}.md`, `# ${name}`);
    const root = document.createElement('div');
    document.body.append(root);
    await new App(root, sourceWithDemo(adapter)).start();
    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('デモモード'))!.click();
    for (let i = 0; i < 12; i++) await tick();

    const open = async (label: string): Promise<void> => {
      const row = [...root.querySelectorAll('.tree .row')]
        .find((node) => node.querySelector('.label')?.textContent === label)!;
      (row as HTMLElement).click();
      for (let i = 0; i < 10; i++) await tick();
    };
    const tabs = (): string[] =>
      [...root.querySelectorAll('.tab-item .tab-label')].map((node) => node.textContent!);
    const menu = (): HTMLElement => document.querySelector('.context-menu')!;
    const clickMenu = (starts: string): void => {
      const item = [...menu().querySelectorAll<HTMLButtonElement>('.context-menu-item')]
        .find((b) => b.textContent?.startsWith(starts))!;
      expect(item, starts).toBeDefined();
      item.click();
    };

    for (const name of ['a', 'b', 'c', 'd']) await open(name);
    expect(tabs()).toEqual(['a', 'b', 'c', 'd']);

    // c を右クリック → 件数つきで出る。
    const tabC = [...root.querySelectorAll<HTMLElement>('.tab-item')]
      .find((item) => item.textContent?.startsWith('c'))!;
    tabC.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
    for (let i = 0; i < 3; i++) await tick();
    expect(menu().textContent).toContain('左側のタブを閉じる（2）');
    expect(menu().textContent).toContain('右側のタブを閉じる（1）');

    clickMenu('左側のタブを閉じる');
    for (let i = 0; i < 14; i++) await tick();
    expect(tabs()).toEqual(['c', 'd']);
    // 基準にしたタブは残り、開いたままになる。
    expect(root.querySelector('.main-title')?.textContent).toBe('c.md');
    expect(document.querySelector('.context-menu')).toBeNull();

    // 今度は右側。
    [...root.querySelectorAll<HTMLElement>('.tab-item')]
      .find((item) => item.textContent?.startsWith('c'))!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
    for (let i = 0; i < 3; i++) await tick();
    clickMenu('右側のタブを閉じる');
    for (let i = 0; i < 14; i++) await tick();

    // 1枚になったので帯は隠れるが、開いているのは c のまま。
    expect(root.querySelector<HTMLElement>('.tab-strip')?.style.display).toBe('none');
    expect(root.querySelector('.main-title')?.textContent).toBe('c.md');
    expect(await adapter.exists('a.md')).toBe(true);
    expect(await adapter.exists('d.md')).toBe(true);
  });
  it('左右のサイドバーを隠せて、次に開いたときも同じ形に戻る', async () => {
    const adapter = new MemoryAdapter('Panel UI');
    await adapter.write('a.md', '# A');
    const root = document.createElement('div');
    document.body.append(root);
    await new App(root, sourceWithDemo(adapter)).start();
    [...root.querySelectorAll('button')].find((b) => b.textContent?.includes('デモモード'))!.click();
    for (let i = 0; i < 12; i++) await tick();

    const workspace = root.querySelector('.workspace')!;
    const press = async (key: string, shift = false): Promise<void> => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, shiftKey: shift }));
      for (let i = 0; i < 6; i++) await tick();
    };

    // 最初はどちらも出ている。
    expect(workspace.classList.contains('sidebar-hidden')).toBe(false);
    expect(workspace.classList.contains('rightbar-hidden')).toBe(false);

    await press('b');
    expect(workspace.classList.contains('sidebar-hidden')).toBe(true);
    await press('b', true);
    expect(workspace.classList.contains('rightbar-hidden')).toBe(true);

    // ヘッダのボタンでも戻せる。
    [...root.querySelectorAll<HTMLButtonElement>('.main-head button')]
      .find((b) => b.textContent === '☰')!.click();
    for (let i = 0; i < 6; i++) await tick();
    expect(workspace.classList.contains('sidebar-hidden')).toBe(false);

    // 右は隠したまま保存される。
    await new Promise((r) => setTimeout(r, 1000));
    for (let i = 0; i < 10; i++) await tick();
    const saved = JSON.parse(await adapter.read('.shiorbit/workspace.json')) as {
      sidebarShown: boolean;
      rightbarShown: boolean;
    };
    expect(saved).toMatchObject({ sidebarShown: true, rightbarShown: false });

    // 開き直すと同じ形に戻る。
    const root2 = document.createElement('div');
    document.body.append(root2);
    await new App(root2, sourceWithDemo(adapter)).start();
    [...root2.querySelectorAll('button')].find((b) => b.textContent?.includes('デモモード'))!.click();
    for (let i = 0; i < 16; i++) await tick();

    const workspace2 = root2.querySelector('.workspace')!;
    expect(workspace2.classList.contains('sidebar-hidden')).toBe(false);
    expect(workspace2.classList.contains('rightbar-hidden')).toBe(true);
  });
});
