var store = require("../../utils/store");
var sample = require("../../utils/sample");
var parser = require("../../utils/parser");
var shareUtil = require("../../utils/share");
var ui = require("../../utils/ui");

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
    loading: false,
    cloudError: "",
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
    var self = this;
    this.refresh().then(function () {
      wx.stopPullDownRefresh();
    });
  },

  refresh: function () {
    var self = this;
    this.setData({ loading: true });

    return store
      .getBanks()
      .then(function (list) {
        console.log("[首页] 列表返回条数 =", (list || []).length, list);

        var banks = (list || []).map(function (b) {
          b.percent = b.count ? Math.round((b.answered / b.count) * 100) : 0;
          b.timeText = formatDate(b.updatedAt);
          b.ownerText = b.mine ? "我的" : "共享";
          return b;
        });
        self.setData({
          banks: banks,
          summary: store.getSummary(banks),
          loading: false,
          cloudError: "",
        });
      })
      .catch(function (err) {
        self.setData({
          banks: [],
          summary: { banks: 0, total: 0, answered: 0, accuracy: 0 },
          loading: false,
          cloudError: (err && err.message) || "加载题库失败",
        });
      });
  },

  onRetry: function () {
    this.refresh();
  },

  onShowCloudHelp: function () {
    wx.showModal({
      title: "云开发未就绪",
      content:
        "请依次确认：\n" +
        "1. 已用你自己的 AppID 打开「云开发」并创建环境\n" +
        "2. app.js 中的 CLOUD_ENV 与环境 ID 一致\n" +
        "3. 右键 cloudfunctions/bankFunctions → 上传并部署\n" +
        "4. 数据库已创建 banks / questions / records 三个集合",
      showCancel: false,
      confirmText: "知道了",
    });
  },

  findMeta: function (id) {
    var list = this.data.banks || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  },

  onImport: function () {
    wx.navigateTo({ url: "/pages/import/import" });
  },

  onOpenCatalog: function () {
    wx.navigateTo({ url: "/pages/catalog/catalog" });
  },

  onLoadSample: function () {
    var self = this;
    var banks = sample.BUILT_IN_BANKS || [];
    if (!banks.length) {
      wx.showToast({ title: "暂无可用的内置题库", icon: "none" });
      return;
    }

    wx.showActionSheet({
      itemList: banks.map(function (bank) {
        return bank.name;
      }),
      success: function (res) {
        self.loadSampleBank(banks[res.tapIndex]);
      },
      fail: function () {},
    });
  },

  loadSampleBank: function (bank) {
    if (!bank) return;
    var self = this;
    var res = null;
    var settled = false;

    try {
      res = parser.parseBank(bank.content);
    } catch (e) {
      console.error("[内置题库] 解析异常", e);
      wx.showModal({
        title: "解析失败",
        content: String((e && e.message) || e),
        showCancel: false,
      });
      return;
    }

    if (!res || !res.questions || !res.questions.length) {
      console.error("[内置题库] 解析结果为空", bank.name, res);
      wx.showModal({
        title: "解析失败",
        content: "示例文本没有解析出题目",
        showCancel: false,
      });
      return;
    }

    console.log("[内置题库] 开始创建", bank.name, "题量 =", res.questions.length);
    wx.showLoading({ title: "保存中", mask: true });

    // 超时兜底：云函数长时间无响应时给出明确提示，避免「完全没反应」
    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      wx.hideLoading();
      wx.showModal({
        title: "操作超时",
        content:
          "云函数 15 秒内没有返回。请到云开发控制台 → 云函数 → bankFunctions → 日志，查看具体报错。",
        showCancel: false,
      });
    }, 15000);

    store
      .createBank({
        name: res.name || bank.name,
        desc: bank.desc,
        questions: res.questions,
        public: false,
      })
      .then(function (data) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        console.log("[内置题库] 保存成功", bank.name, data);
        wx.hideLoading();
        wx.showToast({ title: "已添加内置题库", icon: "success" });
        return self.refresh();
      })
      .catch(function (err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        console.error("[内置题库] 保存失败", bank.name, err);
        wx.hideLoading();
        wx.showModal({
          title: "载入失败",
          content: String((err && err.message) || "保存失败"),
          showCancel: false,
        });
      });
  },

  onOpenBank: function (e) {
    var id = e.currentTarget.dataset.id;
    var meta = this.findMeta(id);
    if (!meta) return;

    var items = ["顺序练习", "随机练习", "考试模式"];
    var modes = ["sequence", "random", "exam"];
    if (meta.wrong) {
      items.push("错题重练");
      modes.push("wrong");
    }
    if (meta.star) {
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
    var meta = this.findMeta(id);
    if (!meta) return;

    var items = [];
    if (meta.mine) {
      items.push("重命名");
      items.push(meta.public ? "设为私密" : "设为公开");
      items.push("清空练习记录");
      items.push("删除题库");
    } else {
      items.push("清空练习记录");
    }

    var self = this;
    wx.showActionSheet({
      itemList: items,
      success: function (res) {
        var item = items[res.tapIndex];
        if (item === "重命名") self.renameBank(id, meta.name);
        else if (item === "设为公开") self.setPublic(id, true);
        else if (item === "设为私密") self.setPublic(id, false);
        else if (item === "清空练习记录") self.resetBank(id);
        else if (item === "删除题库") self.removeBank(id, meta.name);
      },
      fail: function () {},
    });
  },

  setPublic: function (id, value) {
    var self = this;
    wx.showLoading({ title: "保存中" });
    store
      .updateBank(id, { public: value })
      .then(function () {
        wx.hideLoading();
        wx.showToast({ title: value ? "已设为公开" : "已设为私密", icon: "success" });
        return self.refresh();
      })
      .catch(function (err) {
        wx.hideLoading();
        wx.showToast({ title: (err && err.message) || "操作失败", icon: "none" });
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
          wx.showLoading({ title: "保存中" });
          store
            .updateBank(id, { name: res.content.trim() })
            .then(function () {
              wx.hideLoading();
              return self.refresh();
            })
            .catch(function (err) {
              wx.hideLoading();
              wx.showToast({ title: (err && err.message) || "操作失败", icon: "none" });
            });
        }
      },
    });
  },

  resetBank: function (id) {
    var self = this;
    wx.showModal({
      title: "清空练习记录",
      content: "将清除你在这套题库上的答题记录和错题本，确定继续？",
      success: function (res) {
        if (!res.confirm) return;
        wx.showLoading({ title: "处理中" });
        store
          .resetRecord(id)
          .then(function () {
            wx.hideLoading();
            wx.showToast({ title: "已清空", icon: "success" });
            return self.refresh();
          })
          .catch(function (err) {
            wx.hideLoading();
            wx.showToast({ title: (err && err.message) || "操作失败", icon: "none" });
          });
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
        if (!res.confirm) return;
        wx.showLoading({ title: "删除中" });
        store
          .deleteBank(id)
          .then(function () {
            wx.hideLoading();
            wx.showToast({ title: "已删除", icon: "success" });
            return self.refresh();
          })
          .catch(function (err) {
            wx.hideLoading();
            wx.showToast({ title: (err && err.message) || "删除失败", icon: "none" });
          });
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
