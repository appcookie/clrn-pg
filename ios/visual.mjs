// 比较截图及按时间采样的动画帧；不以视频文件编码是否相同判断视觉变化。
import { PNG } from 'pngjs';

export function comparePixels(expectedBytes, actualBytes, channelTolerance = 12, exclusions = []) {
  const expected = PNG.sync.read(expectedBytes);
  const actual = PNG.sync.read(actualBytes);
  if (expected.width !== actual.width || expected.height !== actual.height) {
    return { matches: false, changedRatio: 1, reason: '图片尺寸不同' };
  }
  const diff = new PNG({ width: actual.width, height: actual.height });
  let changed = 0;
  for (let offset = 0; offset < actual.data.length; offset += 4) {
    let excluded = false;
    if (exclusions.length) {
      const pixel = offset / 4;
      const x = pixel % actual.width, y = Math.floor(pixel / actual.width);
      excluded = exclusions.some(box => x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height);
    }
    const different = !excluded && [0, 1, 2, 3].some(channel =>
      Math.abs(expected.data[offset + channel] - actual.data[offset + channel]) > channelTolerance);
    if (different) changed++;
    diff.data.set(different ? [255, 0, 80, 255] : [actual.data[offset], actual.data[offset + 1], actual.data[offset + 2], 80], offset);
  }
  const changedRatio = changed / (actual.width * actual.height);
  return { matches: changedRatio <= 0.001, changedRatio, diff: PNG.sync.write(diff) };
}
