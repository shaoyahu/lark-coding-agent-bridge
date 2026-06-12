# lcb 指令手册

本文档整理当前项目可用的指令，分为两类：

- 飞书内斜杠命令：在 bot 私聊、群聊或话题里发送，以 `/` 开头。
- 本机 CLI 命令：在终端里执行 `lcb ...`。

说明：

- 群聊和话题群默认需要先 `@bot`，私聊不需要。
- 管理类飞书命令需要 bot owner 或管理员权限。
- 路径示例请替换成本机真实路径。
- `@某人` 指飞书消息里的用户 mention，不是手写 open_id。

## 飞书内斜杠命令

| 指令 | 作用 | 示例 | 解释 |
| --- | --- | --- | --- |
| `/new` | 清空当前 chat 或话题的会话，并中断当前任务。 | `/new` | 之后下一条普通消息会开启新 agent 会话。Codex 会归档当前 thread，Claude 会清掉当前 session。 |
| `/reset` | `/new` 的别名。 | `/reset` | 与 `/new` 等价，用于重开当前上下文。 |
| `/new chat [name]` | 创建一个新的私有群，并把你拉进去。 | `/new chat Device Wizard 开发` | 新群会继承当前 cwd，适合为一个任务开独立群和独立会话。需要 bot 具备 `im:chat` 权限。 |
| `/cd <path>` | 切换当前 scope 的工作目录，并重置会话。 | `/cd ~/code/my-project` | 只接受绝对路径或 `~/...`。切换后当前运行会被中断，后续 agent 在新 cwd 下执行。 |
| `/ws` | 列出命名工作目录。 | `/ws` | 等同 `/ws list`，会返回当前 cwd 和可切换的工作目录卡片。 |
| `/ws list` | 列出命名工作目录。 | `/ws list` | 展示当前 scope 下保存过的 workspace alias，并提供切换/删除按钮。 |
| `/ws save <name>` | 把当前 cwd 保存为命名工作目录。 | `/ws save frontend` | 之后可以用 `/ws use frontend` 快速切回。保存前需要当前 chat 已有 cwd。 |
| `/ws use <name>` | 切换到某个命名工作目录，并重置会话。 | `/ws use frontend` | 会校验目标目录仍然存在且安全，然后中断当前任务并清空当前 session。 |
| `/ws remove <name>` | 删除某个命名工作目录别名。 | `/ws remove frontend` | 只删除别名，不删除磁盘上的真实目录。`/ws rm <name>` 也可用。 |
| `/ws rm <name>` | `/ws remove <name>` 的别名。 | `/ws rm frontend` | 适合快速删除 workspace alias，不影响真实目录。 |
| `/resume [N]` | 列出最近可恢复的历史会话。 | `/resume 10` | 私聊中使用，最多显示 20 条；默认 5 条。Codex 展示 thread，Claude 展示 session。 |
| `/resume use <token>` | 恢复 `/resume` 生成的候选会话。 | `/resume use a1b2c3d4e5f6` | token 有效期 10 分钟，且只能在相同 agent、cwd、权限策略和 scope 下使用。通常点卡片按钮即可。 |
| `/status` | 查看当前运行状态。 | `/status` | 显示 profile、cwd、session/thread、agent、权限、lark-cli 身份、队列、active run、owner API 状态等。 |
| `/help` | 显示帮助卡片。 | `/help` | 返回常用命令和快捷按钮。 |
| `/account` | 查看当前飞书/Lark 应用凭据状态。 | `/account` | 显示 appId、tenant、bot 名称，并提供更换凭据入口。 |
| `/account change` | 打开更换 appId/appSecret 的表单。 | `/account change` | 提交后会校验凭据、加密保存 secret，并重连 bridge。 |
| `/account submit` | 账号表单提交回调。 | 点击 `/account change` 卡片里的提交按钮 | 这是卡片内部指令，通常不手动输入；会读取表单里的 appId/appSecret/tenant。 |
| `/account cancel` | 账号表单取消回调。 | 点击 `/account change` 卡片里的取消按钮 | 这是卡片内部指令，通常不手动输入；会收起或撤回账号表单。 |
| `/config` | 打开配置表单。 | `/config` | 可调整回复模式、工具调用展示、并发数、全局 idle timeout、群聊是否需要 @、lark-cli 身份策略和访问控制摘要。 |
| `/config submit` | 配置表单提交回调。 | 点击 `/config` 卡片里的保存按钮 | 这是卡片内部指令，通常不手动输入；会保存表单中的偏好和访问控制相关设置。 |
| `/config cancel` | 配置表单取消回调。 | 点击 `/config` 卡片里的取消按钮 | 这是卡片内部指令，通常不手动输入；会把表单更新为取消状态。 |
| `/stop` | 停止当前 scope 的正在运行任务。 | `/stop` | 对当前 chat 或话题生效。卡片底部的终止按钮也会触发同类逻辑。 |
| `/stop <scope>` | 管理员停止指定 scope 的任务。 | `/stop comment:abc123` | 常用于停止云文档评论任务或其他非当前 chat 的任务。普通用户不能指定 scope。 |
| `/timeout` | 查看当前 session 的 idle watchdog 设置。 | `/timeout` | 显示当前 session 覆盖值和全局默认值，并返回可用语法。 |
| `/timeout <N>` | 设置当前 session 的无输出超时分钟数。 | `/timeout 10` | N 范围为 1 到 120。agent 在没有事件输出达到该时长后会被停止并标记超时。 |
| `/timeout off` | 关闭当前 session 的 idle watchdog。 | `/timeout off` | 写入 session 级覆盖值 `0`，即使全局开启也不触发该 session 的探活。 |
| `/timeout default` | 清除当前 session 的 timeout 覆盖。 | `/timeout default` | 之后回退到 `/config` 里的全局默认。 |
| `/timeout comment:<scopeHash> <N>` | 管理员设置评论任务 scope 的 timeout。 | `/timeout comment:ab12cd 15` | 用于云文档评论任务；也支持 `off` 和 `default` 语义。 |
| `/ps` | 列出本机正在运行的 bridge bot 进程。 | `/ps` | 返回短 id、序号、bot/app 信息和启动时间，并标记当前正在回复的 bot。 |
| `/exit <id\|#>` | 停止指定 bridge bot 进程。 | `/exit 59b3` | `id` 是 `/ps` 里的短 id，`#` 是序号。停止当前 bot 时会先回复再退出。 |
| `/reconnect` | 立即停止当前运行并重连 WebSocket。 | `/reconnect` | 适合网络抖动或 bot 长连接状态异常时使用。会暂停新任务、停止所有 active run，然后重启连接。 |
| `/reconnect --wait` | 等当前运行结束后再重连。 | `/reconnect --wait` | 不主动杀掉当前任务，等待所有 active run 完成后再执行重连。 |
| `/doctor [描述]` | 执行低敏诊断和 agent echo 检查。 | `/doctor 飞书消息一直卡在正在思考` | 会检查工作目录、权限策略、队列状态，并启动一次 session-less echo run。群里触发时详细结果会私信给操作者。30 秒内同一用户限触发一次。 |
| `/doc` | 说明云文档评论用法。 | `/doc` | 当前云文档评论不需要绑定工作区；在支持的文档评论里 `@bot` 即可触发回复。 |
| `/invite user @某人` | 允许某个用户私聊使用 bot。 | `/invite user @张三` | 把被 mention 用户加入 `allowedUsers`。只有 owner/admin 可用。 |
| `/invite admin @某人` | 添加访问控制管理员。 | `/invite admin @李四` | 管理员可使用 `/config`、`/invite`、`/remove`、`/ps`、`/exit` 等管理命令。 |
| `/invite group` | 允许当前群使用 bot。 | `/invite group` | 只能在群里发，把当前群加入响应群名单。私聊里没有群 chat_id，不能使用。 |
| `/invite all group` | 把 bot 所在的所有已知群加入响应群名单。 | `/invite all group` | 会拉取 bot 已知群列表并批量加入 `allowedChats`，适合首次开放多个群。 |
| `/remove user @某人` | 从允许私聊用户名单中移除用户。 | `/remove user @张三` | 只移除访问名单，不影响飞书用户或群成员关系。 |
| `/remove admin @某人` | 移除管理员。 | `/remove admin @李四` | 被移除后不再具备管理命令权限。 |
| `/remove group` | 从响应群名单中移除当前群。 | `/remove group` | 只能在要移除的群里发。移除后该群普通成员无法再使用 bot，owner/admin 仍可管理。 |

## 飞书普通消息

| 指令 | 作用 | 示例 | 解释 |
| --- | --- | --- | --- |
| 普通文本消息 | 把消息转发给本机 agent。 | `帮我看一下这个项目结构` | 私聊可直接发；群聊默认需要 `@bot 帮我看一下这个项目结构`。短时间连续消息会合并处理。 |
| 回复/引用消息 | 带上被引用消息作为上下文。 | 回复某条消息并输入 `继续处理这个问题` | bridge 会尝试拉取引用消息内容，和当前输入一起构造成 prompt。 |
| 附件或图片 | 作为 agent 输入资源。 | 发送截图并说 `分析这个报错` | bridge 会按附件策略缓存和过滤资源。Codex 只把 accepted image path 通过 `--image` 传入。 |
| 云文档评论 `@bot` | 在支持的云文档评论线程中触发 agent 回复。 | 在文档评论里 `@哭哭香蕉 总结这段` | 评论运行复用文档级 session key；无需 `/doc` 绑定工作区。 |

## 本机 lcb CLI 命令

| 指令 | 作用 | 示例 | 解释 |
| --- | --- | --- | --- |
| `lcb --version` | 查看当前 lcb 版本。 | `lcb --version` | 等同 `lcb -v`。 |
| `lcb --help` | 查看顶层 CLI 帮助。 | `lcb --help` | 展示可用的顶层命令和通用选项。多数子命令也支持 `--help`。 |
| `lcb <command> --help` | 查看某个子命令帮助。 | `lcb profile create --help` | 展示该子命令支持的参数和说明。 |
| `lcb run` | 在前台运行 bridge。 | `lcb run --profile codex` | 适合开发调试，会在当前终端显示连接、消息 intake 和 stderr 等日志。 |
| `lcb run --agent <claude\|codex>` | 首次启动或 bootstrap 时指定 agent 类型。 | `lcb run --agent codex` | 已有 profile 通常由 profile 配置决定 agent。 |
| `lcb run --workspace <path>` | 首次创建 profile 时指定默认工作目录。 | `lcb run --agent codex --workspace ~/code/my-project` | 若 profile 已存在，工作目录通常通过飞书 `/cd` 或配置文件管理。 |
| `lcb run --app-id <id> --app-secret <secret>` | 使用已有飞书/Lark 应用凭据启动。 | `lcb run --app-id cli_xxx --app-secret xxx --tenant feishu` | 避免 QR 创建新应用。共享机器上不建议把 secret 明文写进 shell history。 |
| `lcb run -c <path>` | 指定配置文件。 | `lcb run -c ~/.lark-channel/config.json` | 配置根目录由该 config 路径所在目录决定。 |
| `lcb run --skip-check-lark-cli` | 跳过 lark-cli 预检。 | `lcb run --profile codex --skip-check-lark-cli` | 预检包含 auto-install/bind 等流程；只有确认环境已就绪时再跳过。 |
| `lcb migrate` | 迁移旧版 bridge 配置和状态。 | `lcb migrate --profile codex --agent codex` | 把 legacy config/state 移到当前 profile 布局。 |
| `lcb profile list` | 列出本机配置的 profiles。 | `lcb profile list` | 显示 active profile、agent 类型、运行状态等摘要。 |
| `lcb profile create <name>` | 创建 profile。 | `lcb profile create codex --agent codex --workspace ~/code/app` | 可通过 QR 注册或传入已有 app 凭据创建独立 profile。 |
| `lcb profile use <name>` | 切换默认 active profile。 | `lcb profile use codex` | 影响后续未显式指定 `--profile` 的启动命令。 |
| `lcb profile remove <name>` | 归档 profile 和本地状态。 | `lcb profile remove codex-dev` | 默认移入 `.trash`，不是永久删除。 |
| `lcb profile remove <name> --purge --yes` | 永久删除 profile。 | `lcb profile remove codex-dev --purge --yes` | 这是破坏性操作，会删除 profile 本地状态。 |
| `lcb profile export <name>` | 导出 profile 配置。 | `lcb profile export codex --output ./codex-profile.json` | 默认不包含敏感 secret。 |
| `lcb profile export <name> --include-secrets --yes` | 带 secret 导出 profile。 | `lcb profile export codex --include-secrets --yes --output ./full.json` | 会导出敏感信息，只在安全环境下使用。 |
| `lcb ps` | 列出本机运行中的 bridge 进程。 | `lcb ps` | 终端版的进程查看，和飞书 `/ps` 类似。 |
| `lcb kill <target>` | 停止前台/注册表中的 bridge 进程。 | `lcb kill 59b3` | target 可用短 id 或列表序号。先 SIGTERM，超时后 SIGKILL。 |
| `lcb start` | 安装并启动系统托管 daemon。 | `lcb start --profile codex` | macOS 使用 launchd，Linux 使用 systemd user，Windows 使用 schtasks。适合长期后台运行。 |
| `lcb stop` | 停止系统托管 daemon。 | `lcb stop --profile codex` | 卸载/停止服务，但保留服务定义文件。 |
| `lcb restart` | 重启系统托管 daemon。 | `lcb restart --profile codex` | 常用于配置修改后重启后台 bot。 |
| `lcb status` | 查看系统服务状态。 | `lcb status --profile codex` | 输出 pid、最近退出状态和 daemon 日志路径。 |
| `lcb unregister` | 移除系统服务注册。 | `lcb unregister --profile codex` | 停止服务并删除 launchd/systemd/schtasks 注册文件，不删除 profile 数据。 |
| `lcb secrets set --app-id <id>` | 加密保存某个 App Secret。 | `lcb secrets set --app-id cli_xxx --profile codex` | 会交互式输入 secret，不回显。secret 存在 profile 本地 keystore。 |
| `lcb secrets list` | 列出 keystore 里的 secret id。 | `lcb secrets list --profile codex` | 只显示 id，不显示 secret 明文。 |
| `lcb secrets remove --app-id <id>` | 删除某个 App Secret。 | `lcb secrets remove --app-id cli_xxx --profile codex` | 从 profile keystore 中移除对应 secret。 |
| `lcb secrets get` | exec-provider 内部协议。 | `printf '{}' \| lcb secrets get` | 主要供 `lark-cli config bind --source lark-channel` 调用；日常用户一般不直接执行。 |

## 常用组合示例

| 场景 | 示例 | 解释 |
| --- | --- | --- |
| 启动一个 Codex 前台 bot | `lcb run --profile codex --agent codex` | 连接飞书长连接，并把消息转给本机 Codex CLI。 |
| 创建并启用 Codex profile | `lcb profile create codex --agent codex --workspace ~/code/app` | 创建独立配置、凭据、会话、日志和默认工作目录。 |
| 在飞书切到项目目录 | `/cd ~/code/app` | 当前 chat 后续任务都以该目录为 cwd，并重置会话。 |
| 保存常用项目目录 | `/ws save app` | 把当前 cwd 保存成 `app`，之后用 `/ws use app` 切回。 |
| bot 看起来卡住时设置超时 | `/timeout 3` | 当前 session 3 分钟无事件输出就自动终止，避免无限等待。 |
| bot 网络状态异常时重连 | `/reconnect` | 停止当前任务并重建 WebSocket 连接。 |
| 更换飞书应用凭据 | `/account change` | 在飞书卡片里输入新 appId/appSecret，保存后自动重连。 |
| 排查问题 | `/doctor 消息一直停在正在思考` | 收集低敏诊断、工作目录和 agent echo 检查结果。 |
