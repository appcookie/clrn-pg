import test from 'node:test';
import assert from 'node:assert/strict';
import { renewalMarkerEvidence } from './panel-diagnostics.ts';

test('从原树保留隐藏的续期标记，重复根不增加样本，不输出私密内容', () => {
  const close = { res: 'renew-popup-close-button', visible: false, text: 'private',
    bounds: { x: 50, y: 100, width: 30, height: 40 }, attributes: { value: 'private' } };
  const container = { res: 'private-parent', children: [close] };
  assert.deepEqual(renewalMarkerEvidence([container, close]), [
    { marker: close.res, visible: false, bounds: close.bounds },
  ]);
  assert.ok(!JSON.stringify(renewalMarkerEvidence([container])).includes('private'));
  assert.equal(renewalMarkerEvidence(Array.from({ length: 30 }, () => ({ ...close }))).length, 16);
});
