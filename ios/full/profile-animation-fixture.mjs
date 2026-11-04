import { PNG } from 'pngjs';
import sharp from 'sharp';

const screen = { width: 120, height: 180 };
const node = (res, x, y, width, height, text) => ({
  res,
  text,
  visible: true,
  clazz: 'XCUIElementTypeOther',
  bounds: { x, y, width, height },
  children: [],
});
export const panelNodes = [
  node(undefined, 10, 20, 100, 140),
  node('avatar_image', 20, 26, 18, 18),
  node('player-profile-popup-close', 100, 25, 5, 5),
  node('player-profile-nickname', 20, 25, 40, 8, 'Player'),
  node('player-profile-level', 65, 25, 20, 8, 'Lv 1'),
  node('player-profile-id', 20, 36, 30, 3, 'ID: abcdef12'),
  node('player-profile-balance', 20, 43, 20, 7, '10000'),
  node('PlayerStatisticComponent_List', 18, 60, 84, 90),
  node('PlayerStatisticComponent_Item_0', 18, 60, 40, 14, 'Total Hands, 100'),
];
function inRect(x, y, left, top, width, height) {
  return x >= left && x < left + width && y >= top && y < top + height;
}
function panelPixel(x, y) {
  if (inRect(x, y, 20, 26, 18, 18))
    return (Math.floor((x - 20) / 3) + Math.floor((y - 26) / 3)) % 2 ? [230, 230, 230] : [20, 20, 20];
  if (inRect(x, y, 100, 25, 5, 5))
    return x - 100 === y - 25 || x - 100 + (y - 25) === 4 ? [230, 230, 230] : [20, 20, 20];
  return y < 55 ? [27, 30, 45] : [50, 55, 76];
}
function basePicture(panel = false) {
  const png = new PNG(screen);
  for (let y = 0; y < screen.height; y++)
    for (let x = 0; x < screen.width; x++) {
      const rgb = panel && inRect(x, y, 10, 20, 100, 140) ? panelPixel(x, y) : [20, 100 + (y % 20), 60];
      png.data.set([...rgb, 255], (y * screen.width + x) * 4);
    }
  return PNG.sync.write(png);
}
const pictures = new Map([
  [0, basePicture()],
  [1, basePicture(true)],
]);
const scaledPanel = await sharp(pictures.get(1))
  .extract({ left: 10, top: 20, width: 100, height: 140 })
  .resize(65, 91)
  .png()
  .toBuffer();
const dimmed = await sharp(pictures.get(0)).linear(0.9, 0).png().toBuffer();
pictures.set(
  0.65,
  await sharp(dimmed)
    .composite([{ input: scaledPanel, left: 28, top: 45 }])
    .png()
    .toBuffer()
);
export const picture = (scale = 0) => pictures.get(scale);

