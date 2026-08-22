import { beforeEach, describe, expect, it } from 'vitest';
import type { VaultAdapter } from '../src/core/vault/VaultAdapter';
import { isVaultError } from '../src/core/vault/errors';

export interface ContractHarness {
  /** 空の Vault を1つ用意する */
  create: () => Promise<VaultAdapter>;
  /** 後片付け（一時ディレクトリの削除など） */
  cleanup?: () => Promise<void>;
}

/**
 * VaultAdapter の契約テスト。
 *
 * アダプタを増やすたびに、この1本を呼ぶだけで同じ基準で検証できる。
 * 「境界の向こう側がどれも同じ約束を守っている」ことを機械的に保証するのが目的
 * （設計書 §13）。
 */
export function runAdapterContract(name: string, harness: ContractHarness): void {
  describe(`${name} — VaultAdapter の契約`, () => {
    let a: VaultAdapter;

    beforeEach(async () => {
      await harness.cleanup?.();
      a = await harness.create();
    });

    it('書いたものが読める', async () => {
      await a.write('AI/Ollama.md', '# Ollama');
      expect(await a.read('AI/Ollama.md')).toBe('# Ollama');
    });

    it('日本語と改行が壊れない', async () => {
      const text = '# 見出し\n\nローカルLLM の実行環境。\n絵文字も: 🌱\n';
      await a.write('日本語/ノート.md', text);
      expect(await a.read('日本語/ノート.md')).toBe(text);
    });

    it('親ディレクトリが自動で作られる', async () => {
      await a.write('AI/sub/deep.md', 'x');
      const dirs = (await a.list('', true)).filter((e) => e.kind === 'dir').map((e) => e.path);
      expect(dirs).toContain('AI');
      expect(dirs).toContain('AI/sub');
    });

    it('list の recursive=false は直下だけを返す', async () => {
      await a.write('a.md', '1');
      await a.write('AI/b.md', '2');
      expect((await a.list('', false)).map((e) => e.path).sort()).toEqual(['AI', 'a.md']);
      expect((await a.list('', true)).map((e) => e.path).sort()).toEqual(['AI', 'AI/b.md', 'a.md']);
    });

    it('withStat=true で mtime と size が付く', async () => {
      await a.write('a.md', 'hello');
      const entry = (await a.list('', true, true)).find((e) => e.path === 'a.md');
      expect(entry?.size).toBe(5);
      expect(entry?.mtime).toBeGreaterThan(0);
    });

    it('存在しないファイルは ENOENT', async () => {
      const err = await a.read('nope.md').then(() => null, (e: unknown) => e);
      expect(isVaultError(err, 'ENOENT')).toBe(true);
    });

    it('exists が存在を答える', async () => {
      await a.write('AI/a.md', 'x');
      expect(await a.exists('AI/a.md')).toBe(true);
      expect(await a.exists('AI')).toBe(true);
      expect(await a.exists('nope.md')).toBe(false);
    });

    it('stat が mtime と size を返し、書き込みで内容が置き換わる', async () => {
      await a.write('a.md', 'hello');
      const first = await a.stat('a.md');
      expect(first.size).toBe(5);

      await new Promise((r) => setTimeout(r, 12));
      await a.write('a.md', 'hello world');
      const second = await a.stat('a.md');
      expect(second.size).toBe(11);
      expect(second.mtime).toBeGreaterThanOrEqual(first.mtime);
      expect(await a.read('a.md')).toBe('hello world');
    });

    it('上書きで前の内容が残らない', async () => {
      await a.write('a.md', '長いほうのテキスト');
      await a.write('a.md', '短い');
      expect(await a.read('a.md')).toBe('短い');
    });

    it('rename がファイルを移動する', async () => {
      await a.write('a.md', 'x');
      await a.rename('a.md', 'AI/b.md');
      expect(await a.exists('a.md')).toBe(false);
      expect(await a.read('AI/b.md')).toBe('x');
    });

    it('remove がファイルを消す', async () => {
      await a.write('a.md', 'x');
      await a.remove('a.md');
      expect(await a.exists('a.md')).toBe(false);
    });

    it('remove がディレクトリを再帰的に消す', async () => {
      await a.write('AI/x.md', '1');
      await a.write('AI/sub/y.md', '2');
      await a.remove('AI');
      expect(await a.list('', true)).toEqual([]);
    });

    it('mkdir が空ディレクトリを作る', async () => {
      await a.mkdir('Empty/Deep');
      const dirs = (await a.list('', true)).filter((e) => e.kind === 'dir').map((e) => e.path);
      expect(dirs).toContain('Empty');
      expect(dirs).toContain('Empty/Deep');
    });

    it('バイナリを往復できる', async () => {
      const data = new Uint8Array([0, 1, 2, 127, 128, 255]);
      await a.writeBinary('img.png', data.buffer as ArrayBuffer);
      expect(new Uint8Array(await a.readBinary('img.png'))).toEqual(data);
    });

    it('id / name / caps を名乗る', () => {
      expect(typeof a.id).toBe('string');
      expect(typeof a.name).toBe('string');
      expect(typeof a.caps.realFolder).toBe('boolean');
    });
  });
}
