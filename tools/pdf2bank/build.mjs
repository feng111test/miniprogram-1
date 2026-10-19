import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { REQUEST_OPTIONS, buildSystemPrompt, buildUserPrompt } from "./prompt.mjs";
import { markFigureQuestions } from "./figures.mjs";
import { parseModelOutput } from "./parse.mjs";
import { buildAnswerKey, splitSource, verifyBank } from "./verify.mjs";

const MAX_TITLE = 1000;
const MAX_OPTION = 500;
const MAX_EXPLAIN = 2000;

function parseArgs(argv) {
  const args = { in: "out/text", out: "out/bank", config: "config.json", only: "", dry: false, noFix: false, noRepair: false };
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--in") { args.in = value; index += 1; }
    else if (key === "--out") { args.out = value; index += 1; }
    else if (key === "--config") { args.config = value; index += 1; }
    else if (key === "--only") { args.only = value; index += 1; }
    else if (key === "--dry") { args.dry = true; }
    else if (key === "--no-fix") { args.noFix = true; }
    else if (key === "--no-repair") { args.noRepair = true; }
    else if (key === "--help") { args.help = true; }
  }
  return args;
}

async function readConfig(path) {
  let file = {};
  try {
    file = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error(`读取 ${path} 失败：${error.message}`);
  }
  return {
    baseUrl: String(process.env.LLM_BASE_URL || file.baseUrl || "").trim().replace(/\/+$/, ""),
    model: String(process.env.LLM_MODEL || file.model || "").trim(),
    apiKey: String(process.env.LLM_API_KEY || file.apiKey || "").trim(),
    concurrency: Math.max(1, Number(file.concurrency) || 2),
  };
}

function endpointOf(baseUrl) {
  const base = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  return /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
}

function errorText(status, message) {
  if (status === 401 || status === 403) return `API Key 无效或没有权限（${message || status}）`;
  if (status === 404) return `接口或模型不存在（${message || status}）`;
  if (status === 429) return "请求过于频繁或额度用尽，请降低并发";
  return `接口返回 ${status}${message ? `：${message}` : ""}`;
}

export async function requestBank(settings, text, { includeExplanation = true, expected, missing } = {}) {
  const endpoint = endpointOf(settings.baseUrl);
  if (!endpoint) throw new Error("请先配置 baseUrl");
  if (!settings.model) throw new Error("请先配置 model");
  if (!settings.apiKey) throw new Error("请先配置 apiKey");

  let response = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` },
        body: JSON.stringify({
          model: settings.model,
          ...REQUEST_OPTIONS,
          messages: [
            { role: "system", content: buildSystemPrompt({ includeExplanation }) },
            { role: "user", content: buildUserPrompt(text, { expected, missing }) },
          ],
        }),
      });
      break;
    } catch (error) {
      if (attempt === 2) throw new Error(`无法连接接口：${error.message || "网络不通"}`);
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(errorText(response.status, payload?.error?.message || payload?.message));
  }
  const content = payload?.choices?.[0]?.message?.content;
  const raw = typeof content === "string" ? content : Array.isArray(content) ? content.map((item) => item?.text || "").join("") : "";
  try {
    return {
      data: parseModelOutput(raw),
      usage: payload?.usage || null,
      finishReason: payload?.choices?.[0]?.finish_reason || "",
    };
  } catch (error) {
    const parseError = new Error(`模型返回不是合法 JSON：${error.message}`);
    parseError.code = "parse";
    throw parseError;
  }
}

function normalizeQuestion(raw, warnings) {
  const input = raw && typeof raw === "object" ? raw : {};
  let type = input.type === "multiple" ? "multiple" : input.type === "judge" ? "judge" : "single";

  let title = String(input.title ?? "").replace(/\s+/g, " ").trim();
  if (!title) return null;
  if (title.length > MAX_TITLE) {
    warnings.push(`题干超过 ${MAX_TITLE} 字，已截断`);
    title = title.slice(0, MAX_TITLE);
  }

  const options = (Array.isArray(input.options) ? input.options : [])
    .map((option, index) => ({
      key: String(option?.key ?? "ABCDEF"[index] ?? "").trim().toUpperCase().slice(0, 1),
      content: String(option?.content ?? "").trim(),
    }))
    .filter((option) => /^[A-F]$/.test(option.key) && option.content);

  let answer = (Array.isArray(input.answer) ? input.answer : String(input.answer ?? "").split(/[,，、\s]+/))
    .map((item) => String(item).trim().toUpperCase())
    .filter((item) => /^[A-F]$/.test(item));
  answer = [...new Set(answer)].sort();

  if (type === "judge") {
    const keys = new Set(answer.join(""));
    if (!keys.size) return null;
    return {
      number: Number(input.number) || 0,
      type: "judge",
      hasFigure: input.hasFigure === true,
      title,
      options: [],
      answer: [keys.has("A") ? "正确" : "错误"],
      explanation: String(input.explanation ?? "").trim().slice(0, MAX_EXPLAIN),
    };
  }

  if (options.length < 2 || !answer.length) return null;
  const keys = new Set(options.map((option) => option.key));
  if (!answer.every((key) => keys.has(key))) return null;
  if (answer.length > 1) type = "multiple";

  for (const option of options) {
    if (option.content.length > MAX_OPTION) {
      warnings.push(`选项 ${option.key} 超过 ${MAX_OPTION} 字，已截断`);
      option.content = option.content.slice(0, MAX_OPTION);
    }
  }

  let explanation = String(input.explanation ?? "").trim();
  if (explanation.length > MAX_EXPLAIN) {
    warnings.push("解析超过 2000 字，已截断");
    explanation = explanation.slice(0, MAX_EXPLAIN);
  }

  return {
    number: Number(input.number) || 0,
    type,
    hasFigure: input.hasFigure === true,
    title,
    options,
    answer,
    explanation,
  };
}

export function normalizeBank(data) {
  const warnings = [];
  const dropped = [];
  const list = Array.isArray(data) ? data : Array.isArray(data?.questions) ? data.questions : [];
  const questions = [];
  for (const [index, raw] of list.entries()) {
    const question = normalizeQuestion(raw, warnings);
    if (question) questions.push(question);
    else dropped.push(raw?.number ?? index + 1);
  }
  const skipped = (Array.isArray(data?.skipped) ? data.skipped : []).map((item) => ({
    number: Number(item?.number) || 0,
    reason: String(item?.reason || "").slice(0, 120),
  }));
  const figure = questions.filter(
    (question) =>
      /含图|见原卷/.test(question.title) ||
      question.options.some((option) => /见原卷/.test(option.content)),
  ).length;
  return { questions, skipped, warnings, dropped, figure };
}

export function mergeByNumber(existing, extra) {
  const byNumber = new Map();
  for (const question of [...existing, ...extra]) {
    if (!byNumber.has(question.number)) byNumber.set(question.number, question);
  }
  return [...byNumber.values()].sort((left, right) => left.number - right.number);
}

function usage() {
  console.log(`用法：
  node extract.mjs [--source <PDF目录>] [--out out/text]
  node build.mjs   [--in out/text] [--out out/bank] [--config config.json] [--only 北京] [--no-fix] [--no-repair] [--dry]

配置（任选其一）：
  config.json: { "baseUrl": "...", "model": "...", "apiKey": "...", "concurrency": 2 }
  环境变量: LLM_BASE_URL / LLM_MODEL / LLM_API_KEY`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    usage();
    return;
  }

  const settings = await readConfig(args.config);
  const files = (await readdir(args.in))
    .filter((name) => name.endsWith(".txt"))
    .filter((name) => !args.only || name.includes(args.only))
    .sort();
  if (!files.length) throw new Error(`${args.in} 下没有 txt，请先运行 extract.mjs`);

  if (args.dry) {
    const text = await readFile(join(args.in, files[0]), "utf8");
    console.log("=== SYSTEM ===");
    console.log(buildSystemPrompt());
    console.log("\n=== USER（前 1000 字） ===");
    console.log(text.slice(0, 1000));
    console.log(`\n共 ${text.length} 字，将发送给 ${settings.model || "（未配置模型）"}`);
    return;
  }

  const missing = ["baseUrl", "model", "apiKey"].filter((key) => !settings[key]);
  if (missing.length) {
    throw new Error(`缺少配置 ${missing.join("、")}；请复制 config.example.json 为 config.json 并填写，或设置环境变量`);
  }

  await mkdir(args.out, { recursive: true });
  const results = [];
  let cursor = 0;

  const runOne = async (file) => {
    const name = file.replace(/\.txt$/, "");
    try {
      const text = await readFile(join(args.in, file), "utf8");
      const source = splitSource(text);
      const answerKey = buildAnswerKey(source.answerText);
      const expected = {
        count: answerKey.size,
        numbers: [...answerKey.keys()].sort((left, right) => left - right),
      };

      let result;
      try {
        result = await requestBank(settings, text, { includeExplanation: true, expected });
      } catch (error) {
        if (error.code !== "parse") throw error;
        console.warn(`  ↻ ${name} · 返回不是合法 JSON，改为不带解析重试一次`);
        result = await requestBank(settings, text, { includeExplanation: false, expected });
      }
      if (result.finishReason === "length") {
        console.warn(`  ↻ ${name} · 输出被截断，改为不带解析重试一次`);
        const retry = await requestBank(settings, text, { includeExplanation: false, expected }).catch(() => null);
        if (retry && retry.data.questions.length >= result.data.questions.length) result = retry;
      }
      if (result.data.repaired) console.warn(`  ↺ ${name} · 已从重复包裹中恢复题目`);

      const normalized = normalizeBank(result.data);
      if (!normalized.questions.length) throw new Error("没有提取到可用选择题");
      markFigureQuestions(normalized.questions);

      let verification = verifyBank(normalized.questions, source, { fix: !args.noFix });
      const missing = verification.report.missingNumbers;
      if (missing.length && !args.noRepair) {
        console.warn(`  ↻ ${name} · 漏题 ${missing.join("、")}，定向补跑一次`);
        const retry = await requestBank(settings, text, { includeExplanation: true, expected, missing }).catch((error) => {
          console.warn(`  ⚠ ${name} · 补跑失败：${error.message}`);
          return null;
        });
        if (retry) {
          const extra = normalizeBank(retry.data).questions.filter((question) => missing.includes(question.number));
          if (extra.length) {
            markFigureQuestions(extra);
            verification = verifyBank(mergeByNumber(verification.questions, extra), source, { fix: !args.noFix });
          }
        }
      }

      const questions = verification.questions;
      if (!questions.length) throw new Error("答案核对后没有可用题目");
      const figure = questions.filter((question) => question.needsFigure).length;
      const figureLikely = questions.filter((question) => question.figureLikely).length;
      const skipped = normalized.skipped;
      const warnings = normalized.warnings;
      const dropped = normalized.dropped;
      const usage = result.usage;
      await writeFile(
        join(args.out, `${name}.json`),
        `${JSON.stringify({
          format: "local-question-bank-v1",
          name,
          source: "pdf",
          exportedAt: new Date().toISOString(),
          questions,
        }, null, 2)}\n`,
        "utf8",
      );
      const v = verification.report;
      const answerInfo = v.answerKeySize
        ? `答案 ${v.checked}/${v.answerKeySize}${v.fixed.length ? ` · 修正 ${v.fixed.length}` : ""}${v.unfixable.length ? ` · 移除 ${v.unfixable.length}` : ""} · 漏题 ${v.missingNumbers.length}`
        : "答案版未解析出答案，跳过答案核对";
      results.push({ name, ok: true, questions: questions.length, figure, figureLikely, skipped, warnings, dropped, usage, verify: v });
      console.log(
        `✓ ${name} · ${questions.length} 题（含图 ${figure}｜疑似 ${figureLikely}） · ${answerInfo} · 原文核对 ${questions.length - v.titleNotInSource.length}/${questions.length} · 丢弃 ${dropped.length}`,
      );
      if (v.missingNumbers.length) console.warn(`  ⚠ ${name} · 答案版有但结果缺失的题号：${v.missingNumbers.join("、")}`);
      if (v.titleNotInSource.length) console.warn(`  ⚠ ${name} · 题干未能在原文找到：${v.titleNotInSource.join("、")}`);
      if (v.unfixable.length) console.warn(`  ⚠ ${name} · 答案与选项冲突已移除：${v.unfixable.map((item) => `第${item.number}题(源${item.source}/生成${item.generated})`).join("、")}`);
    } catch (error) {
      results.push({ name, ok: false, error: error.message });
      console.error(`✗ ${name} · ${error.message}`);
    }
  };

  const workers = Array.from({ length: Math.min(settings.concurrency, files.length) }, async () => {
    while (cursor < files.length) {
      const index = cursor;
      cursor += 1;
      await runOne(files[index]);
    }
  });
  await Promise.all(workers);

  const combined = [];
  for (const result of results) {
    if (!result.ok) continue;
    const bank = JSON.parse(await readFile(join(args.out, `${result.name}.json`), "utf8"));
    combined.push(...bank.questions);
  }
  if (combined.length && combined.length <= 480) {
    await writeFile(
      join(args.out, "2026高考化学选择题合集.json"),
      `${JSON.stringify({
        format: "local-question-bank-v1",
        name: "2026高考化学选择题合集",
        source: "pdf",
        exportedAt: new Date().toISOString(),
        questions: combined,
      }, null, 2)}\n`,
      "utf8",
    );
  }

  const report = {
    generatedAt: new Date().toISOString(),
    model: settings.model,
    totalQuestions: combined.length,
    papers: results,
  };
  await writeFile(join(args.out, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const okCount = results.filter((result) => result.ok).length;
  const tokens = results.reduce((sum, result) => sum + (result.usage?.total_tokens || 0), 0);
  console.log(`\n完成 ${okCount}/${results.length} 套 · 共 ${combined.length} 道选择题 · 消耗 ${tokens} tokens`);
  console.log(`输出目录：${args.out}`);
  if (results.some((result) => !result.ok)) {
    console.log("失败明细见 report.json");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`\n${error.message}`);
    process.exit(1);
  });
}
