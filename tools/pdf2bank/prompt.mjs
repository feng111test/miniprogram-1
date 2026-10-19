export function buildSystemPrompt({ includeExplanation = true } = {}) {
  const rules = [
    "整个回答只能是一个 JSON 对象：所有题目一次性放进同一个 questions 数组里，绝对不要为每道题重复 questions 键。",
    "只输出选择题（带 A/B/C/D 等选项的题）。填空、实验、计算、简答、推断题一律跳过，不要放进 questions。",
    "题干必须自包含：去掉题号、分值、（2分）之类的标记和页眉页脚；把被分页截断的选项合并回原题。",
    '选项 key 用大写字母 A-F，content 去掉 "A." 之类前缀；被分页拆开的选项内容要接回对应选项。',
    "answer 必须是数组，元素是选项字母；只有一个答案时 type 用 single，多个答案时用 multiple。",
    "依赖图片、结构式、装置图、流程图、表格数据的题也必须输出，不要跳过：在题干末尾追加「（含图，见原卷）」；某个选项本身是纯图片（没有可读文字）时，content 写成「（见原卷图）」，不要自己描述或猜测图形内容。",
    '必须为每道题给出 "hasFigure" 布尔值：只要题干或任意一个选项需要看原卷的图、结构式、装置、流程、曲线或表格才能作答（例如选项以「：」「为」结尾、题干出现空白位置、「如图」「装置」「该过程」等），就写 true，否则写 false。',
    "化学式用 Unicode 上下标表达，例如 H₂SO₄、Fe³⁺、SO₄²⁻、2H₂ + O₂ → 2H₂O；不要用 LaTeX，不要用 HTML 标签。",
    includeExplanation
      ? "explanation 取答案版【详解】的结论性内容，不超过 80 字；没有就输出空字符串。"
      : '不需要解析，每道题的 explanation 一律输出空字符串 ""。',
    "不要编造答案：答案版里找不到对应题号的题，跳过并写进 skipped。",
    "被拆除的填空/实验/计算题即使夹在选择题中间也不要混进 questions。",
    "页面上的题号可能重复或缺失，以学生版的实际顺序为准。",
    "输出要紧凑：不要缩进换行，不要在 JSON 之外写任何字符。",
  ];
  return [
    "你是高考化学试卷结构化助手。输入是一份试卷的「学生版题干与选项」和「答案版的答案与解析」。",
    "只输出 JSON，不要输出任何解释文字，不要输出 Markdown 代码块。",
    "",
    "输出格式：",
    '{"questions":[{"number":1,"type":"single","hasFigure":false,"title":"题干","options":[{"key":"A","content":"..."}],"answer":["B"],"explanation":"解析"}],"skipped":[{"number":5,"reason":"整题只有图片"}]}',
    "",
    "规则：",
    ...rules.map((rule, index) => `${index + 1}. ${rule}`),
  ].join("\n");
}

export function buildUserPrompt(text, { expected, missing } = {}) {
  const lines = ["下面是试卷文本。请只依据文本内容输出 JSON。", ""];
  if (expected?.count) {
    lines.push(
      `参考答案版，本卷共有 ${expected.count} 道选择题（题号 ${expected.numbers.join("、")}），必须全部输出，一题都不能漏。`,
      "",
    );
  }
  if (missing?.length) {
    lines.push(`上一轮遗漏了第 ${missing.join("、")} 题，这次必须补上，可以只输出这几题。`, "");
  }
  lines.push(text);
  return lines.join("\n");
}

export const REQUEST_OPTIONS = {
  temperature: 0,
  max_tokens: 4096,
};
