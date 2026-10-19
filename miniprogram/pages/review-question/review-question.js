var store = require("../../utils/store");

Page({
  data: { bankId: "", qid: "", question: null, title: "", options: [], answer: "", explanation: "", saving: false },

  onLoad: function (params) {
    var self = this;
    this.bankId = params.bankId || "";
    this.qid = decodeURIComponent(params.qid || "");
    this.channel = this.getOpenerEventChannel();
    this.channel.on("question", function (payload) {
      var q = payload && payload.question;
      if (!q) return;
      self.setData({
        question: q,
        title: q.title || "",
        options: (q.options || []).map(function (option) { return { key: option.key, content: option.content || "", formulaImages: option.formulaImages || [] }; }),
        answer: (q.answer || []).join(" "),
        explanation: q.explanation || "",
      });
    });
  },

  onTitleInput: function (e) { this.setData({ title: e.detail.value }); },
  onAnswerInput: function (e) { this.setData({ answer: e.detail.value }); },
  onExplanationInput: function (e) { this.setData({ explanation: e.detail.value }); },
  onOptionInput: function (e) {
    var options = this.data.options.slice();
    var index = Number(e.currentTarget.dataset.index);
    if (!options[index]) return;
    options[index].content = e.detail.value;
    this.setData({ options: options });
  },

  onSave: function () {
    var self = this;
    if (this.data.saving || !this.data.question) return;
    var q = this.data.question;
    var options = this.data.options.map(function (option) {
      var original = (q.options || []).find(function (item) { return item.key === option.key; }) || {};
      return Object.assign({}, original, option);
    });
    var patch = { title: this.data.title, options: options, answer: this.data.answer, explanation: this.data.explanation };
    this.setData({ saving: true });
    wx.showLoading({ title: "保存校对" });
    store.updateQuestion(this.bankId, this.qid, patch).then(function (result) {
      q.title = patch.title;
      q.options = options;
      q.answer = q.type === "subjective" ? [patch.answer] : patch.answer.split(/[\s,，、]+/).filter(Boolean);
      if (q.type === "multiple") q.answer = q.answer.join("").toUpperCase().match(/[A-F]/g) || [];
      else if (q.type === "single") {
        // 与云端 normalizeQuestion 保持一致：单选只保留一个有效选项字母
        var keys = options.map(function (option) { return String(option.key).toUpperCase(); });
        var letters = q.answer.join("").toUpperCase().match(/[A-F]/g) || [];
        var matched = letters.filter(function (key) { return keys.indexOf(key) > -1; });
        q.answer = matched.length ? [matched[0]] : letters.length ? [letters[0]] : q.answer.slice(0, 1);
      }
      q.explanation = patch.explanation;
      q.reviewed = true;
      q.reviewedAt = result.reviewedAt;
      self.channel.emit("questionUpdated", { question: q });
      wx.hideLoading();
      wx.navigateBack();
    }).catch(function (err) {
      wx.hideLoading();
      self.setData({ saving: false });
      wx.showModal({ title: "保存失败", content: err && err.message || "请稍后重试", showCancel: false });
    });
  },
});
