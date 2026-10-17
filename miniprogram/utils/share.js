/**
 * 小程序转发 / 分享能力
 *
 * 用法：
 *   Page(withShare({ ...页面配置 }, function () {
 *     return { title: '自定义标题', path: '/pages/index/index?a=1', imageUrl: '' }
 *   }))
 *
 * 说明：
 * - 只有定义了 onShareAppMessage，右上角「⋯」菜单才会出现「转发给朋友」
 * - 只有同时定义了 onShareTimeline，才会出现「分享到朋友圈」
 * - 页面内主动触发转发必须用 <button open-type="share">，无法用代码直接调起
 */

var DEFAULT_TITLE = "刷题助手 · 导入题库，随时随地刷题";
var DEFAULT_PATH = "/pages/index/index";
// 可选：自定义分享封面图，建议 5:4，支持本地路径或网络图片，留空则默认使用页面截屏
var DEFAULT_IMAGE = "";

function buildQuery(page) {
  var options = (page && page.options) || {};
  return Object.keys(options)
    .map(function (k) {
      return k + "=" + encodeURIComponent(options[k]);
    })
    .join("&");
}

function buildPath(page) {
  var route = page && page.route ? page.route : "";
  var path = route ? "/" + route : DEFAULT_PATH;
  var query = buildQuery(page);
  return query ? path + "?" + query : path;
}

function withShare(pageConfig, shareFn) {
  var getter =
    typeof shareFn === "function"
      ? shareFn
      : function () {
          return shareFn;
        };

  // 转发给好友 / 群聊
  pageConfig.onShareAppMessage = function () {
    var custom = getter.call(this) || {};
    var share = {
      title: custom.title || DEFAULT_TITLE,
      path: custom.path || buildPath(this),
      imageUrl: custom.imageUrl || DEFAULT_IMAGE,
    };
    return share;
  };

  // 分享到朋友圈（单页模式）
  pageConfig.onShareTimeline = function () {
    var custom = getter.call(this) || {};
    return {
      title: custom.title || DEFAULT_TITLE,
      query: custom.query || buildQuery(this),
      imageUrl: custom.imageUrl || DEFAULT_IMAGE,
    };
  };

  return pageConfig;
}

/**
 * 解析启动参数
 * 兼容：转发卡片打开、朋友圈单页模式（options.query）、扫码进入（scene 编码）
 */
function getQuery(options) {
  var query = {};
  if (!options) return query;

  function put(pair) {
    var idx = pair.indexOf("=");
    if (idx > 0) query[pair.slice(0, idx)] = pair.slice(idx + 1);
  }

  Object.keys(options).forEach(function (k) {
    if (k === "scene" || k === "query") return;
    query[k] = options[k];
  });

  if (typeof options.query === "string" && options.query) {
    options.query.split("&").forEach(put);
  }

  if (options.scene) {
    decodeURIComponent(options.scene).split("&").forEach(put);
  }

  return query;
}

module.exports = {
  withShare: withShare,
  getQuery: getQuery,
};
