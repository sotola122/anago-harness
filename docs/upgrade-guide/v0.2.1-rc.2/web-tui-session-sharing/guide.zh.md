---
kind: upgrade-guide
description: "查看 Session 不再占用写入租约，空闲 Agent 会释放租约，被其他进程持有的 Session 以只读方式打开。"
---

# 跨进程 Session 共享

[English](guide.md) | 中文

## 变更

- `session/follow` 新增可选的 `mode: 'activate' | 'read'`。`activate` 是默认值，保持旧行为：prepared observation 会在后台 promote 一个 Agent。`read` 永不激活 Agent，从最后一个物理落盘事件（`savedCursor`）开始，并省略合成的修复 closer。Web 客户端始终以 `read` 打开会话；发送消息时仍会按需恢复 Agent。
- `SessionPersistence` 新增 `ownership(id)`，返回 `free`、`owned-here`、`held-elsewhere`、`missing` 或 `unknown`。该探测不创建目录或锁文件，也不获取所有权；内核租约仍是唯一裁决者。
- 普通 Agent 分离时不再发送 `api-session/removed`。新的 `api-session/detached` 事件表示已存储的 Session 仍可读：客户端保留行、历史与草稿，并清除 Agent 可用状态。`removed` 现在只表示可持久化子 Agent 行随其运行离开实时目录。
- `SessionController` 新增 `releaseOnIdle`（默认 false）、`releaseIdleDelayMs`（默认 0）和 `releaseRetryMs`（默认 1000）。启用后，当 Agent 处于 idle、收件箱为空、没有存活的子 Agent、没有未完成的 `ctx.agents.hold()` 且没有进行中的准入操作时，其句柄会被 dispose 并释放 Session 的写入租约。`anago-web` 以 250 ms 延迟启用该行为。
- 新增的 `@anago-harness/client-ui-session-share` 插件会为其他 DSH 进程持有的 Session 锁定 Web 输入区（`lock: 'all'`），并在租约释放后解锁。
- 终端选择器会把被其他进程持有的 Session 显示为带原因的禁用行，并拒绝打开它。

## 迁移

1. 自定义的 `SessionPersistence` 后端需要实现 `ownership`。`unknown` 必须表示无法判定，绝不能表示空闲。
2. 若客户端把 `api-session/removed` 理解为“Agent 已消失但已存储的 Session 仍在”，则还必须处理 `api-session/detached`；`removed` 现在意味着删除。
3. 依赖旧的后台激活行为的 `session/follow` 调用方需要传入 `mode: 'activate'`。省略该字段会保持旧行为，因此只有 Web 客户端发生了变化。
4. 跨越 idle 转换仍在进行的后台工作（memory review、goal 续轮、子 Agent）必须通过 `ctx.agents.hold(agent)` 持有 Agent；否则启用 `releaseOnIdle` 会中断它。内置的 memory review 与 goal round driver 已经持有。
5. 启用 `releaseOnIdle` 会用下一条消息的延迟换取租约：下一次 prompt 会恢复 Agent 并重新读取日志。要保持 Agent 常驻，请关闭该选项。
