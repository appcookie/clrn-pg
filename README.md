# clrn-pg — iOS 模拟器回归

与 [clrn-az](https://github.com/albitsj/clrn-az) 对应，直接下载 [clrn Release](https://github.com/kevinanew/clrn/releases) 的 `ios-staging-simulator.zip`，不检出应用源码、不构建 React Native、不需要应用配置密钥。`deployments/ios-staging.json` 固定待测版本；下载时验证 Release 身份、构建提交、包大小和 SHA-256，解压后验证 bundle ID、版本及 Mach-O 的 IOSSIMULATOR 平台。

首批覆盖游客大厅、消息、私人房、俱乐部、我的和登录欢迎页。每页检查原生可访问性标识，保存 PNG、4 秒 MP4，并抽取六张动画帧。失败时保留截图、页面层级、Appium 日志和 JSON 报告。

## 本机运行

需要 macOS、Xcode、iOS Simulator runtime、Node.js 24、GitHub CLI 和 ffmpeg。使用专用模拟器，测试会安装应用并清理应用状态。

```sh
npm ci
npm run check
node ios/download-release.mjs --simulator
APPIUM_HOME="$PWD/.appium" npx appium driver install xcuitest@12.19.1
IOS_SIMULATOR_UDID=<专用模拟器 UUID> npm run test:ios
```

产物位于 `ios/artifacts/results/`。`IOS_FILTER` 是页面名称正则，例如 `IOS_FILTER='guest-message|guest-me'`。

## 视觉与动画基准

`IOS_VISUAL_MODE` 支持：

- `smoke`：页面断言、截图和录屏采集，默认模式，不代表视觉基准已通过。
- `reference`：额外将截图、MP4 和采样帧写入 `ios/snapshots/<设备型号及系统>/`，用于人工审查。
- `compare`：与已提交的同型号、同系统基准比较；缺少基准也会失败。静态截图和六张动画帧逐一比较，输出变化比例和 diff PNG；每通道允许 12/255 的编码误差，最多允许 0.1% 像素变化。

首次运行 reference 后，从 Actions 产物取回 `snapshots/`，审查并提交，再用 compare 验证后续 Release。不会自动把新版本覆盖成基准。动画按页面就绪后的相对时间采样，当前比较对循环动画的起始相位和网络内容敏感，需要查看 MP4/diff 判断原因；不覆盖页面切换过程或精确动画性能检测。原始 MP4 可用于人工对照。

## CI

PR、master 推送及手动运行均执行公开包校验和真实模拟器任务，无需自定义 Secrets。固定 macOS 15 / Xcode 16.4 / iPhone 16 / iOS 18.5，避免自动选设备造成基准漂移。截图、MP4、帧序列、日志、报告和 reference 产物保存 30 天；长期基准需审查后入库。手动运行可选择模式和页面过滤条件。

扩展页面见 `ios/scenarios.mjs`；更新应用只需修改部署记录，不需要修改业务代码。
