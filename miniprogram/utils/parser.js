/**
 * 题库解析：支持 JSON 数组 与 纯文本 两种格式
 *
 * 题目统一结构：
 * {
 *   id, type: 'single' | 'multiple' | 'judge',
 *   title, options: [{ key, content }], answer: ['A'], explanation
 * }
 */

var LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function normalize(text) {
  return String(text == null ? "" : text).replace(/\r\n?/g, "\n");
}

function unique(arr) {
  var out = [];
  arr.forEach(function (a) {
    if (out.indexOf(a) === -1) out.push(a);
  });
  return out;
}

function arrEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return a.slice().sort().join("|") === b.slice().sort().join("|");
}

function pick(obj, keys) {
  for (var i = 0; i < keys.length; i++) {
    var v = obj[keys[i]];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return "";
}

/* ---------------- 类型识别 ---------------- */

function detectType(text) {
  var s = String(text || "");
  if (/不定项|多选/.test(s)) return "multiple";
  if (/判断|是非|正误/.test(s)) return "judge";
  if (/单选/.test(s)) return "single";
  if (/multiple|multi/i.test(s)) return "multiple";
  if (/judge|boolean|true.?false|tf/i.test(s)) return "judge";
  if (/single|choice|radio/i.test(s)) return "single";
  return "";
}

/* ---------------- 答案标准化 ---------------- */

function normalizeAnswer(raw, type, keys) {
  var list = Array.isArray(raw)
    ? raw
    : String(raw == null ? "" : raw).split(/[,，、\s\/|]+/);
  list = list.map(function (s) {
    return String(s).trim();
  }).filter(function (s) {
    return !!s;
  });

  if (type === "judge") {
    var joined = list.join("");
    if (/不正确|不对|错误|错|×|否|false|wrong/i.test(joined)) return ["错误"];
    if (/正确|对|√|是|true|right/i.test(joined)) return ["正确"];
    if (joined === "A" || joined === "a") return ["正确"];
    if (joined === "B" || joined === "b") return ["错误"];
    return [];
  }

  var validKeys = keys && keys.length ? keys : LETTERS;
  var out = [];
  list.forEach(function (item) {
    var m = item.match(/^[（(]?([A-Za-z])[)）]?$/);
    if (m) {
      out.push(m[1].toUpperCase());
      return;
    }
    var n = item.match(/^(\d+)$/);
    if (n) {
      var idx = parseInt(n[1], 10) - 1;
      if (idx >= 0 && idx < validKeys.length) out.push(validKeys[idx]);
      return;
    }
    var letters = item.match(/[A-Za-z]/g);
    if (letters) {
      letters.forEach(function (l) {
        out.push(l.toUpperCase());
      });
    }
  });
  return unique(out).filter(function (k) {
    return validKeys.indexOf(k) > -1;
  });
}

/* ---------------- 选项行解析 ---------------- */

function matchOptionLine(line) {
  var s = String(line || "").trim();
  var m = s.match(/^[（(\[【]\s*([A-Za-z])\s*[）)\]】]\s*[.．、:：]?\s*(.+)$/);
  if (m) return { key: m[1].toUpperCase(), content: m[2].trim() };
  m = s.match(/^([A-Za-z])\s*[.．、:：,，)）]\s*(.+)$/);
  if (m) return { key: m[1].toUpperCase(), content: m[2].trim() };
  return null;
}

function parseOptionLines(text) {
  var out = [];
  String(text || "").split("\n").forEach(function (line) {
    var s = line.trim();
    var markers = [];
    var markerPattern = /([A-F])\s*[.．、:：]\s*/g;
    var marker;
    while ((marker = markerPattern.exec(s))) {
      markers.push({ key: marker[1], start: marker.index, end: markerPattern.lastIndex });
    }

    var inline = markers.length > 1 && markers[0].start === 0;
    for (var i = 1; inline && i < markers.length; i++) {
      inline = markers[i].key.charCodeAt(0) === markers[i - 1].key.charCodeAt(0) + 1;
    }

    if (inline) {
      markers.forEach(function (item, i) {
        var end = i + 1 < markers.length ? markers[i + 1].start : s.length;
        var content = s.slice(item.end, end).trim();
        if (content) out.push({ key: item.key, content: content });
      });
      return;
    }

    var m = matchOptionLine(s);
    if (m) out.push(m);
    else {
      m = s.match(/^([A-F])\s+(.+)$/);
      if (m) out.push({ key: m[1], content: m[2].trim() });
    }
  });
  return out;
}

function parseOptions(raw) {
  if (!raw) return [];
  if (typeof raw === "string") return parseOptionLines(raw);
  if (Array.isArray(raw)) {
    return raw.map(function (item, i) {
      var fallbackKey = LETTERS[i] || String(i);
      if (typeof item === "string") {
        var m = String(item).trim().match(/^([A-Za-z])\s*[.、:：,，)）]\s*(.+)$/);
        if (m) return { key: m[1].toUpperCase(), content: m[2].trim() };
        var b = String(item).trim().match(/^[（(\[【]\s*([A-Za-z])\s*[）)\]】]\s*(.+)$/);
        if (b) return { key: b[1].toUpperCase(), content: b[2].trim() };
        return { key: fallbackKey, content: String(item).trim() };
      }
      var key = String(pick(item, ["key", "option", "label", "name", "index"]) || fallbackKey)
        .trim()
        .toUpperCase()
        .charAt(0);
      return {
        key: key || fallbackKey,
        content: String(pick(item, ["content", "text", "value", "desc"]) || "").trim(),
      };
    }).filter(function (o) {
      return !!o.content;
    });
  }
  if (typeof raw === "object") {
    return Object.keys(raw).map(function (k) {
      return {
        key: String(k).trim().toUpperCase().charAt(0),
        content: String(raw[k] || "").trim(),
      };
    }).filter(function (o) {
      return !!o.content && /^[A-Z]$/.test(o.key);
    });
  }
  return [];
}

/* ---------------- JSON 题库 ---------------- */

function tryParseJson(text) {
  var data = null;
  try {
    data = JSON.parse(text);
  } catch (e) {
    var s = text.indexOf("[");
    var end = text.lastIndexOf("]");
    if (s > -1 && end > s) {
      try {
        data = JSON.parse(text.slice(s, end + 1));
      } catch (e2) {
        data = null;
      }
    }
  }
  if (!data) return null;
  if (Array.isArray(data)) return data;
  if (typeof data === "object") {
    var list = data.questions || data.list || data.data || data.items || data.bank;
    if (Array.isArray(list)) return list;
  }
  return null;
}

function buildQuestion(fields, order) {
  var title = String(fields.title || "").trim();
  var options = fields.options || [];
  var type = fields.type || (options.length ? "single" : "judge");
  var explanation = String(fields.explanation || "").trim();
  var keys;

  // 判断题统一使用「正确 / 错误」作为选项键，保证与答案比对一致
  if (type === "judge") {
    options = [
      { key: "正确", content: "正确" },
      { key: "错误", content: "错误" },
    ];
    keys = ["正确", "错误"];
  } else {
    keys = options.map(function (o) {
      return o.key;
    });
  }

  var answer = normalizeAnswer(fields.answer, type, keys);

  if (type !== "judge" && answer.length > 1) type = "multiple";

  if (!title) return { error: "缺少题干" };
  if (!answer.length) return { error: "缺少或无法识别答案" };
  if (type !== "judge" && !options.length) return { error: "缺少选项" };

  return {
    id: "q_" + order + "_" + Math.random().toString(36).slice(2, 8),
    type: type,
    title: title,
    options: options,
    answer: answer,
    explanation: explanation,
  };
}

function fromObject(item, order) {
  if (!item || typeof item !== "object") return { error: "数据格式错误" };
  return buildQuestion(
    {
      title: pick(item, ["title", "question", "stem", "content", "questionTitle", "题干", "题目"]),
      options: parseOptions(pick(item, ["options", "choices", "optionList", "selections", "选项"])),
      answer: pick(item, [
        "answer",
        "answers",
        "correct",
        "correctAnswer",
        "rightAnswer",
        "right",
        "result",
        "key",
        "答案",
        "正确答案",
      ]),
      type: detectType(String(pick(item, ["type", "questionType", "question_type", "题型"]) || "")),
      explanation: pick(item, [
        "explanation",
        "analysis",
        "explain",
        "answerAnalysis",
        "note",
        "remark",
        "解析",
      ]),
    },
    order
  );
}

/* ---------------- 纯文本题库 ---------------- */

function splitBlocks(text) {
  var blocks = text.split(/\n\s*\n+/).map(function (b) {
    return b.trim();
  }).filter(function (b) {
    return !!b;
  });

  var numbered = blocks.filter(function (b) {
    return /^\s*\d+\s*[.、．:：)）]/.test(b);
  });

  if (blocks.length > 1 && numbered.length >= Math.ceil(blocks.length / 2)) {
    return blocks;
  }

  // 兼容题目之间没有空行的写法
  var out = [];
  var cur = [];
  text.split("\n").forEach(function (line) {
    if (/^\s*\d+\s*[.、．:：)）]/.test(line)) {
      if (cur.join("").trim()) out.push(cur.join("\n").trim());
      cur = [line];
    } else {
      cur.push(line);
    }
  });
  if (cur.join("").trim()) out.push(cur.join("\n").trim());
  return out.filter(function (b) {
    return !!b;
  });
}

function parseBlock(block, order) {
  var lines = block.split("\n").map(function (l) {
    return l.trim();
  }).filter(function (l) {
    return !!l;
  });
  if (!lines.length) return { error: "空内容" };

  var answerRe = /^[【\[（(]?\s*(?:正确答案|参考答案|标准答案|答案)\s*[】\]）)]?\s*[：:＝=]?\s*(.*)$/;
  var analysisRe = /^[【\[（(]?\s*(?:答案解析|试题解析|解析|详解|解释)\s*[】\]）)]?\s*[：:＝=]?\s*(.*)$/;
  var typeRe = /[（(\[【]\s*(不定项选择题|不定项|多项选择题|多选题|多选|单项选择题|单选题|单选|判断题|判断|是非题)\s*[）)\]】]/;

  var answerRaw = "";
  var analysisLines = [];
  var weakOptionLines = [];
  var options = [];
  var optionKeys = {};
  var hasStrongOption = false;
  var titleLines = [];
  var typeHint = "";
  var inAnalysis = false;

  lines.forEach(function (line) {
    if (!answerRaw && answerRe.test(line)) {
      answerRaw = line.match(answerRe)[1].trim();
      return;
    }
    if (analysisRe.test(line)) {
      inAnalysis = true;
      var em = line.match(analysisRe)[1].trim();
      if (em) analysisLines.push(em);
      return;
    }
    if (inAnalysis) {
      analysisLines.push(line);
      return;
    }
    var lineOptions = parseOptionLines(line);
    if (lineOptions.length) {
      if (matchOptionLine(line)) {
        hasStrongOption = true;
        lineOptions.forEach(function (option) {
          if (!optionKeys[option.key]) {
            options.push(option);
            optionKeys[option.key] = true;
          }
        });
      } else {
        weakOptionLines.push({ line: line, options: lineOptions });
      }
      return;
    }
    titleLines.push(line);
  });

  weakOptionLines.forEach(function (candidate) {
    var added = false;
    candidate.options.forEach(function (option) {
      if (!hasStrongOption || !optionKeys[option.key]) {
        if (!optionKeys[option.key]) {
          options.push(option);
          optionKeys[option.key] = true;
        }
        added = true;
      }
    });
    if (!added) titleLines.push(candidate.line);
  });

  options.sort(function (a, b) {
    return a.key.charCodeAt(0) - b.key.charCodeAt(0);
  });

  var title = titleLines.join("\n").trim();
  var tm = title.match(typeRe);
  if (tm) {
    typeHint = tm[1];
    title = title.replace(tm[0], " ").trim();
  }
  title = title.replace(/^\s*\d+\s*[.、．:：)）]\s*/, "").trim();

  var type = detectType(typeHint) || (options.length ? "single" : "judge");

  return buildQuestion(
    {
      title: title,
      options: options,
      answer: answerRaw,
      type: type,
      explanation: analysisLines.join("\n").trim(),
    },
    order
  );
}

/* ---------------- 对外入口 ---------------- */

/**
 * 解析题库文本
 * @param {String} text
 * @return {{name: String, questions: Array, errors: Array}}
 */
function parseBank(text) {
  var raw = normalize(text);
  var name = "";

  var nameMatch = raw.match(/(?:^|\n)\s*(?:#|【|\*)?\s*(?:题库名称|题库名|题库|名称)\s*(?:】|\*)?\s*[：:=＝]\s*(.+)/);
  if (nameMatch) {
    name = nameMatch[1].trim();
    raw = raw.replace(nameMatch[0], "\n");
  } else {
    var hash = raw.match(/^\s*#\s*(.+)/);
    if (hash) {
      name = hash[1].trim();
      raw = raw.replace(hash[0], "\n");
    }
  }

  raw = raw.trim();
  if (!raw) return { name: name, questions: [], errors: ["内容为空"] };

  var questions = [];
  var errors = [];

  var list = tryParseJson(raw);
  if (list) {
    list.forEach(function (item, i) {
      var res = fromObject(item, i);
      if (res.error) errors.push({ index: i + 1, reason: res.error });
      else questions.push(res);
    });
  } else {
    splitBlocks(raw).forEach(function (block, i) {
      var res = parseBlock(block, i);
      if (res.error) errors.push({ index: i + 1, reason: res.error });
      else questions.push(res);
    });
  }

  return { name: name, questions: questions, errors: errors };
}

module.exports = {
  parseBank: parseBank,
  arrEqual: arrEqual,
  normalizeAnswer: normalizeAnswer,
  detectType: detectType,
};
