/** 钱包响应币种/结构/首笔显示关联，不允许其他离屏列表冒充当前流水。 */
import { expect } from '@playwright/test';
import { success, type ApiResponse } from './api';
import type { NativeCase } from './case';
export type Statement = { currency_name: string; amount: string; balance: string; event: string; create_at: string; memo: string | null; statement_id: string };
export function statements(response: ApiResponse, currency: 'coin' | 'diamond'): Statement[] {
  const result = success(response); expect(result.currency_name).toBe(currency); expect(Array.isArray(result.statements)).toBe(true);
  for (const s of result.statements) {
    expect(s.currency_name).toMatch(currency === 'coin' ? /^(coin|金币|金幣)$/ : /^(diamond|钻石|鑽石)$/);
    expect(s.amount).toMatch(/^\d+(?:\.\d+)?$/); expect(s.balance).toMatch(/^-?\d+(?:\.\d+)?$/);
    expect(s.event).toMatch(/^(deposit|withdraw)$/); expect(Number.isFinite(Date.parse(s.create_at))).toBe(true);
    expect(typeof s.statement_id === 'string' && s.statement_id.length > 0).toBe(true); expect(s.memo === null || typeof s.memo === 'string').toBe(true);
  }
  return result.statements;
}
export async function expectStatements(ui: NativeCase, list: string, records: Statement[]): Promise<void> {
  await ui.visible(list); const rows = await ui.within(list, 'CurrencyTransactionRecordItem_container');
  if (!records.length) { expect(rows.length).toBe(0); return; }
  expect(rows.length).toBeGreaterThan(0); const first = records[0];
  const flatten = (n: any): any[] => [n, ...(n.children || []).flatMap(flatten)]; const nodes = flatten(rows[0]);
  const text = (id: string) => String(nodes.find(n => n.res === id)?.text || '');
  expect(text('CurrencyTransactionRecordItem_amount')).toBe(`${first.event === 'deposit' ? '+' : '-'}${first.amount}`);
  expect(text('CurrencyTransactionRecordItem_balance')).toMatch(new RegExp(`(?:Balance|余额|餘額):?\\s*${first.balance.replace('.', '\\.')}\\s*$`, 'i'));
  // 模拟器与 CI 必须同 UTC；记录格式来自实际接口时间，不忽略日期字段。
  const date = new Date(first.create_at); const formatted = date.toISOString().replace('T',' ').slice(0,19);
  expect(text('CurrencyTransactionRecordItem_date')).toBe(formatted);
}
