# 容器化验证宿主

[English](README.md) | 中文

把此检出构建成镜像，并在 `http://100.110.252.31:8083` 上提供 Web 宿主，不触及宿主机的 Node 构建、`~/.dsh`，也不影响端口 3080 上运行中的 `anago-web.service`。

镜像安装并构建自己的副本：`pnpm install --frozen-lockfile` 与 `pnpm run build:artifacts` 都在镜像内运行，容器的 DSH 主目录是 `/home/dsh/.dsh`。

## 前置条件

- rootless `podman` 5.7
- 已初始化的 `plugins` 子模块（`git submodule update --init`），因为镜像会复制此检出
- 宿主机上带 PyYAML 的 `python3`（仅用于读取凭据名称；值通过管道传递，绝不打印）
- 含 `OPENCODE_GO_API_KEY` 与 `COMMANDCODE_API_KEY` 条目的 `/home/hwd/.dsh/.credentials.yaml`
- `/home/hwd/.claude/.credentials.json`（Claude Code 基于文件的登录信息）

## 构建

```sh
/data_1/git_workspace/anago-harness/ci/verify-container/run.sh
```

`run.sh` 会构建镜像、刷新 podman secret、停止可能存在的旧 `anago-verify-8083` unit、运行容器并打印启动 URL。修改代码后再次运行即可：构建缓存会保留 `pnpm install` 和未变化的构建步骤。

仅构建：

```sh
cd /data_1/git_workspace/anago-harness
podman build \
  --file ci/verify-container/Containerfile \
  --ignorefile ci/verify-container/containerignore \
  --build-arg "DSH_CLIENT_COMMIT_HASH=$(git rev-parse HEAD)" \
  --tag anago-verify:8083 .
```

## 运行、日志与停止

```sh
ci/verify-container/run.sh           # build, run, print URL
podman logs -f anago-verify-8083     # follow the host log
ci/verify-container/run.sh stop      # remove the container
```

## Secret

来源缺失时，`run.sh` 会在启动任何内容之前失败。值从宿主机凭据文档通过管道写入 podman secret，绝不打印；任何密钥都不会进入镜像、构建历史、`Config.Env` 或本文件。

| podman secret | 来源 | 交付方式 |
|---|---|---|
| `anago-opencode-go` | `refs.OPENCODE_GO_API_KEY` | `type=env,target=OPENCODE_GO_API_KEY` |
| `anago-commandcode` | `refs.COMMANDCODE_API_KEY` | `type=env,target=COMMANDCODE_API_KEY` |
| `anago-claude-credentials` | `/home/hwd/.claude/.credentials.json` | `type=mount,target=/home/dsh/.claude/.credentials.json`（0444） |
| `anago-dsh-credentials` | `/home/hwd/.dsh/.credentials.yaml` | `type=mount,target=/run/anago-secrets/credentials.yaml`；entrypoint 由它一次性生成可写的 0600 `/home/dsh/.dsh/.credentials.yaml` |

Claude Code 通过该文件（OAuth，`claudeAiOauth`）而不是环境变量进行身份验证。Podman 把这个 secret 实体化为 `/home/dsh/.claude/.credentials.json` 处的 0444 文件；宿主机文件本身被复制进 podman 的 secret 存储，容器既不挂载也不修改它。有效的访问令牌可以直接使用；令牌过期后 CLI 无法就地刷新，因此先在宿主机上刷新（运行一次 `claude`，刷新会轮换令牌并重写宿主机文件），再重新运行 `run.sh`。不要让两个可写副本刷新同一登录：这会轮换令牌，并使另一个副本失效。

在容器内登录（`/xai-login`、`/copilot-login` 等）会写入容器自己的凭据存储。该存储最初是宿主机文档的副本，以便启动时能读取已挂载的授权，但容器绝不回写宿主机：要把宿主机授权带入新容器，请先在宿主机上刷新，再重新运行 `./run.sh`。该副本包含宿主机的 OAuth 授权，因此容器刷新其中一项且签发方轮换刷新令牌时，宿主机上同一登录的副本会失效，风险与上文的 Claude 登录相同。

## Profile

`profile/` 是 Profile 定义，它被复制到镜像的 `$DSH_HOME/profiles/verify`，并在构建时安装：

- `package.json`：运行中 Profile 的十个 bundle（`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`@anago-harness/anago-core`、`@anago-harness/anago-web`、`@anago-harness/xai-oauth`、`@anago-harness/copilot-oauth`、`@anago-harness/openai-codex-oauth`、`@mars-sea/dsh-commandcode-provider`、`dsh-mobile-maxxing`、`@deepseek-ai/dsh-experimental-tool-worktree`）。工作区 bundle 与运行中的宿主一样，通过安装锚点从镜像自身的构建解析；三个 npm 包安装到 Profile 的 `node_modules`（`@mars-sea/dsh-commandcode-provider@0.17.1`、`@deepseek-ai/dsh-experimental-tool-worktree@0.2.2-rc.1`，以及固定到运行中宿主所用提交 `9703b24e7196175683c4db96263d78cbf160d880` 的 `dsh-mobile-maxxing` 0.6.1，因此移动的 GitHub 分支不会改变验证宿主）。
- `cordis.patch.yml`：原样取自运行中的 `~/.dsh/profiles/web-anago/cordis.patch.yml`，只有三处容器改动：`skill-filesystem.agentsHome` 指向 entrypoint 创建的 `/home/dsh/.agents`，客户端语言固定为 `preference: en`（镜像没有已保存的用户设置），并追加重新构建的 `subagent-claude-code` / `subagent_claude_code` 配置项，其中 `permissionMode: auto`、`allowedPermissionModes: [dontAsk, acceptEdits, auto, plan]`。模型路由、用途路由、preset、`session-log-deepseek` 与 `selectedDefault: orchestrator` 注册表设置保持不变。
- 对话路由是 `commandcode` / `deepseek/deepseek-v4.1-flash`，`reasoningEffort: max`；默认用途路由是 `opencode-go` / `deepseek-v4.1-flash`。
- 客户端语言保持 `en`：因为镜像没有已保存的用户设置，而运行中的宿主显示英文，所以 Profile 把 `@deepseek-ai/dsh-client-locale` 固定为 `preference: en`。`anago-fonts` 配置项挂载 `@anago-harness/client-ui-fonts-anago`。
- Web 宿主绑定容器网卡；podman 把它发布到 `100.110.252.31:8083`（Web 宿主拒绝绑定 `0.0.0.0`）。

修改此处任何内容后都要重新构建镜像；Profile 是镜像内容，不是运行时状态。

## 出站隔离

fork 不得访问 DeepSeek 或中国域名的端点，因此 `run.sh` 为 `api.deepseek.com`、`chat.deepseek.com`、`platform.deepseek.com`、`download.deepseek.com`、`www.deepseek.com`、`dsh-otel-collector.deepseeksvc.com` 与 `registry.npmmirror.com` 添加 `--add-host <name>:127.0.0.1`。对其中任一主机的请求会立即失败并出现在容器日志中，而不是悄悄成功。只有当 fork 有意开始使用某个主机时，才从 `run.sh` 的 `BLACKHOLED` 中删除对应条目。

## 如何测试

1. 打开打印出的 URL（`http://100.110.252.31:8083/?token=...`）。不带令牌的 URL 返回 `401`；带令牌的 URL 返回 `303` 并设置浏览器会话。界面是英文，这与运行中的配置一致。
2. 用英文发送一条消息，例如 `Reply with the single word: ready`。回复必须是日文（`response-language` 系统提示词章节）。
3. 日文文本必须以 UDEV Gothic 渲染（汉字与假名），拉丁字符以 Noto Sans JP 渲染，代码以 Intel One Mono 渲染，这些都来自 `anago-fonts` 样式表。用浏览器开发者工具检查任一元素：文本的 `font-family` 解析为 `"UDEV Gothic", "Noto Sans JP", ...`，代码解析为 `"Intel One Mono", "UDEV Gothic", ...`。
4. 没有 DeepSeek 登录：设置中没有账户入口，也没有登录提示。组合配置中已禁用 DeepSeek 账户、遥测与反馈配置项。
5. Orchestrator 模式：preset 选择器列出 `orchestrator`，用它开始对话不得报错。组合配置默认选择它。
6. 在消息中委派给 Claude Code：

   ```text
   Use subagent_claude_code with permission_mode "plan" and prompt
   "Reply with the single word: ready". Then report what it returned.
   ```

   模型会以 `{"prompt": "...", "permission_mode": "plan"}` 调用 `subagent_claude_code`。允许的模式是 `dontAsk`、`acceptEdits`、`auto` 与 `plan`；提供方默认值是 `auto`。如果出现审批卡片，请在 Web UI 中批准该工具调用。
7. 确认容器日志中没有被跳过的 bundle、没有 preset 警告，也没有访问被屏蔽主机的网络失败：

   ```sh
   podman logs anago-verify-8083 2>&1 | grep -Ei 'skipping profile bundle|agent preset|deepseek|npmmirror|error' || echo clean
   ```
