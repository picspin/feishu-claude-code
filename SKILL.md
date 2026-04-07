---
name: feishu-claude-code
description: 飞书 Claude Code 桥接。通过飞书事件订阅 Webhook 把飞书 IM 文本消息接入本地 Claude Code，并将回复发回飞书。
---

# Feishu Claude Code Bridge

让飞书 IM 用户通过本地 daemon 与 Claude Code 对话。

## 当前能力

- 接收飞书事件订阅 Webhook 的文本消息、图片、文件与富文本链接
- 支持飞书 challenge 校验与 schema 2.0 事件
- 支持加密事件体解密
- 为每个 `chat_id` 维护独立 Claude 会话
- 将 Claude 文本回复发回飞书
- 下载图片/文件到 `~/.feishu-claude-code/runtime/...`，供 Claude 读取
- 在飞书内处理简单权限批准/拒绝（回复 `y` / `n`）
- 支持基础命令：`/help`、`/clear`、`/status`、`/permission [mode]`、`/model [name]`、`/skills`
- 提供 `npm run daemon -- <start|stop|restart|status|logs>` 后台运行入口

## 安装

```bash
cd ~/.claude/skills/feishu-claude-code
npm install
```

## 配置环境变量

至少需要：

```bash
export FEISHU_APP_ID=your_app_id
export FEISHU_APP_SECRET=your_app_secret
export FEISHU_VERIFICATION_TOKEN=your_verification_token
export FEISHU_PUBLIC_BASE_URL=https://feishu-cc.example.com
```

如果飞书事件订阅开启了加密，还需要：

```bash
export FEISHU_ENCRYPT_KEY=your_encrypt_key
```

## 初始化

```bash
cd ~/.claude/skills/feishu-claude-code
npm run setup
```

这会写入 `~/.feishu-claude-code/config.json`。如果设置了 `FEISHU_PUBLIC_BASE_URL`，启动与 setup 提示会优先显示这个固定公网地址。

## 启动

```bash
cd ~/.claude/skills/feishu-claude-code
npm run start
```

或后台运行：

```bash
cd ~/.claude/skills/feishu-claude-code
npm run daemon -- start
```

默认监听：

```text
http://127.0.0.1:8787/feishu/webhook
```

推荐使用你个人 Cloudflare 账号下的 named tunnel，并把固定域名写入 `FEISHU_PUBLIC_BASE_URL`。这样 setup/start 输出会始终显示稳定的飞书回调地址。

## Cloudflare named tunnel 建议配置

示例 `~/.cloudflared/config.yml`：

```yaml
tunnel: <your-tunnel-id>
credentials-file: /Users/hilbert/.cloudflared/<your-tunnel-id>.json
ingress:
  - hostname: feishu-cc.example.com
    service: http://127.0.0.1:8787
  - service: http_status:404
```

启动 named tunnel 后，把：

```bash
export FEISHU_PUBLIC_BASE_URL=https://feishu-cc.example.com
```

再执行：

```bash
cd ~/.claude/skills/feishu-claude-code
npm run setup
npm run start
```

## 飞书开放平台建议配置

订阅事件：
- `im.message.receive_v1`

机器人权限至少需要：
- 接收与发送消息相关权限

## 验证

1. 在飞书事件订阅中完成 challenge 校验
2. 给机器人发送文本、图片、文件或 rich text 链接消息
3. 检查 `npm run daemon -- logs` 输出，或查看 `~/.feishu-claude-code/logs/stdout.log` 与 `~/.feishu-claude-code/logs/stderr.log`
4. 确认附件被下载到 `~/.feishu-claude-code/runtime/...`
5. 确认飞书能收到 Claude 回复
6. 测试权限请求时在飞书回复 `y` / `n`

## 当前限制

- 当前飞书出站回复仍以纯文本为主
- 附件理解质量依赖 Claude 侧当前可用的本地文件、图片、PDF 处理能力/skills
- 语音 / media 的专用处理尚未完全产品化
- 云文档当前主要以链接透传，尚未稳定导出为本地文件
- 群聊 @ 策略、安装脚本、自启动仍可继续完善
- 当前出站发送逻辑内置在 skill 中；后续可继续收敛到已有 `feishu-mcp`
