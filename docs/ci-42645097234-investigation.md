# Run 42645097234 / attempt 1 调查

诊断指纹：`7f819187355e1d3e5d96362de1dd90b87688115791dd765cd425313a3aa5fa6e`。
API 核对 run、四个 job 与工作区 HEAD 均为 `9d5c64d5fa156519cedba96b03ff01971b4e5d5e`；
CI 实际 checkout 的合并提交为 `903aeb0811e61c777a7cb84aff6dda2a9d790aeb`。
产物 13722948906 下载至全新目录 `/tmp/ci-42645097234-attempt1-9d5c64d-1Anej6/job129364391517`，
命令成功后才读取 report.json、error-context 和失败原图；没有读取旧报告。

## animation-8、animation-11：已证实无需代码改动

Job 129297592033、129302962684 的 steps 均为空，runner_id 为 0，runner_name 为空。
各自 check-run annotations 明确记载：
“The job was not acquired by Runner of type hosted even after multiple attempts”，
并三次提示 macOS arm64 capacity constraints。两项日志接口均为 BlobNotFound，
本轮产物列表也没有这两个分片的报告。取消发生在获得 runner 之前，属于托管容量故障；
没有更换 runner、跳过分片或放宽总门禁。

## animation-19：确认 room_profile 超时，原因仍需 CI 协议证据

Job 129364391517 在 `captureRemainingPanels` 的排行榜截图断言失败：截图前存在意外错误提示。
失败原图明确显示 `timeout of 10000ms exceeded-room_profile`，排行榜实际已展开，
不是漏点或排行榜未打开。

report.json 内嵌的失败前 failure-transport 时间为 00:27:49.621860 UTC：
首尔 websocket 仍 open，最近服务端数据距采样 3260ms，房间订阅 ready=true，
confirmedSubscriptions=1。故不能以清理后的汇总全部连接 closed 推断失败前断线；
也不能以其他候选节点的 DNS/连接超时解释一个已建立且活跃的房间连接。
前景稳定观测在 00:27:41.769 和 00:27:49.602 的面板边界一致、recovered=false，
这也不足以证明业务 RPC 成功。连接活跃与特定 RPC 超时可以同时发生。

修改前只读检查所有现有本地/远端分支及相关历史：
`457daac` 的预热后单次点击已存在，本轮面板展开，不重复实现或补点；
`b9acf3a` 已保留启用德州回放后的 player/alive，本轮预游戏未启用牌局回放，不能重复套用；
`9d5c64d` 的协议诊断只识别拼三张，因此本轮所有 roomProtocol 为空不能证明没有请求。
历史 run 42615049294 的拼三张真实断线与本轮订阅活跃不同，不能照搬断线解释。

复用现有有界、脱敏协议观察器，增加 texas_holdem 房间订阅、房间 RPC、在线 RPC 及应答识别。
仍只输出固定类别、布尔结果和相对时间，不输出 ID、频道、路径、正文或业务错误内容；
继续忽略注入消息并隔离诊断异常。没有改变设备采样、动画时序、断言、超时或测试执行方式。
新增覆盖两种游戏的请求应答关联、业务/协议错误、脱敏、消息不变和 64 项上限的验证。

这是取证补充，尚未宣称行为根因已修复。下一轮 CI 需区分房间 RPC 未响应、协议/业务拒绝
及订阅变动；若超时未复现，单次通过也不证明原因。若相关调用不属于房间路径 RPC，
继续按新证据定向调查，不能把空记录判作上游无故障。

## 总门禁：无需单独修改

Job 129561202262 汇总 animation-19 原始断言失败，并因原生分片 abandoned 阻断。
它没有独立测试异常，原有所有分片必须成功的条件完整保留。

## 验证

传输诊断 unittest 13 项通过（含两游戏子测试）；两个修改的 Python 文件 Ruff 通过；
`git diff --check` 通过。未运行本地模拟器或全量 E2E；行为验证及新增协议证据待 CI。
本轮有必要的诊断改动，未写 NO-FIX 协议；未提交、推送或修改 Git index、分支引用和历史。
