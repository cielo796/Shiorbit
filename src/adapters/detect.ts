import { isFsaSupported } from './fsa';
import { isElectron } from './electron';

export type PlatformKind = 'web' | 'ios' | 'android' | 'electron';

export interface PlatformInfo {
  kind: PlatformKind;
  /** Capacitor でネイティブアプリとして動いているか */
  native: boolean;
  /** File System Access API が使えるか (PC の Chrome / Edge / Opera) */
  fsa: boolean;
  /** Origin Private File System が使えるか */
  opfs: boolean;
  secureContext: boolean;
}

interface CapacitorGlobal {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
}

/**
 * Capacitor はネイティブ実行時に window.Capacitor を注入する。
 * ここを見るだけなら @capacitor/core を静的に import せずに済むので、
 * ブラウザ向けのバンドルが太らない。
 */
function capacitor(): CapacitorGlobal | null {
  const g = (globalThis as Record<string, unknown>)['Capacitor'];
  return typeof g === 'object' && g !== null ? (g as CapacitorGlobal) : null;
}

export function detectPlatform(): PlatformInfo {
  const cap = capacitor();
  const capNative = cap?.isNativePlatform?.() === true;
  const platform = cap?.getPlatform?.() ?? 'web';
  const electron = isElectron();

  const kind: PlatformKind = electron
    ? 'electron'
    : capNative
      ? platform === 'ios'
        ? 'ios'
        : 'android'
      : 'web';

  return {
    kind,
    native: electron || capNative,
    fsa: isFsaSupported(),
    opfs:
      typeof navigator !== 'undefined' &&
      'storage' in navigator &&
      'getDirectory' in navigator.storage,
    secureContext: typeof isSecureContext === 'boolean' ? isSecureContext : false,
  };
}

export function describeUnsupported(info: PlatformInfo): string {
  if (!info.secureContext) {
    return 'HTTPS または localhost で開いてください。file:// では動作しません。';
  }
  return (
    'このブラウザではフォルダを直接開けません。' +
    'PC の Chrome または Edge をお使いください（スマホはアプリ版をご利用ください）。'
  );
}
