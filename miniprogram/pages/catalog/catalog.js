var store = require("../../utils/store");

Page({
  data: { banks: [], loading: true, error: "" },

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
    if (!item || item.added) return;
    wx.showLoading({ title: "添加题库中", mask: true });
    store.addBuiltInBank(item.id).then(function () {
      wx.hideLoading();
      wx.showToast({ title: "已添加到我的题库", icon: "success" });
      self.refresh();
    }).catch(function (err) {
      wx.hideLoading();
      wx.showModal({ title: "添加失败", content: err && err.message || "请稍后重试", showCancel: false });
    });
  },
});
