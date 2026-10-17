/**
 * 内置示例题库（用于一键体验）
 */

var SAMPLE_TEXT = [
  "# 前端基础练习题库",
  "",
  "1.（单选）HTML 中用于定义超链接的标签是：",
  "A. <p>",
  "B. <a>",
  "C. <div>",
  "D. <span>",
  "答案：B",
  "解析：<a> 标签用于定义超链接，通过 href 属性指定跳转地址。",
  "",
  "2.（多选）下列属于 JavaScript 基本数据类型的有：",
  "A. String",
  "B. Number",
  "C. Array",
  "D. Boolean",
  "答案：ABD",
  "解析：基本类型包含 String、Number、Boolean、Null、Undefined、Symbol、BigInt，Array 属于引用类型。",
  "",
  "3.（判断）CSS 中 position: fixed 是相对于最近的已定位祖先元素进行定位的。",
  "答案：错误",
  "解析：fixed 相对于浏览器视口定位，absolute 才是相对最近的已定位祖先元素定位。",
  "",
  "4.（单选）HTTP 状态码 404 表示：",
  "A. 服务器内部错误",
  "B. 请求成功",
  "C. 资源未找到",
  "D. 需要重定向",
  "答案：C",
  "解析：404 Not Found 表示服务器无法找到请求的资源。",
  "",
  "5.（多选）关于 HTTP 与 HTTPS 的说法，正确的有：",
  "A. HTTPS 默认端口是 443",
  "B. HTTPS 在 HTTP 之上加入了 TLS/SSL",
  "C. HTTPS 不需要证书",
  "D. HTTP 是明文传输",
  "答案：ABD",
  "解析：HTTPS 需要由 CA 签发的证书来完成身份验证与密钥协商。",
  "",
  "6.（判断）JavaScript 中 `let` 声明的变量存在变量提升，但在声明前访问会报错。",
  "答案：正确",
  "解析：let 存在暂时性死区（TDZ），声明前访问会抛出 ReferenceError。",
].join("\n");

var SAMPLE_JSON = JSON.stringify(
  [
    {
      type: "single",
      title: "以下哪个方法用于在数组末尾添加元素？",
      options: ["push", "pop", "shift", "unshift"],
      answer: "A",
      explanation: "push 在数组末尾添加元素并返回新长度。",
    },
    {
      type: "multiple",
      title: "以下哪些方式可以创建 Promise？",
      options: ["new Promise()", "Promise.resolve()", "await Promise()", "async 函数返回值"],
      answer: ["A", "B", "D"],
      explanation: "async 函数会自动将返回值包装成 Promise。",
    },
    {
      type: "judge",
      title: "微信小程序的页面样式文件后缀是 .wxss。",
      answer: "正确",
      explanation: "小程序样式文件为 WXSS，是 CSS 的扩展。",
    },
  ],
  null,
  2
);

module.exports = {
  SAMPLE_TEXT: SAMPLE_TEXT,
  SAMPLE_JSON: SAMPLE_JSON,
};
