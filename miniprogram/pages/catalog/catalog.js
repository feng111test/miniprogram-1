var store = require("../../utils/store");

Page({
  data: {
    banks: [],
    loading: true,
    error: "",
    addingId: "",
    addingProgress: 0,
    addingTotal: 0,
    addingPercent: 0,
  },

  onLoad: function () { this.refresh(); },

  refresh: function () {
    var self = this;
    this.setData({ loading: true, error: "" });
    return Promise.all([store.getBuiltInBanks(), store.getBanks()]).then(function (result) {
      var owned = {};
      (result[1] || []).forEach(function (bank) { if (bank.builtinId) owned[bank.builtinId] = bank.id; });
      self.setData({ banks: (result[0] || []).map(function (bank) {
        bank.added = !!owned[bank.id];
        bank.userBankId = owned[bank.id] || "";
        return bank;
      }), loading: false });
    }).catch(function (err) {
      self.setData({ loading: false, error: err && err.message || "读取题库目录失败" });
    });
  },

  onAdd: function (e) {
    var self = this;
    var item = this.data.banks[Number(e.currentTarget.dataset.index)];
    if (!item || item.added || self.data.addingId) return;
    // 进度展示在页面里，不用 wx.showLoading 的文案（连续调用不会刷新）
    self.setData({
      addingId: item.id,
      addingProgress: 0,
      addingTotal: 0,
      addingPercent: 0,
    });
    store.addBuiltInBank(item.id, function (res) {
      var total = res.total || 0;
      var progress = res.progress || 0;
      self.setData({
        addingProgress: progress,
        addingTotal: total,
        addingPercent: total ? Math.round((progress / total) * 100) : 0,
      });
    }).then(function () {
      self.setData({ addingId: "", addingProgress: 0, addingTotal: 0, addingPercent: 0 });
      wx.showToast({ title: "已添加到我的题库", icon: "success" });
      self.refresh();
    }).catch(function (err) {
      self.setData({ addingId: "", addingProgress: 0, addingTotal: 0, addingPercent: 0 });
      wx.showModal({ title: "添加失败", content: (err && err.message) || "请稍后重试", showCancel: false });
      self.refresh();
    });
  },
});
