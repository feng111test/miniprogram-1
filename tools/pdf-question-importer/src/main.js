import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { createWorker, OEM } from "tesseract.js";
import tesseractWorkerUrl from "tesseract.js/dist/worker.min.js?url";
import tesseractCoreUrl from "tesseract.js-core/tesseract-core-simd-lstm.wasm.js?url";
import "./styles.css";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const byId = (id) => document.getElementById(id);
const elements = {
  input: byId("pdfInput"),
  fileCard: byId("fileCard"),
  fileName: byId("fileName"),
  documentMeta: byId("documentMeta"),
  pageList: byId("pageList"),
  pageCount: byId("pageCount"),
  pageLabel: byId("pageLabel"),
  stage: byId("pdfStage"),
  welcome: byId("welcome"),
  pageCanvasWrap: byId("pageCanvasWrap"),
  pageCanvasSurface: byId("pageCanvasSurface"),
  canvas: byId("pdfCanvas"),
  cropLayer: byId("cropLayer"),
  stageStatus: byId("stageStatus"),
  pageHint: byId("pageHint"),
  prevPage: byId("prevPage"),
  nextPage: byId("nextPage"),
  zoomIn: byId("zoomIn"),
  zoomOut: byId("zoomOut"),
  zoomLabel: byId("zoomLabel"),
  clearCrop: byId("clearCrop"),
  runOcr: byId("runOcr"),
  ocrStateDot: byId("ocrStateDot"),
  ocrStatus: byId("ocrStatus"),
  ocrElapsed: byId("ocrElapsed"),
  ocrProgress: byId("ocrProgress"),
  ocrPhase: byId("ocrPhase"),
  ocrLog: byId("ocrLog"),
  copyOcrLog: byId("copyOcrLog"),
  questionType: byId("questionType"),
  questionTitle: byId("questionTitle"),
  optionsField: byId("optionsField"),
  optionList: byId("optionList"),
  addOption: byId("addOption"),
  questionAnswer: byId("questionAnswer"),
  questionExplanation: byId("questionExplanation"),
  questionCount: byId("questionCount"),
  imageCount: byId("imageCount"),
  imageList: byId("imageList"),
  newQuestion: byId("newQuestion"),
  saveQuestion: byId("saveQuestion"),
  saveStatus: byId("saveStatus"),
  exportJson: byId("exportJson"),
  toast: byId("toast"),
};

const state = {
  pdf: null,
  fileName: "",
  page: 1,
  pageCount: 0,
  zoom: 1,
  questions: [],
  activeId: null,
  draft: newQuestion(),
  worker: null,
  busy: false,
  cropStart: null,
  cropRect: null,
  toastTimer: null,
  renderQueue: Promise.resolve(),
  ocrRun: {
    active: false,
    startedAt: 0,
    lastEventAt: 0,
    lastHeartbeatAt: 0,
    timer: null,
    phase: "",
    progress: 0,
    logs: [],
    lastLoggedStatus: "",
    lastLoggedProgress: -1,
  },
};

const MAX_PDF_BYTES = 100 * 1024 * 1024;

function newQuestion() {
  return {
    id: "",
    type: "single",
    title: "",
    options: [
      { key: "A", content: "" },
      { key: "B", content: "" },
      { key: "C", content: "" },
      { key: "D", content: "" },
    ],
    answer: "",
    explanation: "",
    images: [],
  };
}

function activeQuestion() {
  return state.activeId
    ? state.questions.find((question) => question.id === state.activeId)
    : state.draft;
}

function updateButtons() {
  const hasPdf = Boolean(state.pdf);
  elements.prevPage.disabled = !hasPdf || state.page <= 1 || state.busy;
  elements.nextPage.disabled = !hasPdf || state.page >= state.pageCount || state.busy;
  elements.zoomOut.disabled = !hasPdf || state.zoom <= 0.75 || state.busy;
  elements.zoomIn.disabled = !hasPdf || state.zoom >= 2.5 || state.busy;
  elements.runOcr.disabled = !hasPdf || state.busy;
  elements.clearCrop.disabled = !state.cropRect;
  elements.input.disabled = state.busy;
  elements.exportJson.disabled = state.questions.length === 0;
  elements.saveQuestion.disabled = state.busy;
  elements.newQuestion.disabled = state.busy;
}

function setBusy(busy, message = "") {
  state.busy = busy;
  elements.stageStatus.hidden = !busy;
  elements.stageStatus.textContent = message;
  document.body.classList.toggle("is-busy", busy);
  updateButtons();
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 2800);
}

function safeText(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function openPdf(file) {
  if (!file) return;
  if (file.type && file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
    showToast("请选择 PDF 文件");
    return;
  }
  if (file.size > MAX_PDF_BYTES) {
    showToast("PDF 文件不能超过 100 MB");
    return;
  }

  closePdf();
  setBusy(true, "正在打开 PDF…");
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    state.pdf = await pdfjs.getDocument({ data: bytes }).promise;
    state.fileName = file.name;
    state.pageCount = state.pdf.numPages;
    state.page = 1;
    state.zoom = 1;
    elements.fileCard.classList.remove("empty");
    elements.fileName.textContent = file.name;
    elements.documentMeta.textContent = `${formatBytes(file.size)} · ${state.pageCount} 页 · 仅在本机处理`;
    elements.welcome.hidden = true;
    elements.pageCanvasWrap.hidden = false;
    elements.pageCount.textContent = String(state.pageCount);
    renderPageList();
    setBusy(true, "正在绘制第一页…");
    await renderPage();
    showToast("PDF 已在本机打开");
  } catch (error) {
    console.error("[PDF 导入] 打开失败", error?.stack || String(error));
    closePdf();
    showToast(`无法打开 PDF：${error.message || "文件可能已损坏或受密码保护"}`);
  } finally {
    setBusy(false);
  }
}

function closePdf() {
  if (state.pdf) {
    state.pdf.destroy();
    state.pdf = null;
  }
  state.pageCount = 0;
  state.page = 1;
  elements.pageCanvasWrap.hidden = true;
  elements.welcome.hidden = false;
  elements.fileCard.classList.add("empty");
  elements.fileName.textContent = "尚未选择文件";
  elements.documentMeta.textContent = "PDF 不会上传到服务器";
  elements.pageCount.textContent = "0";
  elements.pageList.classList.add("empty-pages");
  elements.pageList.innerHTML = '<div class="empty-note">选择 PDF 后显示页面</div>';
  elements.pageLabel.textContent = "等待导入 PDF";
  elements.canvas.width = 0;
  elements.canvas.height = 0;
  clearCrop();
  updateButtons();
}

function renderPageList() {
  elements.pageList.classList.remove("empty-pages");
  elements.pageList.innerHTML = "";
  for (let pageNumber = 1; pageNumber <= state.pageCount; pageNumber += 1) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `page-item${pageNumber === state.page ? " active" : ""}`;
    item.dataset.page = String(pageNumber);
    item.innerHTML = `
      <span class="page-thumb"><span class="thumb-lines"></span><b>${pageNumber}</b></span>
      <span class="page-item-copy"><strong>第 ${pageNumber} 页</strong><small>点击查看页面</small></span>
      <span class="page-arrow">›</span>`;
    item.addEventListener("click", () => goToPage(pageNumber));
    elements.pageList.append(item);
  }
}

function renderPage() {
  const task = state.renderQueue.then(() => renderPageNow());
  state.renderQueue = task.catch(() => {});
  return task;
}

async function renderPageNow(retries = 1) {
  if (!state.pdf) return;
  const pageNumber = state.page;
  const page = await state.pdf.getPage(state.page);
  const baseViewport = page.getViewport({ scale: 1 });
  const availableWidth = Math.max(320, elements.stage.clientWidth - 56);
  const fitScale = Math.min(2, availableWidth / baseViewport.width);
  const scale = Math.max(0.55, fitScale * state.zoom);
  const viewport = page.getViewport({ scale });
  const canvas = elements.canvas;
  const context = canvas.getContext("2d", { alpha: false });
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  canvas.style.width = `${Math.ceil(viewport.width)}px`;
  canvas.style.height = `${Math.ceil(viewport.height)}px`;
  elements.pageCanvasSurface.style.width = `${Math.ceil(viewport.width)}px`;
  elements.pageCanvasSurface.style.height = `${Math.ceil(viewport.height)}px`;
  clearCrop();
  try {
    await page.render({ canvasContext: context, viewport }).promise;
  } catch (error) {
    if (error?.name === "RenderingCancelledException" && retries > 0 && state.pdf && pageNumber === state.page) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      return renderPageNow(retries - 1);
    }
    throw error;
  }
  if (pageNumber !== state.page) return;
  elements.pageLabel.textContent = `${state.fileName} · 第 ${pageNumber} / ${state.pageCount} 页`;
  elements.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
  elements.pageList.querySelectorAll(".page-item").forEach((item) => {
    const selected = Number(item.dataset.page) === pageNumber;
    item.classList.toggle("active", selected);
    if (selected) item.scrollIntoView({ block: "nearest" });
  });
  updateButtons();
}

async function goToPage(pageNumber) {
  if (!state.pdf || state.busy || pageNumber < 1 || pageNumber > state.pageCount) return;
  state.page = pageNumber;
  setBusy(true, `正在绘制第 ${pageNumber} 页…`);
  try {
    await renderPage();
  } catch (error) {
    console.error("[PDF 页面] 绘制失败", error);
    showToast("页面绘制失败，请重试");
  } finally {
    setBusy(false);
  }
}

function renderOptions(options) {
  elements.optionList.innerHTML = "";
  options.forEach((option, index) => {
    const row = document.createElement("div");
    row.className = "option-row";
    row.innerHTML = `
      <span class="option-key">${safeText(option.key)}</span>
      <input class="field-control option-input" type="text" value="${safeText(option.content)}" placeholder="选项内容" aria-label="选项 ${safeText(option.key)}" data-index="${index}" />
      <button class="remove-option" type="button" aria-label="删除选项 ${safeText(option.key)}" data-index="${index}">×</button>`;
    elements.optionList.append(row);
  });
  elements.optionList.querySelectorAll(".option-input").forEach((input) => {
    input.addEventListener("input", () => {
      const question = activeQuestion();
      const option = question.options[Number(input.dataset.index)];
      if (option) option.content = input.value;
    });
  });
  elements.optionList.querySelectorAll(".remove-option").forEach((button) => {
    button.addEventListener("click", () => {
      const question = activeQuestion();
      question.options.splice(Number(button.dataset.index), 1);
      renderOptions(question.options);
    });
  });
}

function loadQuestion(question) {
  if (question.id && !state.activeId && hasUnsavedDraft() && !window.confirm("当前新题目还没保存，确定放弃它并切换题目吗？")) {
    return;
  }
  state.activeId = question.id || null;
  state.draft = question.id ? state.draft : question;
  elements.questionType.value = question.type;
  elements.questionTitle.value = question.title;
  elements.questionAnswer.value = question.answer;
  elements.questionExplanation.value = question.explanation;
  renderOptions(question.options);
  elements.optionsField.hidden = question.type === "judge";
  renderQuestionList();
  renderImages();
  elements.saveStatus.textContent = question.id ? "编辑中的修改会自动暂存" : "新题目尚未保存";
}

function hasUnsavedDraft() {
  return Boolean(
    state.draft.title.trim() ||
      state.draft.answer.trim() ||
      state.draft.explanation.trim() ||
      state.draft.options.some((option) => option.content.trim()) ||
      state.draft.images.length,
  );
}

function renderQuestionList() {
  const count = state.questions.length;
  elements.questionCount.textContent = `${count} 题`;
  elements.exportJson.disabled = count === 0;
  const section = document.createElement("section");
  section.className = "saved-questions";
  if (count) {
    section.innerHTML = `<div class="saved-heading"><strong>已整理题目</strong><span>${count}</span></div>`;
    state.questions.forEach((question, index) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = `saved-question${question.id === state.activeId ? " active" : ""}`;
      item.innerHTML = `
        <span class="saved-number">${String(index + 1).padStart(2, "0")}</span>
        <span class="saved-copy"><strong>${safeText(question.title || "未填写题干")}</strong><small>${question.images.length} 张题目图片 · ${question.answer ? `答案 ${safeText(question.answer)}` : "答案待补"}</small></span>
        <span class="saved-edit">编辑</span>`;
      item.addEventListener("click", () => loadQuestion(question));
      section.append(item);
    });
  }
  const oldSection = document.querySelector(".saved-questions");
  if (oldSection) oldSection.replaceWith(section);
  else byId("fileCard").closest(".left-panel").append(section);
}

function renderImages() {
  const question = activeQuestion();
  const images = question?.images || [];
  elements.imageCount.textContent = String(images.length);
  elements.imageList.innerHTML = "";
  if (!images.length) {
    elements.imageList.innerHTML = '<div class="image-empty">框选左侧页面区域，将化学式、反应式或结构图添加到当前题目</div>';
    return;
  }
  images.forEach((image, index) => {
    const card = document.createElement("div");
    card.className = "image-card";
    card.innerHTML = `
      <img src="${image.dataUrl}" alt="题目图片 ${index + 1}" />
      <div class="image-card-footer"><span>第 ${image.page} 页 · 图片 ${index + 1}</span><button type="button" class="remove-image" data-index="${index}" aria-label="删除图片">移除</button></div>`;
    elements.imageList.append(card);
  });
  elements.imageList.querySelectorAll(".remove-image").forEach((button) => {
    button.addEventListener("click", () => {
      activeQuestion().images.splice(Number(button.dataset.index), 1);
      renderImages();
    });
  });
}

function setDraftField(field, value) {
  const question = activeQuestion();
  if (question) question[field] = value;
  if (field === "type") elements.optionsField.hidden = value === "judge";
}

function addOption() {
  const question = activeQuestion();
  let keyCode = 65;
  while (question.options.some((option) => option.key === String.fromCharCode(keyCode)) && keyCode <= 90) {
    keyCode += 1;
  }
  if (keyCode > 90) {
    showToast("单题最多支持 26 个选项");
    return;
  }
  const key = String.fromCharCode(keyCode);
  question.options.push({ key, content: "" });
  renderOptions(question.options);
  const inputs = elements.optionList.querySelectorAll(".option-input");
  inputs[inputs.length - 1]?.focus();
}

function saveQuestion() {
  const question = activeQuestion();
  question.title = elements.questionTitle.value.trim();
  question.answer = elements.questionAnswer.value.trim();
  question.explanation = elements.questionExplanation.value.trim();
  question.type = elements.questionType.value;
  if (!question.title) {
    showToast("请先填写题干");
    elements.questionTitle.focus();
    return;
  }
  if (!question.answer) {
    showToast("请填写正确答案");
    elements.questionAnswer.focus();
    return;
  }
  if (question.type !== "judge" && !question.options.some((option) => option.content.trim())) {
    showToast("请至少填写一个选项");
    return;
  }

  if (!state.activeId) {
    question.id = crypto.randomUUID();
    state.questions.push(question);
    state.activeId = question.id;
  }
  elements.saveStatus.textContent = "已暂存在本机 · 可继续校对";
  renderQuestionList();
  renderImages();
  updateButtons();
  showToast("题目已保存到当前页面");
}

function startNewQuestion() {
  if (!state.activeId && hasUnsavedDraft() && !window.confirm("当前新题目还没保存，确定放弃它并新建题目吗？")) {
    return;
  }
  state.activeId = null;
  state.draft = newQuestion();
  loadQuestion(state.draft);
  elements.questionTitle.focus();
}

function cropCoordinates(event) {
  const rect = elements.cropLayer.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
    y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
  };
}

function updateCropRect(endPoint) {
  const start = state.cropStart;
  if (!start) return;
  const left = Math.min(start.x, endPoint.x);
  const top = Math.min(start.y, endPoint.y);
  const width = Math.abs(endPoint.x - start.x);
  const height = Math.abs(endPoint.y - start.y);
  state.cropRect = { left, top, width, height };
  elements.cropLayer.style.setProperty("--crop-left", `${left}px`);
  elements.cropLayer.style.setProperty("--crop-top", `${top}px`);
  elements.cropLayer.style.setProperty("--crop-width", `${width}px`);
  elements.cropLayer.style.setProperty("--crop-height", `${height}px`);
  elements.cropLayer.classList.toggle("has-selection", width > 4 && height > 4);
  updateButtons();
}

function clearCrop() {
  state.cropStart = null;
  state.cropRect = null;
  elements.cropLayer.classList.remove("dragging", "has-selection");
  elements.cropLayer.style.removeProperty("--crop-left");
  elements.cropLayer.style.removeProperty("--crop-top");
  elements.cropLayer.style.removeProperty("--crop-width");
  elements.cropLayer.style.removeProperty("--crop-height");
  updateButtons();
}

function saveCrop() {
  const rect = state.cropRect;
  if (!rect || !state.pdf || rect.width < 12 || rect.height < 12) {
    clearCrop();
    return;
  }
  const bounds = elements.canvas.getBoundingClientRect();
  const ratioX = elements.canvas.width / bounds.width;
  const ratioY = elements.canvas.height / bounds.height;
  const sourceX = Math.max(0, Math.floor(rect.left * ratioX));
  const sourceY = Math.max(0, Math.floor(rect.top * ratioY));
  const sourceWidth = Math.min(elements.canvas.width - sourceX, Math.ceil(rect.width * ratioX));
  const sourceHeight = Math.min(elements.canvas.height - sourceY, Math.ceil(rect.height * ratioY));
  const crop = document.createElement("canvas");
  crop.width = sourceWidth;
  crop.height = sourceHeight;
  crop.getContext("2d").drawImage(
    elements.canvas,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight,
  );
  activeQuestion().images.push({ page: state.page, dataUrl: crop.toDataURL("image/png") });
  clearCrop();
  renderImages();
  showToast("页面截图已添加到当前题目");
}

function renderOcrStatus(message) {
  elements.pageHint.textContent = message;
}

function formatElapsed(ms) {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)} 毫秒`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} 秒`;
  return formatElapsed(ms);
}

function renderOcrLog() {
  const { logs } = state.ocrRun;
  elements.ocrLog.innerHTML = "";
  if (!logs.length) {
    elements.ocrLog.innerHTML = '<div class="ocr-log-empty">运行 OCR 后会记录模型加载、PDF 渲染和识别耗时。</div>';
  } else {
    logs.slice(-12).forEach((entry) => {
      const row = document.createElement("div");
      row.className = `ocr-log-entry${entry.error ? " error" : ""}`;
      const time = document.createElement("span");
      time.className = "ocr-log-time";
      time.textContent = entry.time;
      const message = document.createElement("span");
      message.className = "ocr-log-message";
      message.textContent = entry.message;
      row.append(time, message);
      elements.ocrLog.append(row);
    });
    elements.ocrLog.scrollTop = elements.ocrLog.scrollHeight;
  }
  elements.copyOcrLog.disabled = logs.length === 0;
}

function addOcrLog(message, { error = false, consoleLog = true } = {}) {
  const elapsed = formatElapsed(performance.now() - state.ocrRun.startedAt);
  state.ocrRun.logs.push({ time: elapsed, message, error });
  if (state.ocrRun.logs.length > 80) state.ocrRun.logs.shift();
  renderOcrLog();
  if (consoleLog) {
    (error ? console.error : console.info)(`[OCR +${elapsed}] ${message}`);
  }
}

function setOcrPhase(phase, { log = true } = {}) {
  state.ocrRun.phase = phase;
  state.ocrRun.lastEventAt = performance.now();
  elements.ocrStatus.textContent = phase;
  elements.ocrPhase.textContent = state.ocrRun.active ? `当前阶段：${phase}` : phase;
  elements.ocrStateDot.classList.toggle("active", state.ocrRun.active);
  if (state.busy) setBusy(true, phase);
  if (log) addOcrLog(phase);
}

function setOcrProgress(progress) {
  const value = Math.max(0, Math.min(100, Math.round(progress)));
  state.ocrRun.progress = value;
  elements.ocrProgress.style.width = `${value}%`;
  elements.ocrProgress.classList.toggle("indeterminate", value === 0 && state.ocrRun.active);
}

function startOcrMonitor() {
  clearInterval(state.ocrRun.timer);
  Object.assign(state.ocrRun, {
    active: true,
    startedAt: performance.now(),
    lastEventAt: performance.now(),
    lastHeartbeatAt: performance.now(),
    phase: "",
    progress: 0,
    logs: [],
    lastLoggedStatus: "",
    lastLoggedProgress: -1,
  });
  setOcrProgress(0);
  renderOcrLog();
  elements.ocrElapsed.textContent = "00:00";
  elements.ocrStateDot.classList.add("active");
  state.ocrRun.timer = setInterval(() => {
    const now = performance.now();
    elements.ocrElapsed.textContent = formatElapsed(now - state.ocrRun.startedAt);
    if (
      now - state.ocrRun.lastEventAt >= 15000 &&
      now - state.ocrRun.lastHeartbeatAt >= 30000
    ) {
      state.ocrRun.lastHeartbeatAt = now;
      addOcrLog(`已等待 ${formatElapsed(now - state.ocrRun.startedAt)}；“${state.ocrRun.phase}”尚无新进度，任务仍在等待返回。`, {
        consoleLog: false,
      });
      elements.ocrStatus.textContent = `等待响应 · ${state.ocrRun.phase}`;
    }
  }, 1000);
}

function stopOcrMonitor(finalStatus, { error = false } = {}) {
  clearInterval(state.ocrRun.timer);
  state.ocrRun.timer = null;
  state.ocrRun.active = false;
  const elapsed = formatElapsed(performance.now() - state.ocrRun.startedAt);
  elements.ocrElapsed.textContent = elapsed;
  elements.ocrStatus.textContent = finalStatus;
  elements.ocrPhase.textContent = `本次耗时 ${elapsed}`;
  elements.ocrStateDot.classList.remove("active");
  elements.ocrStateDot.classList.toggle("error", error);
  elements.ocrProgress.classList.remove("indeterminate");
  if (!error) setOcrProgress(100);
  renderOcrLog();
}

async function copyOcrLog() {
  if (!state.ocrRun.logs.length) return;
  const text = state.ocrRun.logs.map((entry) => `[+${entry.time}] ${entry.message}`).join("\n");
  try {
    await navigator.clipboard.writeText(text);
    showToast("OCR 运行日志已复制");
  } catch (error) {
    console.error("[OCR] 复制日志失败", error);
    showToast("复制失败，请确认浏览器允许访问剪贴板");
  }
}

function handleTesseractLog(message, pageNumber) {
  const statusLabels = {
    "loading tesseract core": "加载 OCR 引擎核心",
    "initializing tesseract": "初始化 OCR 引擎",
    "loading language traineddata": "加载简体中文模型",
    "initializing api": "初始化中文识别器",
    "recognizing text": `识别第 ${pageNumber} 页文字`,
  };
  const label = statusLabels[message.status] || `OCR：${message.status}`;
  const percent = Number.isFinite(message.progress) ? Math.round(message.progress * 100) : 0;
  const changedStatus = message.status !== state.ocrRun.lastLoggedStatus;
  const meaningfulProgress =
    message.status === "recognizing text" &&
    (percent === 100 || percent >= state.ocrRun.lastLoggedProgress + 10);

  if (changedStatus || meaningfulProgress) {
    state.ocrRun.lastLoggedStatus = message.status;
    if (message.status === "recognizing text") state.ocrRun.lastLoggedProgress = percent;
    setOcrPhase(meaningfulProgress ? `${label} · ${percent}%` : label);
  } else {
    state.ocrRun.lastEventAt = performance.now();
  }

  if (message.status === "recognizing text") setOcrProgress(percent);
}

async function runOcr() {
  if (!state.pdf || state.busy) return;
  const pageNumber = state.page;
  let failed = false;
  startOcrMonitor();
  try {
    setBusy(true, "正在准备中文 OCR…");
    renderOcrStatus("首次识别会在本机加载中文模型，请稍候…");
    if (!state.worker) {
      const engineStartedAt = performance.now();
      setOcrPhase("准备 OCR 引擎与简体中文模型");
      state.worker = await createWorker("chi_sim", OEM.LSTM_ONLY, {
        workerPath: tesseractWorkerUrl,
        corePath: tesseractCoreUrl,
        langPath: `${import.meta.env.BASE_URL}tessdata`,
        gzip: true,
        cacheMethod: "write",
        logger: (message) => handleTesseractLog(message, pageNumber),
      });
      addOcrLog(`OCR 引擎与模型就绪，用时 ${formatDuration(performance.now() - engineStartedAt)}。`);
      await state.worker.setParameters({ preserve_interword_spaces: "1" });
    } else {
      setOcrPhase("复用已加载的 OCR 引擎");
    }

    setOcrPhase(`准备第 ${pageNumber} 页 PDF 页面`);
    const pageStartedAt = performance.now();
    const page = await state.pdf.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const ocrCanvas = document.createElement("canvas");
    const ocrScale = Math.min(2.5, Math.max(1.8, 1800 / baseViewport.width));
    const viewport = page.getViewport({ scale: ocrScale });
    ocrCanvas.width = Math.ceil(viewport.width);
    ocrCanvas.height = Math.ceil(viewport.height);
    setOcrPhase(`渲染 PDF 页面 · ${ocrCanvas.width} × ${ocrCanvas.height}`);
    await page.render({ canvas: ocrCanvas, viewport }).promise;
    addOcrLog(`PDF 页面渲染完成，用时 ${formatDuration(performance.now() - pageStartedAt)}。`);

    const recognitionStartedAt = performance.now();
    state.ocrRun.lastLoggedProgress = -1;
    state.ocrRun.lastLoggedStatus = "";
    setOcrProgress(0);
    setOcrPhase(`开始识别第 ${pageNumber} 页`);
    setBusy(true, `正在识别第 ${pageNumber} 页…`);
    const { data } = await state.worker.recognize(ocrCanvas);
    addOcrLog(`文字识别返回，用时 ${formatDuration(performance.now() - recognitionStartedAt)}。`);
    const text = data.text.trim();
    if (!text) {
      setOcrPhase("识别结束：本页没有提取到文字");
      renderOcrStatus(`第 ${pageNumber} 页没有提取到文字；请检查页面内容与扫描清晰度`);
      showToast("本页没有识别出文字；扫描质量或页面方向可能影响结果");
      return;
    }
    const existing = elements.questionTitle.value.trim();
    const replacement = existing
      ? window.confirm("将 OCR 结果追加到当前题干？选择“取消”会替换题干。")
        ? `${existing}\n${text}`
        : text
      : text;
    elements.questionTitle.value = replacement;
    setDraftField("title", replacement);
    elements.pageHint.textContent = `第 ${pageNumber} 页识别完成 · ${text.length} 个字符，请人工校对`;
    setOcrPhase(`识别完成 · ${text.length} 个字符`);
    showToast(`识别完成，提取约 ${text.length} 个字符`);
  } catch (error) {
    failed = true;
    console.error("[OCR] 识别失败", error?.stack || String(error));
    addOcrLog(`识别失败：${error.message || String(error)}`, { error });
    renderOcrStatus("OCR 失败，请检查模型文件和本机浏览器控制台");
    showToast(`OCR 失败：${error.message || "请重试"}`);
  } finally {
    stopOcrMonitor(failed ? "OCR 失败" : elements.ocrStatus.textContent, { error: failed });
    setBusy(false);
  }
}

function exportBank() {
  if (!state.questions.length) return;
  const bank = {
    format: "local-chemistry-question-bank-v1",
    name: state.fileName.replace(/\.pdf$/i, "") || "化学题库",
    desc: "由本地 PDF 题目整理工具导出；图片为 data URL。",
    questions: state.questions.map((question) => ({
      type: question.type,
      title: question.title,
      options: question.type === "judge" ? [] : question.options
        .filter((option) => option.content.trim())
        .map((option) => ({ ...option })),
      answer: question.answer.split(/[,，、\s]+/).filter(Boolean),
      explanation: question.explanation,
      images: question.images.map((image) => ({ ...image })),
    })),
  };
  const blob = new Blob([JSON.stringify(bank, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${bank.name || "化学题库"}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("题库 JSON 已导出到下载目录");
}

elements.input.addEventListener("change", (event) => {
  const [file] = event.target.files || [];
  if (file) openPdf(file);
  event.target.value = "";
});
elements.prevPage.addEventListener("click", () => goToPage(state.page - 1));
elements.nextPage.addEventListener("click", () => goToPage(state.page + 1));
elements.zoomIn.addEventListener("click", () => {
  state.zoom = Math.min(2.5, Number((state.zoom + 0.15).toFixed(2)));
  goToPage(state.page);
});
elements.zoomOut.addEventListener("click", () => {
  state.zoom = Math.max(0.75, Number((state.zoom - 0.15).toFixed(2)));
  goToPage(state.page);
});
elements.clearCrop.addEventListener("click", clearCrop);
elements.cropLayer.addEventListener("pointerdown", (event) => {
  if (!state.pdf || state.busy) return;
  state.cropStart = cropCoordinates(event);
  elements.cropLayer.classList.add("dragging");
  elements.cropLayer.setPointerCapture(event.pointerId);
  updateCropRect(state.cropStart);
});
elements.cropLayer.addEventListener("pointermove", (event) => {
  if (state.cropStart) updateCropRect(cropCoordinates(event));
});
elements.cropLayer.addEventListener("pointerup", (event) => {
  if (!state.cropStart) return;
  updateCropRect(cropCoordinates(event));
  elements.cropLayer.classList.remove("dragging");
  state.cropStart = null;
  saveCrop();
});
elements.cropLayer.addEventListener("pointercancel", clearCrop);
elements.runOcr.addEventListener("click", runOcr);
elements.copyOcrLog.addEventListener("click", copyOcrLog);
elements.questionType.addEventListener("change", () => setDraftField("type", elements.questionType.value));
elements.questionTitle.addEventListener("input", () => setDraftField("title", elements.questionTitle.value));
elements.questionAnswer.addEventListener("input", () => setDraftField("answer", elements.questionAnswer.value));
elements.questionExplanation.addEventListener("input", () => setDraftField("explanation", elements.questionExplanation.value));
elements.addOption.addEventListener("click", addOption);
elements.saveQuestion.addEventListener("click", saveQuestion);
elements.newQuestion.addEventListener("click", startNewQuestion);
elements.exportJson.addEventListener("click", exportBank);
window.addEventListener("beforeunload", () => {
  if (state.worker) state.worker.terminate();
  if (state.pdf) state.pdf.destroy();
});

renderOptions(state.draft.options);
loadQuestion(state.draft);
updateButtons();
