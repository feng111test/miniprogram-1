# 化学试卷本地整理台

独立于微信小程序的本地网页工具：打开 PDF，在浏览器本机渲染页面；逐页 OCR 普通文字；把化学式、反应式、结构图和示意图框选为题目图片；人工编辑题干、选项、答案和解析；最后导出 JSON。

PDF、识别结果和截图只留在当前浏览器页面，不会上传云端。中文 OCR 模型和页面处理依赖在项目安装时下载，运行工具时不依赖 OCR 云 API。页面截图以 PNG data URL 写入导出的 JSON，因此图片较多时导出文件也会较大。

## 运行

需要 Node.js 20.19+ 或 22.12+。

```powershell
npm install
npm run dev
```

打开终端显示的本机地址，通常为 `http://127.0.0.1:5173`。停止服务时在终端按 `Ctrl+C`。

首次启动会把中文识别模型从 npm 依赖复制到 `public/tessdata/`；第一次点击“识别本页文字”时模型会在浏览器中加载。PDF 页面转图及 OCR 均在本机完成。构建检查可运行：

```powershell
npm run build
```

## 使用

1. 选择 PDF，在左侧页面列表中切换。
2. 在右侧点击“识别本页文字”。识别结果填入题干输入框，可手工删改或拆分。
3. 填写题型、选项、正确答案和可选解析。
4. 在中间 PDF 页面拖动鼠标框选化学式、反应式或结构图；图片会加入当前正在编辑的题目。
5. 点击“保存这道题”，继续编辑新题目，最后导出 JSON。

OCR 是辅助输入，不保证普通文字正确；数学/化学式、上下标、图表和选项顺序尤其需要人工核对。建议尽量只框选必要区域，避免把整页放进每道题。

OCR 监视区会显示引擎/中文模型加载、PDF 页面渲染、识别阶段、进度及本次用时；运行超过一段时间没有收到引擎进度时，会显示等待提示并记录日志。日志可复制，方便排查浏览器或模型加载问题。

## 导出格式

题目结构与小程序题目字段接近，额外使用 `images` 保存页面裁剪图：

```json
{
  "type": "single",
  "title": "题干文字",
  "options": [{ "key": "A", "content": "选项文字" }],
  "answer": ["A"],
  "explanation": "",
  "images": [{ "page": 1, "dataUrl": "data:image/png;base64,..." }]
}
```

**当前小程序尚未实现图片题目的显示和此导出格式的导入**，因此导出的文件是人工校对好的题库数据，不可直接作为小程序可刷题题库使用；仍需另行适配小程序图片字段、题目导入流程及云端图片存储。

## 依赖许可

- [PDF.js](https://github.com/mozilla/pdf.js)：Apache-2.0
- [Tesseract.js](https://github.com/naptha/tesseract.js)：Apache-2.0
- [chi_sim Tesseract language data](https://github.com/naptha/tessdata)：npm 包标注 MIT
