/**
 * ソフトキーボードに追従するための CSS 変数を更新する。
 *
 * iOS はキーボードが出ても window.innerHeight が変わらないため、
 * visualViewport との差分を取ってツールバーを押し上げる必要がある。
 */
export function trackKeyboardInset(): () => void {
  const vv = window.visualViewport;
  if (!vv) return () => undefined;

  const update = (): void => {
    const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb-inset', `${Math.round(inset)}px`);
  };

  update();
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);

  return () => {
    vv.removeEventListener('resize', update);
    vv.removeEventListener('scroll', update);
  };
}
