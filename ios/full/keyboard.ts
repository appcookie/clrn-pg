// 收起真实 iOS 键盘，并要求原生可访问性树确认隐藏。
import type { NativeDevice } from './native-device';
export async function dismissKeyboard(device: NativeDevice) { await device.hideKeyboard(); }
