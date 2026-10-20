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

本节描述 `npm run test:ios` 基础冒烟脚本；完整 PR 动画门禁使用下文的 `ios/full/`，默认自动执行 `compare`。基础脚本的 `IOS_VISUAL_MODE` 支持：

- `smoke`：页面断言、截图和录屏采集，默认模式，不代表视觉基准已通过。
- `reference`：额外将截图、MP4 和采样帧写入 `ios/snapshots/<设备型号及系统>/`，用于人工审查。
- `compare`：与已提交的同型号、同系统基准比较；缺少基准也会失败。静态截图和六张动画帧逐一比较，动画截图仅保留英文，输出变化比例和 diff PNG；每通道允许 12/255 的编码误差，最多允许 0.1% 像素变化。

首次运行 reference 后，从 Actions 产物取回 `snapshots/`，审查并提交，再用 compare 验证后续 Release。不会自动把新版本覆盖成基准。动画按页面就绪后的相对时间采样，当前比较对循环动画的起始相位和网络内容敏感，需要查看 MP4/diff 判断原因；不覆盖页面切换过程或精确动画性能检测。原始 MP4 可用于人工对照。

## CI

`ios-simulator.yml` 是无需自定义 Secrets 的基础冒烟工作流。PR、master 推送还会执行 `ios-full.yml` 的完整动画门禁，其中登录动画需要下文列出的测试账号 Secrets；基础冒烟通过不能代替该门禁。固定 macOS 15 / Xcode 16.4 / iPhone 16 / iOS 18.5，避免自动选设备造成基准漂移。截图、MP4、帧序列、日志、报告和 reference 产物保存 30 天；长期基准需审查后入库。手动运行可选择模式和页面过滤条件。

扩展页面见 `ios/scenarios.mjs`；更新应用只需修改部署记录，不需要修改业务代码。

## Web / Android 全量迁移

完整清单及原生验证状态见 [docs/coverage.md](docs/coverage.md)。`ios/full/` 覆盖共享静态场景、德州/拼三张/战绩状态、转场和素材动画，并加入 Web 的 60 个功能、8 个交互和 3 个弱网案例。代码收集通过不等于这些原生用例已经通过；运行证据以相应业务组的 CI 报告为准。

```sh
npm run check         # TypeScript、算法/协议/清单契约与实际用例收集
npm run check:python  # 先安装 e2e/mitmproxy/requirements.txt 到 e2e/.venv
```

完整原生测试通过「iOS 完整回归」工作流运行。每个 job 明确一个 `IOS_GROUP`，全量模式拆成三语言、业务组和牌桌分片。代理仅允许 GitHub 托管临时 macOS runner，保存并恢复系统代理；本机默认拒绝更改日常网络。

游客组每种语言拆成两个 job：`pages` 执行 18 个页面，`startup` 执行其余启动、动画、认证和资产用例。英语共 25 项、简中 20 项、繁中 20 项，各项恰好执行一次；启动失败不会阻止页面 job，整体最多并行 5 个 job，每个 job 仍只启动一个模拟器。

普通功能组的 53 例使用 Playwright 原生分片分成 5 个 job（11 / 11 / 11 / 10 / 10 例），各自分配账号槽位。仅该组开启按测试分片，每个 job 仍以一个 worker 顺序执行；多账号用例按需创建额外的独立模拟器。账号较少时，相同账号的 job 通过账号锁排队。创建、交互和弱网组保持原有独立 job。

游客组不需要凭据。登录组需要仓库 Secret `CLRN_IOS_CI_TEST_ACCOUNTS`（至少一个独立 iOS 测试账号），以及余额准备/创建数据所需的 `TESTING_API_TOKEN`。账号池格式为 `{"accounts":[{"username":"clrnciios001","password":"实际密码","status":"ready"}]}`；只配置确实已创建的账号，禁止借用 Web/Android 并发占用的账号。账号级排队锁保证同一账号不会被多个 job 同时使用。

PR 和 master push 默认以 `compare` 运行三语言游客矩阵，以及 `ios/full/animation-gate-cases.json` 中的全部 24 个英文动画分片，覆盖 21 项 Web 动画映射、原生后续分片和账号页面入栈/出栈。每个动画 job 必须实际运行指定用例、通过视觉与运动断言，并提供清单内的全部 PNG 和录屏；缺账号、缺基准、测试跳过或重试均不能通过。固定名称 `iOS animation gate` 汇总所有分片，任一失败、取消或未运行都会失败。管理员还须在 master 分支保护中将该检查设为必需检查，否则 GitHub 不会强制阻止合并。

完整动画基准仍在补齐：24 个分片中 12 个已有完整已审查基准，覆盖游客启动/搜索/品牌、俱乐部菜单及牌局空态、私人房邀请、游戏选择抽屉、老虎机、匹配弹窗及转圈、俱乐部骨架、系统分享面板和账号页入栈/出栈。本轮实际新增 67 张原始 PNG。私人房邀请、搜索弹层、游戏选择抽屉、俱乐部骨架已分别通过独立 CI compare（39462205692、39466032732、39477436312、39482894351），零跳过/重试。其余条目的 `images: []` 表示尚未完成基准采集，**预检会主动失败**；仍须补齐后完成全量 compare，不能据此声称全部动画已验证，也不能用删除门禁条目、跳过账号准备或自动接受截图绕过。

手动 `group=animations` 可独立执行所有英文动画；仅手动诊断允许指定 `animation_case=animation-编号`，不能缩减 PR 门禁。`group=all` 还包括其他业务和功能测试。`smoke` 保留语义/运动断言及原始证据，首次 `reference` 输出须审查后入库，`compare` 进行版本视觉比较。普通比较运行不会修改基准。

完整回归的参考图只使用 `ios/snapshots/v1/<module>/<page>/<state>/ios/iphone16-ios18.5/<locale>/<kind>/<sample>.png`，可被 `laiwan_screenshot` 直接读取。已通过的 `smoke` CI 报告也可用 `node ios/full/export-candidates.mjs <新目录> <下载后的 artifact 目录>...` 导出真实候选；工具核对所有测试通过、同一 Release 与每张 PNG，并标记 `unreviewed`。逐图审查后将候选的 `v1/` 放入 `ios/snapshots/v1/`；PR 的 `compare` 会自动运行，缺少基准会在分配 macOS runner 前失败。当前 Staging 提示卡 CTA 被遮挡属于已记录的发布包布局缺陷，保存其真实参考图不代表认可该布局。

PR 游客矩阵现在要求 **77 张本轮截图**（英文页面 18 / 启动 19，简中和繁中各页面 18 / 启动 2）。独立验收清单同时核对基准预检、实际测试身份及报告附件；缺图、缺录屏、测试删除/跳过、损坏 PNG 或附件文件丢失都会失败。不能通过只删 `review.json` 条目让缺失基准通过预检。登录业务组不包含在这 77 张游客截图内。

本轮截图在每个 job 的 Summary 中提供下载入口，产物名为 `ios-current-screenshots-<语言>-<分片>-<attempt>`。解压后打开 `index.html` 可逐图查看，`v1/` 可供截图中心读取，`manifest.json` 记录本轮 CI、发布包及原图 SHA-256。`compare` 使用已有基准并发布新采集结果，不会自动改写仓库基准；所以 PR 文件差异中不一定有新增 PNG。手动导出也支持 compare 转场中没有 `.png` 后缀的关键帧，以及 Actions 实际下载的目录结构。

全量覆盖契约按三语言逐个核对 Web 的 91 个流程/260 个状态，并为 21 项动画关联实际注册的原生执行入口。英文升级提示以真实动态关键帧替代同名静态图；Web 分享复制确认框映射为 iOS 系统分享面板的显示、选项和取消。游客搜索动画统一使用英文并验证关闭后重开，保留匹配面板入场和独立品牌淡入检查，保存原始录屏与关键帧。类型与 `--list` 检查只证明代码和登记完整，不能代替实际运行。详细映射和限制见 [覆盖说明](docs/coverage.md)。

短动画必须在原生录像中找到符合已审查轨迹的真实中间帧，整段视频帧数多并不足以证明动画被采全。`*-reviewed-middle-comparison` 附件记录候选帧时戳、与首尾的归一化像素距离、空间比较和逐项拒绝原因；这些距离不是透明度或动画时间百分比。缺失中间相位仍然失败，不自动放宽阈值、不自动重跑，也不把接近终态的帧更新为新基准。录屏缺相位本身不能区分采集丢帧和应用绘制跳变，须结合真实录像及复现定位。

英文搜索已通过 XCTest 原生录屏的独立 CI compare（运行 39466032732），沿用原有六张基准和比较阈值。搜索、老虎机、选玩法抽屉和系统分享面板显式选择 XCTest 采集；记录请求帧率和实际编码时戳，原始 MOV 保留并无损封装为 MP4。请求 60 fps 不等于保证每秒都有 60 个不同画面，仍须通过真实首尾和中间相位断言。
