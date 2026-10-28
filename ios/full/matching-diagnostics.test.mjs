import test from 'node:test';
import assert from 'node:assert/strict';
import { MatchingTrace } from './matching-diagnostics.ts';
import { tap } from './navigation.ts';

const identifier = 'quick-start-room-cancel';
const button = { res: identifier, clazz: 'XCUIElementTypeButton', children: [],
  bounds: { x: 20, y: 40, width: 100, height: 40 }, visible: true, enabled: true,
  text: 'private-label', attributes: { token: 'private-token' } };

function fixture({ driverError, commandError } = {}) {
  const attachments = new Map(), taps = [];
  const trace = new MatchingTrace({ command: async endpoint => {
    assert.equal(endpoint, 'native/transport');
    if (commandError) throw commandError;
    return { matchingRpc: { events: [], pending: [] } };
  } }, { attach: async (name, { body }) => attachments.set(name, JSON.parse(body)) });
  const device = { screenSize: { width: 300, height: 600 },
    wait: async () => {}, info: async () => button,
    nodes: async () => [button, { ...button, res: 'private-account', text: 'Connecting...' }],
    input: { tap: async point => { taps.push(point); if (driverError) throw driverError; } } };
  return { attachments, taps, trace, device };
}

test('真实点击只执行一次，驱动成功与弹窗超时分开，不推断回调已处理', async () => {
  const { trace, device, taps, attachments } = fixture();
  await trace.input('prepare-cancel', identifier, observe => tap(device, identifier, observe));
  const timeout = new Error('private-timeout-details');
  await assert.rejects(trace.modal('prepare-cancel', 'gone', async () => { throw timeout; }),
    error => error === timeout);
  await trace.save('prepare-cancel');
  assert.deepEqual(taps, [{ x: 70, y: 60 }]);
  const data = attachments.get('matching-diagnostics-prepare-cancel');
  const [input, modal] = data.events;
  assert.equal(input.driver, 'returned');
  assert.equal(input.appCallback, 'unknown');
  assert.equal(input.appConnectionState, 'unknown');
  assert.equal(input.observation.identityMatches, true);
  assert.deepEqual(input.observation.connectionUi, { connecting: true, timeout: false });
  assert.ok(Date.parse(input.inputRequestedUtc) <= Date.parse(input.driverReturnedUtc));
  assert.equal(modal.assertion, 'failed');
  assert.equal(modal.expected, 'gone');
  assert.equal(JSON.stringify(data).includes('private'), false);
});

test('驱动拒绝后不重试，失败和代理诊断缺失仍保留且不泄露错误正文', async () => {
  const failure = new Error('private-driver-error');
  const { trace, device, taps, attachments } = fixture({ driverError: failure,
    commandError: new Error('private-control-token') });
  await assert.rejects(trace.input('recorded-cancel', identifier,
    observe => tap(device, identifier, observe)), error => error === failure);
  await trace.save('final');
  assert.equal(taps.length, 1);
  const data = attachments.get('matching-diagnostics-final');
  assert.equal(data.events[0].driver, 'failed');
  assert.equal(data.events[0].driverReturnedUtc, undefined);
  assert.deepEqual(data.transport, { unavailable: true });
  assert.equal(JSON.stringify(data).includes('private'), false);
});

test('目标查询失败不冒充已经请求点击，正常界面断言独立保留', async () => {
  const { trace, attachments, taps } = fixture();
  const failure = new Error('private-query-error');
  await assert.rejects(trace.input('prepare-cancel', identifier, async () => { throw failure; }),
    error => error === failure);
  await trace.modal('prepare-join', 'visible', async () => {});
  await trace.save('final');
  const data = attachments.get('matching-diagnostics-final');
  assert.equal(taps.length, 0);
  assert.equal(data.events[0].driver, 'preparation-failed');
  assert.equal(data.events[0].inputRequestedUtc, undefined);
  assert.equal(data.events[1].assertion, 'passed');
  assert.equal(data.events[1].expected, 'visible');
});

test('点击观测接收位置副本，不改变实际点击或原生控件', async () => {
  const { device, taps } = fixture();
  await tap(device, identifier, observation => {
    observation.point.x = 999;
    observation.target.bounds.x = 999;
  });
  assert.deepEqual(taps, [{ x: 70, y: 60 }]);
  assert.equal(button.bounds.x, 20);
});

test('附件保存失败不掩盖原始业务失败', async () => {
  const trace = new MatchingTrace({ command: async () => ({}) }, { attach: async () => {
    throw new Error('private-attachment-error');
  } });
  const failure = new Error('original');
  await assert.rejects((async () => {
    try { await trace.modal('prepare-cancel', 'gone', async () => { throw failure; }); }
    finally { await trace.save('final'); }
  })(), error => error === failure);
});
