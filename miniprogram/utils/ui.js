/**
 * 统一的加载与反馈
 *
 * 背景：wx.hideLoading() 之后立刻调用 wx.showToast()，
 * 在部分基础库版本上 toast 会被 hideLoading 一起关掉，
 * 表现为「点了按钮没反应」，但实际请求已经失败。
 * 所以这里统一延迟一帧再提示，并把错误打到控制台便于排查。
 */

function hideLoading() {
  try {
    wx.hideLoading();
  } catch (e) {}
}

/**
 * 成功提示
 * @param {String} title
 * @param {Function} done 提示后执行的回调
 */
function success(title, done) {
  hideLoading();
  setTimeout(function () {
    wx.showToast({ title: title, icon: "success" });
    if (done) done();
  }, 120);
}

/**
 * 失败提示：用弹窗而非 toast，保证用户一定能看到原因
 * @param {String} scope 操作名称，用于定位
 * @param {Error} err
 * @param {String} fallback 兜底文案
 */
function fail(scope, err, fallback) {
  hideLoading();
  var message =
    (err && (err.message || err.errMsg)) || fallback || "操作失败";
  console.error("[" + scope + "] 失败", err);

  setTimeout(function () {
    wx.showModal({
      title: scope + "失败",
      content: String(message),
      showCancel: false,
      confirmText: "知道了",
    });
  }, 120);
}

/**
 * 轻提示：不带加载框，仅一句 toast
 */
function tip(title) {
  setTimeout(function () {
    wx.showToast({ title: title, icon: "none" });
  }, 120);
}

module.exports = {
  hideLoading: hideLoading,
  success: success,
  fail: fail,
  tip: tip,
};
