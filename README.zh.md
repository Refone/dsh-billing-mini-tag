# dsh-billing-mini-tag

[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/DSH-plugin-4f46e5)](https://github.com/topics/dsh-plugin)

English | 中文

在当前会话输入框下方的统计行里、**缓存命中**右侧，常驻显示本会话消费金额
（`¥x.xx`）。金额按 [DeepSeek 官方 Token 报价](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)
计算。

<p align="center">
  <img src="showcase.png" alt="dsh-billing-mini-tag 使用效果" style="max-width: 80%; height: auto;">
  <br>
  <sub><em>右侧的 ¥1.47 就是这个插件</em></sub>
</p>

## 安装

```sh
dsh plugin --profile web add github:Refone/dsh-billing-mini-tag
```

重启 `dsh web` 并刷新 Web 界面，然后发送一条消息即可。想固定版本而不是跟随
`main`：

```sh
dsh plugin --profile web add https://github.com/Refone/dsh-billing-mini-tag/archive/refs/tags/v0.2.0.tar.gz
```

再次执行同一条 `add` 命令即可更新。卸载：

```sh
dsh plugin --profile web remove dsh-billing-mini-tag
```

> 从 GitHub 安装要求宿主能访问该仓库。网络无法访问 GitHub 时，可以从
> [Releases](https://github.com/Refone/dsh-billing-mini-tag/releases) 下载
> tarball 后按上面的方式安装。

## 显示什么

- **只统计当前会话。** 金额来自该会话持久化日志中的 token 用量，不是账号余额，
  也不是所有会话的累计。
- **边用边更新。** 浏览器半边每秒轮询一次宿主路由，步骤完成后数字就会变化，
  不需要刷新页面。
- **就在缓存命中右侧。** 角标被 portal 进官方统计行，而不是另起一行；官方
  统计项挂载/卸载时，角标仍保持在该行最后。

## 工作原理

包内包含两个半边：

| 半边 | 入口 | 职责 |
| --- | --- | --- |
| 宿主 | `src/index.js`（`.` 导出） | 提供 `GET /plugin-billing-mini-tag/cost?session=<id>`，按 assistant step 折叠会话日志，并刷新官方报价。 |
| 浏览器 | `src/client.js`（`./client` 导出） | 注册 dock 项，把 `¥…` 角标 portal 到 `[data-composer-stats]` 统计行。 |

宿主半边：

1. 启动时抓取一次官方中文报价页，之后每次发送消息再抓一次，并缓存最近一次
   成功结果。请求 8 秒超时；首次抓取成功前（以及页面不可达时）使用内置报价。
2. 按 `turn:step` 折叠 `assistant/attempt` / `assistant/message` 的 usage：同一步
   重复上报时后者替换前者，`llm/retry-started` 会让重试单独计费，与 DSH 自身的
   `tokenUsage` 投影保持一致。
3. 记住每一步实际服务的模型，因此会话中途切换模型也按对应单价计费。
4. 返回两位小数的展示字符串（`¥0.00`），并附带原始 token 数、分模型明细、
   报价来源与未知模型名，便于排查。未知会话、日志未加载、报价抓取失败都会
   退化为 0 或沿用上一份报价，不会抛错打扰输入框。

该路由只接受同源请求：拒绝跨站调用，无请求头的探测只接受 loopback。另有调试
路由 `GET /plugin-billing-mini-tag/quote` 返回缓存的报价与当前单价。除抓取
报价页外不向任何地方发送数据，也没有遥测。

## 计费口径

单价为官方页面的「元 / 百万 token」：

| 桶 | 计价方式 |
| --- | --- |
| 缓存命中（从缓存读取的输入） | 缓存命中价 |
| 缓存未命中（未缓存输入） | 缓存未命中价 |
| 缓存写入 | 缓存未命中价 |
| 输出 | 输出价 |

高峰时段按北京时间判断（无夏令时）：**周一至周五 09:00–12:00、14:00–18:00**。
官方报价未包含中国法定节假日，因此用工作日窗口做本地近似。报价无法识别的
模型按 `deepseek-flash` 计价，路由的调试字段会在 `unknownModels` 中列出它们。

## 环境要求

- DSH **web** profile。包内声明 `dsh.engines.dsh` 为 `>=0.1.5-rc.3`（开发与
  测试所用版本）。
- Node.js **20 及以上**。
- React 18 由宿主提供（peer dependency）；插件本身没有运行时依赖。
- 可访问 `api-docs.deepseek.com` 以获取实时报价；离线时仍可用内置报价。

## 开发

**没有构建步骤**：两个半边都是普通 ESM/JS，浏览器半边是手写的模块加载器
包装，不需要打包器。`pnpm pack` 会打包 `src/`、`cordis.patch.yml`、两份
README、CHANGELOG、LICENSE 和截图。

```sh
node scripts/check-release.mjs   # 发布要求检查 + 模块冒烟测试
pnpm pack --dry-run              # 查看最终 tarball 内容
```

`scripts/check-release.mjs` 检查 DSH 生态扫描的四项内容：`dsh-plugin` 关键字、
README 中可复制的 `dsh plugin --profile web add …` 命令、导出的 `apply(ctx)`
模块，以及可解析的 `dsh.bundle.patch` bundle 声明。

```text
.
├── src/index.js          # 宿主半边（apply、报价、会话折叠、HTTP 路由）
├── src/client.js         # 浏览器半边（dock 项 + ¥ 角标）
├── cordis.patch.yml      # bundle patch：把插件插入 profile
├── scripts/check-release.mjs
├── docs/development-trace.md
└── showcase.png
```

## 许可证

[MIT](LICENSE) © 2026 Refone
