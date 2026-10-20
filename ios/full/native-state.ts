// 原生可见性查询只把 no-such-element 视为不存在。
import type { NativeDevice, NativeSelector } from './native-device';
export async function exists(device: NativeDevice, selector: NativeSelector): Promise<boolean> {
  try { await device.info(selector); return true; }
  catch (error) { if ((error as { code?: string }).code === 'no such element') return false; throw error; }
}
export async function waitAbsent(device: NativeDevice, selector: NativeSelector) { await device.wait(selector, { state: 'gone' }); }
