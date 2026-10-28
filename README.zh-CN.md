# Image Annotator Plus

[English](README.md) | 简体中文

Image Annotator Plus 为 Obsidian 提供专注的图片标注工作区。通过图片的右键菜单打开插件，添加可视化标记，并在源文件旁保存合成后的 PNG 图片。

<!-- 发布前可在此添加一张不含个人或 Vault 内容的标注界面截图。 -->

## 致谢

Image Annotator Plus 基于 [AdlinZ](https://github.com/AdlinZ) 的
[Image Annotator](https://github.com/AdlinZ/obsidian-image-annotator) 改进而来，
原项目采用 MIT 许可证。AdlinZ 是原作者，也是本项目的贡献者，原版权声明保留在
[LICENSE](LICENSE) 中。

本分支新增了直线工具、Shift 吸附绘制、保留 Obsidian 原有图片菜单项的集成方式，
以及保存后的实时预览刷新。

**注意：** 请勿与原版 Image Annotator 同时安装。两个插件读写同一份
`<图片名>.png.annotator.json` 配套文件，同时安装会互相覆盖数据。

## 功能

- 绘制矩形、直线、箭头、自由线条、多行文字、自动编号、实心遮挡和半透明高亮。
- 绘制直线或箭头时按住 Shift，可吸附到 45 度整数倍角度。
- 在 Obsidian 自带的图片右键菜单中追加“标注图片”，保留“复制图片”“重命名”等原有选项。
- 选中后移动、缩放、修改颜色和线宽，或单独删除标注；使用选择工具双击文字或编号可修改内容。
- 记住上次使用的颜色、线宽和字号，提供六个常用色。
- 缩放、适应窗口、原始大小；按住空格或鼠标中键拖动画布，触屏可使用手形按钮。Ctrl/Cmd+滚轮以指针为中心缩放。
- 撤销和重做标注操作。
- 保存 PNG 和可编辑标注数据，再次打开 PNG 后继续修改各个标注。
- 保存成功后，笔记中已打开的图片预览会立即刷新。
- 在支持图片剪贴板的环境中，一键复制合成结果。
- 替换笔记中指定的一处图片引用，或替换本笔记全部匹配引用。
- 关闭前提示未保存的更改，阻止重复保存和冲突覆盖。

首次保存不会修改原图，而是创建 `<原文件名>-annotated.png`。再次打开已有的 `-annotated.png` 标注副本并保存时，将直接更新该副本。早期版本创建的 `-标注.png` 文件仍受支持，并会原位更新。

可编辑的 PNG 配有 `<图片名>.png.annotator.json` 文件，包含固定的底图快照和独立标注。继续编辑需要同时保留这两个文件。在插件启用期间，通过 Obsidian 重命名或移动 PNG 时，会同时移动配套文件。在 Obsidian 之外操作时，请一起移动两个文件，并保持文件名配对。

原始图片后来发生变化，不影响已经保存的底图快照。如果标注 PNG 被其他工具修改，或配套文件损坏，插件会停止加载，避免用旧标注覆盖新内容。旧版合成 PNG 可以继续作为底图使用，已经合成到像素中的旧标注无法恢复为独立对象。

## 使用方法

1. 在文件列表或笔记中的图片上单击右键。
2. 选择 **标注图片**。
3. 添加标注，然后点击保存按钮。
4. 选择保留原引用、仅替换指定位置，或替换本笔记全部匹配引用。

Ctrl/Cmd+Z 撤销，Ctrl/Cmd+Shift+Z 或 Ctrl/Cmd+Y 重做，Ctrl/Cmd+S 保存，Delete 删除选中的标注。按 Esc 关闭时，如有未保存的更改，会先提示确认。

支持的源图片格式包括 PNG、JPEG、WebP、GIF 和 BMP，导出格式为 PNG。打开动态图片时，导出结果会固定为当时显示的画面。

## 隐私

Image Annotator Plus 完全在你的 Vault 中运行，不使用网络、不收集遥测数据，也不会访问 Vault 之外的文件。

配套 JSON 含有未经遮挡的底图。对外分享已遮挡的内容时，仅分享合成 PNG 或剪贴板中的图片。剪贴板结果不包含可编辑对象和底图快照。

## 语言

界面会自动跟随 Obsidian 的语言。中文语言环境显示中文，其他语言环境默认显示英文。

## 安装

### 从 Obsidian 安装

在 **设置 → 第三方插件 → 浏览** 中搜索 **Image Annotator Plus**，选择
**安装** 并 **启用**。Obsidian 会从本仓库的 Release 下载插件文件。

### 手动安装

从最新 Release 下载 `main.js`、`manifest.json` 和 `styles.css`，放入以下目录：

```text
<vault>/.obsidian/plugins/image-annotator-plus/
```

重新加载 Obsidian，然后在“第三方插件”中启用 **Image Annotator Plus**。

## 开发

```bash
npm install
npm run build
npm run lint
npx playwright install chromium
npm test
```

构建产物位于 `dist/`。浏览器回归测试覆盖绘制、编辑、剪贴板像素、保存恢复、写入失败、引用替换、右键菜单和桌面/手机布局，截图位于 `work/qa/`。

## 许可证

[MIT](LICENSE) — Copyright (c) 2026 AdlinZ, Copyright (c) 2026 Robert (true0899)。
