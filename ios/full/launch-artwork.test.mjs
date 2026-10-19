import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { launchArtworkMatch } from './launch-artwork.ts';

function picture(transform = (values) => values) {
  const png = new PNG({ width: 128, height: 256 });
  for (let y = 0; y < png.height; y++) for (let x = 0; x < png.width; x++) {
    const cloud = Math.sin(x / 9) * Math.cos(y / 23) * 30;
    const forest = x < y % 83 ? 35 : 0;
    const values = [75 + x / 3 + cloud - forest, 115 + y / 5 + cloud, 210 + cloud / 2 - forest];
    png.data.set([...transform(values, x, y).map(Math.round), 255], (y * png.width + x) * 4);
  }
  return png;
}

test('iOS实际布局中的插画允许Staging均匀暗层，并排除真实弹窗遮挡', () => {
  const reference = picture();
  const dimmed = picture(values => values.map(value => value * 0.6 + 18));
  const dialog = { x: 30, y: 70, width: 70, height: 150 };
  for (let y = dialog.y; y < dialog.y + dialog.height; y++) for (let x = dialog.x; x < dialog.x + dialog.width; x++) {
    dimmed.data.set([245, 240, 250, 255], (y * dimmed.width + x) * 4);
  }
  assert.equal(launchArtworkMatch(dimmed, reference, [dialog]).matches, true);
  assert.equal(launchArtworkMatch(dimmed, reference, []).matches, false);
});

test('黑白系统启动页、纯蓝底、水平翻转的同色插画不能冒充实际启动素材', () => {
  const reference = picture();
  for (const color of [[0, 0, 0], [255, 255, 255], [70, 130, 220]]) {
    assert.equal(launchArtworkMatch(picture(() => color), reference, []).matches, false);
  }
  const mirrored = picture();
  for (let y = 0; y < mirrored.height; y++) for (let x = 0; x < mirrored.width; x++) {
    const source = (y * reference.width + reference.width - 1 - x) * 4;
    mirrored.data.set(reference.data.subarray(source, source + 4), (y * mirrored.width + x) * 4);
  }
  assert.equal(launchArtworkMatch(mirrored, reference, []).matches, false);
  assert.throws(() => launchArtworkMatch(reference, reference, [{ x: 0, y: 0, width: 128, height: 256 }]), /像素不足/);
});
