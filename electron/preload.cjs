/**
 * preload — レンダラとメインプロセスの橋渡し。
 *
 * レンダラからは fs を一切触らせない (contextIsolation: true, nodeIntegration: false)。
 * ここで公開するのは、VaultAdapter が必要とする最小限の操作だけ。
 * 実際のファイル操作はすべてメインプロセス側で、Vault の外に出ないか検証してから行う。
 */
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('shiorbitNative', {
  /** { sep, vaultPath, version } を返す */
  init: () => invoke('app:init'),
  /** フォルダ選択ダイアログ。選ばれたパス、キャンセルなら null */
  pickVault: () => invoke('vault:pick'),
  forgetVault: () => invoke('vault:forget'),

  fs: {
    readText: (p) => invoke('fs:readText', p),
    readBytes: (p) => invoke('fs:readBytes', p),
    writeText: (p, text) => invoke('fs:writeText', p, text),
    writeBytes: (p, data) => invoke('fs:writeBytes', p, data),
    readDir: (p, withStat) => invoke('fs:readDir', p, withStat),
    listTree: (p, withStat) => invoke('fs:listTree', p, withStat),
    stat: (p) => invoke('fs:stat', p),
    mkdirp: (p) => invoke('fs:mkdirp', p),
    remove: (p) => invoke('fs:remove', p),
    rename: (from, to) => invoke('fs:rename', from, to),
  },
});
