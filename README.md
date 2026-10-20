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
> 网页版（题库刷题、Word / PDF 导入）已拆成独立工程，不再放在本仓库内维护。
```

## 网页版（独立工程）

网页代码已与本仓库解耦，迁移到独立工程 `quiz-web`（自带题库源数据与发布流程，不再依赖 `cloudfunctions/`）：

- 入口：`quiz/index.html`（题库刷题）、`word-quiz/`、`pdf-question-importer/`
- 默认题库：由 `scripts/prepare-default-bank.mjs` 从工程内的 `data/builtin-chemistry/` 生成
- 常用命令：`npm install`、`npm run dev`、`npm run build:quiz`（只打包刷题页用于发布）

发布：该工程自带 GitHub Pages 工作流，推送到 `main` 即自动构建发布（仓库需先在 Settings → Pages 把 Source 选为 GitHub Actions）。

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
