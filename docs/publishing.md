# 发布清单（GitHub + npm）

这份文档记录发布前的仓库检查项，以及只能在 GitHub 网页/API 完成、无法由
`git` 处理的步骤。

## 1. 仓库层（已就绪，由 `scripts/check-release.mjs` 校验）

- [x] `package.json` 的 `keywords` 含 `dsh-plugin`
- [x] README（中英）含可复制的安装命令
      `dsh plugin --profile web add github:Refone/dsh-billing-mini-tag`
- [x] `src/index.js` 导出 `apply(ctx)` 与 `inject`
- [x] `package.json#dsh.bundle.patch` 指向 `cordis.patch.yml`
- [x] `dsh.client` 声明 `platform: "web"` 与宿主注入的客户端包
- [x] `engines.dsh` 声明最低 DSH 版本（`>=0.1.5-rc.3`）
- [x] `repository` / `homepage` / `bugs` 指向 GitHub 仓库
- [x] `LICENSE`（MIT）、`CHANGELOG.md`、英文 + 中文 README
- [x] `pnpm pack --dry-run` 内容物正确（`src/`、`cordis.patch.yml`、README、
      LICENSE、截图）
- [x] CI（`.github/workflows/release-check.yml`）在每次 push / PR 时跑上述检查

本地复核：

```sh
node scripts/check-release.mjs
pnpm pack --dry-run
```

## 2. GitHub 仓库设置（只能手动/API 完成）

DSH 生态的自动收录认两个仓库层信号，它们不属于 git 内容，无法通过提交完成：

1. **仓库必须公开。** 私有仓库或只放二进制文件不会被扫描。
2. **Topics 必须包含 `dsh-plugin`。**

网页操作：仓库 → 右上角 **About** 齿轮 → **Topics** 填入
`dsh-plugin`、`dsh`、`deepseek-harness`，确认仓库可见性为 **Public**。

有 GitHub CLI 时也可以一条命令完成：

```sh
gh repo edit Refone/dsh-billing-mini-tag \
  --visibility public \
  --add-topic dsh-plugin --add-topic dsh --add-topic deepseek-harness
```

## 3. 打标签与发布

版本号已对齐（`package.json` = `0.2.0`）。发布新版本时：

```sh
# 1. 改 package.json#version 与 CHANGELOG.md
# 2. 复核
node scripts/check-release.mjs
pnpm pack --dry-run
# 3. 提交、打标签、推送
git add -A
git commit -m "release: v0.2.0"
git tag -a v0.2.0 -m "dsh-billing-mini-tag v0.2.0"
git push origin main --tags
```

随后在 GitHub 的 **Releases** 页面基于 `v0.2.0` 创建 Release，把
`pnpm pack` 生成的 `dsh-billing-mini-tag-0.2.0.tgz` 作为附件上传；README 中的
固定版本安装命令依赖这个 tag 的源码包。

## 4. 可选：发布到 npm

包已去掉 `private: true`，并带齐 `files`、`repository`、`license`。若 npm 上的
`dsh-billing-mini-tag` 名称可用：

```sh
npm publish --access public
```

发布后可以再补一条更短的安装命令：

```sh
dsh plugin --profile web add dsh-billing-mini-tag
```

并同步更新 README 的 Install 一节与 `package.json#version`。

## 5. 收录到社区目录（可选）

DSH 插件市场（dshmarket）读取 [awesome-dsh-plugin](https://awesome-dsh-plugin.com)
的目录。仓库公开且带 `dsh-plugin` topic 后，向该目录提交条目（PR 或 issue），
或等待爬虫收录。收录通常只依赖上述四项，不需要额外运行时依赖。
