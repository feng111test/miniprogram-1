# 刷题助手小程序

这是一个基于微信小程序的题库刷题助手，支持导入题库、做题、查看解析、收藏题目、统计正确率等功能。适合做考试题库、知识点练习、题库管理类小程序的基础模板。

## 功能概览

- 题库列表页：展示题库数量、总题数、正确率、答题进度
- 题库导入：支持 JSON、文本及 DOCX Word 文件导入（Word 提取选择题文字）
- 练习模式：单选、多选、判断题题型支持
- 做题反馈：显示正确 / 错误答案、解析说明
- 收藏功能：可收藏错题或重点题
- 题卡导航：可快速跳转到任意题目
- 错题统计：记录错误题目与答题结果
- 分享功能：可分享题库或邀请好友一起刷题
- 内置题库模板：包含前端示例，以及元素周期律、离子反应与氧化还原、化学反应原理三套高中化学练习题

首页点击“选择内置题库”或“添加内置题库”即可选择并载入模板；模板题库保存到云端后，可像普通题库一样练习。

## 项目结构

```text
miniprogram/
  app.js
  app.json
  app.wxss
  components/
  pages/
    index/
    import/
    practice/
    result/
  utils/
    parser.js
    docx.js
    sample.js
    store.js
cloudfunctions/
  quickstartFunctions/
web/
  index.html             # 网页工作台统一入口
  word-quiz/             # Word 导入和刷题功能
  pdf-question-importer/ # PDF OCR、题目校对和刷题功能
  package.json           # 网页工具统一依赖与命令
```

### 本地试卷工作台（Word 与 PDF）

Word 和 PDF 功能合并为同一个网页项目，统一入口位于 `web/`，与微信小程序代码分开维护。运行方式：

```powershell
cd web
npm install
npm run dev
```

打开终端显示的网址，在顶部切换“Word 导入刷题”或“PDF 整理刷题”：

- Word 模式：导入 `.docx`，提取选择题及答案解析后直接练习。
- PDF 模式：本地 OCR/手动整理题目，保存后点击“开始刷题”，可直接练习刚整理的题目和裁剪图片；也可导出 JSON。
- 网页项目只需在 `web/` 安装一次依赖。Word/PDF 识别与练习均在本机浏览器运行，不会上传题目文件。

PDF 逐页 OCR 的使用细节见 [PDF 整理说明](./web/pdf-question-importer/README.md)，Word 识别范围见 [Word 刷题说明](./web/word-quiz/README.md)。

## 主要页面说明

- index：题库首页，展示题库列表和统计信息
- import：导入题库页面，可导入 JSON / 文本 / DOCX Word 题库
- practice：刷题页，负责显示题目、答案选择、解析和答题状态
- result：结果页，展示测试结果和统计信息

## 题库格式说明

项目支持导入题库数据，通常为 JSON 格式，示例如下：

```json
{
  "name": "示例题库",
  "desc": "示例描述",
  "questions": [
    {
      "title": "下列选项中，哪一项是正确的？",
      "type": "single",
      "options": ["A", "B", "C", "D"],
      "answer": ["A"],
      "explanation": "这是解析说明。"
    }
  ]
}
```

## 运行方式

1. 打开微信开发者工具
2. 选择本项目目录
3. 确认项目已配置为小程序项目
4. 运行并预览

## 说明

- 本项目使用微信小程序原生能力和前端本地存储进行题库管理
- Word 导入仅提取选择题文字，不支持旧版 `.doc` 文件；文档内图片和复杂公式不会作为题目图片导入，保存前请核对解析预览
- 题库数据可由用户导入或使用示例题库
- 项目适合作为刷题类、测试类、题库类小程序的学习和二次开发基础

## 参考资源

- 微信小程序开发文档
- 微信云开发文档（如项目中包含相关云开发模板文件）
