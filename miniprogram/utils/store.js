/**
 * 题库本地存储
 *
 * 索引：quiz_bank_index -> [meta]
 * 题库：quiz_bank_<id>  -> bank
 * 最近一次成绩：quiz_last_result
 */

var INDEX_KEY = "quiz_bank_index";
var BANK_PREFIX = "quiz_bank_";
var RESULT_KEY = "quiz_last_result";

function genId(prefix) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function getIndex() {
  var list = wx.getStorageSync(INDEX_KEY);
  return Array.isArray(list) ? list : [];
}

function setIndex(list) {
  wx.setStorageSync(INDEX_KEY, list);
}

function buildMeta(bank) {
  var typeStat = { single: 0, multiple: 0, judge: 0 };
  (bank.questions || []).forEach(function (q) {
    if (typeStat[q.type] !== undefined) typeStat[q.type] += 1;
  });

  var answers = (bank.record && bank.record.answers) || {};
  var ids = Object.keys(answers);
  var correct = 0;
  ids.forEach(function (k) {
    if (answers[k] && answers[k].correct) correct += 1;
  });

  return {
    id: bank.id,
    name: bank.name,
    desc: bank.desc || "",
    count: (bank.questions || []).length,
    typeStat: typeStat,
    answered: ids.length,
    correct: correct,
    accuracy: ids.length ? Math.round((correct / ids.length) * 100) : 0,
    wrong: ((bank.record && bank.record.wrongIds) || []).length,
    star: ((bank.record && bank.record.starIds) || []).length,
    updatedAt: bank.updatedAt || bank.createdAt,
  };
}

function getBanks() {
  return getIndex();
}

function getBank(id) {
  if (!id) return null;
  var bank = wx.getStorageSync(BANK_PREFIX + id);
  return bank && bank.id ? bank : null;
}

function saveBank(bank) {
  bank.updatedAt = Date.now();
  wx.setStorageSync(BANK_PREFIX + bank.id, bank);

  var list = getIndex();
  var meta = buildMeta(bank);
  var found = false;
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === bank.id) {
      list[i] = meta;
      found = true;
      break;
    }
  }
  if (!found) list.unshift(meta);
  setIndex(list);
  return bank;
}

function createBank(data) {
  var now = Date.now();
  var bank = {
    id: genId("b"),
    name: data.name || "未命名题库",
    desc: data.desc || "",
    questions: data.questions || [],
    createdAt: now,
    updatedAt: now,
    record: {
      answers: {}, // { qid: { selected: [], correct: Boolean } }
      wrongIds: [],
      starIds: [],
      lastIndex: 0,
    },
  };
  return saveBank(bank);
}

function updateBank(id, updater) {
  var bank = getBank(id);
  if (!bank) return null;
  if (typeof updater === "function") updater(bank);
  return saveBank(bank);
}

function deleteBank(id) {
  var list = getIndex();
  var next = [];
  list.forEach(function (b) {
    if (b.id !== id) next.push(b);
  });
  setIndex(next);
  wx.removeStorageSync(BANK_PREFIX + id);
}

/**
 * 记录一道题的作答结果
 * @param {String} bankId
 * @param {String} qid
 * @param {Array} selected 用户选中的选项
 * @param {Boolean|null} correct 是否答对（考试模式交卷前传 null）
 */
function saveAnswer(bankId, qid, selected, correct) {
  return updateBank(bankId, function (bank) {
    var record = bank.record;
    record.answers[qid] = { selected: selected || [], correct: correct === true };

    var inWrong = record.wrongIds.indexOf(qid) > -1;
    if (correct === true && inWrong) {
      record.wrongIds = record.wrongIds.filter(function (id) {
        return id !== qid;
      });
    } else if (correct === false && !inWrong) {
      record.wrongIds.push(qid);
    }
  });
}

function toggleStar(bankId, qid) {
  return updateBank(bankId, function (bank) {
    var ids = bank.record.starIds;
    var i = ids.indexOf(qid);
    if (i > -1) ids.splice(i, 1);
    else ids.push(qid);
  });
}

function setLastIndex(bankId, index) {
  return updateBank(bankId, function (bank) {
    bank.record.lastIndex = index;
  });
}

function resetRecord(bankId) {
  return updateBank(bankId, function (bank) {
    bank.record = { answers: {}, wrongIds: [], starIds: [], lastIndex: 0 };
  });
}

function clearAll() {
  getIndex().forEach(function (b) {
    wx.removeStorageSync(BANK_PREFIX + b.id);
  });
  setIndex([]);
  wx.removeStorageSync(RESULT_KEY);
}

function getSummary() {
  var list = getIndex();
  var total = 0;
  var answered = 0;
  var correct = 0;
  list.forEach(function (b) {
    total += b.count || 0;
    answered += b.answered || 0;
    correct += b.correct || 0;
  });
  return {
    banks: list.length,
    total: total,
    answered: answered,
    accuracy: answered ? Math.round((correct / answered) * 100) : 0,
  };
}

function saveResult(result) {
  wx.setStorageSync(RESULT_KEY, result);
}

function getResult() {
  return wx.getStorageSync(RESULT_KEY) || null;
}

module.exports = {
  createBank: createBank,
  getBanks: getBanks,
  getBank: getBank,
  saveBank: saveBank,
  updateBank: updateBank,
  deleteBank: deleteBank,
  saveAnswer: saveAnswer,
  toggleStar: toggleStar,
  setLastIndex: setLastIndex,
  resetRecord: resetRecord,
  clearAll: clearAll,
  getSummary: getSummary,
  saveResult: saveResult,
  getResult: getResult,
};
