const fs = require('node:fs/promises');
const path = require('node:path');

/** 一覧取得をメイン側で完結させる。I/Oは16件まで、リンク先へは再帰しない。 */
async function listTree(root, withStat = false) {
  const result = [];
  const directories = [''];
  for (let at = 0; at < directories.length; at++) {
    const prefix = directories[at];
    let entries;
    try { entries = await fs.readdir(path.join(root, prefix), { withFileTypes: true }); }
    catch (error) {
      if (prefix && error.code === 'ENOENT') continue;
      throw error;
    }
    for (let start = 0; start < entries.length; start += 16) {
      const batch = await Promise.all(entries.slice(start, start + 16).map(async entry => {
        if (entry.isSymbolicLink()) return null;
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        const item = { path: relative, name: entry.name, kind: entry.isDirectory() ? 'dir' : 'file' };
        if (entry.isDirectory()) directories.push(relative);
        else if (withStat) {
          try {
            const stat = await fs.stat(path.join(root, relative));
            item.mtime = stat.mtimeMs;
            item.size = stat.size;
          } catch (error) {
            if (error.code === 'ENOENT') return null;
            throw error;
          }
        }
        return item;
      }));
      result.push(...batch.filter(Boolean));
    }
  }
  return result;
}

module.exports = { listTree };
