import { extractJsonText } from "../../web/src/vision-client.js";

export function braceEnd(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function bracketEnd(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

export function countNumberMarkers(text) {
  return (String(text).match(/"number"\s*:/g) || []).length;
}

export function extractQuestionObjects(text) {
  const content = String(text || "");
  const objects = [];
  const pattern = /\{\s*"number"\s*:/g;
  let match = pattern.exec(content);
  while (match) {
    const start = match.index;
    const end = braceEnd(content, start);
    if (end < 0) break;
    try {
      const parsed = JSON.parse(content.slice(start, end + 1));
      if (parsed && (parsed.title || parsed.stem)) objects.push(parsed);
    } catch {
      /* 单个对象损坏就跳过，不影响其它题 */
    }
    pattern.lastIndex = end + 1;
    match = pattern.exec(content);
  }
  return objects;
}

export function extractSkipped(text) {
  const content = String(text || "");
  const key = content.indexOf('"skipped"');
  if (key < 0) return [];
  const start = content.indexOf("[", key);
  if (start < 0) return [];
  const end = bracketEnd(content, start);
  if (end < 0) return [];
  try {
    const parsed = JSON.parse(content.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseModelOutput(raw) {
  const text = extractJsonText(raw);
  const markers = countNumberMarkers(text);

  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }

  const list = Array.isArray(data) ? data : Array.isArray(data?.questions) ? data.questions : [];
  const skipped = Array.isArray(data?.skipped) ? data.skipped : [];

  // 模型有时把每道题各自包一层 {"questions":[...]}，重复键会让 JSON.parse 只剩最后一题
  if (markers > 1 && list.length < markers) {
    const objects = extractQuestionObjects(text);
    const fallbackSkipped = extractSkipped(text);
    if (objects.length > list.length) {
      return { questions: objects, skipped: fallbackSkipped.length ? fallbackSkipped : skipped, repaired: true };
    }
  }

  if (!list.length && !Array.isArray(data)) {
    const objects = extractQuestionObjects(text);
    if (objects.length) {
      return { questions: objects, skipped: extractSkipped(text), repaired: true };
    }
  }

  return { questions: list, skipped, repaired: false };
}
