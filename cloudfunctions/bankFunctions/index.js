const cloud = require("wx-server-sdk");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

/* 集合名 */
const COLL_BANK = "banks"; // 题库元信息
const COLL_QUESTION = "questions"; // 题目（按 bankId 拆分成多条，避免单文档过大）
const COLL_RECORD = "records"; // 每个用户 × 每个题库 一条练习记录

/* 限制 */
const MAX_QUESTIONS = 1000; // 单个题库题目上限
const MAX_BANKS = 100; // 单个用户题库上限

// 部署标记：每次改完云函数上传后把这里改一下，
// 客户端控制台打印的标记若不一致，说明云端跑的还是旧代码
const BUILTIN_BANKS = require("./builtin-data/manifest.json").banks || [];
const DEPLOY_TAG = "builtin-chemistry-review-4";

function now() {
  return Date.now();
}

function str(value, maxLen) {
  return String(value == null ? "" : value).trim().slice(0, maxLen || 200);
}

function normalizeImages(value) {
  if (!Array.isArray(value)) return [];
  return value.map(function (image) {
    if (!image || typeof image !== "object" || typeof image.dataUrl !== "string" || image.dataUrl.length > 400000) return null;
    return { page: Number(image.page) || 0, dataUrl: image.dataUrl };
  }).filter(Boolean);
}

function bizError(message) {
  const err = new Error(message);
  err.isBizError = true;
  return err;
}

/* ---------------- 题目清洗 ---------------- */

function normalizeQuestion(raw) {
  if (!raw || typeof raw !== "object") return null;

  const title = str(raw.title, 5000);
  if (!title) return null;

  let type = str(raw.type, 20) || "single";
  if (type !== "single" && type !== "multiple" && type !== "judge" && type !== "subjective") type = "single";

  const options = Array.isArray(raw.options)
    ? raw.options
        .map(function (o) {
          return {
            key: str(o && o.key, 10),
            content: str(o && o.content, 4000),
            formulaImages: normalizeImages(o && o.formulaImages),
          };
        })
        .filter(function (o) {
          return !!o.content;
        })
    : [];

  let answer = Array.isArray(raw.answer) ? raw.answer : [raw.answer];
  answer = answer
    .map(function (a) {
      return str(a, type === "subjective" ? 8000 : 20);
    })
    .filter(Boolean);

  if (type === "multiple") {
    answer = answer.flatMap(function (item) {
      return String(item).toUpperCase().match(/[A-F]/g) || [];
    });
  }

  if (type === "single") {
    // 校对时可能写成 “A B”“ab” 等多个字母，单选只保留一个有效选项字母，
    // 否则落库的答案数组与选项对不上，练习页判分会永远判错
    const keys = options.map(function (option) { return String(option.key).toUpperCase(); });
    const letters = answer.join("").toUpperCase().match(/[A-F]/g) || [];
    const matched = letters.filter(function (key) { return keys.indexOf(key) > -1; });
    if (matched.length) answer = [matched[0]];
    else if (letters.length) answer = [letters[0]];
  }

  if (type === "judge") {
    options.length = 0;
    options.push({ key: "正确", content: "正确" }, { key: "错误", content: "错误" });
  }

  if (!answer.length) return null;
  if (type !== "judge" && type !== "subjective" && !options.length) return null;

  return {
    type: type,
    paperNumber: str(raw.paperNumber, 10),
    partNumber: str(raw.partNumber, 10),
    questionLabel: str(raw.questionLabel, 20),
    sourcePage: Number(raw.sourcePage) || 0,
    reviewed: raw.reviewed === true,
    reviewedAt: Number(raw.reviewedAt) || 0,
    title: title,
    titleImages: normalizeImages(raw.titleImages),
    images: normalizeImages(raw.images),
    options: options,
    answer: answer,
    explanation: str(raw.explanation, 12000),
    explanationImages: normalizeImages(raw.explanationImages),
    id: str(raw.id || raw.qid, 100),
    region: str(raw.region, 20),
  };
}

function questionDocumentId(bankId, qid) {
  return bankId + "-q-" + crypto.createHash("sha1").update(String(qid)).digest("hex");
}

function ensureUniqueQuestionIds(questions) {
  const seen = {};
  questions.forEach(function (q, index) {
    const base = q.id || "question-" + (index + 1);
    const count = seen[base] || 0;
    seen[base] = count + 1;
    q.id = count ? base + "-" + (count + 1) : base;
  });
}

function countTypes(questions) {
  const stat = { single: 0, multiple: 0, judge: 0, subjective: 0 };
  questions.forEach(function (q) {
    if (stat[q.type] !== undefined) stat[q.type] += 1;
  });
  return stat;
}

/* ---------------- 题库 ---------------- */

async function listBanks(openid) {
  const [bankRes, recordRes] = await Promise.all([
    // 注意：这里不使用 orderBy，因为 where + orderBy 需要手动建复合索引，
    // 改为取回后在内存中排序，开箱即用无需配置索引
    db
      .collection(COLL_BANK)
      .where(_.or([{ _openid: openid }, { public: true }]))
      .limit(MAX_BANKS)
      .get(),
    db.collection(COLL_RECORD).where({ _openid: openid }).limit(MAX_BANKS).get(),
  ]);

  console.log(
    "[列表] openid =",
    openid,
    "题库数 =",
    (bankRes.data || []).length,
    "记录数 =",
    (recordRes.data || []).length
  );

  const recordMap = {};
  (recordRes.data || []).forEach(function (r) {
    recordMap[r.bankId] = r;
  });

  return (bankRes.data || [])
    .sort(function (a, b) {
      return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
    })
    .map(function (b) {
      return buildMeta(b, recordMap[b._id], openid);
    });
}

function buildMeta(bank, record, openid) {
  const answers = (record && record.answers) || {};
  const ids = Object.keys(answers);
  let correct = 0;
  ids.forEach(function (k) {
    if (answers[k] && answers[k].correct) correct += 1;
  });

  return {
    id: bank._id,
    name: bank.name || "未命名题库",
    desc: bank.desc || "",
    count: bank.count || 0,
    typeStat: bank.typeStat || { single: 0, multiple: 0, judge: 0, subjective: 0 },
    public: bank.public === true,
    builtinId: bank.builtinId || "",
    mine: bank._openid === openid,
    answered: ids.length,
    correct: correct,
    accuracy: ids.length ? Math.round((correct / ids.length) * 100) : 0,
    wrong: (record && record.wrongIds ? record.wrongIds : []).length,
    star: (record && record.starIds ? record.starIds : []).length,
    updatedAt: bank.updatedAt || bank.createdAt || 0,
  };
}

async function getBank(id, openid, offset, limit) {
  let bank = null;
  try {
    const res = await db.collection(COLL_BANK).doc(id).get();
    bank = res && res.data ? res.data : null;
  } catch (err) {
    return null;
  }

  if (!bank) return null;
  if (bank.public !== true && bank._openid !== openid) {
    throw bizError("无权访问该题库");
  }

  const safeOffset = Math.max(0, Number(offset) || 0);
  const [page, record] = await Promise.all([
    fetchQuestions(id, bank.questionIds || [], safeOffset, Math.min(32, Math.max(1, Number(limit) || 32))),
    fetchRecord(id, openid),
  ]);

  return {
    id: bank._id,
    name: bank.name || "未命名题库",
    desc: bank.desc || "",
    public: bank.public === true,
    mine: bank._openid === openid,
    questions: page.questions,
    questionCount: bank.count || 0,
    nextOffset: page.nextOffset,
    hasMore: page.nextOffset < (bank.count || 0),
    record: record || { answers: {}, wrongIds: [], starIds: [], lastIndex: 0 },
  };
}

async function fetchQuestions(bankId, questionIds, offset, limit) {
  let data = [];
  let requestedCount = 0;
  if (questionIds.length) {
    const qids = questionIds.slice(offset, offset + limit);
    requestedCount = qids.length;
    const ids = qids.map(function (qid) { return questionDocumentId(bankId, qid); });
    const res = await db.collection(COLL_QUESTION).where({ _id: _.in(ids) }).get();
    data = res.data || [];
  } else {
    const res = await db.collection(COLL_QUESTION).where({ bankId }).limit(1000).get();
    data = (res.data || []).sort(function (a, b) { return (a.order || 0) - (b.order || 0); }).slice(offset, offset + limit);
    requestedCount = data.length;
  }
  data.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
  const candidates = data
    .map(function (q) {
      return {
        id: q.qid || q._id,
        type: q.type,
        paperNumber: q.paperNumber || "",
        partNumber: q.partNumber || "",
        questionLabel: q.questionLabel || "",
        region: q.region || "",
        title: q.title,
        sourcePage: q.sourcePage || 0,
        reviewed: q.reviewed === true,
        reviewedAt: q.reviewedAt || 0,
        titleImages: q.titleImages || [],
        images: q.images || [],
        options: q.options || [],
        answer: q.answer || [],
        explanation: q.explanation || "",
        explanationImages: q.explanationImages || [],
      };
    });
  const page = [];
  let bytes = 0;
  const maxBytes = 800 * 1024;
  for (let index = 0; index < candidates.length; index += 1) {
    const questionBytes = Buffer.byteLength(JSON.stringify(candidates[index]), "utf8");
    if (page.length && bytes + questionBytes > maxBytes) break;
    page.push(candidates[index]);
    bytes += questionBytes;
  }
  return { questions: page, nextOffset: offset + (page.length === candidates.length ? requestedCount : page.length) };
}

async function createBank(data, openid) {
  const rawList = Array.isArray(data.questions) ? data.questions : [];
  const questions = rawList.map(normalizeQuestion).filter(Boolean).slice(0, MAX_QUESTIONS);
  ensureUniqueQuestionIds(questions);
  console.log("[创建题库] 收到题目数 =", rawList.length, "有效题目数 =", questions.length);

  if (!questions.length) throw bizError("没有解析到有效题目");

  const countRes = await db.collection(COLL_BANK).where({ _openid: openid }).count();
  if ((countRes.total || 0) >= MAX_BANKS) throw bizError("题库数量已达上限");

  const ts = now();
  const addRes = await db.collection(COLL_BANK).add({
    data: {
      // 必须显式写入归属者：云函数 add() 不会自动补 _openid，
      // 不写的话后续按 _openid 过滤的列表查询会查不到这个题库
      _openid: openid,
      name: str(data.name, 30) || "未命名题库",
      desc: str(data.desc, 100),
      count: questions.length,
      questionIds: questions.map(function (q) { return q.id; }),
      typeStat: countTypes(questions),
      public: data.public === true,
      builtinId: str(data.builtinId, 100),
      createdAt: ts,
      updatedAt: ts,
    },
  });

  await insertQuestions(addRes._id, questions);
  return { id: addRes._id };
}

async function insertQuestions(bankId, questions, startOrder) {
  // 分批并发写入，减少串行往返；内置题库一次要写几百条，批太小会拖到云函数超时
  const SIZE = 40;
  for (let i = 0; i < questions.length; i += SIZE) {
    const chunk = questions.slice(i, i + SIZE);
    await Promise.all(
      chunk.map(function (q, j) {
        return db.collection(COLL_QUESTION).doc(questionDocumentId(bankId, q.id)).set({
          data: {
            bankId: bankId,
            order: (Number(startOrder) || 0) + i + j,
            qid: q.id || q._id || "",
            type: q.type,
            paperNumber: q.paperNumber,
            partNumber: q.partNumber,
            questionLabel: q.questionLabel,
            region: q.region,
            sourcePage: q.sourcePage,
            reviewed: q.reviewed,
            reviewedAt: q.reviewedAt,
            title: q.title,
            titleImages: q.titleImages,
            images: q.images,
            options: q.options,
            answer: q.answer,
            explanation: q.explanation,
            explanationImages: q.explanationImages,
            createdAt: now(),
          },
        });
      })
    );
  }
}

async function updateBank(id, data, openid) {
  const bank = await loadOwnBank(id, openid);
  const patch = { updatedAt: now() };

  if (Object.prototype.hasOwnProperty.call(data, "name")) {
    const name = str(data.name, 30);
    if (name) patch.name = name;
  }
  if (Object.prototype.hasOwnProperty.call(data, "public")) {
    patch.public = data.public === true;
  }
  if (Object.prototype.hasOwnProperty.call(data, "desc")) {
    patch.desc = str(data.desc, 100);
  }

  await db.collection(COLL_BANK).doc(bank._id).update({ data: patch });
  return { id: bank._id };
}

async function updateQuestion(bankId, qid, patch, openid) {
  const bank = await loadOwnBank(bankId, openid);
  if (!qid) throw bizError("缺少题目 ID");
  let current = null;
  if (bank.questionIds && bank.questionIds.indexOf(qid) > -1) {
    try {
      const found = await db.collection(COLL_QUESTION).doc(questionDocumentId(bankId, qid)).get();
      current = found && found.data;
    } catch (err) { current = null; }
  } else {
    const found = await db.collection(COLL_QUESTION).where({ bankId: bankId, qid: qid }).limit(1).get();
    current = found.data && found.data[0];
  }
  if (!current) throw bizError("题目不存在");
  const merged = normalizeQuestion(Object.assign({}, current, patch || {}, { id: qid }));
  if (!merged) throw bizError("题干、选项或答案格式不完整");
  const ts = now();
  await db.collection(COLL_QUESTION).doc(current._id).update({
    data: {
      type: merged.type, title: merged.title, options: merged.options, answer: merged.answer,
      explanation: merged.explanation, reviewed: true, reviewedAt: ts, updatedAt: ts,
    },
  });
  return { id: qid, reviewedAt: ts };
}

async function getBuiltins() {
  return BUILTIN_BANKS.map(function (item) {
    return { id: item.id, name: item.name, desc: item.desc, questionCount: item.questionCount, region: item.region || "" };
  });
}

async function addBuiltin(id, openid) {
  const builtin = BUILTIN_BANKS.find(function (item) { return item.id === id; });
  if (!builtin) throw bizError("未找到该内置题库");
  const existing = await db.collection(COLL_BANK).where({ _openid: openid, builtinId: id }).limit(1).get();
  const sources = builtin.members
    ? builtin.members.map(function (memberId) { return BUILTIN_BANKS.find(function (item) { return item.id === memberId; }); }).filter(Boolean)
    : [builtin];
  const questionCount = sources.reduce(function (sum, source) { return sum + (source.questionCount || 0); }, 0);
  if (!questionCount || questionCount > MAX_QUESTIONS) throw bizError("内置题库题量无效");

  let bankId = null;
  if (existing.data && existing.data[0]) {
    const bank = existing.data[0];
    const progress = Number(bank.builtinProgress) || 0;
    if ((bank.count || 0) === questionCount && progress >= sources.length) {
      return { id: bank._id, alreadyAdded: true, done: true, progress: sources.length, total: sources.length };
    }
    if ((bank.count || 0) !== questionCount) {
      // 老版本留下的半截题库（导入被云函数超时打断），清掉重导
      await db.collection(COLL_QUESTION).where({ bankId: bank._id }).remove();
      await db.collection(COLL_BANK).doc(bank._id).remove();
    } else {
      // 题量一致但没导完，接着上次的分卷继续，不重复写
      bankId = bank._id;
    }
  }
  const countRes = await db.collection(COLL_BANK).where({ _openid: openid }).count();
  if ((countRes.total || 0) >= MAX_BANKS) throw bizError("题库数量已达上限");
  const typeStat = sources.reduce(function (sum, source) {
    ["single", "multiple", "judge", "subjective"].forEach(function (key) { sum[key] += (source.typeStat && source.typeStat[key]) || 0; });
    return sum;
  }, { single: 0, multiple: 0, judge: 0, subjective: 0 });
  const questionIds = sources.reduce(function (all, source) { return all.concat(source.questionIds || []); }, []);
  if (questionIds.length !== questionCount) throw bizError("内置题库题号校验失败");

  let progress = 0;
  if (!bankId) {
    const ts = now();
    const added = await db.collection(COLL_BANK).add({ data: {
      _openid: openid, name: str(builtin.name, 30), desc: str(builtin.desc, 100),
      count: questionCount, typeStat: typeStat, questionIds: questionIds, public: false, builtinId: id,
      builtinProgress: 0, createdAt: ts, updatedAt: ts,
    } });
    bankId = added._id;
  } else {
    const current = await db.collection(COLL_BANK).doc(bankId).get();
    progress = Number(current.data && current.data.builtinProgress) || 0;
  }

  // 逐卷导入并限制本次调用的耗时；没导完就带上进度返回，客户端继续调用即可续传。
  // 注意：必须先检查耗时再导入下一个分卷，保证每次调用至少导一卷、但绝不超时
  const startedAt = Date.now();
  const TIME_BUDGET = 1200;
  let advanced = 0;
  while (progress < sources.length) {
    if (advanced > 0 && Date.now() - startedAt > TIME_BUDGET) break;
    const source = sources[progress];
    const order = sources.slice(0, progress).reduce(function (sum, item) { return sum + (item.questionCount || 0); }, 0);
    const questions = readSourceQuestions(source);
    if (questions.length !== (source.questionCount || 0)) throw bizError("题库导入题量校验失败");
    await insertQuestions(bankId, questions, order);
    progress += 1;
    advanced += 1;
    await db.collection(COLL_BANK).doc(bankId).update({ data: { builtinProgress: progress, updatedAt: now() } });
  }

  const done = progress >= sources.length;
  return { id: bankId, done: done, progress: progress, total: sources.length };
}

function readSourceQuestions(source) {
  const filePath = path.join(__dirname, "builtin-data", source.file);
  const fd = fs.openSync(filePath, "r");
  const compressed = Buffer.allocUnsafe(source.compressedSize);
  fs.readSync(fd, compressed, 0, source.compressedSize, source.offset);
  fs.closeSync(fd);
  const parsed = JSON.parse(zlib.gunzipSync(compressed).toString("utf8"));
  return (parsed.questions || []).map(function (q) {
    return normalizeQuestion(Object.assign({}, q, { region: q.region || source.region }));
  }).filter(Boolean);
}

async function removeBank(id, openid) {
  const bank = await loadOwnBank(id, openid);
  await db.collection(COLL_BANK).doc(bank._id).remove();
  await Promise.all([
    db.collection(COLL_QUESTION).where({ bankId: bank._id }).remove(),
    db.collection(COLL_RECORD).where({ bankId: bank._id }).remove(),
  ]);
  return { id: bank._id };
}

async function loadOwnBank(id, openid) {
  if (!id) throw bizError("缺少题库 ID");
  let bank = null;
  try {
    const res = await db.collection(COLL_BANK).doc(id).get();
    bank = res && res.data ? res.data : null;
  } catch (err) {
    bank = null;
  }
  if (!bank) throw bizError("题库不存在");
  if (bank._openid !== openid) throw bizError("只有创建者可以修改题库");
  return bank;
}

/* ---------------- 练习记录 ---------------- */

async function fetchRecord(bankId, openid) {
  const res = await db
    .collection(COLL_RECORD)
    .where({ bankId: bankId, _openid: openid })
    .limit(1)
    .get();
  return res.data && res.data[0] ? res.data[0] : null;
}

async function ensureRecord(bankId, openid) {
  let record = await fetchRecord(bankId, openid);
  if (!record) {
    const addRes = await db.collection(COLL_RECORD).add({
      data: {
        _openid: openid,
        bankId: bankId,
        answers: {},
        wrongIds: [],
        starIds: [],
        lastIndex: 0,
        updatedAt: now(),
      },
    });
    record = {
      _id: addRes._id,
      bankId: bankId,
      answers: {},
      wrongIds: [],
      starIds: [],
      lastIndex: 0,
    };
  }
  return record;
}

async function saveAnswer(bankId, qid, selected, correct, openid) {
  const record = await ensureRecord(bankId, openid);
  const answers = record.answers || {};
  answers[qid] = {
    selected: Array.isArray(selected) ? selected : [],
    correct: correct === true,
  };

  const wrongIds = Object.keys(answers).filter(function (k) {
    return !answers[k].correct;
  });

  await db.collection(COLL_RECORD).doc(record._id).update({
    data: { answers, wrongIds, updatedAt: now() },
  });
  return { wrongIds };
}

/**
 * 批量提交作答（考试模式交卷用）
 * @param {Object} answers { qid: { selected: [], correct: Boolean } }
 */
async function saveAnswers(bankId, answers, openid) {
  const record = await ensureRecord(bankId, openid);
  const stored = record.answers || {};

  Object.keys(answers || {}).forEach(function (qid) {
    const item = answers[qid] || {};
    stored[qid] = {
      selected: Array.isArray(item.selected) ? item.selected.slice(0, 10) : [],
      correct: item.correct === true,
    };
  });

  const wrongIds = Object.keys(stored).filter(function (k) {
    return !stored[k].correct;
  });

  await db.collection(COLL_RECORD).doc(record._id).update({
    data: { answers: stored, wrongIds: wrongIds, updatedAt: now() },
  });

  return { wrongIds };
}

async function toggleStar(bankId, qid, openid) {
  const record = await ensureRecord(bankId, openid);
  const starIds = (record.starIds || []).slice();
  const i = starIds.indexOf(qid);
  if (i > -1) starIds.splice(i, 1);
  else starIds.push(qid);

  await db.collection(COLL_RECORD).doc(record._id).update({
    data: { starIds, updatedAt: now() },
  });
  return { starIds };
}

async function setLastIndex(bankId, index, openid) {
  const record = await ensureRecord(bankId, openid);
  await db.collection(COLL_RECORD).doc(record._id).update({
    data: { lastIndex: index, updatedAt: now() },
  });
  return { lastIndex: index };
}

async function resetRecord(bankId, openid) {
  const record = await ensureRecord(bankId, openid);
  await db.collection(COLL_RECORD).doc(record._id).update({
    data: {
      answers: {},
      wrongIds: [],
      lastIndex: 0,
      updatedAt: now(),
    },
  });
  return { ok: true };
}

/* ---------------- 入口 ---------------- */

// 集合初始化：首次调用时自动创建，避免忘记建集合导致调用失败
let collectionsReady = false;

async function ensureCollections() {
  if (collectionsReady) return;

  const names = [COLL_BANK, COLL_QUESTION, COLL_RECORD];
  for (let i = 0; i < names.length; i++) {
    try {
      await db.createCollection(names[i]);
      console.log("[集合] 创建成功", names[i]);
    } catch (err) {
      // 集合已存在时会报错，打印出来便于在云日志里确认
      console.log("[集合] 已存在或创建失败", names[i], err && err.message);
    }
  }
  collectionsReady = true;
}

async function dispatch(action, event, openid) {
  await ensureCollections();

  switch (action) {
    case "list":
      return { ok: true, data: await listBanks(openid) };
    case "get":
      return { ok: true, data: await getBank(event.id, openid, event.offset, event.limit) };
    case "builtins":
      return { ok: true, data: await getBuiltins() };
    case "addBuiltin":
      return { ok: true, data: await addBuiltin(event.id, openid) };
    case "updateQuestion":
      return { ok: true, data: await updateQuestion(event.bankId, event.qid, event.patch, openid) };
    case "create":
      return { ok: true, data: await createBank(event, openid) };
    case "update":
      return { ok: true, data: await updateBank(event.id, event, openid) };
    case "remove":
      return { ok: true, data: await removeBank(event.id, openid) };
    case "saveAnswer":
      return {
        ok: true,
        data: await saveAnswer(event.bankId, event.qid, event.selected, event.correct, openid),
      };
    case "saveAnswers":
      return {
        ok: true,
        data: await saveAnswers(event.bankId, event.answers, openid),
      };
    case "toggleStar":
      return { ok: true, data: await toggleStar(event.bankId, event.qid, openid) };
    case "setLastIndex":
      return { ok: true, data: await setLastIndex(event.bankId, event.index, openid) };
    case "resetRecord":
      return { ok: true, data: await resetRecord(event.bankId, openid) };
    default:
      return { ok: false, message: "未知操作：" + action };
  }
}

exports.main = async (event = {}) => {
  const openid = (cloud.getWXContext() || {}).OPENID || "";
  if (!openid) {
    return { ok: false, message: "无法获取用户身份，请重新进入", tag: DEPLOY_TAG };
  }

  let result;
  try {
    result = await dispatch(event.action, event, openid);
  } catch (err) {
    // 业务异常直接提示，其它异常不暴露内部信息
    result = {
      ok: false,
      message: err && err.isBizError ? err.message : "云服务异常，请稍后重试",
    };
  }

  // 客户端会打印这个标记，用来确认云端跑的是不是最新代码
  result.tag = DEPLOY_TAG;
  return result;
};
