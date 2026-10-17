var store = require("../../utils/store");
var parser = require("../../utils/parser");
var sample = require("../../utils/sample");
var shareUtil = require("../../utils/share");
var ui = require("../../utils/ui");

var TYPE_TEXT = { single: "单选", multiple: "多选", judge: "判断" };

Page(shareUtil.withShare({
  data: {
    name: "",
    content: "",
    parsed: null,
    showHelp: false,
    isPublic: false,
  },

  questions: [],
  timer: null,

  onUnload: function () {
    if (this.timer) clearTimeout(this.timer);
  },

  onNameInput: function (e) {
    this.setData({ name: e.detail.value });
  },

  onContentInput: function (e) {
    this.setData({ content: e.detail.value });
    this.scheduleParse();
  },

  scheduleParse: function () {
    if (this.timer) clearTimeout(this.timer);
    var self = this;
    this.timer = setTimeout(function () {
      self.doParse();
    }, 300);
  },

  doParse: function () {
    var content = this.data.content;
    if (!content.trim()) {
      this.questions = [];
      this.setData({ parsed: null });
      return;
    }

    var res = parser.parseBank(content);
    this.questions = res.questions;

    if (res.name && !this.data.name) this.setData({ name: res.name });

    var typeStat = { single: 0, multiple: 0, judge: 0 };
    res.questions.forEach(function (q) {
      if (typeStat[q.type] !== undefined) typeStat[q.type] += 1;
    });

    var preview = res.questions.slice(0, 3).map(function (q, i) {
      return {
        id: q.id,
        index: i + 1,
        title: q.title,
        typeText: TYPE_TEXT[q.type] || "题目",
        answerText: q.answer.join(" "),
      };
    });

    this.setData({
      parsed: {
        count: res.questions.length,
        typeStat: typeStat,
        preview: preview,
        errors: res.errors,
      },
    });
  },

  onChooseFile: function () {
    var self = this;
    wx.chooseMessageFile({
      count: 1,
      type: "file",
      extension: ["json", "txt", "md", "csv"],
      success: function (res) {
        var file = res.tempFiles[0];
        try {
          var content = wx.getFileSystemManager().readFileSync(file.path, "utf8");
          var name = String(file.name || "").replace(/\.[^.]+$/, "");
          self.setData({
            content: content,
            name: self.data.name || name,
          });
          self.doParse();
          wx.showToast({ title: "已读取文件", icon: "success" });
        } catch (err) {
          wx.showToast({ title: "文件读取失败，请手动粘贴", icon: "none" });
        }
      },
      fail: function (err) {
        if (String(err.errMsg).indexOf("cancel") === -1) {
          wx.showToast({ title: "选择文件失败", icon: "none" });
        }
      },
    });
  },

  onFillText: function () {
    this.setData({ content: sample.SAMPLE_TEXT, name: this.data.name || "前端基础练习题库" });
    this.doParse();
  },

  onFillJson: function () {
    this.setData({ content: sample.SAMPLE_JSON, name: this.data.name || "JSON 模板题库" });
    this.doParse();
  },

  onClear: function () {
    this.setData({ content: "", parsed: null });
    this.questions = [];
  },

  toggleHelp: function () {
    this.setData({ showHelp: !this.data.showHelp });
  },

  onTogglePublic: function (e) {
    this.setData({ isPublic: !!e.detail.value });
  },

  onSave: function () {
    var self = this;
    if (!this.questions.length) {
      wx.showToast({ title: "请先导入题目内容", icon: "none" });
      return;
    }

    var name = this.data.name.trim() || "未命名题库";
    var d = new Date();
    var desc =
      "共 " + this.questions.length + " 题 · 导入于 " +
      d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();

    wx.showLoading({ title: "保存中" });

    store
      .createBank({
        name: name,
        desc: desc,
        questions: this.questions,
        public: this.data.isPublic,
      })
      .then(function () {
        ui.success("导入成功", function () {
          setTimeout(function () {
            wx.navigateBack();
          }, 500);
        });
      })
      .catch(function (err) {
        ui.fail("导入题库", err, "导入失败");
      });
  },
}, function () {
  return {
    title: "刷题助手 · 一键导入题库，随时随地刷题",
    path: "/pages/index/index?from=share",
  };
}));
