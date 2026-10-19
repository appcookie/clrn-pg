import { waitAbsent } from './native-state';
import { expect, type TestInfo } from '@playwright/test';
import type { NativeDevice as AndroidDevice, NativeSelector as AndroidSelector } from './native-device';
import type { ScreenshotMask } from './screenshot';
import { compareScreenshot } from './device';
import { reveal, tap } from './navigation';
import type { VisualScenario } from '../../visual/scenarioTypes';

/**
 * 通过与 Web 相同的房名定位原生记录行。
 * @param name - 共享夹具中的房名。
 */
export function recordRow(name: string): AndroidSelector {
  // Playwright Android 的 hasDescendant 在 Java 驱动中没有解包子选择器。
  // 两版均直接定位可见房名，正常点击由其所属记录行处理。
  return { res: 'room-name-text', text: name };
}

/**
 * 等待复合选择器可见，并点击其实际边界中心。
 * @param device - 专用模拟器连接。
 * @param selector - 原生控件条件。
 */
export async function pressRecordControl(device: AndroidDevice, selector: AndroidSelector): Promise<void> {
  await reveal(device, selector, true);
  const { bounds } = await device.info(selector);
  await device.input.tap({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
}

/**
 * 在真实战绩列表中滚动，不修改应用状态。
 * @param device - 专用模拟器连接。
 * @param end - 是否向列表末尾滚动。
 */
export async function scrollRecords(device: AndroidDevice, end: boolean): Promise<void> {
  const { bounds } = await device.info({ res: 'my-game-record-list' });
  const horizontal = String(Math.round(bounds.x + bounds.width * 0.95));
  const top = String(Math.round(bounds.y + bounds.height * 0.2));
  const bottom = String(Math.round(bounds.y + bounds.height * 0.85));
  await device.input.swipe({ x1: Number(horizontal), y1: Number(end ? bottom : top), x2: Number(horizontal), y2: Number(end ? top : bottom), duration: Number('600') });
}

/**
 * 返回当前列表入口并再次打开，重新读取代理中的状态。
 * @param device - 专用模拟器连接。
 */
export async function reopenRecords(device: AndroidDevice): Promise<void> {
  await device.input.press('Back');
  await device.wait({ res: 'game-record' });
  await tap(device, 'game-record');
  await device.wait({ res: 'my-game-record-list' });
}

/**
 * 截图顺序与共用状态清单一致；错误弹窗不能冒充正常页面。
 * @param device - 专用模拟器连接。
 * @param scenario - Web 场景及其状态清单。
 * @param testInfo - 当前报告。
 * @param states - 本轮要求的状态序列。
 */
export function recordSnapshots(device: AndroidDevice, scenario: VisualScenario, testInfo: TestInfo, states: readonly string[]) {
  let index = 0;
  return {
    /**
     * 验证当前状态并保存原生截图。
     * @param state - 共享状态名称。
     */
    capture: async (state: string) => {
      expect(state).toBe(states[index++]);
      expect(scenario.snapshotStates).toContain(state);
      await waitAbsent(device, { res: 'alert-message-text' });
      if (!['delete_confirm', 'delete_blocked', 'delete_failure', 'list_failure', 'detail_failure'].includes(state)) {
        await expect.poll(() => device.alertText()).toBeNull();
      }
      const masks: ScreenshotMask[] = [];
      let assertLoading: (() => Promise<void>) | undefined;
      if (['loading', 'pagination_loading'].includes(state)) {
        const spinner = await device.info({ clazz: 'XCUIElementTypeActivityIndicator' });
        masks.push({ ...spinner.bounds, reason: '加载场景仅遮罩已断言存在的旋转进度图案' });
        if (state === 'pagination_loading') {
          /** 原生请求保留真实截止时间；每帧确认仍在加载，不能把超时后的空白当加载态。 */
          assertLoading = async () => {
            const current = await device.info({ res: 'pull-up-activity-indicator' });
            expect(current.bounds).toEqual(spinner.bounds);
          };
        }
      }
      await compareScreenshot(device, `${scenario.locale}-${scenario.pageLabel.replaceAll('_', '-')}-${state.replaceAll('_', '-')}`,
        testInfo, masks, assertLoading);
    },
    /** 检查所有声明的状态确实执行。 */
    complete: () => expect(index).toBe(states.length),
  };
}
