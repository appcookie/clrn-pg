# PR #33：run 42662045252 / attempt 1

诊断指纹：`6dff3d4552c759e7862c1bef78e7cacf840de45661ad0660b2b6f5406168142f`。
GitHub run、各 job API 和工作区 HEAD 均为 `0fa3c1c7924d3308094b34a0e0f7cb89837f5d26`。
修改前工作区干净；只读检查本地及远端已有分支和相关提交，没有改 Git index、引用或历史。
仓库没有 `.codegraph/`，未建立索引。

## 已取得的本轮证据

日志及附件下载到新建目录 `/tmp/pr33-run42662045252-attempt1-FFWxPA`，各 ZIP 分别在新建子目录成功解压后读取。
完整 run 日志接口因 job 数量限制失败，随后逐个取得四个失败 job 和总门禁日志。
四个附件的 API 元数据均属于本 run、目标 HEAD，名称均以 attempt `1` 结尾：

| 分片 / job | 完整产物 | 原始失败及证据 | 结论及本轮改动 |
| --- | --- | --- | --- |
| animation-13 / 129395933688 | 13716229991 | `report-field-input 应可见且连接正常`；堆栈为 texas-gameplay.ts 的举报入场后检查。失败截图和脱敏树证明 Report 标题、原因选项及 TextView 已显示，但输入节点的名称被旧脱敏规则隐藏。失败前房间订阅 ready=true。 | **待 CI 取证，未声称修复**。不能把弹窗已显示等同于轮询期间输入框和连接同时就绪。只为该检查保存原轮询最近16份目标存在、Report 标题、连接提示、查询耗时样本，失败时输出。脱敏树只允许保留固定 `report-field-input` 名称，输入内容及敏感祖先仍遮蔽。 |
| animation-15 / 129396448253 | 13718940971 | 下一步 `menu-button 应可见`。此前 card-rank-exit 原片的分时帧始终显示牌型层；失败截图和树仍有 card-rank-list / card-rank-popup-close。失败前订阅 ready=true，三条 WebSocket 仍活跃。 | **待 CI 取证，未声称修复**。直接原因是上一层没有退出，不能归因于菜单查询本身或盲目延长菜单等待。记录原有关闭输入的准备/请求/驱动返回 UTC、原 bounds、落点及屏幕尺寸，下一轮与原片核对预热前后几何。没有重新定位、补点或新增设备查询。 |
| animation-17 / 129421253071 | 13724821632 | Cancel 调用后 `game-matching-loading-view` 消失超时。失败截图仍显示匹配层和 Cancel；树中 countdown=71，截图为77，说明它们不是同一瞬间的观测。 | **待 CI 取证，未声称修复**。尚不能区分原生输入未生效和应用/夹具处理问题。记录原有稳定观测所得的 Cancel bounds、viewport、落点和请求/返回 UTC；协议诊断只增加 join/quit/keep_waiting 固定类别，判断 quit 是否真正到达代理。注入响应不冒充真实上游响应。 |
| animation-22 / 129459219335 | 13727691652 | 排行榜录屏预热后 `gameTapCurrent` 检测到真实 Connection Timeout，尚未实际点击。清理前01:39:53 UTC快照 ready=false、房间订阅和承载连接计数均为0；原房间首尔连接约33秒前服务端关闭，另一首尔连接仍交换消息。 | **断线已证实，触发原因待 CI 取证**。复用其他分支已有的逐连接房间协议诊断，关联订阅/退订、在线与其他房间 RPC 请求应答及服务端退订通知，不记录频道、房间、玩家、正文或命令ID。下一轮区分在线请求未应答、服务端退订和重订阅缺失，继续保留 Connection Timeout 原始失败。 |

四份 build-info 均对应应用提交 `c3ff78c66c7aedd586a66c9b09e8849497565365`、Release `ios-staging-36-1-c3ff78c66c7a`。
进一步从 `kevinanew/clrn` 下载本轮应用包，校验 SHA-256 为
`f15b44cbbcbfc6325df5513b0ca1822db4c35ebe2113ca7aaa8d5c4d85489407` 后在新的 app 子目录解压。
`main.jsbundle` 是 Hermes v96 字节码；字符串中包含 report-field-input、card-rank-popup-close、quick-start-room-cancel。
这排除了包内完全缺少这些标识的假设，但不能证明运行时原生节点绑定正确。
发布仓库该应用提交的 Git tree API 返回422，无法从该公开发布仓库取得对应应用源码；未修改应用或部署版本。

## 已证实无需代码改动的项目

- [guest / zh-Hant / pages，job 129320835447](https://github.com/appcookie/clrn-pg/actions/runs/42662045252/job/129320835447)
- [animation-3，job 129320835256](https://github.com/appcookie/clrn-pg/actions/runs/42662045252/job/129320835256)

两者 API 均为 runner_id=0、runner_name为空、steps=[]，且 check-run 注解明确为
“The job was not acquired by Runner of type hosted even after multiple attempts”，伴随 macOS arm64 capacity constraints 提示。
因此取消发生在分配 runner 阶段，没有测试失败可以修复。没有据取消结果推测任何测试已通过。

[总门禁 job 129570317028](https://github.com/appcookie/clrn-pg/actions/runs/42662045252/job/129570317028)
汇总上述四项失败和 abandoned 分片，没有独立代码故障；必须继续阻断，未修改工作流或检查条件。
本轮仍需补充四项测试失败的证据，因此未使用全轮 NO-FIX 协议。

## 历史反例及复用边界

- `457daac` / `docs/issue-23-investigation.md`：旧排行榜故障是录后 empty 标记未出现；已有录制中稳定定位修复仍保留。
  本轮 animation-22 在实际输入前已发现 Connection Timeout，不能再以相同入口为由重写点击。
- `f8a00ea`、`bfe4b14` 的菜单重连和绿色桌布修复均已在 HEAD；不重复实现。animation-15 的牌型层仍存在，
  且快照房间已订阅，不能套用菜单重开补点当作已经证实的解决办法。
- `9d5c64d` 的历史 run 42615049294 / animation-25 同样在其他 WebSocket 活跃时丢失房间订阅，
  已记录仅凭健康探测失败不能认定选线是根因。本轮严格沿用这一限制，不把其他地区 connect-timeout 当成因果证明。
- 复用 `9d5c64d` 的 RoomProtocolDiagnostics 和集成位置，以及 `a1cbb67` 的德州/拼三张类别支持及相关脱敏测试。
  只迁入诊断及验证所需内容；额外对非对象帧、未登记连接做防护。匹配固定类别用于本轮 Cancel 故障。
- 同轮多个其他分片成功不能否定上述具体故障，也不能替代失败时刻的观测。本轮没有对照通过即认定因果。

## 验证和后续 CI 判据

诊断不新增原生读取、不改变原轮询谓词、间隔、预算、动画后端、预热、采样或断言；不增加业务点击。
日志写入失败受保护，原输入/断言异常继续原样传播；协议观察异常不改写消息。
本地仅运行直接相关的隔离验证、类型及静态检查，没有执行模拟器回归：

- 诊断脱敏11项、举报轮询诊断2项通过；覆盖内容隐藏、数量上限及日志异常保留原错误。
- 面板和导航原有定向回归及新增诊断错误保护用例通过。
- 传输诊断14项通过，覆盖命令关联、脱敏、数量上限、不改消息、诊断错误保护及匹配请求类别。
- TypeScript、ESLint/Ruff历史门禁、依赖与重复代码检查、两种游戏复杂度门禁和 diff whitespace 检查通过。

仍须由 CI 在同样应用包和原门禁下取得新报告。若输入坐标与录像当前目标不符，才修复该入口的预热后定位；
若落点正确、驱动返回而应用未处理，继续调查原生触摸与应用处理；若 quit 已发出，则核对夹具响应和应用收尾。
举报诊断应区分目标一直缺失与目标存在但连接遮罩阻止就绪；房间诊断应解释服务端关闭前后的在线/订阅事件。
这些行为根因尚未全部定位，不能把本次诊断补充当成四项失败已修复，也不能宣称无需改动。
