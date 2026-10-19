import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const pdfjs = await import("../../web/node_modules/pdfjs-dist/legacy/build/pdf.mjs");

const DEFAULT_SOURCE = "F:/2026年高考化学真题（全国各地共22省）";

function parseArgs(argv) {
  const args = { source: DEFAULT_SOURCE, out: "out/text" };
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--source" && value) {
      args.source = value;
      index += 1;
    } else if (key === "--out" && value) {
      args.out = value;
      index += 1;
    }
  }
  return args;
}

export function classify(fileName) {
  const stem = fileName.replace(/\.pdf$/i, "");
  const key = stem
    .replace(/[（(]学生版[）)]/g, "")
    .replace(/[（(]答案版[）)]/g, "")
    .replace(/学生版|答案版/g, "")
    .replace(/答案$/g, "")
    .replace(/\s+/g, "");
  return {
    key,
    isAnswer: /答案/.test(stem) || /答案版/.test(stem),
    isStudent: /学生版/.test(stem),
  };
}

export function shortName(key) {
  let name = key.replace(/^2026年?高考?/, "").replace(/高考真题|真题/g, "").trim();
  const wrapped = name.match(/^化学[（(](.+?)[）)]$/);
  if (wrapped) name = `${wrapped[1]}化学`;
  return `2026${name.replace(/[（()）\s]/g, "")}`;
}

async function extractPdf(path) {
  const data = new Uint8Array(await readFile(path));
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: true }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();
    const lines = [];
    let line = "";
    for (const item of content.items) {
      if (!("str" in item)) continue;
      line += item.str;
      if (item.hasEOL) {
        if (line.trim()) lines.push(line.trim());
        line = "";
      }
    }
    if (line.trim()) lines.push(line.trim());
    pages.push({ pageNumber, lines });
    page.cleanup();
  }
  await doc.destroy();
  return pages;
}

function pagesToText(pages) {
  return pages
    .map((page) => `--- 第 ${page.pageNumber} 页 ---\n${page.lines.join("\n")}`)
    .join("\n\n");
}

async function main() {
  const args = parseArgs(process.argv);
  const entries = await readdir(args.source, { withFileTypes: true });
  const pdfNames = entries
    .filter((entry) => entry.isFile() && /\.pdf$/i.test(entry.name))
    .map((entry) => entry.name)
    .filter((name) => !/[（(]\d[）)]\.pdf$/i.test(name));

  const groups = new Map();
  for (const name of pdfNames) {
    const info = classify(name);
    if (!groups.has(info.key)) groups.set(info.key, { student: null, answer: null });
    const group = groups.get(info.key);
    if (info.isAnswer) group.answer = name;
    else if (!group.student) group.student = name;
  }

  await mkdir(args.out, { recursive: true });
  const summary = [];
  for (const [key, group] of groups) {
    const name = shortName(key);
    const studentPages = group.student ? await extractPdf(join(args.source, group.student)) : [];
    const answerPages = group.answer ? await extractPdf(join(args.source, group.answer)) : [];
    const studentText = pagesToText(studentPages);
    const answerText = pagesToText(answerPages);
    const content = [
      `===== 试卷：${name} =====`,
      "===== 学生版（题干与选项） =====",
      studentText || "（缺少学生版）",
      "===== 答案版（答案与解析） =====",
      answerText || "（缺少答案版）",
    ].join("\n\n");
    await writeFile(join(args.out, `${name}.txt`), content, "utf8");
    summary.push({
      name,
      student: group.student,
      answer: group.answer,
      pages: studentPages.length + answerPages.length,
      chars: content.length,
      warn: !studentText || !answerText ? "缺学生版或答案版" : studentText.length < 400 ? "文本过少，可能是扫描件" : "",
    });
  }

  console.log(`试卷数：${summary.length}`);
  for (const item of summary) {
    console.log(
      `${item.warn ? "⚠ " : "✓ "}${item.name} · ${item.pages} 页 · ${item.chars} 字${item.warn ? ` · ${item.warn}` : ""}`,
    );
  }
  console.log(`\n已写入 ${args.out}`);
}

main().catch((error) => {
  console.error("抽取失败：", error);
  process.exit(1);
});
