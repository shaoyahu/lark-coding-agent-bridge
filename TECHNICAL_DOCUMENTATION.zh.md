# lark-channel-bridge 技术文档

本文基于当前仓库的源码、README、配置文件和测试契约整理，面向维护、二次开发和排障。项目是一个 TypeScript ESM CLI 包，用飞书 / Lark PersonalAgent 长连接把聊天、话题和云文档评论事件桥接到本机 Claude Code 或 Codex CLI，并把本机 agent 的流式事件渲染回飞书消息或卡片。

## 0. 阅读范围与依据

本技术文档覆盖当前仓库内的项目源码、测试契约和构建配置：

- 源码：`src/` 下 97 个 TypeScript 文件。
- 测试：`tests/` 下 94 个测试与辅助文件。
- 入口与发布配置：`bin/lark-channel-bridge.mjs`、`package.json`、`tsconfig.json`、`tsup.config.ts`。
- 用户文档：`README.md`、`README.zh.md`。
- 未纳入实现分析的内容：`node_modules/`、`dist/`、覆盖率输出、外部依赖源码和运行时用户目录。

代码规模约 3.9 万行 TypeScript。本文按运行链路、模块边界、状态持久化、安全策略和测试契约组织，而不是逐文件罗列。

## 1. 项目定位

`lark-channel-bridge` 的核心职责是把飞书 / Lark 变成本机 coding agent 的远程交互面：

- 接收私聊、群聊、话题群、云文档评论中的用户请求。
- 将消息、引用、卡片、附件、评论上下文包装为结构化 prompt。
- 以统一接口启动 Claude Code 或 Codex CLI。
- 将 agent 的文本、thinking、工具调用、用量、终态事件统一渲染回飞书。
- 为不同 chat / topic / doc comment 维护独立会话、工作目录和运行状态。
- 提供 profile、访问控制、权限模式、后台服务、lark-cli profile-local 身份、secret 管理等运维能力。

## 2. 技术栈与入口

- 运行环境：Node.js `>=20.12.0`。
- 语言与模块：TypeScript，ESM。
- 构建：`tsup`，生成 `dist/cli.js` 和 `dist/index.js`。
- CLI：`commander`。
- Lark 通道：`@larksuite/channel`。
- 测试：`vitest`。
- 并发与锁：`proper-lockfile` 加自定义 registry / lock metadata。

关键入口：

- `bin/lark-channel-bridge.mjs`：npm bin shim，加载构建后的 CLI。
- `src/cli/index.ts`：宿主 CLI 命令注册。
- `src/cli/commands/start.ts`：前台 `run` 主流程。
- `src/bot/channel.ts`：飞书长连接、消息 intake、队列、run 提交和渲染主链路。
- `src/index.ts`：库导出，只暴露卡片渲染、文本渲染、run state 和 telemetry 类型。

## 3. 目录结构

```text
src/
  agent/        Claude / Codex adapter、prompt、preflight、事件标准化
  bot/          Lark channel 事件处理、pending queue、comment、run flow
  card/         CardKit 2.0 渲染、callback 签名、托管卡片
  cli/          宿主 CLI、start/service/profile/secrets/migrate/ps
  commands/     飞书内 slash command
  config/       schema、profile、permissions、secret、路径、迁移
  core/         logger、telemetry
  daemon/       launchd / systemd / schtasks 适配
  lark-cli/     lark-cli source projection 和身份策略
  media/        附件下载、hash、缓存、策略
  platform/     atomic write、spawn 封装
  policy/       访问控制、工作目录、run policy、fingerprint
  runtime/      RunExecutor、process registry、runtime locks、profile runtime
  session/      session store、agent-aware catalog、history
  utils/        Feishu / Lark 凭据校验
  workspace/    scope 到 cwd / alias 的持久化
tests/
  unit/         单模块契约
  integration/  跨模块行为
  process/      子进程 argv/env/事件契约
  static/       静态架构约束
```

## 4. 运行主链路

前台启动链路：

1. `lcb run` 进入 `src/cli/index.ts`。
2. `runStart()` 调用 `resolveProfileRuntime()` 解析或创建 profile。
3. 运行 preflight：配置完整性、lark-cli source projection、agent 可执行文件检查。
4. 根据 profile 创建 `ClaudeAdapter` 或 `CodexAdapter`。
5. 获取 profile lock 和 app lock，避免同 profile 或同 app 多实例。
6. 加载 `SessionStore`、`SessionCatalog`、`WorkspaceStore`。
7. 将当前进程写入 runtime registry。
8. `startChannel()` 建立 Lark WebSocket 长连接。
9. message / cardAction / comment 事件进入各自 handler。
10. 普通消息经访问控制、命令分发、pending queue、run policy 后提交给 `RunExecutor`。
11. `RunExecutor` 启动本机 agent 子进程，把事件 fanout 给渲染器和 session recorder。
12. 渲染器把 `AgentEvent` reduce 为 `RunState`，再发送 card / markdown / text 回复。

后台服务链路与前台一致，只是由 `launchd`、`systemd --user` 或 Windows Task Scheduler 运行：

```text
node <bridge-entry> run --profile <profile>
```

## 5. Agent 抽象层

### 5.1 统一事件模型

`src/agent/types.ts` 定义 `AgentEvent`，所有渲染和 session 逻辑都只依赖该模型：

- `system`：sessionId、threadId、cwd、model。
- `text`：正文增量。
- `thinking`：thinking 增量。
- `tool_use` / `tool_result`：工具调用开始和结果。
- `usage`：token、cost 等用量。
- `done` / `error`：终态，必须带 termination reason。

这使 Claude / Codex 差异被隔离在 `src/agent/claude/*` 和 `src/agent/codex/*`。

### 5.2 ClaudeAdapter

`src/agent/claude/adapter.ts` 运行 Claude Code：

- 使用 `claude -p <prompt> --output-format stream-json --verbose`。
- 通过 `--append-system-prompt` 注入 bridge system prompt。
- 通过 `--resume <sessionId>` 恢复 Claude 会话。
- 可传 `--model`。
- 子进程 cwd 必须由 policy 先解析。
- stop 先发 `SIGTERM`，等待 `stopGraceMs`，再 `SIGKILL`。
- `src/agent/claude/stream-json.ts` 将 Claude stream-json 翻译为 `AgentEvent`。

### 5.3 CodexAdapter

`src/agent/codex/adapter.ts` 运行 Codex CLI：

- 参数由 `src/agent/codex/argv.ts` 生成。
- 新 run 使用 `aiden x codex exec --json ... -`。
- 恢复 run 使用 `aiden x codex exec ... resume --json <threadId> -`。
- 启动前预检使用 `aiden x codex --help` 验证 Aiden X 的 Codex 入口可用。
- prompt 通过 stdin 传入，并由 bridge system prompt 前缀包装。
- sandbox 由 bridge access mode 映射：`read-only`、`workspace-write`、`danger-full-access`。
- 默认继承用户 `CODEX_HOME`，除非 profile 指定 `codexHome` 或 `inheritCodexHome: false`。
- `src/agent/codex/jsonl.ts` 将 Codex JSONL 翻译为 `AgentEvent`。

### 5.4 Prompt 结构

`src/agent/prompt.ts` 生成结构化 prompt：

- `<bridge_context>`：chat、sender、thread、mentions、botOpenId、source。
- `<bridge_instructions>`：bridge 运行约束。
- `<quoted_messages>`：引用消息内容。
- `<interactive_cards>`：交互卡 JSON。
- `<comment_context>`：评论上下文。
- `<user_input>`：用户输入和附件列表。

`safeJsonStringify()` 会转义 `<`、`>`、`&`，避免用户文本闭合 bridge 标签。`src/agent/bridge-system-prompt.ts` 进一步约束 agent 不要输出内部标签、不要绕开 bridge-bound lark-cli 环境、卡片回调必须使用签名 token、OAuth 必须前台阻塞执行。

## 6. Lark 消息链路

### 6.1 Channel 初始化

`startChannel()` 创建 `@larksuite/channel` 时做了几个关键选择：

- `dmMode: open`，SDK 不负责最终授权，bridge 自己做访问控制。
- `requireMention: false`，群聊 mention 策略由 bridge profile 决定。
- `respondToMentionAll: false`，永不响应 `@all`。
- 禁用 SDK chatQueue，使用自定义 `PendingQueue`。
- `includeRawEvent: true`，保留 sender_type 和 CardKit form_value 等 raw 字段。
- 设置 WS ping timeout、handshake timeout、REST timeout 和 proxy env 支持。

### 6.2 Intake 规则

`intakeMessage()` 的执行顺序：

1. `ChatModeCache` 解析 chat mode：`p2p`、`group`、`topic`。
2. 计算 scope：普通 chat 是 `chatId`，话题群是 `chatId:threadId`。
3. 访问控制：
   - 私聊允许 owner、allowedUsers、admins。
   - 群聊允许 owner、admins、allowedChats。
4. 群聊默认必须直接 mention bot；私聊不需要 mention。
5. slash command 优先处理，命令处理后取消该 scope 的 pending batch。
6. 普通消息进入 `PendingQueue` 等待合批。

### 6.3 PendingQueue

`src/bot/pending-queue.ts` 是按 scope 的 600ms 防抖队列：

- 短时间多条消息合并为一个 batch。
- scope 有 run 活跃时 `block(scope)`，消息继续累积但不 flush。
- run 结束后 `unblock(scope)`，重新等待 600ms 静默窗口。
- 命令绕过 pending queue，保证 `/stop`、`/new`、`/cd` 等可及时响应。

### 6.4 普通消息到 agent run

`runAgentBatch()` 负责：

- 下载并规范化附件。
- 拉取引用消息，topic root reply 不当作 quote。
- 构造 bridge prompt。
- topic 内回复加 `replyInThread`。
- 调用 `startRunFlow()` 统一处理 cwd、policy、session resume、RunExecutor。
- 根据 `messageReply` 渲染为：
  - `card`：CardKit 2.0，含工具块和停止按钮。
  - `markdown`：流式 markdown。
  - `text`：run 结束后一次性发送 markdown。

### 6.5 空闲超时

`processAgentStream()` 支持 per-scope 和全局 idle watchdog：

- `/timeout` 的 scope override 优先于 `preferences.runIdleTimeoutMinutes`。
- agent 在超时时间内没有事件则 stop。
- 有未完成 `tool_use` 时暂停 watchdog，避免长命令或 OAuth 等待被误杀。
- 终态映射为 `idle_timeout`。

## 7. 云文档评论链路

`src/bot/comments.ts` 独立处理 cloud-doc comment mention：

- 只处理 mention bot 的评论。
- 支持 `doc`、`docx`、`sheet`、`file`。
- 跳过 bridge 自己的回复，避免循环。
- 通过 `channel.comments.resolveTarget()` 解析 wiki / file target。
- 通过 `channel.comments.fetch()` 获取评论上下文。
- 从 reply content 提取问题，保留 docs_link URL。
- 构造纯文本导向 prompt，要求 agent 不调用评论接口，最终答案由 bridge 写回评论。
- 工作目录优先级：文档绑定 cwd、profile 默认 cwd、profile 托管默认 cwd。
- run scope 是 `comment:<digest>:<random>`，agent session scope 是文档维度 `doc:<digest>`。
- 同一文档已有评论 run 活跃时不复用 agent session，防止并发串话。
- 最终回复会去除常见 markdown，限制 2000 字。

评论入口不使用 IM 白名单，而是依赖文档权限和 comment mention；run policy 的 access reason 是 `comment-mention`。

## 8. RunExecutor 与运行互斥

`src/runtime/run-executor.ts` 是所有 agent run 的统一执行器：

- 生成唯一 runId。
- 检查 policy TTL。
- 检查 `ActiveRuns.pauseNewRuns()`，用于 reconnect drain。
- 按 scope reservation 防止同 scope 重复 run。
- 通过 `ProcessPool` 控制全局并发。
- 调用 `agent.prepareRun()` 和 `agent.run()`。
- 注册 active run，并在终态或错误后清理 activeRuns 与 pool slot。
- `EventFanout` 保证多个消费者订阅同一 agent 事件流时不会重复 spawn。
- 终态后等待 agent 进程退出；超时则 stop，避免 zombie / stdout hanging。

`src/bot/active-runs.ts` 提供：

- `reserve()`：运行前占位，避免并发提交 race。
- `register()` / `unregister()`。
- `interrupt(scope)`：用于 `/stop`、`/new`、`/cd`。
- `pauseNewRuns()`：用于 reconnect / disconnect。
- `stopAll()` / `waitForAll()`。

## 9. 状态与会话

### 9.1 路径模型

默认根目录是 `~/.lark-channel`，每个 profile 独立保存状态：

```text
~/.lark-channel/config.json
~/.lark-channel/active-profile
~/.lark-channel/profiles/<profile>/sessions.json
~/.lark-channel/profiles/<profile>/sessions.json.catalog.json
~/.lark-channel/profiles/<profile>/workspaces.json
~/.lark-channel/profiles/<profile>/secrets.enc
~/.lark-channel/profiles/<profile>/lark-cli/
~/.lark-channel/profiles/<profile>/lark-cli-source/config.json
~/.lark-channel/profiles/<profile>/media/
~/.lark-channel/profiles/<profile>/logs/
~/.lark-channel/registry/processes.json
~/.lark-channel/registry/locks/
```

### 9.2 SessionStore

`src/session/store.ts` 保存 legacy Claude session 和 scope idle timeout：

- key 是 scope。
- value 包含 `sessionId`、`cwd`、`updatedAt`、`idleTimeoutMinutes`。
- `resumeFor(scope, cwd)` 只有 cwd 匹配才返回 sessionId。
- `/new` 清掉 sessionId/cwd，但保留 idle timeout override。

### 9.3 SessionCatalog

`src/session/catalog.ts` 是 agent-aware catalog：

- key 由 `scopeId`、`agentId`、`cwdRealpath`、`policyFingerprint` 组成。
- Claude 记录 `sessionId`。
- Codex 记录 `threadId`。
- 支持 active / archived 状态和 GC。

恢复优先级：

- 有 catalog 命中时优先使用。
- Claude 无 catalog 命中时 fallback 到 legacy `SessionStore`。
- Codex 不读取 legacy Claude session。
- policy fingerprint 变化时不会恢复旧 session/thread。

### 9.4 WorkspaceStore

`src/workspace/store.ts` 保存：

- `chats`: scope 到 cwd。
- `named`: workspace alias 到 cwd。

`/cd`、`/ws use` 会切换 scope cwd 并重置 session。`/ws save` 的新 alias 会带 profile、owner、scope 前缀，同时兼容旧全局 alias。

## 10. 配置、权限与访问控制

### 10.1 ProfileConfig

v2 root config 包含多个 profile。profile 主要字段：

- `agentKind`
- `accounts.app`
- `preferences`
- `access`
- `workspaces`
- `permissions`
- 派生兼容字段 `sandbox`
- `codex`
- `attachments`
- `comments`
- `larkCli`

`profile-store` 保存时只序列化 canonical 字段，避免 runtime-only 字段污染磁盘配置。

### 10.2 权限模型

canonical access mode：

```text
read-only < workspace < full
```

映射关系：

| Bridge access | Codex sandbox | Claude permission |
| --- | --- | --- |
| `read-only` | `read-only` | `plan` |
| `workspace` | `workspace-write` | `acceptEdits` |
| `full` | `danger-full-access` | `bypassPermissions` |

`defaultAccess` 不能超过 `maxAccess`。运行时还会被 capability maxAccess 夹紧。旧 `sandbox` 可读，但会标准化到 `permissions`。

### 10.3 访问控制

`src/policy/access.ts` 使用 fail-closed 语义：

- `allowedUsers` 空不代表所有私聊用户可用。
- `allowedChats` 空不代表所有群可用。
- `admins` 空不代表无管理员限制。
- runtime owner 通过 Lark application owner API 刷新，并始终 bypass。

访问判定：

- 私聊：owner、allowed user、admin。
- 群聊：owner、admin、allowed chat。
- 管理命令：owner 或 admin。

### 10.4 工作目录安全

`src/policy/workspace.ts` 拒绝高风险 cwd：

- 文件系统根。
- Home 根。
- 用户根。
- Desktop / Downloads 等宽泛用户目录。
- tmp 根。
- 系统目录。
- volume 根。

cwd 是 agent 子进程当前目录，不等同于完整文件系统 sandbox。

### 10.5 RunPolicy

`evaluateRunPolicy()` 输出：

- `accessMode`
- Codex `sandbox`
- Claude `permissionMode`
- `policyFingerprint`
- `expiresAt`
- 附件策略结果

拒绝条件：

- access denied。
- 未验证 folder resource binding。
- required attachment 被拒绝。

`policyFingerprint` 由 cwd、sandbox、访问策略摘要、资源 scope、附件策略、Codex home 等组成，用于隔离 session/thread 恢复。

## 11. Secret 与 lark-cli 身份

### 11.1 Secret 解析

`accounts.app.secret` 支持：

- plain string。
- `${ENV}` 模板。
- `SecretRef`：`env` / `file` / `exec`。

`src/config/keystore.ts` 提供 profile-local 加密 keystore。`src/config/store.ts` 会生成 `secrets-getter` wrapper，让 lark-cli 通过 exec provider 读取 bridge keystore，避免把 secret 直接写入 lark-cli 配置。

### 11.2 profile-local lark-cli

每个 profile 独立使用：

```text
profiles/<profile>/lark-cli/
profiles/<profile>/lark-cli-source/config.json
```

agent 子进程注入：

- `LARK_CHANNEL=1`
- `LARK_CHANNEL_PROFILE`
- `LARK_CHANNEL_HOME`
- `LARK_CHANNEL_CONFIG`
- `LARKSUITE_CLI_CONFIG_DIR`

`larkCli.identityPreset`：

- `bot-only`：`strict-mode bot`，`default-as bot`。
- `user-default`：`strict-mode off`，`default-as auto`。

## 12. 附件与媒体缓存

`src/media/cache.ts` 和 `src/media/attachment.ts` 负责：

- 下载 Lark message resource。
- 按内容 hash 写入 cache，不把 file key 暴露到路径。
- 推断 MIME / 扩展名。
- 应用数量、总大小、单文件大小、图片大小限制。
- 输出 prompt attachment metadata。
- Codex 仅把 accepted image path 传入 `--image`。
- 启动时按 TTL 和 cacheMaxBytes 做 GC。

## 13. 卡片、回调与安全

`src/card/run-state.ts` 把 `AgentEvent` reduce 为 `RunState`。`src/card/run-renderer.ts` 输出 CardKit 2.0，`src/card/text-renderer.ts` 输出 markdown。

卡片渲染策略：

- thinking 放到折叠面板。
- 工具调用少量时逐个展示，多工具时折叠汇总，避免飞书元素大小限制。
- running 时显示 footer 和停止按钮。
- terminal 显示 done / interrupted / idle_timeout / error。

回调安全：

- 新回调 marker 是 `__bridge_cb`。
- 旧 `__claude_cb` 不再转发给 agent。
- `bridge_token` 由 `CallbackAuth` 签名，绑定 runId、scope、chatId、operatorOpenId、action、policyFingerprint、TTL。
- `CallbackNonceStore` 防重放。

## 14. 宿主 CLI 与后台服务

宿主命令：

- `run`：前台运行。
- `start` / `stop` / `restart` / `status` / `unregister`：OS service。
- `profile list/create/use/remove/export`：profile 管理。
- `secrets get/set/list/remove`：加密 secret 管理和 exec-provider 协议。
- `migrate`：v1 到 v2 配置迁移。
- `ps` / `kill`：本机 bridge 进程管理。

后台服务：

- macOS：LaunchAgent，label `ai.lark-channel-bridge.bot.<profile>`。
- Linux：systemd user unit，name `lark-channel-bridge.bot.<profile>.service`。
- Windows：Task Scheduler task，name `LarkChannelBridge.Bot.<profile>`。

服务定义会写入当前 PATH、`LARK_CHANNEL_HOME` 和 profile daemon log 路径。

## 15. Runtime registry 与锁

`src/runtime/registry.ts` 的 `processes.json` 记录：

- short id。
- pid。
- appId / tenant。
- profileName / agentKind。
- configPath。
- startedAt / version。
- botName。

用途：

- `ps` / `kill` / `/ps` / `/exit`。
- 启动时检测同 app 多实例冲突。
- v1 迁移前检测旧进程。

`src/runtime/locks.ts` 提供：

- profile lock：同 profile 单实例。
- app lock：同 appId 单实例，避免 Lark open-platform 随机路由长连接。

锁文件旁会写 `.meta.json`，便于 conflict / status 诊断。

## 16. Preflight 与迁移

Agent preflight：

- 检查 Claude / Codex `--version`。
- 区分 not found、not executable、resolve failed、timeout、signaled、nonzero、empty output。
- 错误会格式化为中文用户可读信息。

lark-cli preflight：

- 检查或尝试安装 lark-cli。
- 写 profile-local source projection。
- bind lark-channel source。
- 应用 identity policy。
- 尝试迁移本机同 app 用户授权到 profile-private lark-cli。
- 对旧 lark-cli source 能力做 legacy overlay 兼容。

v1 到 v2 迁移：

- 检查旧单 profile config。
- 检测活跃旧进程，避免边运行边迁移。
- 将旧 `sessions.json`、`workspaces.json`、`secrets.enc`、media、logs 等移入 profile 目录。
- 写 v2 root config 和 active-profile。
- 失败时 rollback 已移动状态。

## 17. 日志与可观测性

`src/core/logger.ts` 输出：

- profile logs 下按天滚动的 JSONL。
- 前台 stdout 的精选信息。

日志和 telemetry 会清洗敏感信息：

- credential / token / secret。
- open_id、chat_id 等外发时缩短。
- file key、doc token、media key。
- 本地 path / cwd。

`/doctor` 会读取近期日志尾部并再次脱敏，再做 workspace、policy、agent echo 检查。

## 18. 测试契约

测试分层体现维护边界：

- `tests/process/*-adapter.test.ts`：Claude/Codex argv、env、stdin、事件、spawn failure、stop。
- `tests/integration/executor/run-executor.test.ts`：runId、fanout、pool、pauseNewRuns、scope 互斥、清理。
- `tests/integration/session/resume.test.ts`：Claude/Codex 恢复隔离、policy fingerprint 不匹配不恢复。
- `tests/integration/bot/*.test.ts`：IM 运行、附件、访问门禁、topic quote、markdown startup failure、回调安全。
- `tests/integration/comments/*.test.ts`：评论 guard、生命周期、timeout、workspace fallback、回复格式。
- `tests/unit/config/*.test.ts`：profile schema、permissions、路径、profile store。
- `tests/unit/card/*.test.ts`：RunState、卡片快照、callback auth。
- `tests/static/contracts.test.ts`：架构静态约束，例如 bot/card 共享代码不直接依赖 Codex internals、状态写入必须 atomic 0600。

推荐验证顺序：

```bash
pnpm test
pnpm typecheck
pnpm build
```

## 19. 扩展与改造注意事项

- 新 agent 类型应先实现 `AgentAdapter`，再补充 capability、session identity、history provider、profile schema。
- 不要让 `src/bot` 或 `src/card` 直接依赖某个 agent 的内部协议；应保持只依赖统一 `AgentEvent`。
- 改 run policy 时必须考虑 `policyFingerprint`，否则可能错误复用旧 session/thread。
- 改访问控制时必须保持 fail-closed 语义，owner bypass 由 runtime owner refresh 提供。
- 改 profile 持久化时应继续使用 atomic write 和 `0o600`。
- 改 lark-cli 相关逻辑时必须保持 profile-local `LARKSUITE_CLI_CONFIG_DIR`，不要回退到用户全局配置。
- 改评论链路时不要让 agent 自行调用评论回复接口，bridge 才是评论写回方。
- 改卡片回调时必须保留签名 token 和 nonce 防重放。
- 改消息队列时要保持“同 scope 单 run，运行中消息累积到下一批”的用户体验。
