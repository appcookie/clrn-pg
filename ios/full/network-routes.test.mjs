import test from 'node:test';
import assert from 'node:assert/strict';
import { visualNetworkRouter } from './network-routes.ts';

test('原生mitm桥不伪造健康或metadata，仍保留业务夹具并透传真实私人房', async () => {
  const route = await visualNetworkRouter({ realPrivateRoom: true });
  for (const host of ['api.shafayouxi.org', '64.kr-seoul.api.staging.laiwan.shafayouxi.com',
    '67.hk.api.staging.laiwan.shafayouxi.com', '68.kr.api.staging.laiwan.shafayouxi.com']) {
    for (const path of ['/node/v1/status', '/public/v12/metadata/servers', '/public/v13/metadata/servers',
      '/v2/centrifugo/connection/websocket']) {
      assert.equal(await route(`https://${host}${path}`), null, `${host}${path} must reach native proxy/upstream`);
    }
  }
  const country = await route('https://api.shafayouxi.org/public/v10/profile/country');
  assert.equal(JSON.parse(country.body).result.countryPhoneCode, '86');
  const reminder = await route('https://api.shafayouxi.org/v2/room/disallow-rule/reminder');
  assert.equal(JSON.parse(reminder.body).result.enable, false);
  assert.equal(await route('https://api.shafayouxi.org/v10/house/user/real-user'), null);
});
