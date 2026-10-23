# Agent Note：Web UI 与终端 UI 之间的跨进程 Session 共享

状态：已实现

[English](2026-10-23-cross-process-session-sharing.md) | 中文

## 问题

Web UI 与终端 UI 共享同一个 `$DSH_HOME/sessions` 存储，但 Web 无法与正在运行的终端共享 Session：

- 打开会话会调用 `session/follow`，而它会提升 prepared observation 并在后台恢复 Agent。因此仅仅查看就会占用 Session 的内核写入租约，终端无法打开 Web 只是看过的 Session。
- 冷观察会追加合成的 `interruptedTurnClosers`，并把它们的 seq 作为 cursor 上报，于是 follower 从物理落盘前缀之后开始，会把写入方在该 seq 的真实事件当成重复事件丢弃。
- dispose 一个 Agent 会发出 `api-session/removed`，客户端把 Session 标记为已删除，尽管已存储的 Session 仍然存在，输入区却被丢弃。
- 从不释放空闲 Agent 的 Host 会在整个生命周期内持有租约，即使没有浏览器连接。

## 决定

1. **查看是被动的。** `session/follow` 新增 `mode: 'activate' | 'read'`，默认为历史的 `activate`。`read` 永不 promote、永不 resume，从 `savedCursor`（最后一个物理落盘事件）开始，并省略合成的修复 closer。Web 客户端始终以 `read` 打开，只在显式写入操作时恢复。
2. **Agent 退出不等于 Session 删除。** 普通会话的 `session/disposed` 发出 `api-session/detached`；可持久化子 Agent 行仍使用 `api-session/removed`，与其离开目录的生命周期一致。客户端保留普通会话的行、历史、草稿与引用，只清除 Agent 可用状态。
3. **租约只在工作运行时持有。** `releaseOnIdle` 仅在收件箱为空、没有存活的子 Agent、`ctx.agents.holds(agent)` 为零且没有进行中的准入操作时 dispose 空闲 Agent。prompt、队列编辑、模型选择、重命名、fork 与附件准入共享同一个按 Session 的闸门，因此释放不会与已经解析出 Agent 的操作竞争。
4. **后台工作拥有自己的生命周期。** 回合结束后的 memory review 与 goal round driver 在本轮持有 `ctx.agents.hold(agent)`，并在所有退出路径释放；若持有被拒绝，则跳过该工作而不是与 dispose 竞争。
5. **所有权是建议性的。** `SessionPersistence.ownership()` 使用相同的平台锁进行探测，但不创建目录或锁文件；`unknown` 绝不表示空闲。open 与 prompt 时的内核租约仍是唯一裁决者。Web 用 `lock: 'all'` 锁定输入区并轮询该探测；终端把被持有的行变暗、显示原因并拒绝打开。
6. **只读实时查看复用现有读取器。** read 模式的 follower 轮询存储 revision 并通过既有读取 API 读取增量；没有新增第二套日志解析器或文件监视。

## 考虑过的替代方案

- **两个并发写入方加冲突解决。** 否决：仅追加日志与连续 seq 契约没有合并语义。
- **新增 persistence `watch` seam，使用 `fs.watch` 与增量帧解码。** 暂缓：revision 轮询复用已验证的读取器；若测量需要，provider 内部可增加按字节偏移的快速路径。
- **把 detach 当作删除再重新添加行。** 否决：会丢失草稿与历史，且重新添加会与删除事件竞争。
- **只在浏览器断开时释放。** 否决：长驻 Host 会在没有客户端时继续持有租约，这正是最初的问题。

## 影响

- 空闲释放后的第一条消息会恢复 Agent 并重新读取日志；部署以此延迟换取跨界面共享，也可以关闭 `releaseOnIdle`。
- 只读视图中的投影（inbox、model、goal）在交接或重新加载时刷新，而非实时；实时的是对话记录。
- 当另一个进程持有 Session 时触发的 schedule follow-up 会以 writer-held 错误失败。
- 自定义 `SessionPersistence` 后端必须实现 `ownership`；该抽象方法对实现者是不兼容变更。
