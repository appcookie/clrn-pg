# clrn-pg — iOS 模拟器回归

与 [clrn-az](https://github.com/albitsj/clrn-az) 对应，直接下载 [clrn Release](https://github.com/kevinanew/clrn/releases) 的 `ios-staging-simulator.zip`，不检出应用源码、不构建 React Native、不需要应用配置密钥。`deployments/ios-staging.json` 固定待测版本；下载时验证 Release 身份、构建提交、包大小和 SHA-256，解压后验证 bundle ID、版本及 Mach-O 的 IOSSIMULATOR 平台。

首批覆盖游客大厅、消息、私人房、俱乐部、我的和登录欢迎页。每页检查原生可访问性标识，保存 PNG 和原始 MP4，并从视频的 0.5～3.5 秒区间抽取六张动画帧。录制等待 8 秒，为 CI 编码器首帧延迟留出余量；缺帧仍会失败。失败时保留截图、页面层级、Appium 日志和 JSON 报告。

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

## Web / Android 全量迁移

完整清单及原生验证状态见 [docs/coverage.md](docs/coverage.md)。`ios/full/` 覆盖共享静态场景、德州/拼三张/战绩状态、转场和素材动画，并加入 Web 的 60 个功能、8 个交互和 3 个弱网案例。代码收集通过不等于这些原生用例已经通过；运行证据以相应业务组的 CI 报告为准。

```sh
npm run check         # TypeScript、算法/协议/清单契约与实际用例收集
npm run check:python  # 先安装 e2e/mitmproxy/requirements.txt 到 e2e/.venv
```

完整原生测试通过「iOS 完整回归」工作流运行。每个 job 明确一个 `IOS_GROUP`，全量模式拆成三语言、业务组和牌桌分片。代理仅允许 GitHub 托管临时 macOS runner，保存并恢复系统代理；本机默认拒绝更改日常网络。

游客组每种语言拆成两个 job：`pages` 执行 18 个页面，`startup` 执行其余启动、动画、认证和资产用例。英语共 25 项、简中 21 项、繁中 20 项，各项恰好执行一次；启动失败不会阻止页面 job，整体最多并行 5 个 job，每个 job 仍只启动一个模拟器。

普通功能组的 53 例使用 Playwright 原生分片分成 5 个 job（11 / 11 / 11 / 10 / 10 例），各自分配账号槽位。仅该组开启按测试分片，每个 job 仍以一个 worker 顺序执行；多账号用例按需创建额外的独立模拟器。账号较少时，相同账号的 job 通过账号锁排队。创建、交互和弱网组保持原有独立 job。

游客组不需要凭据。登录组需要仓库 Secret `CLRN_IOS_CI_TEST_ACCOUNTS`（至少一个独立 iOS 测试账号），以及余额准备/创建数据所需的 `TESTING_API_TOKEN`。账号池格式为 `{"accounts":[{"username":"clrnciios001","password":"实际密码","status":"ready"}]}`；只配置确实已创建的账号，禁止借用 Web/Android 并发占用的账号。账号级排队锁保证同一账号不会被多个 job 同时使用。

未配置凭据时，PR 明确只运行游客矩阵，并在 Actions summary 记录未运行的登录/创建组。配置两项 Secrets 后，PR 默认展开完整矩阵；手动选择 all 但缺凭据会直接失败。`smoke` 保留语义/运动断言及原始证据，首次 `reference` 输出须审查后入库，后续 `compare` 才进行版本视觉比较。不会自动接受变化或用跳过充当业务通过。

全量覆盖契约按三语言逐个核对 Web 的 91 个流程/260 个状态，并为 21 项动画关联实际注册的原生执行入口。英文升级提示以真实动态关键帧替代同名静态图；Web 分享复制确认框映射为 iOS 系统分享面板的显示、选项和取消。新增简体中文游客搜索、匹配面板入场和独立品牌淡入检查，保存原始录屏与关键帧。这些新增用例目前仅完成类型、算法和收集检查，尚待完整模拟器任务验证；详细映射和限制见 [覆盖说明](docs/coverage.md)。
