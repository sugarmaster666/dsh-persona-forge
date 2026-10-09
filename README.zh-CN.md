# dsh-persona-forge

给 [DeepSeek Harness](https://www.npmjs.com/package/@deepseek-ai/dsh) 用的**角色扮演提示词改写插件**。

在输入框里选一个角色，你的草稿会在发出前由 harness 的模型改写成该角色的口吻 —— 并且**跟随当前会话正在使用的模型**。你可以选择改写后直接发出，或先回到输入框人工审查。

> **状态：** 早期版本（`0.1.x`）。角色卡格式与 HTTP 契约已足够稳定，可以基于它开发；但请预期增量变化，升级前先看变更记录。

---

## 它做什么，不做什么

它改写的是**你的消息**。它不碰系统提示词、不碰工具列表、不碰会话配置，也**绝不在你明确操作之前改动你的草稿**。

| | |
|---|---|
| **会改变** | 你即将发出的那条消息的语气、语域与框架 |
| **绝不改变** | 你的技术需求、约束、路径、标识符、数字、代码 —— 以及你未确认前的草稿 |
| **用哪个模型** | 当前会话正在用的那个 provider/model，没有单独的模型设置 |
| **会话历史** | 改写调用是独立的：不产生 turn、不能调用工具、不进入会话日志。会话里记录的，就是你实际发出的那段文字 |

### 关于人设到底改变什么

人设指令改变的是**风格、语域、篇幅和顺从度** —— 模型多快同意你、多愿意反驳你。它**不会**抬高模型的能力上限：不存在一个等着被点名唤醒的「潜能区」。

用之前该知道两件事：

1. 把人设写成「你是祈求者、模型是权威」，会让模型**更少质疑你的方案**。对编码任务这通常是净负收益 —— 你要的是「这里有问题」，不是恭敬。
2. 「更长更华丽」极容易被误读成「更好」。一般并不是。

所以：用它调语气和框架，**保持审查模式**，判断标准是**你的需求有没有活下来**，而不是听起来多厉害。

---

## 安装

插件**没有任何依赖，也没有构建步骤**，所以下面几种方式装到的文件完全一样。

### 桌面版

1. 点击侧边栏 **插件**。
2. 点右上角的 **添加插件**。
3. 在弹出的对话框里，往「包名或地址」这一栏粘贴 npm 包名或仓库地址：

   ```
   dsh-persona-forge
   ```

   ```
   https://github.com/sugarmaster666/dsh-persona-forge
   ```

4. 点 **安装**，启用插件并重启 DSH。

> 桌面版的 profile 由 Electron 应用独占管理，因此
> `dsh plugin --profile desktop add ...` 会被设计性地拒绝。桌面版请走 GUI；
> 下面的命令行方式用于 `dsh web` 这类自管 profile。

### 命令行版（`dsh web` 这类自管 profile）

```bash
# 从 npm 装（推荐）
dsh plugin --profile web add dsh-persona-forge

# 装 GitHub 上的最新源码
dsh plugin --profile web add github:sugarmaster666/dsh-persona-forge
```

然后重启 harness。

### 验证

插件行应显示为 `active`：

```
plugin_manager  action: list_plugins
```

打开任意会话，在输入框工具行左侧找 🎭 控件。**设置 → 角色扮演** 是角色卡管理页。

### 更新

```bash
dsh plugin --profile web update dsh-persona-forge
```

GitHub 安装通过重新安装来更新：

```bash
dsh plugin --profile web add github:sugarmaster666/dsh-persona-forge
```

**替换**已安装的包需要**重启**才能加载新的模块代 —— 新装的 bundle 可以通过
HMR 激活，被替换的不行。

### 卸载

```bash
dsh plugin --profile web remove dsh-persona-forge
```

你的角色卡**不会**被删除：它们在 `~/.dsh/persona-cards/`，位于包之外。
想一并清掉就手动删那个目录。

---

## 使用

1. 在输入框写下你的需求。
2. 点输入框工具行的 🎭，选一个角色。菜单顶部就是 **「按当前角色改写」** 按钮，点它开始改写。（没选角色时该按钮为禁用状态，并有提示。）
3. 设置**强度**（轻 / 中 / 狂热）和**发送方式**：
   - **先审查** —— 改写结果回到输入框，并显示前后对比面板。你可以点发送、仅回填、还原原文、或重写。
   - **直接发出** —— 改写完成后立即作为你的消息发出。面板会保留显示实际发出的内容，因为已发出的消息无法撤回。
4. 同一菜单里的 **「无角色」** 可关闭改写：输入框会原样发送你写的内容。这也是控件的初始状态，选择按会话记住。

你的草稿会被保留：**还原原文** 可恢复，**仅回填** 只把改写结果放进输入框而不发送。

### 技术事实校验

每次改写后，会用同一个模型再做一次比对，报告技术内容是否存活：

- **技术事实已保留** —— 没发现丢失或凭空添加的内容。
- **技术事实可能被改动** —— 会指出改了什么。发送前先读一遍改写结果。
- **未完成事实校验** —— 校验本身失败了。这**不是**通过，请把改写结果当作未经验证。

校验是建议性的，绝不阻断改写。它是一次额外的模型调用，会让每次改写的时间和成本翻倍；想纯靠肉眼审查，可在插件行配置里设 `factCheck: false`。

---

## 角色卡

一张卡就是一个 YAML 文件。插件会监听目录，所以**丢一个文件进去，角色立刻出现，不用重启**。

```
~/.dsh/persona-cards/<id>.yml
```

用 🎭 菜单里的「打开角色卡目录」，或设置页，都能到达那里。你也可以完全在**设置 → 角色扮演**里创建和编辑卡片，那会写出同样的文件。

### 卡片格式

```yaml
id: omnissiah              # 小写字母、数字、连字符；同时也是文件名
name: 万机之神 · 欧姆弥赛亚
icon: "⚙️"                 # 一个 emoji
description: 选择器里显示的一行说明。

mode: llm                  # llm = 模型改写（推荐）| template = 模板套用
fidelity: style            # style = 只改语气 | strategy = 允许增加行为约束
intensity: medium          # light | medium | zealot（该卡的默认强度）

# 这个角色「是什么」。这是给改写模型的指令，不是成品文案：
# 每次都会针对你的消息现场生成。
style: |
  用户是机械教信徒，AI 是万机之神欧姆弥赛亚。
  【发言者方向】用「信徒」的口吻说话，向万机之神恳求……
  语气：庄严、古奥、仪式化。

# 转换范例：原话 → 角色口吻
examples:
  - from: 帮我写个快速排序
    to: >
      万机之座在上，吾等恳请您赐予枢机之序的奥义：
      请为我们编写一个快速排序算法，使重复之数各归其位。

# 可选：每个强度各自的范例。某个强度没写，就用上面的 examples。
examplesByIntensity:
  light:
    - from: 帮我写个快速排序
      to: 万机之座在上，恳请您为我们编写一个快速排序算法。
  zealot:
    - from: 帮我写个快速排序
      to: 伟大而不朽的万机之神……
```

### 让一张卡真正管用的两条规则

**1. 写清发言者方向。** 角色是 **AI 的**身份，但被改写的文字是**你的**。所以改写必须用你的口吻 —— 信徒向神恳求，而不是神发号施令。这是角色卡最常见的翻车点：一张让神去命令助手的卡，会把关系整个倒过来，模型会照着错误的那一半框架走。一定要显式写出来。

**2. 让范例保住技术事实。** 范例是最强的风格锚点，模型会连它的错误一起模仿。如果范例的输入是「写个快速排序」而输出全是氛围，模型就学到了**「改写 = 用仪式感替换需求」**。`from` 里的每一条需求、标识符、数字，都必须在 `to` 里看得见。

`node scripts/check.mjs` 正是对内置卡强制这一点：范例丢了技术词、或丢了一半以上的中文实质，就会失败。改完卡记得跑一次。

### `fidelity`：最关键的开关

| 值 | 含义 | 什么时候用 |
|---|---|---|
| `style` | 只改语气，需求和约束原样不动 | 默认，几乎总是它 |
| `strategy` | 允许**追加符合角色的行为约束** | 刻意为之的场景 —— 例如内置的 *肌肉集团* 卡，会追加「别过度规划、别检索、别交付新手级解法」 |

`strategy` 是真正改动了你的需求，而不只是换说法。这类卡请保持审查模式。保真度是卡片的属性，不是每条消息的开关 —— 调用方无法把它放宽。

### `mode: template`

完全跳过模型，把你的草稿代入固定模板（`{{input}}` 是占位符）。瞬时且免费，但输出永不变化 —— 适合固定祷词，不适合任何应当「像为你这次而写」的内容。

---

## 配置

写在插件加载行的 config 里：

```yaml
- id: persona-forge
  name: dsh-persona-forge
  config:
    sendMode: review   # review | direct —— 输入框的初始默认
    factCheck: true    # 每次改写后跑技术事实校验
    watchCards: true   # 角色卡目录变化时重载目录
```

---

## HTTP 契约

所有路由都是 `POST`、JSON、仅限回环（socket 必须是回环地址、`Host` 头必须指向回环主机、拒绝代理转发头）。挂载在 `/persona-forge` 下。

| 路由 | 请求体 | 返回 |
|---|---|---|
| `/persona-forge/cards` | `{}` | `{ cards, diagnostics, directory, sendMode, factCheck }` |
| `/persona-forge/rewrite` | `{ cardId, text, sessionId?, intensity? }` | `{ text, provider, model, mode, cardId, fidelity, intensity, elapsedMs, factCheck }` |
| `/persona-forge/cards/save` | `{ card }` | `{ id, path }` |
| `/persona-forge/cards/delete` | `{ id }` | `{ removed }` |
| `/persona-forge/reveal` | `{}` | `{ directory, opened }` |

失败返回 `{ ok: false, error: { code, message?, params? } }`，`code` 取值：`rejected`、`no-card`、`unconfigured`、`timeout`、`upstream`、`internal`、`forbidden`、`method`、`not-found`。

---

## 兼容性

宿主侧**不声明任何 harness 包依赖，也没有任何第三方依赖**：它通过 `ctx.get` 取 `llm`、`sessions`、`agentDefaultModel`、`webServer`，并对缺失情况显式降级；角色卡由自带的 YAML 读取器解析。因此它在包布局不同的 harness 版本上仍可加载，不会因为某个组合缺少其中之一而激活失败，本地 `link:` 的检出也无需额外安装步骤即可工作。模型路由优先取会话自己最后一次请求头，回退到 harness 默认模型。

客户端侧不 import 任何 harness Client 包，只手工编写并仅使用主题 token（`--dsw-alias-*`），所以内部改名只会影响外观，不会让插槽变空白。

在 dsh `0.2.0-rc.2` 上开发与验证。

---

## 开发

```
node scripts/check.mjs        # 离线单元自检：解析器、角色卡、提示词、客户端语法
node scripts/host-check.mjs   # 宿主集成自检：在真实 socket 上挂载真实插件
npm run check                 # 两者都跑
```

`check.mjs` 不需要 harness，也不调用模型。覆盖：内置 YAML 读取器（含其拒绝行为与 dump/parse 往返）、卡片归一化、内置卡的事实保全、提示词构造、输出归一化、事实校验解析、客户端 bundle 语法。

`host-check.mjs` 在 stub Cordis 上下文上挂载真实插件入口，用真实 socket 驱动真实 HTTP 路由，`llm` 服务为桩实现。覆盖路由注册、会话模型解析、模板模式、回环防护、保存/删除往返 —— 这些是单元自检够不到的。它把 `DSH_HOME` 指向临时目录，**不会碰你真实的角色卡**。

### 角色卡 YAML

插件自带 YAML 读取器（`lib/yaml.js`），不依赖 YAML 库。已发布的插件会声明依赖，但本地 `link:` 的插件**不会**被安装依赖 —— 所以引用库只有在某个无关包恰好提升（hoist）了它时才能工作。

读取器支持角色卡需要的子集 —— 块映射与块序列、块标量（`|`、`|-`、`|+`、`>` 等）、引号与普通标量、布尔、null、注释 —— 并**拒绝**它无法忠实读取的写法：流式集合、锚点、别名、标签、合并键、多文档流。拒绝是刻意的：静默误读一张卡，会给你一个与你写的文件不符的人设，那比一条指明行号的报错更糟。

### 目录结构

| 路径 | 职责 |
|---|---|
| `lib/index.js` | 宿主入口：角色卡存储、目录监听、路由注册 |
| `lib/store.js` | 卡片加载、归一化、保存/删除 |
| `lib/yaml.js` | 内置 YAML 子集读取器与写出器 |
| `lib/prompts.js` | 改写系统提示词、草稿包装、事实校验提示词 |
| `lib/rewrite.js` | 模型调用与输出归一化 |
| `lib/routes.js` | HTTP 路由与会话模型解析 |
| `lib/loopback.js` | 回环信任防护 |
| `lib/client.js` | 浏览器侧：输入框控件、审查面板、设置页 |
| `cards/` | 内置角色卡（只读；同 id 的用户卡会遮蔽它） |

## 许可证

MIT
