/** 个人资料/账号安全/帮助；取消编辑必须保留数据，不发送验证码或支付。 */
import { expect } from '@playwright/test';
import { register } from './shared/register';
register('SETTINGS-001', 0, 'signed-in', async ui => {
  const session=ui.requiredSession(); await ui.tap('settings-tab'); await ui.contains('username-text',session.username);
  for (const id of ['coin-balance-text','diamond-balance-text']) await ui.hasText(id,/^[\d,.]+$/);
  await ui.tap('user-info-button'); await ui.hasText('content-text-1',session.username); const nickname=await ui.text('content-text-0');
  await ui.tap('profile-item-0'); await ui.hasText('nickname-input',nickname); await ui.fill('nickname-input','IOS canceled'); await ui.back(); await ui.hasText('content-text-0',nickname);
  await ui.tap('profile-item-3'); const bio=await ui.text('bio-input'); await ui.fill('bio-input','IOS cancel bio'); await ui.back();
  await ui.tap('profile-item-3'); await ui.hasText('bio-input',bio); await ui.back(); await ui.back(); await ui.hasText('nickname-text',nickname);
  await ui.tap('user-level'); await ui.hasText('user-level-screen',/coin|金币|金幣/i);
  const coins=await ui.nodes('coin-amount'); expect(coins.length).toBeGreaterThan(0); expect(coins[0].text).toMatch(/^\d+$/);
  await ui.back(); await ui.contains('username-text',session.username);
});
register('SETTINGS-002', 0, 'signed-in', async ui => {
  await ui.settings('account-security'); await ui.visible('account-security-items-list'); await ui.tap('account-security-item-0');
  await ui.hasText('country-code-text',/^\+\d+$/); await ui.hasText('phone-number-input',''); await ui.back(); await ui.visible('account-security-item-0');
  await ui.tap('account-security-item-1'); await ui.hasText('email-address-input',''); await ui.hasText('bind-email-tips',/password|密码|密碼/i); await ui.back();
  await ui.tap('account-security-item-2'); for(const id of ['old-password-input','new-password-input']) {await ui.hasText(id,''); await ui.secure(id);} await ui.back();
  await ui.tap('account-security-item-3'); await ui.hasText('explanation-text',/recover|clear|retrieve|清空|找回/i); await ui.visible('all-clubs-and-rooms-text');
  await ui.tap('cancel-button'); await ui.visible('account-security-items-list');
});
register('SETTINGS-004', 0, 'signed-in', async ui => {
  await ui.settings('contact-us'); await ui.visible('online-service-button'); await ui.visible('feedback-button'); await ui.tap('faq-button');
  await ui.visible('faq-screen'); await ui.visible('faq-item-share_laiwan'); await ui.tap('faq-item-share_laiwan');
  await ui.visible('faq-detail-scroll-view'); await ui.visible('faq-detail-image'); await ui.back(); await ui.visible('faq-item-share_laiwan');
  await ui.back(); await ui.visible('online-service-button'); await ui.back();
  // default 渠道可能无下载帮助；明确失败与覆盖缺口，绝不吞错或 skip。
  await ui.tap('download-help'); await ui.visible('download-help-list'); await ui.tap('apple-button');
  await ui.hasText('apple_id_site_button','https://appleid.apple.com/'); await ui.visible('h5_link1_button'); await ui.back();
  for(const [button,screen,body] of [['android-button','download-android-help-view',/Play/i],['h5-button','h5-version-help-view',/computer|phone|电脑|手機|手机/i],['official_website-button','download-official-website-help-view',/download|下载|下載/i]] as const) {
    await ui.tap(button); await ui.hasText(screen,body); await ui.back(); await ui.visible(button);
  }
});
register('SETTINGS-005', 0, 'signed-in', async ui => {
  await ui.settings('application-management'); await ui.tap('language');
  for (const [id,label] of [['english','English'],['zh-hant','繁體中文'],['zh-hans','简体中文']]) await ui.contains(id,label);
  expect(JSON.stringify((await ui.node('english')).children)).toContain('checkmark-icon'); await ui.back(); await ui.visible('language'); await ui.back();
  await ui.tap('about-laiwan'); await ui.hasText('app-version-text',/\d/); for(const id of ['current-version-title','agreement-title','privacy-title']) await ui.visible(id); await ui.back();
  await ui.tap('official-site'); for(const i of [1,2,3]) await ui.hasText(`official-site-${i}-text`,/^https:\/\/\S+$/); await ui.back();
  await ui.tap('share-app'); await ui.hasText('app-name-text',/GoPlay360|来玩|來玩/); await ui.hasText('scan-app-text',/QR|scan|扫描|掃描/i);
  await ui.hasText('download-url-text',/^https:\/\//); await ui.hasText('url-text',/^https:\/\//); await ui.back();
  await ui.tap('telegram-channel'); await ui.hasText('channel-url-button','https://t.me/laiwanpai'); await ui.back(); await ui.visible('settings-screen');
});
register('SETTINGS-006', 0, 'signed-in', async ui => {
  await ui.settings('game-record'); await ui.hasText('no-records-text',/record|战绩|戰績/i); await ui.absent('progress-hud-activity-indicator');
  await ui.back(); await ui.visible('game-record');
});
register('SETTINGS-007', 0, 'signed-in', async ui => {
  await ui.settings('account-security'); await ui.tap('account-security-item-2'); await ui.enabled('confirm-button',false); await ui.fill('old-password-input','12345678');
  for(const [value,enabled] of [['1234567',false],['12345678',true],['12345678901234567',false],['1234567890123456',true]] as const) {await ui.fill('new-password-input',value); await ui.enabled('confirm-button',enabled);}
  for(const [value,enabled] of [['1234567',false],['1234567890123456',true],['12345678901234567',false],['',false]] as const) {await ui.fill('old-password-input',value); await ui.enabled('confirm-button',enabled);}
  await ui.back(); await ui.visible('account-security-items-list');
});
register('SETTINGS-008', 0, 'guest', async ui => {
  await ui.settings('application-management'); await ui.tap('language'); await ui.tap('zh-hans');
  expect(JSON.stringify((await ui.node('zh-hans')).children)).toContain('checkmark-icon'); await ui.visible({text:'语言'});
  await ui.back(); await ui.tap('language'); expect(JSON.stringify((await ui.node('english')).children)).toContain('checkmark-icon'); await ui.visible({text:'Language'});
});
register('SETTINGS-009', 0, 'signed-in', async ui => {
  await ui.settings('faq'); const title=await ui.text('faq-item-question-plug_in'); await ui.tap('faq-item-question-plug_in');
  await ui.visible({text:title}); await ui.visible('faq-detail-scroll-view'); const paragraphs=await ui.nodes(/^faq-detail-paragraph-/);
  expect(paragraphs.length).toBeGreaterThan(0); expect(paragraphs[0].text).toMatch(/\S/); await ui.back(); await ui.visible('faq-screen'); await ui.hasText('faq-item-question-plug_in',title);
});
