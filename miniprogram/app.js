// app.js

// 云开发环境 ID
// 到「开发者工具 → 云开发控制台 → 设置 → 环境 ID」查看或修改
const CLOUD_ENV = "test-d7g2tc8av93168efa";

// 云开发连通性自检：启动时自动调用一次云函数，结果打印到控制台
// 上线前把它改成 false 即可关闭
const RUN_DIAGNOSE = true;

function diagnose(app) {
  wx.cloud
    .callFunction({ name: "bankFunctions", data: { action: "list" } })
    .then(function (r) {
      console.log("[云开发自检] ✅ 成功", JSON.stringify(r));
      app.globalData.cloudDiag = "ok";
    })
    .catch(function (e) {
      console.log("[云开发自检] ❌ 失败", JSON.stringify(e));
      console.log("[云开发自检] errMsg =", e && e.errMsg);
      console.log("[云开发自检] errCode =", e && e.errCode);
      app.globalData.cloudDiag = (e && (e.errMsg || e.message)) || "未知错误";
    });
}

App({
  globalData: {
    env: CLOUD_ENV,
    cloudReady: false,
    cloudDiag: "",
  },

  onLaunch: function () {
    if (!wx.cloud) {
      wx.showModal({
        title: "基础库版本过低",
        content: "请使用 2.2.3 或以上的基础库以使用云能力",
        showCancel: false,
      });
      return;
    }

    try {
      wx.cloud.init({
        env: CLOUD_ENV || undefined,
        traceUser: true,
      });
      this.globalData.cloudReady = true;
    } catch (err) {
      console.error("[云开发自检] 初始化失败", err);
      return;
    }

    if (RUN_DIAGNOSE) diagnose(this);
  },

  // 捕获未被 try/catch 接住的异常
  onError: function (err) {
    console.error("[全局异常]", err);
    wx.showModal({
      title: "运行异常",
      content: String(err || "未知错误"),
      showCancel: false,
    });
  },
});
