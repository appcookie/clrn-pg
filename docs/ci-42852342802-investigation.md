# Run 42852342802 / attempt 1

诊断指纹：`1a6e2eab9ccd9893b8994ffdf6b54057ae6604206b706438e88d4ee26b2a1907`。
读取日志前已核对 run、四个 job、attempt 1 和 PR HEAD
`d6dda1afce54847445f769c2e00135f586601923`；本地 HEAD 一致。
两个业务 job 实际检出 PR merge `58784d8`，base 为 `75a9318`。
下载使用带 run/attempt/HEAD 的新临时目录；德州首次下载 TLS 失败后换新目录，
最终仅采用成功完整下载、解压的 App 与德州产物，未使用失败或中断提取的报告。
两份构建身份均为应用提交 `c3ff78c66c7aedd586a66c9b09e8849497565365`、
Release `ios-staging-36-1-c3ff78c66c7a`、包 SHA256
`f15b44cbbcbfc6325df5513b0ca1822db4c35ebe2113ca7aaa8d5c4d85489407`。

修改前只读检查分支和相关历史，包括当前已包含的 `75a9318`、`bc11376`、
`b2e93cd`、`a1cbb67`、`9d5c64d`，以及其他分支的 `de61e61`、`005cba3`。
复用已有模拟器失败收集器、gameGone 样本收集器及 gameTapCurrent 回调；
没有重复实现 Appium 状态等待或其他控件的历史输入修复。

## App / animation-4：会话设备发现失败，待 CI 取证

[Job 129962483157](https://github.com/appcookie/clrn-pg/actions/runs/42852342802/job/129962483157)
在创建会话、尚未打开俱乐部菜单时失败。Appium 的显式 UDID 发现进入
real-device discovery，connected devices 查询失败。启动诊断中模拟器状态为
unavailable，查询错误明确为 timeout；不是已证实的设备删除。
负载为 `[145.59375,181.3642578125,182.9072265625]`，但单凭负载不能区分
runner 外部争用、测试工具残留或 CoreSimulator 自身停顿。

当前已有的 Appium /status 等待已成功，不能套用历史 42797337726 的
listener 延迟原因继续延长状态预算；前后其他分组通过也不能排除本次发现故障。
仅把已有 withSimulatorFailure 接到实际 session start，失败后收集固定工具进程数
和模拟器状态，以区分工具积累与其他阻塞。原能力、会话请求、预算和异常均保留。
根因尚未闭环，不标记为已修复或无需改动。

## App / animation-10：释放后俱乐部列表仍为错误页，待 CI 取证

[产物 13802403625](https://github.com/appcookie/clrn-pg/actions/runs/42852342802/artifacts/13802403625)
的报告显示失败在最终两个标题严格等于 TestClub1/TestClub2 的断言。
此前占位符检查、录制及 loaded 增长检查均已通过。原片首尾均为两个真实占位符，
没有网络错误；失败 accessibility 和脱敏截图则显示 club-list-load-error、Retry，
并且占位符仍在。不是仅仅 club-title 的查询标记不匹配。

当前已有 XCTest stop 后、附加及 remux 前释放响应的逻辑；不能重复实现该修复，
也不能把 loaded 增长等同于客户端成功接收响应。现有传输白名单没有这两个
俱乐部端点，无法区分客户端超时、取消与夹具完成交付的先后关系。
仅补充 /v10/club 和 /v10/clubs 的现有 HTTP 时序/来源/传输结果，查询参数和正文
不导出；测试失败时输出原 hold、占位符就绪、release 的 UTC 阶段，并复用
captureFailure 的脱敏 transport 附件。没有增加设备查询或改变采样、断言、延迟、
释放位置。下轮以这些时间与 UI 错误对齐后才能选择行为修复。

## 德州 / animation-13：已证实上游 HTTP 500，此路径无需改动

[Job 129962484213](https://github.com/appcookie/clrn-pg/actions/runs/42852342802/job/129962484213)
及[产物 13806945390](https://github.com/appcookie/clrn-pg/actions/runs/42852342802/artifacts/13806945390)
的失败前 transport 一致：请求序号 60，香港节点 /v3/pay_action/do，
21:07:31.556Z 请求、21:07:38.080Z 返回 500；mocked=false、responseSource=upstream、
fixtureLookupFailed=false、TCP/TLS 均已建立、viaProxy=false、transportError=false。
这是上游 HTTP 错误，不是历史夹具 502 或连接超时；另一分组成功建房不能推翻
本请求的 500。保留原始建房失败和禁止重复提交规则；不重试、不改选节点。
服务端内部为何返回 500 无法由仓库证据确定，本仓库没有据此修改业务代码的依据。

## 德州 / animation-19：牌谱退出未生效，待 CI 取证

同一德州产物中，牌谱退场原片首尾都完整显示 Empty games 面板，失败截图及
完整树仍有 review-board-description-text。原 gameGone 的七次样本耗时约
5–7 秒，始终 targetPresent=true、connecting=false、timeout=false。
失败前 transport 的房间连接仍 open，alive 持续收到成功应答；结束汇总中的
client close 是后续清理，不能解释失败。历史 42615049294/42735484012 的真实断线
与本轮不符，不能补点、延长预算或移除连接门禁。

关闭前观测的真实侧栏为 x=248、width=930；现有日志只有点击返回，缺少本次落点、
输入期间的实际遮罩边界和定向消失查询样本。gameGoneCurrent 已返回后，完整树
仍有面板，可能涉及 predicate 漏报；还不能认定点击失效或 UI 后来重新挂载的原因。
仅复用实际单次点击和原查询的回调记录最后两份固定控件几何、输入落点与 UTC；
原 gameGoneCurrent 复用既有 gameGone 样本诊断，并为牌谱保留成功查询样本，
区分 predicate 与 tree。没有新增查询、改变原谓词、点击位置或轮询预算。
下轮结合原片与这些记录核对实际落点及消失判据；不宣称已修复业务失败。

## 两个汇总检查：已证实无需修改

simulator（job 130153538058）明确为 PLAN/PREFLIGHT=success、NATIVE=failure。
iOS screenshot and video gate（job 130153540175）在 assertGroupsPassed 拒绝
animation-4；这是上述业务失败的汇总阻断，没有独立根因。保持所有原门禁。
由于三项原始失败仍需 CI 取证，没有生成全轮 NO-FIX 协议文件。

## 验证

- 36 项 Node 定向测试通过：控件、牌谱诊断、启动诊断；覆盖单次动作、原样本复用、
  脱敏、诊断写出失败保留成功结果或同一个原始异常。
- 17 项 Python 传输诊断测试通过，新增覆盖俱乐部路径查询参数/正文脱敏、来源与时序、响应不变。
- 类型检查、ESLint、Ruff、依赖、重复代码及德州/拼三张复杂度门禁通过；
  未扩大历史清单，既有违规的行号保持不变。git diff --check 通过。
- 未本地运行原生用例；真实失败闭环及新增证据须由 CI 取得。未提交、推送或修改 Git 引用/index。
