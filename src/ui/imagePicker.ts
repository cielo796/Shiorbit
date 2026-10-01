/** PC・スマートフォン共通の画像選択。保存先はApp側がVault内に限定する。 */
export type PickImageFile = () => Promise<File | null>;

export function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.png,.jpg,.jpeg,.gif,.webp,.svg,.avif,.bmp,image/*';
    input.style.display = 'none';
    document.body.append(input);

    let done = false;
    const finish = (file: File | null): void => {
      if (done) return;
      done = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => finish(null), { once: true });
    input.click();
  });
}
