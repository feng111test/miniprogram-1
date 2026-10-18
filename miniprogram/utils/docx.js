function decodeCodePoint(value) {
  if (value <= 0xffff) return String.fromCharCode(value);
  value -= 0x10000;
  return String.fromCharCode(0xd800 + (value >> 10), 0xdc00 + (value & 0x3ff));
}

function decodeXml(text) {
  return String(text || "")
    .replace(/&#(\d+);/g, function (_, code) {
      return decodeCodePoint(parseInt(code, 10));
    })
    .replace(/&#x([0-9a-f]+);/gi, function (_, code) {
      return decodeCodePoint(parseInt(code, 16));
    })
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function decodeUtf8(buffer) {
  var bytes = new Uint8Array(buffer);
  var out = [];
  for (var i = 0; i < bytes.length; i++) {
    var first = bytes[i];
    var codePoint;
    if (first < 0x80) {
      codePoint = first;
    } else if ((first & 0xe0) === 0xc0 && i + 1 < bytes.length) {
      codePoint = ((first & 0x1f) << 6) | (bytes[++i] & 0x3f);
    } else if ((first & 0xf0) === 0xe0 && i + 2 < bytes.length) {
      codePoint = ((first & 0x0f) << 12) | ((bytes[++i] & 0x3f) << 6) | (bytes[++i] & 0x3f);
    } else if ((first & 0xf8) === 0xf0 && i + 3 < bytes.length) {
      codePoint =
        ((first & 0x07) << 18) |
        ((bytes[++i] & 0x3f) << 12) |
        ((bytes[++i] & 0x3f) << 6) |
        (bytes[++i] & 0x3f);
      codePoint -= 0x10000;
      out.push(String.fromCharCode(0xd800 + (codePoint >> 10), 0xdc00 + (codePoint & 0x3ff)));
      continue;
    } else {
      codePoint = 0xfffd;
    }
    out.push(String.fromCharCode(codePoint));
  }
  return out.join("");
}

function asText(data) {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return decodeUtf8(data);
  throw new Error("Word 正文数据格式不受支持");
}

function extractText(xml) {
  var paragraphs = [];
  var paragraphPattern = /<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g;
  var paragraphMatch;

  while ((paragraphMatch = paragraphPattern.exec(xml))) {
    var content = paragraphMatch[1];
    var text = "";
    var tokenPattern = /<(?:w|m):t\b[^>]*>([\s\S]*?)<\/(?:w|m):t>|<w:(tab|br|cr)\b[^>]*\/\s*>/g;
    var tokenMatch;
    while ((tokenMatch = tokenPattern.exec(content))) {
      text += tokenMatch[1] !== undefined ? decodeXml(tokenMatch[1]) : "\n";
    }
    text = text.trim();
    if (text && !/^第\s*\d+\s*页\s*\/\s*共\s*\d+\s*页$/.test(text)) paragraphs.push(text);
  }

  return paragraphs.join("\n");
}

function objectiveText(text) {
  var lines = String(text || "").split("\n");
  var firstChoiceSection = -1;
  for (var i = 0; i < lines.length; i++) {
    if (/^[一二三四五六七八九十]+、.*选择题/.test(lines[i].trim())) {
      firstChoiceSection = i;
      break;
    }
  }
  if (firstChoiceSection < 0) return text;

  var end = lines.length;
  for (var j = firstChoiceSection + 1; j < lines.length; j++) {
    if (/^[一二三四五六七八九十]+、.*(?:非选择题|填空题|解答题)/.test(lines[j].trim())) {
      end = j;
      break;
    }
  }
  return lines
    .slice(firstChoiceSection + 1, end)
    .filter(function (line) {
      return !/^[一二三四五六七八九十]+、.*选择题/.test(line.trim());
    })
    .join("\n");
}

function toQuestionText(data) {
  var text = extractText(asText(data));
  return objectiveText(text);
}

module.exports = {
  toQuestionText: toQuestionText,
};
