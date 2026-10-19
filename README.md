# clrn-pg — iOS 模拟器回归

本仓库与 [clrn-az](https://github.com/albitsj/clrn-az) 对应，测试来玩 Staging 的 iOS 原生界面。应用源码留在私有的 `laiwan_react_native`，测试只通过公开的 iOS Release 锁定应用提交，再从该提交构建 **iOS Simulator `.app`**。Release 中的 `.ipa` 是真机包，不能安装到模拟器。

目前先覆盖游客大厅、消息、私人房、俱乐部、我的以及登录欢迎页。测试通过 React Native `testID` 在 XCUITest 可访问性树中的标识定位，验证页面就绪并保存完整截图。`smoke` 模式验证导航和截图采集；`reference` 生成待人工审查的基准；`compare` 逐像素比较已提交的基准。后续页面可在 `ios/scenarios.mjs` 中继续添加。

## 本机运行

需要 macOS、Xcode、已安装的 iOS Simulator runtime、Node.js 24，以及能够访问应用源码仓库的凭据。先在应用仓库执行其依赖准备（Yarn、CocoaPods），并按 Staging 配置构建 Release 模拟器 `.app`。本仓库不会改动应用代码。

```sh
npm ci
npm run check
node ios/download-release.mjs
npx appium driver install xcuitest@12.19.1
IOS_APP_SOURCE_DIR=../laiwan_react_native node ios/build-simulator.mjs
IOS_SIMULATOR_UDID=<专用模拟器 UUID> npm run test:ios
```

运行前脚本会检查 `.app` 的 bundle identifier、模拟器架构、源提交和 Release 元数据。只有指定 UUID 的模拟器会被启动和安装应用。截图及失败时的页面层级保存在 `ios/artifacts/results/`，均不提交。截图模式通过 `IOS_VISUAL_MODE=smoke|reference|compare` 设置；只有人工审查后，才将 `reference` 产物加入 `ios/snapshots/` 并用 `compare` 复核。

## CI

工作流在 `master` 推送、PR 和手动调用时运行 Node 检查及公开 Release 身份校验。模拟器任务需要 `APP_SOURCE_TOKEN`（只读私有应用仓库）、`IOS_STAGING_ENV_FILE`（应用 Staging `.env`），以及已安装 iOS Simulator runtime 的 macOS runner。配置完成后将仓库变量 `IOS_SIMULATOR_ENABLED` 设为 `true`，即可在同一工作流中开启自动原生任务；手动调用也会执行。凭据未就绪时 PR 只运行公开检查，原生任务显示为跳过，不能据此声称页面已通过。模拟器任务检出 Release 对应应用提交并运行构建与页面测试，报告始终作为 Actions 产物保存。初期默认 `smoke`，待基准审查入库后可切换 `compare`。
