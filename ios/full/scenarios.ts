// 从三端共享场景选取 iPhone 流程，保留所有状态而不将不可达入口静默跳过。
import { buildScenarios } from '../../visual/scenarios';
import type { NativeSelector } from './native-device';
export function nativeSelector(selector: string): NativeSelector {
  const match = /^\[data-testid(\^=|\$=|=)"([^"]+)"\](?: input)?$/.exec(selector);
  if (!match) throw new Error(`需要显式适配的选择器：${selector}`);
  const [, operator, value] = match;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { res: operator === '=' ? value : new RegExp(operator === '^=' ? `^${escaped}` : `${escaped}$`) };
}
export function iosScenarios(locale: string, group = 'all') {
  const known = ['all', 'guest', 'account', 'social', 'rooms', 'wallet-help', 'records', 'texas', 'zhajinhua',
    'animation', 'functional', 'functional-creation', 'interaction', 'network'];
  if (!known.includes(group)) throw new Error(`未知 iOS 业务组：${group}`);
  return buildScenarios({ VISUAL_LOCALES: locale, VISUAL_SCOPE: 'full', VISUAL_SUITE: 'app' })
    .filter(scenario => scenario.viewport.label === 'mobile' && scenario.group !== 'game-record')
    .filter(scenario => {
      const selected = !scenario.signIn ? 'guest' : scenario.group === 'account' ? 'account'
        : scenario.group === 'private-room' ? 'rooms' : ['wallet', 'help'].includes(scenario.group) ? 'wallet-help' : 'social';
      return group === 'all' || group === selected;
    });
}
export const androidScenarios = iosScenarios;
