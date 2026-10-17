const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

/* 集合名 */
const COLL_BANK = "banks"; // 题库元信息
const COLL_QUESTION = "questions"; // 题目（按 bankId 拆分成多条，避免单文档过大）
const COLL_RECORD = "records"; // 每个用户 × 每个题库 一条练习记录

/* 限制 */
const MAX_QUESTIONS = 500; // 单个题库题目上限
const MAX_BANKS = 100; // 单个用户题库上限

function now() {
  return Date.now();
}

function str(value, maxLen) {
  return String(value == null ? "" : value).trim().slice(0, maxLen || 200);
}

function bizError(message) {
  const err = new Error(message);
  err.isBizError = true;
  return err;
}

/* ---------------- 题目清洗 ---------------- */

function normalizeQuestion(raw) {
  if (!raw || typeof raw !== "object") return null;

  const title = str(raw.title, 1000);
  if (!title) return null;

  let type = str(raw.type, 20) || "single";
  if (type !== "single" && type !== "multiple" && type !== "judge") type = "single";

  const options = Array.isArray(raw.options)
    ? raw.options
        .map(function (o) {
          return {
            key: str(o && o.key, 10),
            content: str(o && o.content, 500),
          };
        })
        .filter(function (o) {
          return !!o.content;
        })
    : [];

  let answer = Array.isArray(raw.answer) ? raw.answer : [raw.answer];
  answer = answer
    .map(function (a) {
      return str(a, 10);
    })
    .filter(Boolean);

  if (type === "judge") {
    options.length = 0;
    options.push({ key: "正确", content: "正确" }, { key: "错误", content: "错误" });
  }

  if (!answer.length) return null;
  if (type !== "judge" && !options.length) return null;

  return {
    type: type,
    title: title,
    options: options,
    answer: answer,
    explanation: str(raw.explanation, 2000),
  };
}

function countTypes(questions) {
  const stat = { single: 0, multiple: 0, judge: 0 };
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
    typeStat: bank.typeStat || { single: 0, multiple: 0, judge: 0 },
    public: bank.public === true,
    mine: bank._openid === openid,
    answered: ids.length,
    correct: correct,
    accuracy: ids.length ? Math.round((correct / ids.length) * 100) : 0,
    wrong: (record && record.wrongIds ? record.wrongIds : []).length,
    star: (record && record.starIds ? record.starIds : []).length,
    updatedAt: bank.updatedAt || bank.createdAt || 0,
  };
}

async function getBank(id, openid) {
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

  const [questions, record] = await Promise.all([
    fetchQuestions(id),
    fetchRecord(id, openid),
  ]);

  return {
    id: bank._id,
    name: bank.name || "未命名题库",
    desc: bank.desc || "",
    public: bank.public === true,
    questions: questions,
    record: record || { answers: {}, wrongIds: [], starIds: [], lastIndex: 0 },
  };
}

async function fetchQuestions(bankId) {
  // 单次取回后按 order 排序（题库上限 MAX_QUESTIONS 条，一次查询即可覆盖）
  const res = await db.collection(COLL_QUESTION).where({ bankId }).limit(1000).get();

  return (res.data || [])
    .sort(function (a, b) {
      return (a.order || 0) - (b.order || 0);
    })
    .map(function (q) {
      return {
        id: q.qid || q._id,
        type: q.type,
        title: q.title,
        options: q.options || [],
        answer: q.answer || [],
        explanation: q.explanation || "",
      };
    });
}

async function createBank(data, openid) {
  const rawList = Array.isArray(data.questions) ? data.questions : [];
  const questions = rawList.map(normalizeQuestion).filter(Boolean).slice(0, MAX_QUESTIONS);

  if (!questions.length) throw bizError("没有解析到有效题目");

  const countRes = await db.collection(COLL_BANK).where({ _openid: openid }).count();
  if ((countRes.total || 0) >= MAX_BANKS) throw bizError("题库数量已达上限");

  const ts = now();
  const addRes = await db.collection(COLL_BANK).add({
    data: {
      name: str(data.name, 30) || "未命名题库",
      desc: str(data.desc, 100),
      count: questions.length,
      typeStat: countTypes(questions),
      public: data.public === true,
      createdAt: ts,
      updatedAt: ts,
    },
  });

  await insertQuestions(addRes._id, questions);
  return { id: addRes._id };
}

async function insertQuestions(bankId, questions) {
  // 分批写入，避免单次请求过大
  const SIZE = 20;
  for (let i = 0; i < questions.length; i += SIZE) {
    const chunk = questions.slice(i, i + SIZE);
    await Promise.all(
      chunk.map(function (q, j) {
        return db.collection(COLL_QUESTION).add({
          data: {
            bankId: bankId,
            order: i + j,
            qid: q.id || q._id || "",
            type: q.type,
            title: q.title,
            options: q.options,
            answer: q.answer,
            explanation: q.explanation,
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
    } catch (err) {
      // 集合已存在时会报错，忽略即可
    }
  }
  collectionsReady = true;
}

exports.main = async (event = {}) => {
  const openid = (cloud.getWXContext() || {}).OPENID || "";
  if (!openid) {
    return { ok: false, message: "无法获取用户身份，请重新进入" };
  }

  const { action } = event;

  try {
    await ensureCollections();

    switch (action) {
      case "list":
        return { ok: true, data: await listBanks(openid) };
      case "get":
        return { ok: true, data: await getBank(event.id, openid) };
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
  } catch (err) {
    // 业务异常直接提示，其它异常不暴露内部信息
    return {
      ok: false,
      message: err && err.isBizError ? err.message : "云服务异常，请稍后重试",
    };
  }
};
