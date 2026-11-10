# Run 42735484012 / attempt 1

诊断指纹：`af2877aa956ed26e6aed2b41f4d2c4d90363d95d67d576b87a61f7f006fee83a`。
GitHub run 的 headSha 与本地 HEAD 均为 `a1cbb6757613939c63fe6aeb0aad0c26517ec246`；
作业检出 PR merge `6f2a88486558fd30486d09d8e72d8e2f254c8e04`。
在新建的带 run/attempt/HEAD 标识的临时目录下载并成功解压产物后，读取报告及附件。
两份 build-info 均指向应用提交 `c3ff78c66c7aedd586a66c9b09e8849497565365`、
Release `ios-staging-36-1-c3ff78c66c7a`，包摘要均为
`f15b44cbbcbfc6325df5513b0ca1822db4c35ebe2113ca7aaa8d5c4d85489407`。

## guest / zh-Hant / startup（job 129567721797）

[产物 13728799776](https://github.com/appcookie/clrn-pg/actions/runs/42735484012/artifacts/13728799776)
中的 report.json 仅有无调用栈的 AbortError / TimeoutError。
但同一失败结果已经附上 launch-capture-evidence（插画相关性 0.988、品牌字比例 0.114）、
zh-Hant-launch-branding.png，以及 launch-health-recovery `{"retried":false}`。
这些附件只有视觉检查与大厅恢复通过后才会出现。故启动采样或健康检查失败不能解释本项错误。
执行随后进入 finally；hold 释放后由 device.close 执行带 30000ms 预算的 DELETE session。
目前能定位到清理阶段，不能从缺少命令上下文的 AbortError 判断 Appium/WDA 为什么卡住。

增加 WebDriver 传输失败的命令类别、UTC、耗时及既有预算诊断；不记录地址、会话 ID、
请求体或错误正文，仍抛出同一个异常，诊断写出失败也不替换原异常。
下轮 CI 应确认是否为 delete-session 超时，再调查该命令的 Appium/WDA 行为；不延长预算。
同轮 zh-Hans/en startup 通过不证明清理一定可靠；现有视频回退也已实际成功，不能重复修改采样。

## recording / animation-22（job 129625289439）

[产物 13736952165](https://github.com/appcookie/clrn-pg/actions/runs/42735484012/artifacts/13736952165)
显示失败来自原有 gameReady(public-leader-board-empty) 中的 Connection Timeout 检查。
入场 input 附件记录两次完整树目标位置一致、visible/enabled 为真、连接提示均为假；
05:02:32.106Z 请求单次点击，05:02:44.781Z 驱动返回。
录后 semantics 于 05:03:42.837Z 观察到 timeoutVisible=true，原断言失败。
failure-transport 于 05:03:42.857Z 显示三个旧连接约 49.7 秒前由客户端关闭，
其最后服务端数据约 74.7 秒前、客户端数据约 64.4 秒前；之后的新连接已经恢复收发。
首尔房间订阅曾收到无协议错误的回复，但 roomProtocol 仅有 subscribe 请求/响应。
这证明存在连接中断，尚不能证明是上游、代理还是应用事件处理停顿造成；
后来重新连通不能消除已经出现的失败。

复用 a1cbb67/9d5c64d 的脱敏传输诊断和 457daac 的排行榜单次点击流程。
当前房间协议诊断过滤掉非房间 method-9 RPC，无法核对排行榜附近是否有请求未获回复；
仅补充这类 RPC 的通用 rpc 请求/响应类别，沿用 64 项上限和原有响应结果布尔值，
不输出路径、请求 ID、用户信息或正文，不改变消息。
下轮 CI 将据此区分未响应 RPC 与已响应后仍报超时；本轮不宣称业务根因已修复。

历史 40690449375 的失败为面板不可见且缺少点击证据（见 issue-23-investigation.md），
本轮已经具备稳定目标和单次输入回执，且明确出现 Connection Timeout。
不能沿用历史“未打开”的表象去补点，也不能将既有多节点健康失败计数直接认作本项根因。
修改前已只读检查相关分支及修复历史，包括 e102925 的请求预算修复、457daac 的输入修复，
以及另一分支 f8d6309 的确认控件/房间诊断改动；没有证据支持复用其确认控件改动。

## 总门禁（job 129680148716）

日志为 PLAN/PREFLIGHT/PROXY=success、NATIVE=failure，原有聚合断言正确阻断上述两个分片。
这是派生失败，门禁无需修改。两个独立失败仍需下轮原生 CI 取得上述缺失证据，
不适用无需改动协议，不跳过任何用例或断言。

## 定向验证

WebDriver 4 项测试、传输诊断 14 项测试通过，包含超时传播、诊断写出异常、
非房间 RPC 关联、敏感内容排除、消息原样保留及原有事件上限验证。
未本地重复运行原生测试；原生结果须由 CI 验证。
