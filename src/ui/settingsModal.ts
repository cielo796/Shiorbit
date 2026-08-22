import type { SettingsData } from '../core/settings/Settings';
import { button, el } from './dom';

export interface SettingsModalOptions {
  read: () => SettingsData;
  save: (patch: Partial<SettingsData>) => Promise<void>;
}

/** 設定画面。値は Vault の .shiorbit/settings.json に保存される。 */
export class SettingsModal {
  private overlay: HTMLElement | null = null;

  constructor(private readonly opts: SettingsModalOptions) {}

  open(): void {
    if (this.overlay) return;
    const data = this.opts.read();
    const patch: Partial<SettingsData> = {};

    const overlay = el('div', 'modal-overlay');
    const modal = el('div', 'modal settings-modal');
    modal.append(el('div', 'settings-title', '設定'));

    const body = el('div', 'settings-body');

    body.append(
      toggle('Live Preview', '記法を隠して読みやすく表示します。カーソルのある行は生の Markdown を見せます。',
        data.livePreview, (v) => { patch.livePreview = v; }),
      toggle('行番号を表示', '', data.showLineNumbers, (v) => { patch.showLineNumbers = v; }),
      choice('テーマ', data.theme, [['dark', 'ダーク'], ['light', 'ライト']], (v) => {
        patch.theme = v as SettingsData['theme'];
      }),
      text('Daily Notes のフォルダ', data.dailyFolder, (v) => { patch.dailyFolder = v; }),
      text('Daily Notes の日付書式', data.dailyFormat,
        (v) => { patch.dailyFormat = v; }, 'YYYY / MM / DD / ddd が使えます'),
      text('Daily Notes のテンプレート', data.dailyTemplate,
        (v) => { patch.dailyTemplate = v; }, '例: Templates/Daily.md（空なら使いません）'),
      text('テンプレートのフォルダ', data.templateFolder, (v) => { patch.templateFolder = v; }),
    );

    const footer = el('div', 'settings-footer');
    footer.append(
      button('閉じる', undefined, () => this.close()),
      button('保存', 'primary', () => {
        void this.opts.save(patch);
        this.close();
      }),
    );

    modal.append(body, footer);
    overlay.append(modal);
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) this.close();
    });
    document.body.append(overlay);
    this.overlay = overlay;
  }

  close(): void {
    this.overlay?.remove();
    this.overlay = null;
  }
}

function field(label: string, hint: string | undefined, control: HTMLElement): HTMLElement {
  const row = el('div', 'settings-row');
  const left = el('div', 'settings-label');
  left.append(el('div', undefined, label));
  if (hint) left.append(el('div', 'settings-hint', hint));
  row.append(left, control);
  return row;
}

function toggle(label: string, hint: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const input = el('input', 'settings-checkbox');
  input.type = 'checkbox';
  input.checked = value;
  input.addEventListener('change', () => onChange(input.checked));
  return field(label, hint || undefined, input);
}

function text(
  label: string,
  value: string,
  onChange: (v: string) => void,
  hint?: string,
): HTMLElement {
  const input = el('input', 'settings-input');
  input.type = 'text';
  input.value = value;
  input.addEventListener('input', () => onChange(input.value));
  return field(label, hint, input);
}

function choice(
  label: string,
  value: string,
  options: [string, string][],
  onChange: (v: string) => void,
): HTMLElement {
  const select = el('select', 'settings-input');
  for (const [v, text_] of options) {
    const option = el('option', undefined, text_);
    option.value = v;
    if (v === value) option.selected = true;
    select.append(option);
  }
  select.addEventListener('change', () => onChange(select.value));
  return field(label, undefined, select);
}
