// 独立于 review.json 和测试收集结果的游客验收清单。
// 调整覆盖范围时必须显式修改这里，不能通过删除用例/审查记录隐式缩减截图。
const pages = [
  ['hall', 'hall'], ['hall', 'guest_game_sign_in_prompt'],
  ['private-room', 'guest_private_room'], ['auth', 'login'],
  ['auth', 'login_username'], ['club', 'guest_club'], ['hall', 'search_sign_in_prompt'],
  ['auth', 'login_forgot_password'], ['auth', 'login_forgot_password_email'],
  ['auth', 'login_phone'], ['auth', 'login_forgot_password_sms'],
  ['auth', 'login_pick_country_code'], ['auth', 'login_user_agreement'],
  ['auth', 'login_user_privacy'], ['auth', 'login_language'],
  ['auth', 'login_phone_password'], ['message', 'guest_message'], ['account', 'guest_me'],
];
const phases = name => ['start', 'middle', 'end'].map(phase => `${name}-${phase}.png`);

export function guestScreenshotTests(locale, shard = 'all') {
  if (!['en', 'zh-Hans', 'zh-Hant'].includes(locale)) throw new Error(`未知语言：${locale}`);
  if (!['all', 'pages', 'startup'].includes(shard)) throw new Error(`未知游客分片：${shard}`);
  const pageTests = pages.map(([group, page]) => ({
    file: 'tests/parity.spec.ts', title: `${locale} / ${group} / ${page}`,
    images: [`${locale}-${page.replaceAll('_', '-')}.png`],
  }));
  const startup = [
    { file: 'tests/launch-branding.spec.ts', title: `${locale} launch_branding full screen while initialization waits`,
      images: [`${locale}-launch-branding.png`], videos: ['launch-branding-window-native-video'] },
    { file: 'tests/launch-pages.spec.ts', title: `${locale} launch_staging_notice full screen`,
      images: [`${locale}-launch-staging-notice.png`] },
  ];
  if (locale === 'en') startup.push(
    { file: 'tests/animation-assets.spec.ts', title: 'published iOS simulator app contains every reviewed animation asset',
      images: [], json: ['packaged-animation-assets'] },
    { file: 'tests/animation-transitions.spec.ts', title: 'native launch artwork and staging notice appear on a real app start',
      images: ['native-launch-artwork-visible.png', ...phases('native-launch-and-staging-notice')],
      videos: ['native-launch-and-staging-notice-native-video'] },
    { file: 'tests/animation-transitions.spec.ts', title: 'guest search confirmation animates into and out of the iOS screen',
      images: [...phases('search-confirmation-enter'), ...phases('search-confirmation-exit')],
      videos: ['search-confirmation-enter-native-video', 'search-confirmation-exit-native-video'] },
    { file: 'tests/auth.spec.ts', title: 'iOS Staging 登录与找回密码页面视觉回归',
      images: ['login-welcome.png', 'login-username.png', 'forgot-password-method.png', 'forgot-password-email.png'] },
    { file: 'tests/web-animation-parity.spec.ts', title: 'launch branding independently fades in while real initialization waits',
      images: phases('launch-branding-fade'), videoPrefixes: ['independent-launch-branding-enter-attempt-'] },
  );
  return shard === 'pages' ? pageTests : shard === 'startup' ? startup : [...pageTests, ...startup];
}

export function* reportSpecs(suite) {
  yield* suite.specs || [];
  for (const child of suite.suites || []) yield* reportSpecs(child);
}

export const screenshotTestKey = spec => `${spec.file.replace(/^ios\/full\//, '')}: ${spec.title}`;
