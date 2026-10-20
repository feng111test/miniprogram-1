import { parseQuestionsFromText } from "./src/question-parser.js";

const ocrText = `
高中化学必修一 第一章 检测
1．下列物质中，属于电解质的是（　　）
A．氯化钠 B．蔗糖 C．酒精 D．二氧化碳
【答案】A
【解析】氯化钠在水溶液中能导电，属于电解质。

2. 关于氧化还原反应，下列说法正确的是
A. 氧化剂被氧化
B. 还原剂被还原
C. 氧化剂发生还原反应
D. 以上都不对
参考答案：C
解析：氧化剂得电子，发生还原反应。

3、判断题：水是由氢元素和氧元素组成的。
答案：正确

第4题：下列反应属于放热反应的是
Ａ. 碳酸钙分解
Ｂ. 生石灰与水反应
Ｃ. 氯化铵与氢氧化钡反应
D．碳与二氧化碳反应
正确答案：B
第 3 页 共 8 页
`;

const questions = parseQuestionsFromText(ocrText);
console.log("切分出题目数:", questions.length);
questions.forEach((question, index) => {
  console.log(
    `第${index + 1}题 [${question.type}] 答案=${question.answer || "待补"} 选项=${question.options.length}`,
  );
  console.log("   题干:", question.title.slice(0, 30));
  console.log("   选项:", question.options.map((o) => `${o.key}.${o.content}`).join(" | "));
  if (question.explanation) console.log("   解析:", question.explanation.slice(0, 30));
});

console.log("\n--- 干扰文本（不应切出题目）---");
console.log("结果:", parseQuestionsFromText("第 3 页 共 8 页\n高中化学\n2023年10月").length, "题");
console.log("空文本:", parseQuestionsFromText("").length, "题");
