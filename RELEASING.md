# 发布

版本号是用户唯一的交付坐标。用户装的是 `0.8.3`，不是"10 月 10 日晚上那个
commit"——所以版本号一旦发出去就不能收回，`npm unpublish` 超过 72 小时会被
拒绝，而且撤回过版本号的人会在别人的 lockfile 里留下一个永久解析不了的洞。

**一次发布 = 一个用户能感知到的变化，或者一批攒够的修复。**
用户装完新版，能说出一句"哦，这个变好了"，就够一版。做不到这一句的改动，
等下一次。

## 步骤

### 1. 判断该不该发版

看 `git log` 自上一个 tag 以来攒了什么：

```
git log --oneline v0.8.3..HEAD
```

全是 `docs:` / `chore:` —— **不发**。用户装插件不是为了看 README。
有 `fix:` 或 `feat:` —— 往下走。

### 2. 定版本号

| 改动 | 动哪一位 | 例子 |
|---|---|---|
| 只有 `fix:` | 修订号 | 0.8.3 → 0.8.4 |
| 有 `feat:`，老用法还能用 | 次版本号，修订归零 | 0.8.3 → 0.9.0 |
| 老用法会坏（卡格式、路由、配置键改名） | 主版本号 | 0.9.0 → 1.0.0 |
| 加了一堆但用户无感（内部重构） | 修订号 | 0.8.3 → 0.8.4 |

**卡住的时候选小的那个。** 发小了的代价是"下次再发一个"，发大了的代价是
让所有人以为要迁移。

### 3. 写 CHANGELOG

在 `## [Unreleased]` 下面加一节，日期用今天。分类是 Keep a Changelog 的：
`Added` / `Changed` / `Fixed` / `Removed` / `Security`。

**写根因，不写症状。** 对比：

- 差：`修复了审查面板显示不全的问题`
- 好：`审查面板在会话开头会被顶出视口。它在 composer stack 里，那个位置是
  flex: none，所以面板一高就把整个栈往上推；没有对话记录可滚动时，溢出的
  部分就直接出屏了。`

第二版读者能判断"这影响不影响我"。这个项目的 CHANGELOG 一直是这个水准，
保持住。

最后把底部的链接补上（`[0.9.0]: .../compare/v0.8.3...v0.9.0`），并把
`[Unreleased]` 的比较基准改成新版本。

### 4. 发布提交

只改版本号，不夹带代码：

```
npm version patch --no-git-tag-version   # 或 minor / major
git add package.json CHANGELOG.md
git commit -m "chore: release 0.9.0 (v0.9.0)"
```

**版本号和 CHANGELOG 必须在同一个 commit 里。** 分两个 commit 就会出现
"tag 指向的那棵树上，CHANGELOG 还没有这一节"的情况。

### 5. 跑检查

```
npm run check
```

不绿就停。发布一个检查不过的版本，比不发更糟。

### 6. 打 tag 并发布

```
git tag -a v0.9.0 -m "v0.9.0"
npm publish
git push --follow-tags
```

**这三条要在同一个 commit 上，一次做完。** `--follow-tags` 保证 tag 和代码
一起上去。

**不要先打 tag 再改代码再发布。** 0.8.3 就是这么坏的：tag 打在 `80b79a2`，
之后为了加截图又提交了 `4b61b4f`，npm 发的是后者——于是
`git checkout v0.8.3` 和 `npm i dsh-persona-forge@0.8.3` 拿到的不是同一份东西。

### 7. 验证

```
npm view dsh-persona-forge version dist-tags.latest gitHead
```

`version` 要是新版本号，`gitHead` 要等于 `git rev-parse HEAD`。对不上就是
第 6 步出问题了。

## 已完成 vs 待处理

**待处理（历史欠账，不影响新版本发布）：**

- **`0.5.2` 是幽灵版本。** CHANGELOG 里有整节，但没打过 tag、没发过 npm，
  底部的 `compare/v0.5.1...v0.5.2` 和 `compare/v0.5.2...v0.6.0` 两个链接都是 404。
  处理方式：下次动 CHANGELOG 时把它标成"未发布"，或者直接删掉那一节。
- **`0.0.0-stage` 还在 npm 上。** 最早的占位版本，没打过 tag，但能被装。
  处理方式：`npm deprecate dsh-persona-forge@0.0.0-stage "placeholder, never released"`。
- **`v0.8.3` 的 tag 和 npm 上的 0.8.3 不是同一个 commit**（见第 6 步）。
  处理方式：**不动它**。已经推到 GitHub 的公开 tag 移动有风险，下次发版自然对齐。

**已完成：** 27 个 tag 全部是 annotated tag，且每个 tag 上的 `package.json`
版本号都和 tag 一致——这条是对的，别破坏它。

## 这个仓库的历史节奏

供参考，不是要求照做：73 个 commit 出了 27 个 tag，平均 2.7 个 commit 一版，
其中 10 月 10 日一天打了 18 个 tag。结果是 27 个版本里只有 4 个真到了用户手里
（0.2.1、0.3.0、0.3.1、0.8.3），其余只是账面上的里程碑。

**版本号是稀缺资源。** 攒够再发。
