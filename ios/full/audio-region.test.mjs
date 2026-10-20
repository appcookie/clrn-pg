import test from 'node:test';
import assert from 'node:assert/strict';
import { animationRegion, nativeAudioPanelBounds } from './animation-region.ts';

const screenSize = { width: 1178, height: 2556 };
const node = (res, y, height) => ({ res, clazz: 'XCUIElementTypeOther', visible: true,
  bounds: { x: 0, y, width: 1178, height }, children: [] });
// Real iOS 18.5 geometry from reference run 39508650275.
const mask = node('in-game-audio-popup-close', 0, 2556);
const sheet = node(undefined, 1803, 753);
const controls = [node('in-game-audio-top-tips', 1938, 36),
  node('in-game-audio-microphone-button', 1995, 318), node('in-game-audio-bottom-tips', 2328, 36)];

test('语音入场和退场使用完整原生面板，包含上下提示与底部安全区', () => {
  const nodes = [mask, sheet, ...controls];
  assert.deepEqual(nativeAudioPanelBounds(nodes, screenSize), sheet.bounds);
  const result = { bounds: sheet.bounds, source: 'native-audio-content-container' };
  assert.deepEqual(animationRegion('texas-holdem-voice-enter', [], nodes, { screenSize }, mask.bounds), result);
  assert.deepEqual(animationRegion('texas-holdem-voice-exit', nodes, [], { screenSize }, mask.bounds), result);
});

test('语音截图缺少可见控件或真实容器时失败，不回退到麦克风或全屏', () => {
  assert.throws(() => nativeAudioPanelBounds([mask, ...controls], screenSize), /完整语音/);
  assert.throws(() => nativeAudioPanelBounds([mask, sheet, ...controls.slice(1)], screenSize), /缺少可见/);
  assert.throws(() => nativeAudioPanelBounds([mask, sheet,
    ...controls.map(n => ({ ...n, visible: false }))], screenSize), /缺少可见/);
});
