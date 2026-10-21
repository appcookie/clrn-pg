import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRecordedToastText } from './recorded-text.ts';
import { toastPanelPixels } from './toast-panel.ts';

const screen = { width: 100, height: 400 }, panel = { x: 10, y: 20, width: 80, height: 40 };
const line = (text, changes = {}) => ({ text, confidence: 1,
  bounds: { x: 0.2, y: 0.07, width: 0.6, height: 0.03 }, ...changes });
test('只接受提示面板内实际识别的文案；背景数字、错字和连接遮挡均失败', () => {
  assert.doesNotThrow(() => assertRecordedToastText([line('Minimum 40')], '40', panel, screen));
  for (const lines of [[], [line('Minimum 30')], [line('Minimum 40', { confidence: 0.1 })],
    [line('Minimum 40', { bounds: { x: 0.1, y: 0.5, width: 0.6, height: 0.1 } })]])
    assert.throws(() => assertRecordedToastText(lines, '40', panel, screen), /实际显示预期文字/);
  assert.throws(() => assertRecordedToastText([line('Minimum 40'), line('Connecting...')], '40', panel, screen), /连接等待/);
  assert.throws(() => assertRecordedToastText([line('Minimum 40')], '', panel, screen), /预期文字/);
});
test('识别只归一化空白和全角，不改写错字或丢失文字', () => {
  assert.doesNotThrow(() => assertRecordedToastText([line('Minimum ４０')], 'Minimum 40', panel, screen));
  assert.doesNotThrow(() => assertRecordedToastText([line('表示 主动投钱 到底池')], '表示主动投钱到底池', panel, screen));
  assert.throws(() => assertRecordedToastText([line('Minimurn 40')], 'Minimum 40', panel, screen), /预期文字/);
});
test('从原片浅色横幅像素计算保护区，小图标和下方白色内容不能冒充提示', () => {
  const frame = { ...screen, data: Buffer.alloc(screen.width * screen.height * 4, 50) };
  const fill = (x, y, width, height) => {
    for (let row = y; row < y + height; row++) for (let col = x; col < x + width; col++)
      frame.data.fill(255, (row * screen.width + col) * 4, (row * screen.width + col + 1) * 4);
  };
  assert.equal(toastPanelPixels(frame), undefined);
  fill(10, 200, 80, 40); fill(10, 10, 10, 10);
  assert.equal(toastPanelPixels(frame), undefined);
  fill(10, 30, 80, 40);
  assert.deepEqual(toastPanelPixels(frame), { x: 9, y: 29, width: 82, height: 42 });
});
