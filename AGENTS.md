# dsh-persona-forge — agent guide

给 DeepSeek Harness 用的角色扮演改写插件。宿主侧是 ESM，浏览器侧是 CommonJS，
零依赖、零构建。

## 三条硬约束

1. **零依赖。** `dependencies` 永远是 `{}`。本地 `link:` 装的插件不会被安装依赖，
   引一个库只在某个无关包恰好 hoist 了它时才工作——那是碰运气，不是依赖管理。
2. **零构建。** `lib/` 就是发布物，`npm pack` 出来的字节和仓库里的一致。
   加打包器会同时破坏这一条和上一条。
3. **宿主入口不导出 `Config`。** 加载器会把它当 Standard-Schema 调用
   `.validate()`，普通对象会直接激活失败。配置从 `apply` 的第二个参数进。

## 改完必须跑的

```
npm run check
```

288 个单元检查加 101 个宿主集成检查，两秒内跑完。动了 `lib/`、`cards/`、
两个 README 或 `cordis.patch.yml` 的任何一处都要跑——检查里有一批是专门
盯着"文档和代码说的不一样"这类沉默漂移的。

## 发布

**发版有它自己的规矩，动手前读 [RELEASING.md](RELEASING.md)。**

版本号是用户唯一的交付坐标。用错一次，别人的升级路径就断了——而
`npm publish` 发出去的版本号**永久存在，不能撤回重发**。

## 提交信息

用 `feat:` / `fix:` / `docs:` / `chore:` / `refactor:` 前缀。这不是风格偏好：
`feat` 攒到够多就该动次版本号，`fix` 攒到够多就动修订号，前缀是判断
"这次该发什么版本"的唯一依据。

一条 commit 只做一件事。`chore: release X.Y.Z` 是发布提交，它只改版本号，
不夹带任何代码改动。
