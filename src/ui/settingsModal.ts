import type { SettingsData } from '../core/settings/Settings';
import { LIMITS } from '../core/settings/Settings';
import { button, el } from './dom';

export interface SettingsModalOptions {
  read: () => SettingsData;
  save: (patch: Partial<SettingsData>) => Promise<void>;
  /** 保存せずに見た目だけ反映する。閉じると破棄される。 */
  preview?: (patch: Partial<SettingsData>) => void;
  /** preview を捨てて保存済みの値へ戻す。 */
  discardPreview?: () => void;
  changeVault?: () => Promise<void>;
  forgetVault?: () => Promise<void>;
}

/**
 * 設定画面。値は Vault の .shiorbit/settings.json に保存される。
 *
 * 変更はその場で画面へ反映し（保存はしない）、閉じれば元に戻る。
 * 文字サイズやテーマは、効果を見ないと決められないため。
 */
export class SettingsModal {
  private overlay: HTMLElement | null = null;

  constructor(private readonly opts: SettingsModalOptions) {}

  open(): void {
    if (this.overlay) return;
    const data = this.opts.read();
    const patch: Partial<SettingsData> = {};

    const apply = (change: Partial<SettingsData>): void => {
      Object.assign(patch, change);
      this.opts.preview?.(patch);
    };

    const overlay = el('div', 'modal-overlay');
    const modal = el('div', 'modal settings-modal');
    modal.append(el('div', 'settings-title', '設定'));

    const body = el('div', 'settings-body');

    body.append(
      section('表示'),
      choice('テーマ', data.theme, [['dark', 'ダーク'], ['light', 'ライト']], (v) => {
        apply({ theme: v as SettingsData['theme'] });
      }),
      number('表示倍率', Math.round(data.zoom * 100), {
        min: Math.round(LIMITS.zoom.min * 100),
        max: Math.round(LIMITS.zoom.max * 100),
        step: 10,
        unit: '%',
        hint: 'Ctrl + ホイール、Ctrl と +／-／0 でも変えられます。',
      }, (v) => apply({ zoom: v / 100 })),
      number('UI の文字サイズ', data.uiFontSize, {
        min: LIMITS.uiFontSize.min, max: LIMITS.uiFontSize.max, step: 1, unit: 'px',
        hint: 'サイドバーやペインの文字。',
      }, (v) => apply({ uiFontSize: v })),
      number('エディタの文字サイズ', data.editorFontSize, {
        min: LIMITS.editorFontSize.min, max: LIMITS.editorFontSize.max, step: 0.5, unit: 'px',
        hint: '本文を書く面の文字。',
      }, (v) => apply({ editorFontSize: v })),

      section('編集'),
      toggle('Live Preview', '記法を隠して読みやすく表示します。カーソルのある行は生の Markdown を見せます。',
        data.livePreview, (v) => apply({ livePreview: v })),
      toggle('行番号を表示', '', data.showLineNumbers, (v) => apply({ showLineNumbers: v })),
      choice('HTML を開いたときの表示', data.htmlDefaultView,
        [['preview', 'プレビュー'], ['source', 'ソース']], (v) => {
          apply({ htmlDefaultView: v as SettingsData['htmlDefaultView'] });
        }),
      number('自動保存の待ち時間', data.autoSaveDelay, {
        min: LIMITS.autoSaveDelay.min, max: LIMITS.autoSaveDelay.max, step: 100, unit: 'ms',
        hint: '入力が止まってから保存するまでの時間。',
      }, (v) => apply({ autoSaveDelay: v })),
      number('外部変更を見に行く間隔', data.pollInterval, {
        min: LIMITS.pollInterval.min, max: LIMITS.pollInterval.max, step: 1000, unit: 'ms',
        hint: '他のアプリや同期による変更を拾う間隔。',
      }, (v) => apply({ pollInterval: v })),

      section('ノートの置き場所'),
      text('Daily Notes のフォルダ', data.dailyFolder, (v) => apply({ dailyFolder: v })),
      text('Daily Notes の日付書式', data.dailyFormat,
        (v) => apply({ dailyFormat: v }), 'YYYY / MM / DD / ddd が使えます'),
      text('Daily Notes のテンプレート', data.dailyTemplate,
        (v) => apply({ dailyTemplate: v }), '例: Templates/Daily.md（空なら使いません）'),
      text('テンプレートのフォルダ', data.templateFolder, (v) => apply({ templateFolder: v })),
    );

    if (this.opts.changeVault || this.opts.forgetVault) {
      const actions = el('div', 'settings-vault-actions');
      if (this.opts.changeVault) {
        actions.append(button('フォルダを変更', undefined, () => void this.opts.changeVault?.()));
      }
      if (this.opts.forgetVault) {
        actions.append(button('設定を解除', 'danger', () => void this.opts.forgetVault?.()));
      }
      body.append(section('フォルダ'), field(
        'フォルダ',
        '設定の解除は記憶したフォルダパスだけを消去します。ノートやフォルダは削除されません。',
        actions,
      ));
    }

    const footer = el('div', 'settings-footer');
    footer.append(
      button('閉じる', undefined, () => this.close()),
      button('保存', 'primary', () => {
        void this.opts.save(patch);
        this.overlay?.remove();
        this.overlay = null;
      }),
    );

    modal.append(body, footer);
    overlay.append(modal);
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) this.close();
    });
    overlay.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      this.close();
    });
    document.body.append(overlay);
    this.overlay = overlay;
    body.querySelector<HTMLElement>('select, input')?.focus();
  }

  /** 閉じるときは、保存していない変更（プレビュー）を必ず捨てる。 */
  close(): void {
    if (!this.overlay) return;
    this.overlay.remove();
    this.overlay = null;
    this.opts.discardPreview?.();
  }
}

function section(label: string): HTMLElement {
  return el('div', 'settings-section', label);
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

interface NumberOptions {
  min: number;
  max: number;
  step: number;
  unit: string;
  hint?: string;
}

/**
 * 数値の入力。範囲外は反映せず理由を出す。
 * 黙って丸めると「入れた値と違う」ことに気づけないため。
 */
function number(
  label: string,
  value: number,
  opts: NumberOptions,
  onChange: (v: number) => void,
): HTMLElement {
  const input = el('input', 'settings-input');
  input.type = 'number';
  input.value = String(value);
  input.min = String(opts.min);
  input.max = String(opts.max);
  input.step = String(opts.step);
  input.setAttribute('aria-label', label);

  const error = el('div', 'settings-error');
  const control = el('div', 'settings-number');
  control.append(input, el('span', 'settings-unit', opts.unit));

  input.addEventListener('input', () => {
    const parsed = Number(input.value);
    if (input.value.trim() === '' || !Number.isFinite(parsed)) {
      error.textContent = '数値を入れてください。';
      return;
    }
    if (parsed < opts.min || parsed > opts.max) {
      error.textContent = `${opts.min}〜${opts.max}${opts.unit} の範囲で入れてください。`;
      return;
    }
    error.textContent = '';
    onChange(parsed);
  });

  const row = field(label, opts.hint, control);
  row.querySelector('.settings-label')?.append(error);
  return row;
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
