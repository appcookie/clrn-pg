// 与 laiwan_screenshot 的 snapshots/v1 路径契约一致；规则拷贝自其 scene-rules.json。
import { resolve, join } from 'node:path';
import rules from './scene-rules.json' with { type: 'json' };

export const baselineRoot = resolve('ios/snapshots/v1');
export const baselineDevice = 'iphone16-ios18.5';
const pages = rules.pages.map(rule => ({ ...rule, match: new RegExp(rule.pattern) })).reverse();
const aliases = Object.entries(rules.aliases).sort((a, b) => b[0].length - a[0].length);
const phases = /-(\d+ms|\d+frame|start(?:-alternate-\d+)?|middle|end|peak|changed|moved|first(?:-alternate-\d+)?|alternate(?:-\d+)?|light|dark)$/;
const smokeAuth = new Set(['login-welcome', 'login-username', 'forgot-password-method', 'forgot-password-email']);
const animationAliases = { 'launch-branding-fade': 'launch-branding' };
// 与 laiwan_screenshot/src/model.ts 的原生旧图模块推断保持一致；匹配不到就要求新增明确规则。
const moduleFallbacks = [
  [/^(texas|six-plus)/, 'texas-holdem'],
  [/^zhajinhua/, 'zhajinhua'],
  [/^(game-record|game-records|records-legacy|records-v2)/, 'game-record'],
  [/^(smoke|login|forgot-password|phone-password|pick-country|user-agreement|user-privacy)/, 'auth'],
  [/^(private-room|create-room|game-picker)/, 'private-room'],
  [/^club/, 'club'],
  [/^(message|buy-in|system-notification)/, 'message'],
  [/^(mall|wallet|currency|purchase|gift-card)/, 'wallet'],
  [/^(help|faq|feedback|contact|share|official|download|about)/, 'help'],
  [/^(me|profile|account|bind|reset-password|delete-account|user-level|application|language|telegram|update-)/, 'account'],
  [/^slot/, 'slot'],
  [/^asset/, 'assets'],
  [/^(prop-|sticker-)/, 'effects'],
  [/^(native|launch|staging-notice)(-|$)/, 'launch'],
  [/^invite-friends/, 'help'],
  [/^(hall|search|daily-bonus)/, 'hall'],
];

function canonicalEffect(scene) {
  const alias = aliases.find(([from]) => scene === from || scene.startsWith(`${from}-`));
  return alias ? alias[1] + scene.slice(alias[0].length) : scene.replace(/^texas-holdem-/, 'texas-');
}

/** 完整显示区域不当作设备尺寸；动画裁图仍归属同一 iPhone 16 runtime。 */
export function baselineRelativePath(filename, locale) {
  if (!['en', 'zh-Hans', 'zh-Hant'].includes(locale)) throw new Error(`未知基准语言：${locale}`);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*\.png$/.test(filename) || filename.includes('..')) {
    throw new Error(`视觉基准文件名无效：${filename}`);
  }
  const name = filename.slice(0, -4);
  const prefix = /^(zh-Hans|zh-Hant|en)-(.+)$/.exec(name);
  if (prefix && prefix[1] !== locale) throw new Error(`截图语言与运行语言不同：${filename}`);
  const raw = prefix?.[2] || name;
  // 旧版 iOS 登录冒烟图与正式 en 页面即使像素相同，也不合并业务身份。
  const pageState = !prefix && smokeAuth.has(raw) ? `smoke-${raw}` : raw;
  const phase = pageState.match(phases);
  const videoArtwork = pageState === 'native-launch-artwork-visible';
  // 这些后缀来自录制的真实相位；带 signed-in-/guest- 的 Web 页面状态仍是静态页。
  const animation = videoArtwork || (!!phase && !/^(signed-in|guest)-/.test(pageState));
  const kind = raw.startsWith('asset-') ? 'asset' : animation ? 'animation' : 'page';
  const sample = videoArtwork ? 'visible' : animation ? phase[1] : 'default';
  const state = videoArtwork ? pageState
    : animation ? pageState.slice(0, -phase[0].length) : pageState;
  const scene = kind === 'page' ? state : canonicalEffect(animationAliases[state] || state);
  const parent = pages.find(rule => rule.match.test(scene));
  // 新状态只有可归属已知业务模块时才独立成页；未知模块须先审查命名。
  const fallbackName = scene.replace(/^(signed-in-|guest-)/, '');
  const module = parent?.module || moduleFallbacks.find(([pattern]) => pattern.test(fallbackName))?.[1];
  if (!module) throw new Error(`视觉场景尚未归类，请更新 scene-rules.json：${scene}`);
  const page = parent?.id || scene;
  return join(module, page, scene, 'ios', baselineDevice, locale, kind, `${sample}.png`);
}

export function baselinePath(filename, locale = process.env.IOS_LOCALE || 'en') {
  return resolve(baselineRoot, baselineRelativePath(filename, locale));
}
