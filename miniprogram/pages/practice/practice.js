var store = require("../../utils/store");
var parser = require("../../utils/parser");
var shareUtil = require("../../utils/share");

var TYPE_TEXT = { single: "单选", multiple: "多选", judge: "判断" };
var MODE_TEXT = {
  sequence: "顺序练习",
  random: "随机练习",
  exam: "考试模式",
  wrong: "错题重练",
  star: "收藏练习",
};

function pad(n) {
  return n < 10 ? "0" + n : "" + n;
}

function fmtTime(sec) {
  return pad(Math.floor(sec / 60)) + ":" + pad(sec % 60);
}

function shuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

Page(shareUtil.withShare({
  data: {
    bankId: "",
    mode: "sequence",
    modeText: "",
    bankName: "",
    index: 0,
    total: 0,
    percent: 0,
    question: {},
    options: [],
    selected: [],
    answered: false,
    correct: false,
    showResult: false,
    answerText: "",
    selectedText: "",
    typeText: "",
    starred: false,
    sheetVisible: false,
    statuses: [],
    currentIndex: 0,
    stats: { answered: 0, right: 0, wrong: 0 },
    timeText: "00:00",
    scrollTop: 0,
    finishText: "查看结果",
  },

  session: {},
  bank: null,
  list: [],
  timer: null,
  startAt: 0,

  onLoad: function (options) {
    var self = this;
    var id = options.id;
    var mode = options.mode || "sequence";

    if (!id) {
      wx.showToast({ title: "缺少题库 ID", icon: "none" });
      setTimeout(function () {
        wx.navigateBack();
      }, 800);
      return;
    }

    wx.showLoading({ title: "加载中" });

    store
      .getBank(id)
      .then(function (bank) {
        wx.hideLoading();

        if (!bank || !bank.questions || !bank.questions.length) {
          wx.showToast({ title: "题库为空或不存在", icon: "none" });
          setTimeout(function () {
            wx.navigateBack();
          }, 800);
          return;
        }

        self.initPractice(bank, mode);
      })
      .catch(function (err) {
        wx.hideLoading();
        wx.showToast({
          title: (err && err.message) || "加载题库失败",
          icon: "none",
        });
        setTimeout(function () {
          wx.navigateBack();
        }, 800);
      });
  },

  initPractice: function (bank, mode) {
    var list;
    if (mode === "random") list = shuffle(bank.questions);
    else if (mode === "wrong")
      list = bank.questions.filter(function (q) {
        return bank.record.wrongIds.indexOf(q.id) > -1;
      });
    else if (mode === "star")
      list = bank.questions.filter(function (q) {
        return bank.record.starIds.indexOf(q.id) > -1;
      });
    else list = bank.questions.slice();

    if (!list.length) {
      wx.showToast({ title: "暂无可练习的题目", icon: "none" });
      setTimeout(function () {
        wx.navigateBack();
      }, 800);
      return;
    }

    var restore = mode === "sequence";
    var session = {};
    list.forEach(function (q) {
      var rec = restore ? bank.record.answers[q.id] : null;
      session[q.id] = rec
        ? { selected: (rec.selected || []).slice(), answered: true, correct: !!rec.correct }
        : { selected: [], answered: false, correct: false };
    });

    var index = restore && bank.record.lastIndex < list.length ? bank.record.lastIndex : 0;

    this.bank = bank;
    this.list = list;
    this.session = session;

    this.setData({
      bankId: bank.id,
      mode: mode,
      modeText: MODE_TEXT[mode] || "练习",
      bankName: bank.name,
      total: list.length,
      index: index,
      finishText: mode === "exam" ? "交卷" : "查看结果",
    });

    wx.setNavigationBarTitle({
      title: bank.name + " · " + (MODE_TEXT[mode] || "练习"),
    });

    this.render();
    this.startTimer();
  },

  onUnload: function () {
    this.stopTimer();
    if (this.data.mode === "sequence" && this.data.bankId) {
      store
        .setLastIndex(this.data.bankId, this.data.index)
        .catch(function (err) {
          console.error("保存进度失败", err);
        });
    }
  },

  /* ---------------- 渲染 ---------------- */

  render: function () {
    var idx = this.data.index;
    var q = this.list[idx];
    if (!q) return;

    var s = this.session[q.id];
    var isExam = this.data.mode === "exam";
    var answered = !!s.answered;
    var correct = !!s.correct;
    var selected = s.selected.slice();

    var options = q.options.map(function (o) {
      var state = "";
      if (answered && !isExam) {
        if (q.answer.indexOf(o.key) > -1) state = "right";
        else if (selected.indexOf(o.key) > -1) state = "wrong";
      } else if (selected.indexOf(o.key) > -1) {
        state = "checked";
      }
      return { key: o.key, content: o.content, state: state };
    });

    var statuses = this.list.map(function (item) {
      var st = this.session[item.id];
      if (!st.answered) return "todo";
      if (isExam) return "done";
      return st.correct ? "right" : "wrong";
    }, this);

    var stats = { answered: 0, right: 0, wrong: 0 };
    statuses.forEach(function (st) {
      if (st === "todo") return;
      stats.answered += 1;
      if (st === "right") stats.right += 1;
      if (st === "wrong") stats.wrong += 1;
    });

    this.setData({
      question: q,
      options: options,
      selected: selected,
      answered: answered,
      correct: correct,
      showResult: answered && !isExam,
      answerText: q.answer.join(" "),
      selectedText: selected.length ? selected.join(" ") : "未作答",
      typeText: TYPE_TEXT[q.type] || "题目",
      starred: this.bank.record.starIds.indexOf(q.id) > -1,
      statuses: statuses,
      currentIndex: idx,
      stats: stats,
      percent: Math.round(((idx + 1) / this.list.length) * 100),
      // 0/1 交替，保证每次切题都会触发滚动到顶部
      scrollTop: this.data.scrollTop === 0 ? 1 : 0,
    });
  },

  /* ---------------- 选项判断 ---------------- */

  onSelectOption: function (e) {
    var key = e.currentTarget.dataset.key;
    var q = this.list[this.data.index];
    if (!q) return;
    var s = this.session[q.id];
    var isExam = this.data.mode === "exam";

    // 练习模式判题后不可修改
    if (s.answered && !isExam) return;

    if (q.type === "multiple") {
      var i = s.selected.indexOf(key);
      if (i > -1) s.selected.splice(i, 1);
      else s.selected.push(key);
      if (isExam) s.answered = s.selected.length > 0;
      this.render();
      return;
    }

    // 单选 / 判断：点击即判断
    s.selected = [key];
    s.answered = true;
    s.correct = parser.arrEqual(s.selected, q.answer);

    if (!isExam) this.persist(q);
    this.render();
  },

  onConfirmMultiple: function () {
    var q = this.list[this.data.index];
    if (!q) return;
    var s = this.session[q.id];

    if (!s.selected.length) {
      wx.showToast({ title: "请至少选择一项", icon: "none" });
      return;
    }

    s.answered = true;
    s.correct = parser.arrEqual(s.selected, q.answer);
    this.persist(q);
    this.render();
  },

  persist: function (q) {
    var s = this.session[q.id];

    // 写云端，失败不阻塞刷题，仅记录日志
    store
      .saveAnswer(this.data.bankId, q.id, s.selected, s.correct)
      .catch(function (err) {
        console.error("保存作答失败", err);
      });

    if (this.data.mode === "sequence") {
      store
        .setLastIndex(this.data.bankId, this.data.index)
        .catch(function (err) {
          console.error("保存进度失败", err);
        });
    }
  },

  /* ---------------- 交互 ---------------- */

  goTo: function (i) {
    if (i < 0 || i >= this.list.length) return;
    this.setData({ index: i });
    if (this.data.mode === "sequence") {
      store
        .setLastIndex(this.data.bankId, i)
        .catch(function (err) {
          console.error("保存进度失败", err);
        });
    }
    this.render();
  },

  onPrev: function () {
    this.goTo(this.data.index - 1);
  },

  onNext: function () {
    this.goTo(this.data.index + 1);
  },

  onJump: function (e) {
    var i = parseInt(e.currentTarget.dataset.index, 10);
    this.setData({ sheetVisible: false });
    this.goTo(i);
  },

  toggleSheet: function () {
    this.setData({ sheetVisible: !this.data.sheetVisible });
  },

  onSheetTap: function () {},

  onToggleStar: function () {
    var self = this;
    var q = this.list[this.data.index];
    if (!q) return;

    store
      .toggleStar(this.data.bankId, q.id)
      .then(function (res) {
        var starIds = (res && res.starIds) || [];
        self.bank.record.starIds = starIds;
        self.setData({ starred: starIds.indexOf(q.id) > -1 });
        wx.showToast({
          title: self.data.starred ? "已收藏" : "已取消收藏",
          icon: "none",
        });
      })
      .catch(function (err) {
        wx.showToast({
          title: (err && err.message) || "操作失败",
          icon: "none",
        });
      });
  },

  onQuit: function () {
    var self = this;
    if (this.data.mode === "exam") {
      wx.showModal({
        title: "退出考试",
        content: "当前为考试模式，退出后本次作答将不记录，确定退出？",
        success: function (res) {
          if (res.confirm) wx.navigateBack();
        },
      });
      return;
    }
    wx.navigateBack();
  },

  /* ---------------- 交卷 / 结果 ---------------- */

  onFinish: function () {
    var isExam = this.data.mode === "exam";
    var self = this;
    var items = [];
    var payload = {};
    var right = 0;
    var wrong = 0;
    var unanswered = 0;

    this.list.forEach(function (q, i) {
      var s = self.session[q.id];
      var correct = false;

      if (isExam) {
        correct = s.selected.length ? parser.arrEqual(s.selected, q.answer) : false;
        s.correct = correct;
        s.answered = s.selected.length > 0;
        payload[q.id] = { selected: s.selected, correct: correct };
      } else {
        correct = !!s.correct;
      }

      if (!s.answered) unanswered += 1;
      else if (correct) right += 1;
      else wrong += 1;

      items.push({
        qid: q.id,
        no: i + 1,
        type: q.type,
        typeText: TYPE_TEXT[q.type] || "题目",
        title: q.title,
        options: q.options,
        selected: s.selected,
        answer: q.answer,
        selectedText: s.selected.length ? s.selected.join(" ") : "未作答",
        answerText: q.answer.join(" "),
        correct: correct,
        answered: !!s.answered,
        explanation: q.explanation || "",
      });
    });

    var goResult = function () {
      var seconds = Math.floor((Date.now() - self.startAt) / 1000);
      store.saveResult({
        bankId: self.data.bankId,
        bankName: self.data.bankName,
        mode: self.data.mode,
        modeText: self.data.modeText,
        total: self.list.length,
        right: right,
        wrong: wrong,
        unanswered: unanswered,
        accuracy: self.list.length ? Math.round((right / self.list.length) * 100) : 0,
        usedTime: seconds,
        timeText: fmtTime(seconds),
        items: items,
        createdAt: Date.now(),
      });
      wx.redirectTo({ url: "/pages/result/result" });
    };

    var submit = function () {
      // 练习模式的作答已在答题时逐题写入云端，直接出结果
      if (!isExam) {
        goResult();
        return;
      }

      wx.showLoading({ title: "交卷中" });
      store
        .saveAnswers(self.data.bankId, payload)
        .then(function () {
          wx.hideLoading();
          goResult();
        })
        .catch(function (err) {
          wx.hideLoading();
          wx.showToast({
            title: (err && err.message) || "交卷失败",
            icon: "none",
          });
        });
    };

    if (isExam && unanswered > 0) {
      wx.showModal({
        title: "还有题目未作答",
        content: "有 " + unanswered + " 道题尚未作答，确定交卷吗？",
        success: function (res) {
          if (res.confirm) submit();
        },
      });
      return;
    }

    submit();
  },

  /* ---------------- 计时 ---------------- */

  startTimer: function () {
    this.startAt = Date.now();
    var self = this;
    this.stopTimer();
    this.timer = setInterval(function () {
      var s = Math.floor((Date.now() - self.startAt) / 1000);
      self.setData({ timeText: fmtTime(s) });
    }, 1000);
  },

  stopTimer: function () {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  },
}, function () {
  // 转发时题库在对方手机本地并不存在，因此统一回落到首页并带上来访来源
  return {
    title: "我在刷「" + this.data.bankName + "」，一起来挑战吧",
    path: "/pages/index/index?from=result",
  };
}));
