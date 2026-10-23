# 暂停 PR 自动运行的 iOS 录屏组

这里是 PR CI 的隔离清单，来源为 [上次完整 PR 运行](https://github.com/appcookie/clrn-pg/actions/runs/39915161911)中失败的五组。`cases.json` 是调度的唯一来源：PR 和 master push 不运行这些组；`workflow_dispatch` 的 `quarantined` 组仍可单独重跑。测试实现继续复用原来的 spec 文件，避免复制出两份；本目录集中管理它们的启停与失败记录。隔离不等于通过，CI 汇总会列出全部五组。

| 组 | 测试 | 当前问题 |
| --- | --- | --- |
| 9 | iOS 分享面板 | 原生控件出现超时；定向重跑通过，未在完整 PR 中复验。 |
| 12 | 德州牌桌 | `opponent_turn` 截图不符；定向重跑通过，未在完整 PR 中复验。 |
| 14 | 德州大厅 | 牌桌状态等待超时；定向重跑通过，未在完整 PR 中复验。 |
| 20 | 德州面板 | 最近一次[定向运行](https://github.com/appcookie/clrn-pg/actions/runs/39988179300)的 `theme_four_color` 截图不符；此前运行曾缺少 MP4。三个面板分段一起隔离。 |
| 21 | 德州面板变体 | 买入申请状态等待超时；定向重跑通过，未在完整 PR 中复验。 |

其余 20 组录屏和六个游客截图分片仍是 PR 必跑项。要恢复某组，先手动运行 `quarantined` 诊断并确认截图与 MP4，然后从 `cases.json` 删除对应 ID，再让 PR 的完整门禁复验。
