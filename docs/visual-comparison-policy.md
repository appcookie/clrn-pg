# 截图与动画比较清点（Issue #27）

检查基线为 `026e21ecd6ac31edcd66d55eb44323cee39ea8f1`，2026-10-29。
项目内没有 AGENTS.md、AGENTS.txt、DEVELOPMENT.md；适用说明为 README.md、
`ios/full/quarantined/README.md`、`docs/coverage.md` 和两个 iOS 工作流。
本轮没有合并冲突或预先存在的修改，也没有修改应用仓库。

## 当前画面与基准更新

普通截图顺序统一为：进入明确业务状态 → 固定截图来源和有效区域 → 等待画面稳定 →
保存原图、遮罩及排除区域证据 → 比较该环境、语言、状态的一个当前基准。
基准不符时直接失败，不换截图来源、不追加排除区、不重放动作。

先区分失败原因，再决定是否更新图片：

| 原因 | 处理 |
| --- | --- |
| 已确认的预期应用变化 | 固定 Release、应用提交、网络夹具、设备和语言；采集真实 reference 候选，逐图审阅 actual/diff 后替换对应当前基准，再执行完整 compare |
| 应用缺陷 | 保留失败及证据，记录应用问题；不能更新基准掩盖，也不在本仓库修改应用 |
| 测试缺陷 | 修复采集或就绪逻辑，保留原比较阈值及业务断言，再验证 |
| 环境问题或原因未知 | 保存日志、原图和原片，保持未通过；不接受候选图片 |

`assertVisual` 的 reference 分支原本就直接保存当前采集图，本轮增加回归保护：
即使新旧图差异小于 0.5%，reference 也不把旧图恢复回来。
compare 只读基准，不自动接受变化。旧版本由 Git 历史保存，同一状态不同时接受旧、新静态图。
README 中的人工审阅流程继续适用；`docs/coverage.md` 中“reference 重写所选状态”
与此一致。该文档导入的 Linux/H5/Android 采集说明不是本仓库 iOS 基准的批准证据。

## 比较入口、来源与重试

| 入口及调用方 | 目的与现有证据 | 决定 |
| --- | --- | --- |
| `ios/run.mjs` → `comparePixels` | 基础六页冒烟；XCTest 静态图和 `ios/recording.mjs` 的六个时间采样帧 | 保留独立冒烟范围，不冒充完整门禁 |
| `device.ts::assertVisual` | 完整回归的采集、reference 写候选、compare 读一个当前基准；缺图/尺寸不符/无有效像素失败 | 保留，统一附上实际排除区 |
| `device.ts::compareScreenshot` | parity、auth、俱乐部、战绩、牌桌、启动页及匹配场景的稳定截图 | 保留就绪轮询：普通 1500ms、短时状态 250ms、最长30s；稳定后只做一次基准比较 |
| 默认 `device.screenshot()` | XCTest；parity/auth/俱乐部/战绩和普通牌桌原有来源 | 保留；不根据比较结果改变 |
| 显式 `takeScreenshot` | 启动页 `fullScreen`、匹配与短时牌桌 `gameScreenshot` 使用 Simulator；启动页额外核对尺寸 | 保留，在采集前由调用方选择；`native-device.ts` 仍只允许裁掉一行/列，不能缩放适配 |
| `nativeFallback` | 旧代码在 XCTest 图不符后尝试 Simulator，仅在后者匹配时替换；同时增加 Dynamic Island 排除区 | 删除。合成图已复现稳定的错误 XCTest 图被替换后误通过；这不是对历史真实截图裁切原因的结论 |
| `_alternateSnapshots` | 普通截图未使用的占位参数，调用方仅传 `[]` | 删除，所有配置改成具名选项，避免相邻数组和布尔值错位 |
| `animation-transition.ts`、`loop-keyframes.ts`、`asset-sequence.ts`、`game-animation.ts` | 原片中选择有语义的相位或区域，与静态截图分开 | 保留；动画覆盖映射见下表 |
| `video-frames.ts` | 动作前确定 XCTest/simctl 后端和30/60fps；注释逐项列出历史缺帧、PTS倒退的运行编号 | 保留既有平台适配，不在失败后挑选后端；本轮未重新审阅这些原片 |
| `loop-keyframes.ts` 的采样窗口 | 默认1次；老虎机横幅显式最多5个窗口以观察慢速自动轮播；已有原片只能分析一次 | 保留原上限，不增加尝试，不将稳定性轮询当回归重试 |
| `playwright.config.ts` | `retries: 0`、`updateSnapshots: 'none'` | 保留；CI不自动恢复失败或批准基准 |

## 遮罩及排除区域

以下为按用途列出的规则，不是本轮新增许可。表中“保留”表示没有足够证据证明可等价删除，
不表示已批准其当前真实画面。`screenshot.ts` 继续拒绝超过全屏12%的遮罩，
未校准布局不生效；局部截图沿用原全屏面积限制和真实裁图坐标。

| 规则/调用方 | 目的、边界与代码证据 | 决定与验证 |
| --- | --- | --- |
| `screenshotMasks` / parity、俱乐部、匹配 | 版本、服务器、签到日期的真实文本框；槽机横幅三个自动轮播图案 | 保留；文字、布局和按钮仍比较，不能扩成整个横幅 |
| `focusedCaretMask` / 输入场景 | 两帧识别窄竖线，键盘移动只平移光标位置；最多12个既有错相采样间隔 | 保留；`caret-mask.test.mjs` 拒绝文字块或框外变化 |
| `record-navigation.ts` / 加载态 | 已断言存在的原生 spinner；分页截图前后检查仍加载 | 保留，不接受超时后的空白 |
| `game-capture.ts` / 牌桌动态控件 | 原生网络数值/图标、房间UUID、玩家ID、各倒计时、座位箭头全运动范围；固定房号另作精确断言 | 保留；`game-masks.ts` 集中几何和前景裁剪，`game-masks.test.mjs` 等保护面板、按钮及牌面 |
| `modal-background-masks.ts`、`texas-raise-masks.ts` / 牌桌弹窗和加注 | AX隐藏但仍绘制的背景时钟、ping；按实际前景面板、轨道、刻度、滑块和按钮裁除遮罩 | 保留，现有单测覆盖前景缺陷及错误布局；不凭AX隐藏扩大遮罩 |
| `game-capture.ts` 的4类比较排除 | backgroundMasks、拼三张quick-raise的下一行动玩家、旧图countdown-text、英文card-rank的指示条/箭头边缘 | 暂留原范围。本轮集中在报告中记录；其中仅为兼容旧图的规则优先待同构建逐图采集审阅后删除，不再追加 |
| `launch-pages.spec.ts` 的Home indicator | 系统指示条，屏幕比例固定小区域 | 保留原范围及屏幕尺寸检查，实际图与排除区一起保存 |
| `matchingModalMotionMasks` / 匹配转场 | `matching-mask-reference.json` 记录运行39478679178的面板和旋转图标固定框；中心偏离或布局变化失败 | 保留；计时数字单独排除，旋转图标独立动画检查不删除；PR只录屏的限制见下文 |
| `animation-transition.ts` 端点动态值 | `accurateBetEndpointMasks`、`ownProfileIdentityMask`、`alertEndpointClockMasks`、两种操作时钟、`texasRaiseClockMasks/ValueMask`、`texasEffectEndpointMasks`、`reviewEndpointNetworkMasks`、座位箭头和排行榜UUID | 保留；仅端点，原片及目标运动帧不被这些端点遮罩改写；对应 `*-region.test.mjs` / `*-masks.test.mjs` 继续检查边界 |
| 转场历史特例 | chat-report的固定时钟数字框、拼三张排行榜退场Home indicator；`animation-transition.ts` 注明运行39886064246 | 暂留，待当前构建真实原片与端点逐图审阅，不能凭注释当本轮批准 |
| `game-loading-region.ts`、`launch-artwork.ts`、品牌淡入 | 分开检查圆环/中心黑桃、启动插画可见区域、品牌固定位置淡入；排除独立遮挡 | 保留分别的目标运动/画面断言，不能合并成忽略整个区域 |
| 失败后追加Dynamic Island | `compareScreenshot` 内部固定379×114区域，调用方事先不知有效区域会变化 | 删除，合成回归确认该区域里的超差变化仍会失败 |

## 动画参考帧与覆盖映射

| 入口 / 调用方 | 必须保留的覆盖 | 备用相位与决定 |
| --- | --- | --- |
| `captureNativeTransition` / 面板、导航、发牌等 | 独立起点、中途、终点、真实时间戳、候选离首尾距离、区域运动和业务就绪；局部按钮/牌面/轨迹各自检查 | start/end/videoPhaseAnchors 三个显式参数保留；拼三张翻牌有一个实际 alternate.png，由 `zhajinhua-gameplay.ts` 引用。没有原片审阅，不能删除并宣称覆盖等价 |
| `compareAnimationEndpoint` | 12通道容差和0.5%差异，所有候选使用相同规则；尺寸不符失败 | 保留多候选接口，调用方的可选端点目前无新增；终点不替代中途运动 |
| `captureMovingKeyframes` / 箭头、倒计时、spinner、横幅、弹幕 | 每个控件实际运动，first/moved两种不同相位，已有原片不重采 | 保留 phaseAnchors；`barrage-motion.ts` 显式提及的 first-alternate 当前无对应入库文件，不能据此声称审阅过；后续统一审阅再处理 |
| `captureAssetSequence` / 表情与道具 | 背景、peak、changed、播放结束恢复；飞行区另查至少两个不同位置 | 保留 peak/changed 的可选alternate及飞行alternate/alternate-2读取；当前均无入库文件，不新增；素材内容与空间轨迹不能互相替代 |
| `game-pregame.ts` → `panelAnimation` | 买入申请中途变暗及面板绘出 | 显式middle-alternate当前无入库文件，暂留调用契约，未增加可接受相位 |
| toast / level-up / prediction | 同次触发、真实可见稳定时长、文案和首中尾、消失恢复；`toast-keyframes.ts`、`prediction-result.ts` 等 | 保留原要求，无新增备用图或重试 |

清单仍为25组；当前PR只运行20组录屏、5组隔离，详见隔离目录。
`IOS_ANIMATION_RECORD_ONLY=1` 时不执行完整运动/相位诊断；本轮没有改变这一既有状态。
因此PR的MP4有效不能算上述完整动画覆盖已通过。本轮未删除任何动画断言，
也未把转场改成只有起止两图。后续精简必须先提供真实原片与逐项覆盖等价审阅。

## 修改前后数量及验证边界

| 口径 | 修改前 | 修改后 |
| --- | --- | --- |
| `ios/snapshots/v1` 的PNG | 701（page 163，animation 538） | 701，字节均未修改 |
| 含alternate文件名的入库PNG | 1（拼三张翻牌） | 1 |
| 普通截图可用备用基准 | 0（参数未使用） | 0（删除参数） |
| 普通截图比较失败后换源路径 | 1 | 0 |
| 上述换源路径中的if判断 | 4（启用模式、初图失败、设备尺寸、备用图成功） | 0 |
| 上述路径追加的排除区域 | 1 | 0 |
| compareScreenshot参数个数 | 9 | 4，配置集中到具名options |
| 牌桌原有比较排除类别 / 启动页类别 | 4 / 1 | 4 / 1，无扩大 |
| 动画基准候选读取与特定运动比较 | 保留既有实现 | 无变化，不宣称整体复杂度已完成收敛 |

合成回归先在基线实现复现：稳定XCTest图有明显变化，但Simulator图等于基准时，
旧入口替换截图后通过。修复后同样变化失败，保留actual/diff且不调用备用来源。
新增测试还检查固定来源、遮罩外缺陷、排除区域外缺陷和有效面积、缺图、尺寸、
全排除失败、reference真实覆盖及compare不改基准。合成PNG与构建身份只写独立临时目录。

本轮本地验证：从已有缓存离线 `npm ci` 成功；TypeScript通过；截图比较、容差、
裁图遮罩、弹窗背景与动画终点的22项针对性测试全部通过；实际用例收集184项通过，
不代表Simulator执行通过。全量 `npm run check` 的首次单测运行503项中483项通过、
20项因 `listen EPERM 127.0.0.1` 失败（此后补充的reference回归已包含在上述22项中）。
Python虚拟环境创建成功，但pip未能取得mitmproxy 12.2.3，`check:python` 因缺少该模块失败。
完整固定检查及原生运行交给宿主，不把这些结果报告成全绿。

当前基线的 [完整回归40690449375](https://github.com/appcookie/clrn-pg/actions/runs/40690449375)
仍失败。已取得两个失败原生job及汇总job的完整日志（918/972/232行）；
日志显示固定Release `ios-staging-36-1-c3ff78c66c7a`，应用提交
`c3ff78c66c7aedd586a66c9b09e8849497565365`，Xcode16.4、iPhone16/iOS18.5配置。
animation-15为建房HTTP0，animation-22为排行榜未出现，都在截图比较前失败。
这些分别属于既有建房/排行榜调查范围，本轮不改变其网络或点击逻辑。

失败产物ID为12821067946、12821894690。下载接口已返回文件引用，
但本地下载被沙箱DNS限制，**尚未查看其中截图、录像、report.json及build-info.json**，
日志中的构建声明不能代替这些文件核验。未得出应用缺陷/环境问题的最终归因，未批准任何新图。
基线失败也不能证明本轮未发布改动的结果；宿主须针对发布后的实际提交跑固定检查及原生compare，
补齐截图、diff、原片和完整构建身份，先保留未通过状态。本轮完成静态比较回退修复，
动画相位收敛、旧遮罩迁移和真实基准更新仍待上述证据，不视为Issue全部验收完成。
