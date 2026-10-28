# iOS 拼三张排行榜单次点击调查（#23）

## 本轮结论与边界

基线为 `026e21ecd6ac31edcd66d55eb44323cee39ea8f1`。开始时工作树干净，HEAD 与基线相同，
没有 MERGE_HEAD、冲突或已合入的主分支更新。本轮不执行合并或提交。
目标仓库没有 AGENTS.md、AGENTS.txt、DEVELOPMENT.md 或 `.codegraph/`；已核对 README.md、
`.github/workflows/ios-full.yml` 和 `ios-simulator.yml`，没有套用其他仓库规则。

隔离回归确认了测试同步缺陷：原路径在录屏预热前取得 bounds，预热期间按钮移位后，
仍点击旧中心。修改前同一测试实际点击 `(25,40)`，录制中观测次数为 0；
修改后依次观测移动位置和两份稳定位置，只点击一次 `(65,40)`。
这证明了测试路径需要修复，**不能证明旧 CI 的这次点击确实遇到坐标失效**。

本轮仅修复拼三张 `leaderboard` 入场录屏入口。真实原生恢复尚未验证；
TypeScript、隔离测试和用例收集不能替代 iPhone 16 / iOS 18.5 的实际运行。

## 已读取的 CI 证据

通过 GitHub 接口取得了[运行 40690449375 的 animation-22 作业日志](https://github.com/appcookie/clrn-pg/actions/runs/40690449375/job/122853118024)。
日志确认检出基线提交、使用 compare 与 `IOS_ANIMATION_RECORD_ONLY=1`，并下载
Release `ios-staging-36-1-c3ff78c66c7a`、应用提交 `c3ff78c66c7aedd586a66c9b09e8849497565365`。

| UTC | 日志所能证明的事件 |
| --- | --- |
| 14:14:18.509 | 开始调用 `zhajinhua-leaderboard-enter` 的 simctl 录屏流程；不是实际点击时间 |
| 14:15:34.643 | 有一次耗时 5419ms 的原生整树查询结束；日志没有把它关联到点击 |
| 14:16:33.733 | 新建房间清理完成 |
| 14:16:33.884 | 报告 `public-leader-board-empty 应可见`，断言预算 45000ms，堆栈指向 `gamePreGame` 的录后就绪检查 |
| 14:16:45.492 | 上传完整报告产物 12821894690，ZIP 摘要 `09ae044df1099330af2e368e1919b0ceacafeb153b509e14659646036905be35` |

日志列出了 recorder-process JSON、原始 MP4 和 error-context 的附件路径，
但没有该点击的请求时间、目标位置或驱动回执。末尾代理传输汇总也不能证明点击瞬间的连接状态，
不能据此将 #15 的选线限制认定为本例根因。

已调用[完整产物 12821894690](https://github.com/appcookie/clrn-pg/actions/runs/40690449375/artifacts/12821894690)的下载接口并取得 ZIP 链接，
但沙箱 DNS 无法解析下载主机，GitHub CLI 下载也无法连接 API。本轮**没有读取 ZIP 中的
原片、控件树、失败截图、录屏进程 JSON 或 build-info.json**。
Issue 提供的 1178×2556、53.795 秒、媒体采样内容及包 SHA-256
`f15b44cbbcbfc6325df5513b0ca1822db4c35ebe2113ca7aaa8d5c4d85489407`
尚未在本轮独立核实。不能用清理后的截图证明面板从未短暂出现。

## 修复与证据读取方法

- `animateGamePanel` 只为拼三张排行榜入场选择录制中的 `gameTapCurrent`。
  沿用既有的目标唯一性、真实 visible/enabled、两份稳定 bounds、重连恢复及超时即失败规则；
  落点还须位于真实屏幕内。没有补点、重启、延长原有可见性断言或修改基准。
- 原生录屏的后端、预热、3500ms 尾段与完整画面范围保持原实现。实际 tap 后不增加原生查询；
  录屏返回后仍执行原有 `gameReady(public-leader-board-empty)` 与
  `gameGone(public-leader-board-loading)`，再截图与关闭面板。
- `zhajinhua-leaderboard-enter-input` 附件记录准备、最近 16 次查询的完成 UTC、总查询数、
  固定目标标识、真实状态/边界、连接提示、实际落点、输入请求及驱动返回/失败 UTC。
  `not-requested` 表示准备阶段阻止输入，`driver-error` 表示已请求但驱动报错，
  `returned` 仅表示驱动调用返回；`applicationProcessing` 仍为 `unobserved`。
- `zhajinhua-leaderboard-enter-semantics` 在原有录后断言完成或失败后、清理前保存断言结果，
  以及一次当前面板/连接定向观测。只存固定标记、几何量和布尔值，不保存用户文字、凭据、
  完整树或错误正文。定向查询曾漏报真实节点，因此空结果不是面板不存在的独立证明；
  原有完整树断言继续决定通过与否。诊断读取失败不覆盖已有断言错误。

后续审阅应使用同一新提交、固定应用包的报告、录屏进程 JSON、上述两个附件与原片，
核对预热 → 最新稳定目标 → 单次请求 → 驱动回执 → 录后面板断言/清理的顺序。
UTC 只能关联墙钟事件；不能在缺乏媒体映射时直接作为视频 PTS。
若驱动返回而面板仍不可见，继续保留失败，结合原片和清理前控件树区分遮挡、应用未处理或短暂打开；
本仓库不能替代应用端处理日志，也不跨仓库修改应用。

## 本轮验证

新增位置变化回归先在修改前失败，再在修复后通过。
针对同步与诊断的 36 项隔离测试通过，包括稳定入口、预热移位、重连遮罩、
disabled/隐藏目标、任一样本连接超时、重复目标、定向漏报/完整树回查、
缺失原生属性、越屏落点、驱动输入失败、录后断言失败及诊断错误传播。
使用本机缓存的 `npm ci --offline` 与类型检查通过。
`npm run check` 的 508 项单元测试中，488 项通过，20 项因
`listen EPERM: operation not permitted 127.0.0.1` 失败；已查看全部失败堆栈，
涉及既有回放、截图/帧处理与 WebDriver 的本地 HTTP 监听，未修改或跳过这些测试。
因此完整检查本轮未通过，交由宿主在允许端口的环境执行固定检查。
单独执行原生用例收集成功，共 184 项、13 个文件，仅表示登记完整。
本机已创建 `e2e/.venv`，但 pip 未能取得固定的 `mitmproxy==12.2.3`（没有可用分发版本），
因此 `check:python` 本轮未执行，也由宿主按固定步骤安装后验证；未改动 Python 实现或依赖版本。
本轮未运行真实原生回归，旧失败不作为新提交的通过或失败证据；宿主仍需验证新提交及收集新原生产物。
