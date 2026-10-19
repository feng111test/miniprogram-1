var store = require("../../utils/store");

Page({
  data: { banks: [], loading: true, error: "", adding: false },

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
    if (!item || item.added || self.data.adding) return;
    self.setData({ adding: true });
    self.importBank(item.id, 0);
  },

  // 题库较大时云端会分次导入，这里按进度续传直到 done
  importBank: function (id, rounds) {
    var self = this;
    wx.showLoading({ title: "添加题库中", mask: true });
    store.addBuiltInBank(id).then(function (res) {
      if (res && res.done === false && (res.total || 0) > 1) {
        if (rounds + 1 > 40) throw new Error("导入超时，请重试");
        wx.showLoading({
          title: "添加题库中 " + (res.progress || 0) + "/" + res.total,
          mask: true,
        });
        return self.importBank(id, rounds + 1);
      }
      wx.hideLoading();
      self.setData({ adding: false });
      wx.showToast({ title: "已添加到我的题库", icon: "success" });
      self.refresh();
    }).catch(function (err) {
      wx.hideLoading();
      self.setData({ adding: false });
      wx.showModal({ title: "添加失败", content: err && err.message || "请稍后重试", showCancel: false });
      self.refresh();
    });
  },
});
