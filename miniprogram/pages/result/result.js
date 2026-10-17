var store = require("../../utils/store");

Page({
  data: {
    bankId: "",
    bankName: "",
    mode: "sequence",
    modeText: "",
    total: 0,
    right: 0,
    wrong: 0,
    unanswered: 0,
    accuracy: 0,
    timeText: "00:00",
    items: [],
    list: [],
    filter: "all",
  },

  onLoad: function () {
    var r = store.getResult();
    if (!r) {
      wx.showToast({ title: "暂无成绩数据", icon: "none" });
      setTimeout(function () {
        wx.reLaunch({ url: "/pages/index/index" });
      }, 800);
      return;
    }

    var items = (r.items || []).map(function (it) {
      var answer = it.answer || [];
      var selected = it.selected || [];
      var options = (it.options || []).map(function (o) {
        var state = "";
        if (it.answered) {
          if (answer.indexOf(o.key) > -1) state = "right";
          else if (selected.indexOf(o.key) > -1) state = "wrong";
        } else if (selected.indexOf(o.key) > -1) {
          state = "checked";
        }
        return { key: o.key, content: o.content, state: state };
      });
      return Object.assign({}, it, { options: options });
    });

    this.setData({
      bankId: r.bankId || "",
      bankName: r.bankName || "",
      mode: r.mode || "sequence",
      modeText: r.modeText || "",
      total: r.total || 0,
      right: r.right || 0,
      wrong: r.wrong || 0,
      unanswered: r.unanswered || 0,
      accuracy: r.accuracy || 0,
      timeText: r.timeText || "00:00",
      items: items,
      list: items,
    });

    wx.setNavigationBarTitle({ title: "练习结果" });
  },

  onFilter: function (e) {
    var f = e.currentTarget.dataset.filter;
    var list = f === "all" ? this.data.items : this.data.items.filter(function (i) {
      return !i.correct;
    });
    this.setData({ filter: f, list: list });
  },

  onRetry: function () {
    wx.redirectTo({
      url: "/pages/practice/practice?id=" + this.data.bankId + "&mode=" + this.data.mode,
    });
  },

  onRedoWrong: function () {
    wx.redirectTo({
      url: "/pages/practice/practice?id=" + this.data.bankId + "&mode=wrong",
    });
  },

  onBackHome: function () {
    wx.reLaunch({ url: "/pages/index/index" });
  },
});
