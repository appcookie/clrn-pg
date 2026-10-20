/** 精确关联 Web 源测试；未配置依赖或业务失败按普通失败处理。 */
import { readFileSync } from 'node:fs';
import { test } from '../../fixtures';
import { NativeCase } from './case';
import { credentials, fund } from './api';
const source = JSON.parse(readFileSync(new URL('../../../../docs/web-coverage-source.json', import.meta.url), 'utf8'));
export type Group = 'functional' | 'functional-creation' | 'interaction' | 'network';
export type Mode = 'guest' | 'signed-in' | 'creation';
export function register(id: string, variant: number, mode: Mode, run: (ui: NativeCase) => Promise<void>): void {
  const entry = source.functional.filter((row: any) => row.caseId === id)[variant];
  if (!entry) throw new Error(`缺少 Web 源案例 ${id}/${variant}`);
  const group: Group = entry.createsData ? 'functional-creation' : 'functional';
  nativeTest(group, `${id}/${variant + 1} ${entry.title}`, mode, run, `${source.sourceCommit}:${entry.path}:${entry.line}`);
}
export function nativeTest(group: Group, title: string, mode: Mode, run: (ui: NativeCase) => Promise<void>, sourcePath: string): void {
  const selected = process.env.IOS_GROUP || 'all';
  if (selected !== 'all' && selected !== group) return;
  test(title, { annotation: [{ type: 'web-source', description: sourcePath }] }, async ({ application }, info) => {
    test.setTimeout(720_000);
    info.annotations.push({ type: 'web-source', description: sourcePath });
    if (!application.proxy) throw new Error('功能测试必须使用 visual:false 的真实网络代理和 HTTP 观测');
    if (!['functional','functional-creation','interaction','network'].includes(process.env.IOS_GROUP || '')) throw new Error('原生功能运行必须显式选择业务组；all只用于静态清单，不能混用视觉代理');
    const ui = new NativeCase(application.device, application.proxy);
    await ui.guest();
    if (mode !== 'guest') { const session = await ui.signIn(credentials(mode === 'creation')); if (mode === 'creation') await fund(session); }
    await run(ui);
  });
}
