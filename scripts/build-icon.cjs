/**
 * build/icon-source.png から、Electron・Web用のアイコンを生成する。
 * ICOにはWindowsの各表示サイズをまとめて格納する。
 */
const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'build', 'icon-source.png');
const PNG_OUTPUT = path.join(ROOT, 'build', 'icon.png');
const ICO_OUTPUT = path.join(ROOT, 'build', 'icon.ico');
const WEB_OUTPUT = path.join(ROOT, 'public', 'icon.png');
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

function buildIco(pngs) {
  const directorySize = 6 + pngs.length * 16;
  const directory = Buffer.alloc(directorySize);
  directory.writeUInt16LE(0, 0); // reserved
  directory.writeUInt16LE(1, 2); // ICO
  directory.writeUInt16LE(pngs.length, 4);

  let offset = directorySize;
  pngs.forEach(({ size, data }, index) => {
    const entry = 6 + index * 16;
    directory.writeUInt8(size === 256 ? 0 : size, entry);
    directory.writeUInt8(size === 256 ? 0 : size, entry + 1);
    directory.writeUInt8(0, entry + 2); // palette colors
    directory.writeUInt8(0, entry + 3); // reserved
    directory.writeUInt16LE(1, entry + 4); // color planes
    directory.writeUInt16LE(32, entry + 6); // bits per pixel
    directory.writeUInt32LE(data.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });

  return Buffer.concat([directory, ...pngs.map(({ data }) => data)]);
}

app.whenReady().then(() => {
  const source = nativeImage.createFromPath(SOURCE);
  if (source.isEmpty()) throw new Error(`アイコン原画を読み込めません: ${SOURCE}`);

  const webPng = source.resize({ width: 512, height: 512, quality: 'best' }).toPNG();
  const icoPngs = ICO_SIZES.map((size) => ({
    size,
    data: source.resize({ width: size, height: size, quality: 'best' }).toPNG(),
  }));

  fs.mkdirSync(path.dirname(WEB_OUTPUT), { recursive: true });
  fs.writeFileSync(PNG_OUTPUT, webPng);
  fs.writeFileSync(WEB_OUTPUT, webPng);
  fs.writeFileSync(ICO_OUTPUT, buildIco(icoPngs));

  console.log(`icon.png: 512x512 -> ${PNG_OUTPUT}`);
  console.log(`icon.ico: ${ICO_SIZES.join(', ')}px -> ${ICO_OUTPUT}`);
  console.log(`favicon: 512x512 -> ${WEB_OUTPUT}`);
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
