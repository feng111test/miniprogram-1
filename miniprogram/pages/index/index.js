var store = require("../../utils/store");
var sample = require("../../utils/sample");
var parser = require("../../utils/parser");
var shareUtil = require("../../utils/share");

function pad(n) {
  return n < 10 ? "0" + n : "" + n;
}

function formatDate(ts) {
  if (!ts) return "";
  var d = new Date(ts);
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

Page(shareUtil.withShare({
  data: {
    banks: [],
    summary: { banks: 0, total: 0, answered: 0, accuracy: 0 },
    shareTip: "",
  },

  onLoad: function (options) {
    // 好友通过转发卡片进入时给出引导
    var q = shareUtil.getQuery(options);
    if (q.from === "share") {
      this.setData({
        shareTip: "好友给你分享了刷题助手，先载入示例题库体验一下吧",
      });
    } else if (q.from === "result") {
      var tip = "好友分享了他的练习成绩";
      if (q.bank) tip += "（" + q.bank + "）";
      this.setData({ shareTip: tip + "，导入题库和他比比看" });
    }
  },

  onShow: function () {
    this.refresh();
  },

  onPullDownRefresh: function () {
    this.refresh();
    wx.stopPullDownRefresh();
  },

  refresh: function () {
    var list = store.getBanks().map(function (b) {
      b.percent = b.count ? Math.round((b.answered / b.count) * 100) : 0;
      b.timeText = formatDate(b.updatedAt);
      return b;
    });
    this.setData({
      banks: list,
      summary: store.getSummary(),
    });
  },

  onImport: function () {
    wx.navigateTo({ url: "/pages/import/import" });
  },

  onLoadSample: function () {
    var res = parser.parseBank(sample.SAMPLE_TEXT);
    if (!res.questions.length) {
      wx.showToast({ title: "示例题库解析失败", icon: "none" });
      return;
    }
    store.createBank({
      name: res.name || "前端基础练习题库",
      desc: "内置示例，含单选 / 多选 / 判断",
      questions: res.questions,
    });
    this.refresh();
    wx.showToast({ title: "已载入示例题库", icon: "success" });
  },

  onOpenBank: function (e) {
    var id = e.currentTarget.dataset.id;
    var bank = store.getBank(id);
    if (!bank) return;

    var items = ["顺序练习", "随机练习", "考试模式"];
    var modes = ["sequence", "random", "exam"];
    if (bank.record.wrongIds.length) {
      items.push("错题重练");
      modes.push("wrong");
    }
    if (bank.record.starIds.length) {
      items.push("收藏练习");
      modes.push("star");
    }

    wx.showActionSheet({
      itemList: items,
      success: function (res) {
        var mode = modes[res.tapIndex];
        wx.navigateTo({
          url: "/pages/practice/practice?id=" + id + "&mode=" + mode,
      });
    },
    fail: function () {},
    });
  },

  onMoreAction: function (e) {
    var id = e.currentTarget.dataset.id;
    var bank = store.getBank(id);
    if (!bank) return;

    var self = this;
    wx.showActionSheet({
      itemList: ["重命名", "清空练习记录", "删除题库"],
      success: function (res) {
        if (res.tapIndex === 0) self.renameBank(id, bank.name);
        else if (res.tapIndex === 1) self.resetBank(id);
        else if (res.tapIndex === 2) self.removeBank(id, bank.name);
      },
      fail: function () {},
    });
  },

  renameBank: function (id, name) {
    var self = this;
    wx.showModal({
      title: "重命名题库",
      editable: true,
      placeholderText: "请输入题库名称",
      content: name,
      success: function (res) {
        if (res.confirm && res.content && res.content.trim()) {
          store.updateBank(id, function (b) {
            b.name = res.content.trim();
          });
          self.refresh();
        }
      },
    });
  },

  resetBank: function (id) {
    var self = this;
    wx.showModal({
      title: "清空练习记录",
      content: "将清除该题库的答题记录和错题本，确定继续？",
      success: function (res) {
        if (res.confirm) {
          store.resetRecord(id);
          self.refresh();
          wx.showToast({ title: "已清空", icon: "success" });
      }
    },
    });
  },

  removeBank: function (id, name) {
    var self = this;
    wx.showModal({
      title: "删除题库",
      content: "确定删除「" + name + "」吗？该操作不可恢复。",
      confirmColor: "#F04438",
      success: function (res) {
        if (res.confirm) {
          store.deleteBank(id);
          self.refresh();
          wx.showToast({ title: "已删除", icon: "success" });
      }
    },
    });
  },

  onCloseShareTip: function () {
    this.setData({ shareTip: "" });
  },
}, function () {
  return {
    title: "刷题助手 · 支持题库导入，随时随地在线刷题",
    path: "/pages/index/index?from=share",
  };
}));
