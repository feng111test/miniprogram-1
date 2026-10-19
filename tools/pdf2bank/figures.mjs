const FIGURE_WORDS = /图示|如图|下图|上图|装置|流程|模型|电子式|轨道表示式|结构简式|结构式|转化关系|示意图|曲线|表格/;
const TRAILING_COLON = /[:：]\s*$/;
const TRAILING_WEI = /为\s*$/;
const BLANK_STRUCTURE = /(?:关于|下列)\s*[和与、]\s*(?:的|说法)/;
const LIKELY_WORDS = /图|装置|流程|曲线|示意|模型|结构式|表格/;

export function detectFigureReasons(question) {
  const reasons = [];
  if (question.hasFigure === true) reasons.push("模型判断依赖原卷图");
  if (FIGURE_WORDS.test(question.title)) reasons.push("题干提到图示/结构");
  if (TRAILING_COLON.test(question.title) || TRAILING_WEI.test(question.title)) reasons.push("题干结尾像缺图");
  if (BLANK_STRUCTURE.test(question.title)) reasons.push("题干中有结构式空白");

  const options = question.options || [];
  if (options.some((option) => TRAILING_COLON.test(option.content) || TRAILING_WEI.test(option.content))) {
    reasons.push("选项以冒号/为结尾，图缺失");
  }
  if (options.some((option) => option.content.trim().length <= 2)) reasons.push("选项内容为空");
  if (question.type === "single" && options.length > 0 && options.length < 4) reasons.push("选项不足 4 个");
  return reasons;
}

export function markFigureQuestions(questions, { marker = "（含图，见原卷）" } = {}) {
  let marked = 0;
  let likely = 0;
  for (const question of questions) {
    const reasons = detectFigureReasons(question);
    if (reasons.length) {
      if (!question.title.includes("含图")) question.title = `${question.title}${marker}`;
      question.needsFigure = true;
      question.figureReason = reasons.join("；");
      marked += 1;
      continue;
    }
    if (LIKELY_WORDS.test(question.explanation || "")) {
      question.figureLikely = true;
      likely += 1;
    }
  }
  return { marked, likely };
}
