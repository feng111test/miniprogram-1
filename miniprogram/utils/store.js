/**
 * 题库云后台存储
 *
 * 数据全部存放在云开发数据库：
 *   banks     题库元信息
 *   questions 题目（按 bankId 拆分为多条文档）
 *   records   每个用户 × 每个题库 一条练习记录
 *
 * 说明：
 * - 所有接口均为异步，返回 Promise
 * - 题库列表有本地兜底缓存，云请求失败时可离线查看列表
 * - 最近一次成绩属于临时数据，仍保存在本地
 */

var FUNCTION_NAME = "bankFunctions";
var INDEX_CACHE_KEY = "quiz_bank_index_cache";
var RESULT_KEY = "quiz_last_result";

function isCloudAvailable() {
  return typeof wx !== "undefined" && !!wx.cloud && typeof wx.cloud.callFunction === "function";
}

// 把云开发的底层错误码翻译成可操作的提示
var ERR_HINTS = {
  "-501000": "云开发环境不可用，请检查是否已开通云开发并部署 bankFunctions",
  "-404011": "云函数执行出错，请重新上传部署 bankFunctions",
  "-404001": "云函数 bankFunctions 不存在，请先上传部署",
};

function toMessage(err) {
  var raw = err ? err.errMsg || err.message || "" : "";
  raw = String(raw);

  // 注意顺序：函数未部署与环境不可用都会返回 -501000，
  // 必须先按具体的 errMsg 细分，否则会给出误导性的提示
  if (/FunctionName parameter could not be found|FUNCTION_NOT_FOUND/i.test(raw)) {
    return ERR_HINTS["-404001"];
  }
  if (/Cloud API isn't enabled|未开通云开发/i.test(raw)) {
    return "该小程序尚未开通云开发";
  }

  var matched = raw.match(/errCode:\s*(-?\d+)/);
  if (matched && ERR_HINTS[matched[1]]) return ERR_HINTS[matched[1]];

  return raw || "网络异常，请稍后重试";
}

/**
 * 调用云函数
 * @param {String} action
 * @param {Object} payload
 * @return {Promise}
 */
function call(action, payload) {
  if (!isCloudAvailable()) {
    return Promise.reject(new Error("当前环境不支持云开发"));
  }

  var data = Object.assign({ action: action }, payload || {});

  return wx.cloud
    .callFunction({ name: FUNCTION_NAME, data: data })
    .then(function (res) {
      var result = res && res.result ? res.result : null;
      if (!result) throw new Error("云服务返回异常");
      console.log("[云调用]", action, "云端部署标记 =", result.tag || "(无，说明跑的是旧代码)");
      if (result.ok === false) throw new Error(result.message || "操作失败");
      return result.data;
    })
    .catch(function (err) {
      throw new Error(toMessage(err));
    });
}

/* ---------------- 题库 ---------------- */

function getBanks() {
  return call("list", {})
    .then(function (list) {
      var banks = Array.isArray(list) ? list : [];
      try {
        wx.setStorageSync(INDEX_CACHE_KEY, banks);
      } catch (e) {}
      return banks;
    })
    .catch(function (err) {
      // 云请求失败时回退到本地缓存，保证列表可读
      var cache = [];
      try {
        cache = wx.getStorageSync(INDEX_CACHE_KEY) || [];
      } catch (e) {}
      if (cache.length) return cache;
      throw err;
    });
}

function getBank(id) {
  if (!id) return Promise.resolve(null);
  var questions = [];
  var first = null;
  function load(offset) {
    return call("get", { id: id, offset: offset, limit: 32 }).then(function (page) {
      if (!first) first = page;
      questions = questions.concat(page.questions || []);
      if (page.hasMore && page.nextOffset > offset) return load(page.nextOffset);
      first.questions = questions;
      return first;
    });
  }
  return load(0);
}

function getBuiltInBanks() { return call("builtins", {}); }

// 首次进入时自动准备的内置题库：用户无需手动添加
var DEFAULT_BUILTIN_ID = "2026-chemistry-mixed";

var importTasks = {};
var importListeners = {};

/**
 * 添加内置题库。题库较大时云端会分次导入，这里自动续传到 done。
 * @param {String} id
 * @param {Function} [onProgress] 每轮回调，收到 { progress, total, done }
 */
function addBuiltInBank(id, onProgress) {
  if (typeof onProgress === "function") {
    importListeners[id] = (importListeners[id] || []).concat(onProgress);
  }
  // 同一题库只在云上跑一条导入链路，多个页面监听同一份进度
  if (importTasks[id]) return importTasks[id];

  function emit(res) {
    (importListeners[id] || []).forEach(function (fn) {
      try {
        fn(res);
      } catch (e) {
        console.error("[题库导入] 进度回调异常", e);
      }
    });
  }

  function loop(rounds) {
    return call("addBuiltin", { id: id }).then(function (res) {
      emit(res);
      if (res && res.done === false && rounds + 1 < 60) return loop(rounds + 1);
      return res;
    });
  }

  var task = loop(0);
  importTasks[id] = task.then(function (res) {
    delete importTasks[id];
    delete importListeners[id];
    return res;
  }).catch(function (err) {
    delete importTasks[id];
    delete importListeners[id];
    throw err;
  });
  return importTasks[id];
}
function updateQuestion(bankId, qid, patch) { return call("updateQuestion", { bankId: bankId, qid: qid, patch: patch }); }

function createBank(data) {
  return call("create", {
    name: data.name,
    desc: data.desc,
    questions: data.questions,
    public: data.public === true,
  });
}

function updateBank(id, patch) {
  return call("update", { id: id, name: patch.name, desc: patch.desc, public: patch.public });
}

// 题库题目多时云端分片删除，这里续删直到 done
function deleteBank(id) {
  function loop(rounds) {
    return call("remove", { id: id }).then(function (res) {
      if (res && res.done === false && rounds + 1 < 60) return loop(rounds + 1);
      return res;
    });
  }
  return loop(0);
}

/* ---------------- 练习记录 ---------------- */

/**
 * @param {String} bankId
 * @param {String} qid
 * @param {Array} selected
 * @param {Boolean|null} correct 传 null 表示只记录不判分
 */
function saveAnswer(bankId, qid, selected, correct) {
  return call("saveAnswer", {
    bankId: bankId,
    qid: qid,
    selected: selected || [],
    correct: correct,
  });
}

/**
 * 批量保存作答（考试模式交卷）
 * @param {Object} answers { qid: { selected: [], correct: Boolean } }
 */
function saveAnswers(bankId, answers) {
  return call("saveAnswers", { bankId: bankId, answers: answers || {} });
}

function toggleStar(bankId, qid) {
  return call("toggleStar", { bankId: bankId, qid: qid });
}

function setLastIndex(bankId, index) {
  return call("setLastIndex", { bankId: bankId, index: index });
}

function resetRecord(bankId) {
  return call("resetRecord", { bankId: bankId });
}

/* ---------------- 统计 ---------------- */

function getSummary(banks) {
  var list = banks || getIndexCache();
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

function getIndexCache() {
  try {
    var cache = wx.getStorageSync(INDEX_CACHE_KEY);
    return Array.isArray(cache) ? cache : [];
  } catch (e) {
    return [];
  }
}

function clearIndexCache() {
  try {
    wx.removeStorageSync(INDEX_CACHE_KEY);
  } catch (e) {}
}

/* ---------------- 最近一次成绩（本地临时数据） ---------------- */

function saveResult(result) {
  try {
    wx.setStorageSync(RESULT_KEY, result);
  } catch (e) {}
}

function getResult() {
  try {
    return wx.getStorageSync(RESULT_KEY) || null;
  } catch (e) {
    return null;
  }
}

module.exports = {
  DEFAULT_BUILTIN_ID: DEFAULT_BUILTIN_ID,
  getBanks: getBanks,
  getBank: getBank,
  getBuiltInBanks: getBuiltInBanks,
  addBuiltInBank: addBuiltInBank,
  updateQuestion: updateQuestion,
  createBank: createBank,
  updateBank: updateBank,
  deleteBank: deleteBank,
  saveAnswer: saveAnswer,
  saveAnswers: saveAnswers,
  toggleStar: toggleStar,
  setLastIndex: setLastIndex,
  resetRecord: resetRecord,
  getSummary: getSummary,
  getIndexCache: getIndexCache,
  clearIndexCache: clearIndexCache,
  saveResult: saveResult,
  getResult: getResult,
};
