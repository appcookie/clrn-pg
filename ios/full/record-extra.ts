import { expect } from '@playwright/test';
import type { NativeDevice as AndroidDevice } from './native-device';
import type { RecordProxy } from '../../visual/cases/game-record/proxy';
import { exists, waitAbsent } from './native-state';
import { tap, reveal } from './navigation';
import { pressRecordControl, recordRow, reopenRecords, scrollRecords } from './record-navigation';
import { scrollToEnd } from './scroll-end';

type Capture = (state: string) => Promise<void>;

/**
 * 通过 iOS 系统弹窗按钮完成确认或取消。
 * @param device - 专用模拟器连接。
 * @param confirm - 是否选择确认按钮。
 */
export async function recordDialog(device: AndroidDevice, confirm = true): Promise<void> {
  const message = await waitRecordAlert(device);
  if (confirm) await device.acceptAlert();
  else await device.dismissAlert();
  await expect.poll(() => device.alertText(), { timeout: 10000 }).not.toBe(message);

}

/** iOS 系统警告文字必须来自真实弹窗，不把接口故障当作弹窗消失。 */
export async function waitRecordAlert(device: AndroidDevice, text?: string | RegExp): Promise<string> {
  let message = '';
  await expect(async () => {
    message = (await device.alertText()) || '';
    expect(message).not.toBe('');
    if (typeof text === 'string') expect(message).toContain(text);
    else if (text) expect(message).toMatch(text);
  }).toPass({ timeout: 30000 });
  return message;
}

/**
 * 从指定战绩行内部真实左滑，定位露出的删除按钮。
 * @param device - 专用模拟器连接。
 * @param name - 共享夹具的房间名称。
 */
async function swipeRecord(device: AndroidDevice, name: string): Promise<void> {
  await reveal(device, recordRow(name));
  const row = (await device.info(recordRow(name))).bounds;
  const list = (await device.info({ res: 'my-game-record-list' })).bounds;
  const y = String(Math.round(row.y + row.height / 2));
  await device.input.swipe({ x1: Number(String(Math.round(list.x + list.width * 0.85))), y1: Number(y), x2: Number(String(Math.round(list.x + list.width * 0.25))), y2: Number(y), duration: Number('600') });
  await device.wait({ res: 'delete-button' });
}

/**
 * 点击已侧滑行的删除区域；同名隐藏按钮不能误选到其他记录行。
 * @param device - 专用模拟器连接。
 * @param name - 当前侧滑记录的名称。
 */
async function deleteRecord(device: AndroidDevice, name: string): Promise<void> {
  const row = (await device.info(recordRow(name))).bounds;
  const button = (await device.info({ res: 'delete-button' })).bounds;
  await device.input.tap({ x: button.x + button.width / 2, y: row.y + row.height / 2 });
}

/**
 * 验证两版共同的侧滑、确认、取消与进行中记录禁止删除。
 * @param device - 专用模拟器连接。
 * @param capture - 截图回调。
 */
export async function recordDeletion(device: AndroidDevice, capture: Capture): Promise<void> {
  await swipeRecord(device, 'Private Texas');
  await capture('swipe_delete');
  await deleteRecord(device, 'Private Texas');
  await waitRecordAlert(device);
  await capture('delete_confirm');
  await recordDialog(device, false);
  await capture('delete_cancel');
  await deleteRecord(device, 'Private Texas');
  await recordDialog(device);
  await waitRecordAlert(device, /.*(删除|刪除|delete).*/i);
  await capture('delete_blocked');
  await recordDialog(device);
  await reopenRecords(device);
}

/**
 * 覆盖旧版删除成功、失败、真实分页与重新进入列表。
 * @param device - 专用模拟器连接。
 * @param proxy - 共享 Web 战绩代理。
 * @param capture - 截图回调。
 */
export async function legacyRecordEnd(device: AndroidDevice, proxy: RecordProxy, capture: Capture): Promise<void> {
  await swipeRecord(device, 'Club Cards');
  await deleteRecord(device, 'Club Cards');
  await recordDialog(device);
  await expect.poll(async () => (await proxy.status()).deleted).toContain('visual-record-club');
  await waitAbsent(device, recordRow('Club Cards'));
  await capture('delete_success');
  await proxy.mode('delete-error');
  await swipeRecord(device, 'Hall Texas');
  await deleteRecord(device, 'Hall Texas');
  await recordDialog(device);
  await waitRecordAlert(device, 'Visual record service unavailable');
  await capture('delete_failure');
  await recordDialog(device);
  await proxy.mode('paged', true);
  await reopenRecords(device);
  await device.wait(recordRow('Paged Texas 01'));
  // 页尾尚未滚入屏幕时立即继续滑动，不能逐行消耗原生请求的十秒截止时间。
  await expect(async () => {
    await scrollRecords(device, true);
    expect(await exists(device, recordRow('No Hands'))).toBe(true);
  }).toPass({ timeout: 30_000, intervals: [100] });
  await device.wait({ res: 'pull-up-activity-indicator' });
  await scrollToEnd(device, { res: 'my-game-record-list' }, recordRow('No Hands'));
  await capture('pagination_loading');
  await proxy.release();
  await waitAbsent(device, { res: 'pull-up-activity-indicator' });
  // 人工挂起期间请求可能已超时；离开再回到分页阈值，通过真实滚动恢复加载。
  // 已完成分页时应用会正常忽略再次触底，不重置数据或修改应用请求时钟。
  await scrollRecords(device, false);
  await scrollRecords(device, true);
  await reveal(device, recordRow('Long Room Name ABCDE'));
  await scrollToEnd(device, { res: 'my-game-record-list' }, recordRow('Long Room Name ABCDE'));
  await capture('pagination_end');
  await proxy.mode('list');
  await reopenRecords(device);
  await device.wait(recordRow('Private Texas'));
  expect(await exists(device, recordRow('Club Cards'))).toBe(false);
  await capture('reopen');
}

/**
 * 覆盖新版列表错误、真实重试和详情错误，核对代理确实收到故障请求。
 * @param device - 专用模拟器连接。
 * @param proxy - 共享 Web 战绩代理。
 * @param capture - 截图回调。
 */
export async function v2RecordErrors(device: AndroidDevice, proxy: RecordProxy, capture: Capture): Promise<void> {
  await proxy.mode('list-error');
  await device.input.press('Back');
  await tap(device, 'game-record');
  await waitRecordAlert(device, 'Request failed with status code 503');
  await capture('list_failure');
  const faults = (await proxy.status()).faultRequests;
  expect(Object.values(faults).reduce((sum, count) => sum + count, 0)).toBeGreaterThan(0);
  await proxy.mode('list');
  await recordDialog(device);
  await device.wait(recordRow('Private Texas'));
  await capture('retry_success');
  await proxy.mode('detail-error');
  await pressRecordControl(device, recordRow('Private Texas'));
  await waitRecordAlert(device, 'Visual record service unavailable');
  await capture('detail_failure');
  await recordDialog(device);
}
