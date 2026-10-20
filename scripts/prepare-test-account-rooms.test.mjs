import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareTestAccountRooms } from './prepare-test-account-rooms.mjs';

const session = { userId: '11111111-2222-4333-8444-555555555555', authorization: 'Bearer private-session' };
const house = { house_id: '22222222-2222-4333-8444-555555555555', user_id: session.userId };
const room = { room_id: '33333333-2222-4333-8444-555555555555', room_name: 'TestRoom',
  creator_id: session.userId, building_id: house.house_id, building_type: 'house',
  is_official: false, room_status: 'opening', timer_status: 'wait_for_timing', timing_at: null, seat_occupied: 0 };

/**
 * 只替换网络，执行真实的归属校验、状态校验、删除及回读流程。
 * @param context - 当前测试上下文。
 * @param replies - 按请求顺序返回的服务端数据。
 */
function network(context, replies) {
  const requests = [];
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, ...options });
    assert.ok(requests.length <= replies.length, '不得发出未预期请求');
    const reply = replies[requests.length - 1];
    if (reply instanceof Error) throw reply;
    return reply instanceof Response ? reply : Response.json({ ok: true, result: reply });
  });
  return requests;
}

test('空私人房只检查归属及列表，不执行删除', async context => {
  const requests = network(context, [house, []]);
  await prepareTestAccountRooms(session);
  assert.deepEqual(requests.map(request => request.method), ['PUT', 'PUT']);
  assert.deepEqual(JSON.parse(requests[1].body), { building_ids: [house.house_id] });
});

test('本账号空闲测试房必须复查详情、删除并回读为空', async context => {
  for (const name of ['TestRoom', 'E2E私局m123abc']) {
    const current = { ...room, room_name: name };
    // 真实列表响应省略官方标志，删除资格必须由详情里的明确 false 补齐。
    const requests = network(context, [house, [{ ...current, is_official: undefined }], current, undefined, []]);
    await prepareTestAccountRooms(session);
    assert.deepEqual(requests.map(request => [new URL(request.url).pathname, request.method]), [
      [`/v10/house/user/${session.userId}`, 'PUT'], ['/v2/building/rooms', 'PUT'],
      [`/v1/room/${room.room_id}`, 'GET'], [`/v1/room/${room.room_id}`, 'DELETE'], ['/v2/building/rooms', 'PUT'],
    ]);
    for (const request of requests) {
      assert.equal(new URL(request.url).origin, 'https://api.shafayouxi.org');
      assert.equal(request.headers.Authorization, session.authorization);
      assert.equal(request.headers['X-Testing-Api-Token'], undefined);
      assert.equal(request.redirect, 'error');
      assert.ok(request.signal instanceof AbortSignal);
    }
    context.mock.restoreAll();
  }
});

test('会话或房屋归属不符时立即停止', async context => {
  const requests = network(context, [{ ...house, user_id: house.house_id }]);
  for (const invalid of [undefined, {}, { ...session, userId: '../other' }, { ...session, authorization: 'Bearer secret\n' }]) {
    await assert.rejects(prepareTestAccountRooms(invalid), /有效账号会话/);
  }
  assert.equal(requests.length, 0);
  await assert.rejects(prepareTestAccountRooms(session), /归属不符/);
  assert.equal(requests.length, 1);
});

test('陌生房间、其他归属、有人入座、已开局或不完整数据都不能自动删除', async context => {
  for (const changes of [
    { room_name: '私人房' }, { room_name: undefined }, { room_id: '../other' },
    { creator_id: house.house_id }, { building_id: session.userId }, { building_type: 'club' },
    { is_official: true }, { room_status: 'closed' }, { timer_status: 'timing' },
    { timing_at: 123 }, { seat_occupied: 1 }, { seat_occupied: undefined },
  ]) {
    const requests = network(context, [house, [{ ...room, ...changes }]]);
    await assert.rejects(prepareTestAccountRooms(session), /未删除/);
    assert.equal(requests.length, 2);
    context.mock.restoreAll();
  }
  for (const rooms of [null, {}, [room, room], [null]]) {
    const requests = network(context, [house, rooms]);
    await assert.rejects(prepareTestAccountRooms(session), /无效|未删除/);
    assert.equal(requests.length, 2);
    context.mock.restoreAll();
  }
});

test('删除前状态变化必须停止，清理后仍有房间也必须失败', async context => {
  for (const current of [{ ...room, seat_occupied: 1 }, { ...room, room_id: house.house_id },
    { ...room, is_official: undefined }, { ...room, is_official: true }, null]) {
    const requests = network(context, [house, [room], current]);
    await assert.rejects(prepareTestAccountRooms(session), /状态或归属已变化/);
    assert.equal(requests.length, 3);
    context.mock.restoreAll();
  }
  network(context, [house, [room], room, undefined, [room]]);
  await assert.rejects(prepareTestAccountRooms(session), /清理后.*仍非空/);
});

test('任一网络或业务失败都会停止且错误中不泄露会话', async context => {
  const replies = [house, [room], room, undefined, []];
  for (const stage of [0, 1, 2, 3, 4]) {
    for (const failure of [new Error(session.authorization), new Response(session.authorization, { status: 503 }),
      new Response(session.authorization), Response.json({ ok: false })]) {
      const requests = network(context, [...replies.slice(0, stage), failure]);
      await assert.rejects(prepareTestAccountRooms(session), error => {
        assert.match(error.message, /失败/);
        assert.ok(!error.message.includes(session.authorization));
        return true;
      });
      assert.equal(requests.length, stage + 1);
      context.mock.restoreAll();
    }
  }
});
