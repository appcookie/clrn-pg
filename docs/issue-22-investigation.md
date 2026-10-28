# #22：真实建房 502 的传输调查

## 本轮状态

本轮修复建房诊断缺失，供发布后的固定构建原生回归继续定位；**尚未确认历史 502 的根因，也未确认 master 恢复**。不能以隔离回归、用例收集或诊断代码完成代替真实建房通过。

首轮开始时工作树干净，HEAD 为 `026e21ecd6ac31edcd66d55eb44323cee39ea8f1`，无 MERGE_HEAD、冲突或相对基线的已有修改。没有可仅靠已有合并解决的更新。目标工作树中不存在 AGENTS.md、AGENTS.txt、DEVELOPMENT.md 或 .codegraph/；已核对 README.md、ios-full.yml 和 ios-simulator.yml。

## 重新分析与增补

本次开始时工作树干净，HEAD 为已有修复 `af5052de477d6e1f9fe242dd79dd9d7097591825`，无 MERGE_HEAD 或冲突；保留该提交相对基线的全部 14 个项目文件改动。只读查询远端 master 仍为基线 `026e21e`，所以没有主分支更新已解决问题的证据。本次重新读取的 #22 正文与提供的资料一致，评论为空。

核对本工作树安装的 mitmproxy 12.2.3 源码时发现，`proxy/layers/http/_http2.py` 会生成 `HTTP/2 protocol error:`，已有诊断仅识别 HTTP/1 的固定前缀，会将 HTTP/2 协议失败误记为 unknown。本次补齐同一 `http-protocol` 类别，从实际 iOS addon 入口加入 HTTP/1、HTTP/2 回归：修复前 HTTP/2 用例失败，修复后通过；同时验证请求、错误和响应状态未被修改，私有错误内容未输出。这不证明历史建房采用 HTTP/2 或历史 502 已恢复。

本次再次读取历史作业完整日志；原始产物 ZIP 的本地下载仍因 DNS 无法解析而失败，未查看其中的报告、截图或 build-info。历史证据缺口继续保留。已有提交的[完整回归 40722507732](https://github.com/appcookie/clrn-pg/actions/runs/40722507732)绑定 `af5052d`、attempt 1，查询时整体尚未结束，proxy-check 作业已成功；这些结果不覆盖本次未发布的增补，也不能代表真实建房或 master 已恢复。

## 已取得与缺失的历史证据

- [运行 40690449375](https://github.com/appcookie/clrn-pg/actions/runs/40690449375)：GitHub 元数据为上述基线 master 的 push，attempt 1，结论 failure。
- 已读取 [animation-15 作业日志](https://github.com/appcookie/clrn-pg/actions/runs/40690449375/job/122845163898)。实际用例为 `en / zhajinhua / signed_in_zhajinhua_pre_game_first`，报告错误为「真实建房请求失败：HTTP 0，业务成功标记 false」。随后视频导出明确记录 0 段原始视频，失败发生在正式录屏前。
- 日志确认 Release `ios-staging-36-1-c3ff78c66c7a`、应用提交 `c3ff78c66c7aedd586a66c9b09e8849497565365`；与当前部署记录一致。日志中首尔 64 健康响应为 200 / normal / backendDelay 115，真实 WebSocket 握手为 101，其他节点出现 `visual-node-exclusion`。这些只证明相应请求的结果，不能证明稍后的建房链路正常或节点限制就是根因。
- [原始产物 12821067946](https://github.com/appcookie/clrn-pg/actions/runs/40690449375/artifacts/12821067946)的下载工具成功返回 ZIP 引用，但本地下载因沙箱 DNS 失败。**尚未读取 ZIP 内的原始报告、失败截图与 build-info**。界面「Create game failed / Request failed with status code 502」及包 SHA-256 `f15b44cbbcbfc6325df5513b0ca1822db4c35ebe2113ca7aaa8d5c4d85489407`来自 issue 提供的线索，本轮未独立复核。
- 未取得本次建房对应的服务端、网关或代理连接错误诊断。旧日志白名单未包含 `/v3/pay_action/do`，且 observer 在 error 回调中仅保存无响应状态 0，无法从现存证据追溯其具体失败类别。其他主机的 TLS 失败计数不能归属到建房请求。

## HTTP 0 与界面 502 为什么可能不同

0 是本仓库在 `flow.response is None` 时使用的内部观测值，不是服务器发来的 HTTP 状态，也不代表界面显示 0。mitmproxy 12.2.3 的 HTTP 层先发出 error hook，再向客户端处理传输错误；HTTP/1 层可以直接生成 502 字节而不设置该流的 `flow.response`。因此代理连接失败、上游连接或协议失败可能产生「observer 0 / 客户端 502」。

固定版本源码依据：[HTTP error hook 与连接失败](https://github.com/mitmproxy/mitmproxy/blob/v12.2.3/mitmproxy/proxy/layers/http/__init__.py)、[HTTP/1 错误响应写出](https://github.com/mitmproxy/mitmproxy/blob/v12.2.3/mitmproxy/proxy/layers/http/_http1.py)、[错误类别到 HTTP 状态的映射](https://github.com/mitmproxy/mitmproxy/blob/v12.2.3/mitmproxy/proxy/layers/http/_events.py)。这解释一种机制，**不是历史故障的根因认定**；没有响应也不能推断客户端一定收到了 502。

## 新增诊断的含义与边界

`native/transport` 将建房端点纳入原有白名单。`httpEvents.sequence` 与 `native/observer/room-creation` 使用同一代理内递增请求序号，结合方法、无查询参数路径、公开节点 host、UTC 观测时间和耗时定位同次请求。序号仅在本轮代理内有效，不导出 flow UUID、连接 UUID、账号或房间身份。

| 字段 | 含义 |
| --- | --- |
| `status` | 实际 `flow.response.status_code`；无响应仍为 0，进行中为 null |
| `ok`（仅建房尝试） | 响应业务标记是否严格等于 true；仍独立要求 HTTP 200 |
| `observationHook` | 收到 `response` 或 `error` 回调，不代表客户端最终接收结果 |
| `responseSource` | `upstream` / `fixture` / `none`；upstream 指代理上游 HTTP 响应，不能进一步证明来自应用服务而非网关 |
| `failureCategory` | `none`、`upstream-http`、`fixture-http`、`proxy-connection`、`upstream-connection`、`client-tls`、`server-tls`、`client-disconnect`、`upstream-disconnect`、`proxy-abort`、`http-protocol` 或 `unknown` |
| `failureReason` | 可确认的固定原因 `connection-refused` / `connect-timeout` / `dns` / `certificate-verify-failed` / `peer-closed` / `connection-cancelled`，否则 null；不输出错误原文 |
| `serverTcpEstablished` / `serverTlsEstablished` / `viaProxy` | 当前流关联连接的建立事实及是否配置上游代理；不是建房已到达或生效的证明 |
| `fixtureLookupFailed` | 本地 Node 夹具查询曾异常，异常继续原样抛出。mitmproxy 可能继续访问上游，因此该标记不直接决定最终失败类别 |

TLS 按实际连接身份关联已观察到的失败 hook；固定的证书验证失败前缀也可识别为 server-tls，不根据相同 host 的计数猜测。TLS 在 HTTP 请求解密之前失败时可能根本不存在建房流，此时仍只有 TLS 聚合计数。连接拒绝、DNS 和连接超时仅识别固定系统 errno；无法识别的错误保持 unknown，不从任意错误文案中的 TLS、timeout 等词猜测类别。

诊断不保存头、查询参数、凭据、原始错误消息或请求/响应正文。建房失败消息只增加安全序号和枚举；完整安全时序仍由现有失败捕获输出。未修改建房请求/响应、自动重放 POST、超时、业务成功条件、节点选择或视觉基准。

## 验证与后续恢复条件

本次增补后重新通过 iOS 代理目录的 30 项 Python 隔离测试、8 项建房流程测试及 TypeScript 检查；原生用例收集为 184 项，仅证明登记成功。隔离测试从实际 iOS addon 入口验证上游 200、上游 502、代理/上游连接错误、客户端中断、HTTP/1 与 HTTP/2 协议错误、TLS 精确关联、夹具异常和 unknown 脱敏，比较请求与响应保持原样，并验证失败 POST 不补点。

本次 `npm run check` 的完整单测为 499 项，479 通过、20 项因 `listen EPERM 127.0.0.1` 失败，未跳过任何测试；因此该命令未通过，后续用例收集另行执行。`npm run check:python` 在共享代理的真实上游集成测试绑定回环端口时被沙箱拒绝，整体未通过；单独执行的 3 项 mitmdump 集成测试同样全部因 `listen EPERM` 失败，不能记作通过。集成回归已加入正常建房与上游 502 的本地上游字节校验，以及不可用代理导致「客户端 502 / observer 0」的单次 POST 场景，由宿主 `check:python` 执行。在线 npm 安装因 DNS 不可用中止，随后使用复制到临时目录的本地缓存离线 `npm ci` 成功；Python 使用本工作树已有的 `e2e/.venv`，离线依赖核对成功。宿主仍需按固定检查重新安装并验证本工作树。

发布后的原生验证须继续使用上述固定 Release、iPhone 16 / iOS 18.5 和真实建房入口，要求 HTTP 200、ok=true、本轮真实房间登记及原有桌面/录像检查通过。保存当前提交完整日志、报告、build-info 与适用截图/原片；缺少录像应注明失败阶段，不伪造录像或更新基准。旧失败不证明新提交仍失败或已通过。

若仍失败，按 sequence、节点、方法、无参数路径和 UTC 时间关联本轮传输诊断，再由有权限的一方核对同次服务端/网关诊断。不要打印账号、令牌、正文或原始连接错误。若确认外部服务或应用缺陷，仅记录证据及恢复条件，不修改应用仓库。根因 unknown、真实服务异常或固定构建原生验证未通过时，保留 issue 的恢复阻塞，不能以本轮诊断修复宣称 master CI 已通过。
