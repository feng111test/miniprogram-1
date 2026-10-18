const buttons = document.querySelectorAll(".mode-button");
const frames = {
  word: document.getElementById("word-app"),
  pdf: document.getElementById("pdf-app"),
};

function selectMode(mode) {
  buttons.forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  Object.entries(frames).forEach(([name, frame]) => {
    frame.classList.toggle("active", name === mode);
  });
  document.title = mode === "word" ? "Word 导入刷题 · 试卷学习工作台" : "PDF 整理刷题 · 试卷学习工作台";
}

buttons.forEach((button) => {
  button.addEventListener("click", () => selectMode(button.dataset.mode));
});

selectMode("word");
