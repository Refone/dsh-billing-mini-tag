# 开发日志

1. 在这个文件夹内，生成一个 deepseek harness 插件，可以在输入框下方，缓存命中右侧，出现一个 LRF 文字。

![出现 LRF 标签](images/placeholder-tag.png)

commit: `95d474c9359d2e7ec13de40408c8171f2a3fd0a7`

2. 将 tag 中的文字 "LRF" 替换为 "¥0.00"，其中数值代表当前会话实际消费金额：按官方 Token 报价、模型选择与 Token 使用量计算，每次点击发送消息时拉取一次最新官方报价，金额保留两位小数。
   - 官方报价来源：<https://api-docs.deepseek.com/zh-cn/quick_start/pricing/>（中文页面直接给出人民币价格与高峰/空闲时段）。
   - 宿主半边按会话日志逐 step 折叠 usage 与模型，浏览器半边轮询 `/plugin-billing-mini-tag/cost` 并渲染 `¥x.xx`。

![消费金额标签](images/real-billing-tag.png)

3. 适配 DSH 0.2：官方统计行不再有 `[data-composer-stats]` 容器，原来的 portal 无处可挂。改为注册
   `conversation.composer.dock` 里的 `billing-mini-tag` 统计项（`order: 2`），与官方 `activity`、
   `usage` 同处一行，排在缓存命中右侧；样式复用同款排版 token 与内边距，并带
   `data-composer-stat` 标记。同时按 0.2 的 stream 记录结构（`record.chunk.usage`）读取 usage，
   补上 locale 文案、图标与 `>=0.2.0` 的版本约束。

4. 修正统计行位置：`conversation.composer.dock` 槽位渲染在 `ContextMeter`（context usage）
   之前，所以 `order: 2` 只能排到缓存命中右侧、context usage 左侧。给角标加 CSS
   `order: 1`，利用槽位出口 `display: contents` 让角标成为 dock 的直接 flex item，
   从而排到 context usage 右边（统计行最右侧），恢复最初的布局。

5. 插件列表图标改为白底、`¥` 镂空：符号轮廓取自 Arial Black，作为
   `fill-rule="evenodd"` 的第二个子路径从白色圆角方块中挖掉，不再用蓝色底与白色描边。

6. 标题交还给包名：`locale/*.json` 去掉 `meta.title`，DSH 回退到 `package.json` 的
   包名（`dsh-billing-mini-tag`）；它与组件行的 `id`/`moduleName` 相同，所以详情页
   不再在标题下重复两行技术名。（中途加过一版 640×300 的详情页配图，按作者要求已移除：
   DSH 只给自带 bundle 渲染功能配图，第三方包只能在 `plugins.detail.section` 里自绘。）

7. 修正 locale 注入：浏览器半边原来用 `ctx.get("locale")` 取服务，而 fiber 只等
   `slots`。locale 插件挂载更晚，取到的是 `undefined`，词典从未注册，角标 tooltip
   一直是原始 key（`cost.title`）。改为声明 `inject: ["slots", "locale"]`、用
   `ctx.locale` 注册词典并 `bind` 出翻译座位；`scripts/test-client.mjs` 用一个
   `ctx.get()` 返回空的假上下文复现这一退化。
