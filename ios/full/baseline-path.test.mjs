import assert from 'node:assert/strict';
import test from 'node:test';
import { baselineRelativePath } from './baseline-path.mjs';
import { iosScenarios } from './scenarios.ts';

test('共享场景使用 laiwan_screenshot 的 v1 路径，语言和设备不进入状态 ID', () => {
  assert.equal(baselineRelativePath('zh-Hans-hall.png', 'zh-Hans'),
    'hall/hall/hall/ios/iphone16-ios18.5/zh-Hans/page/default.png');
  assert.equal(baselineRelativePath('en-login-user-privacy.png', 'en'),
    'auth/login/login-user-privacy/ios/iphone16-ios18.5/en/page/default.png');
  assert.equal(baselineRelativePath('zh-Hant-launch-staging-notice.png', 'zh-Hant'),
    'launch/launch/launch-staging-notice/ios/iphone16-ios18.5/zh-Hant/page/default.png');
});

test('原始录像相位不伪装成时间戳，重复的登录入口归于同一状态', () => {
  assert.equal(baselineRelativePath('search-confirmation-enter-middle.png', 'en'),
    'hall/search/search-confirmation-enter/ios/iphone16-ios18.5/en/animation/middle.png');
  assert.equal(baselineRelativePath('native-launch-artwork-visible.png', 'en'),
    'launch/launch/native-launch-artwork-visible/ios/iphone16-ios18.5/en/animation/visible.png');
  assert.equal(baselineRelativePath('launch-branding-fade-middle.png', 'en'),
    'launch/launch/launch-branding/ios/iphone16-ios18.5/en/animation/middle.png');
  assert.equal(baselineRelativePath('login-welcome.png', 'en'),
    'auth/login/smoke-login-welcome/ios/iphone16-ios18.5/en/page/default.png');
  assert.notEqual(baselineRelativePath('login-welcome.png', 'en'), baselineRelativePath('en-login.png', 'en'));
  assert.notEqual(baselineRelativePath('forgot-password-method.png', 'en'),
    baselineRelativePath('en-login-forgot-password.png', 'en'));
});

test('基准文件名和运行语言不允许越界或冲突', () => {
  assert.throws(() => baselineRelativePath('../hall.png', 'en'), /无效/);
  assert.throws(() => baselineRelativePath('zh-Hans-hall.png', 'en'), /语言与运行语言不同/);
  assert.throws(() => baselineRelativePath('hall.png', 'fr'), /未知基准语言/);
  assert.throws(() => baselineRelativePath('unmapped-product-panel.png', 'en'), /尚未归类/);
  assert.equal(baselineRelativePath('en-signed-in-mall.png', 'en'),
    'wallet/signed-in-mall/signed-in-mall/ios/iphone16-ios18.5/en/page/default.png');
  assert.equal(baselineRelativePath('en-signed-in-game-record.png', 'en'),
    'game-record/signed-in-game-record/signed-in-game-record/ios/iphone16-ios18.5/en/page/default.png');
});

test('三语言全部共享页面与声明的后续状态都有稳定模块路径', () => {
  let count = 0;
  for (const locale of ['en', 'zh-Hans', 'zh-Hant']) {
    for (const scenario of iosScenarios(locale, 'all')) {
      const page = `${locale}-${scenario.pageLabel.replaceAll('_', '-')}`;
      for (const filename of [`${page}.png`, ...(scenario.snapshotStates || [])
        .map(state => `${page}-${state.replaceAll('_', '-')}.png`)]) {
        const path = baselineRelativePath(filename, locale);
        assert.ok(!path.startsWith('other/'), filename);
        count++;
      }
    }
  }
  assert.ok(count >= 225);
});
