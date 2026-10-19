const CJK_RUN = /[\u4e00-\u9fa5]{6,}/g;

function flat(text) {
  return String(text ?? "").replace(/\s+/g, "");
}

export function splitSource(text) {
  const content = String(text || "");
  const parts = content.split("===== 答案版（答案与解析） =====");
  const studentPart = parts[0].split("===== 学生版（题干与选项） =====");
  return {
    studentText: studentPart[1] || parts[0],
    answerText: parts[1] || "",
  };
}

export function buildAnswerKey(answerText) {
  const section = String(answerText || "").split("===== 答案版")[1] || String(answerText || "");
  const map = new Map();

  for (const match of section.matchAll(/(\d{1,3})\s*[.．、]\s*【答案】\s*([A-F]{1,6})/g)) {
    map.set(Number(match[1]), match[2].split(""));
  }
  if (map.size) return map;

  for (const match of section.matchAll(/^\s*(\d{1,3})\s*[.．]\s*([A-F]{1,6})\s*$/gm)) {
    map.set(Number(match[1]), match[2].split(""));
  }
  return map;
}

function signature(text, minLength = 8) {
  const runs = (String(text ?? "").match(CJK_RUN) || [])
    .map((run) => run.replace(/\s+/g, ""))
    .filter((run) => run.length >= minLength)
    .sort((left, right) => right.length - left.length);
  return runs[0] || "";
}

export function verifyBank(questions, source, { fix = true } = {}) {
  const answerKey = buildAnswerKey(source.answerText);
  const studentFlat = flat(source.studentText);
  const report = {
    answerKeySize: answerKey.size,
    checked: 0,
    answerMismatch: [],
    fixed: [],
    unfixable: [],
    removed: [],
    missingNumbers: [],
    titleNotInSource: [],
    duplicateTitles: [],
    unchecked: 0,
  };

  const kept = [];
  for (const question of questions) {
    const optionKeys = new Set(question.options.map((option) => option.key));
    const sourceAnswer = answerKey.get(Number(question.number));

    if (!Number.isFinite(Number(question.number)) || !question.number) {
      report.unchecked += 1;
    } else if (!sourceAnswer) {
      report.unchecked += 1;
    } else {
      report.checked += 1;
      const expected = [...new Set(sourceAnswer)].sort();
      const actual = [...question.answer].sort();
      const same = expected.length === actual.length && expected.every((key, index) => key === actual[index]);
      if (!same) {
        const fixable = expected.every((key) => optionKeys.has(key));
        report.answerMismatch.push({ number: question.number, generated: actual.join(""), source: expected.join("") });
        if (fixable && fix) {
          question.answer = expected;
          question.type = expected.length > 1 ? "multiple" : "single";
          report.fixed.push({ number: question.number, from: actual.join(""), to: expected.join("") });
        } else {
          report.unfixable.push({ number: question.number, generated: actual.join(""), source: expected.join("") });
          report.removed.push(question.number);
          continue;
        }
      }
    }

    const titleSignature = signature(question.title);
    if (titleSignature && !studentFlat.includes(titleSignature)) {
      report.titleNotInSource.push(question.number || 0);
    }
    kept.push(question);
  }

  const seen = new Map();
  for (const question of kept) {
    const key = flat(question.title).slice(0, 40);
    seen.set(key, (seen.get(key) || 0) + 1);
  }
  report.duplicateTitles = [...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key.slice(0, 20));

  const used = new Set(kept.map((question) => Number(question.number)).filter(Boolean));
  if (answerKey.size) {
    report.missingNumbers = [...answerKey.keys()].filter((number) => !used.has(number)).sort((left, right) => left - right);
  }

  return { questions: kept, report, answerKey };
}
