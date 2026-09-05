import {
  parseProgress, rememberCatalog, rememberExpected, setEntryDone,
  isEntryDone, fileProgress, modeProgress, completedToday, progressMessage,
} from "./lib/review-progress.js";

const STORAGE_KEY = "fe-awakening-reviewer:review-progress:v1";
const PREFIX_RE = /^(?:✓ 완료|◐ 진행|○ 미완료) · /u;
let progress = parseProgress(localStorage.getItem(STORAGE_KEY));
let decorating = false;

const $ = (selector) => document.querySelector(selector);
const els = {
  mainTab: $("#main-tab"), dlcTab: $("#dlc-tab"), search: $("#search"), fileSelect: $("#file-select"),
  includeVariants: $("#include-variants"), entryButtons: $("#entry-buttons"), sourcePath: $("#source-path"),
  completeEntry: $("#complete-entry"), controlState: $("#control-state"), save: $("#save"),
  progressMode: $("#progress-mode"), progressPercent: $("#progress-percent"), progressCount: $("#progress-count"),
  progressFill: $("#progress-fill"), progressMessage: $("#progress-message"), progressToday: $("#progress-today"),
  fileState: $("#review-file-state"), toast: $("#toast"),
};

function currentMode() {
  return els.dlcTab?.classList.contains("active") ? "dlc" : "main";
}

function currentFileId() {
  return els.fileSelect?.value || "";
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

function cleanLabel(value) {
  return String(value || "").replace(PREFIX_RE, "").replace(/^✓\s+/u, "").trim();
}

function currentEntryKey() {
  const buttons = [...(els.entryButtons?.querySelectorAll(".entry-button") || [])];
  const active = buttons.find((button) => button.classList.contains("active"));
  return active ? (active.dataset.reviewBase || cleanLabel(active.textContent)) : "";
}

function showToast(message, type = "ok") {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.dataset.type = type;
  els.toast.classList.add("show");
  setTimeout(() => els.toast.classList.remove("show"), 2400);
}

function snapshotCatalog() {
  if (!els.fileSelect || els.search?.value.trim()) return;
  const ids = [...els.fileSelect.options].map((option) => option.value).filter(Boolean);
  if (!ids.length) return;
  rememberCatalog(progress, currentMode(), ids);
  persist();
}

function snapshotEntries() {
  const fileId = currentFileId();
  if (!fileId || !els.entryButtons || els.includeVariants?.checked) return;
  const labels = [...els.entryButtons.querySelectorAll(".entry-button")]
    .map((button) => button.dataset.reviewBase || cleanLabel(button.textContent))
    .filter(Boolean);
  if (!labels.length) return;
  rememberExpected(progress, { mode: currentMode(), fileId, labels });
  persist();
}

function decorateFileSelect() {
  if (!els.fileSelect) return;
  for (const option of els.fileSelect.options) {
    if (!option.value) continue;
    const base = option.dataset.reviewBase || cleanLabel(option.textContent);
    option.dataset.reviewBase = base;
    const state = fileProgress(progress, option.value).state;
    const prefix = state === "complete" ? "✓ 완료" : state === "progress" ? "◐ 진행" : "○ 미완료";
    const next = `${prefix} · ${base}`;
    if (option.textContent !== next) option.textContent = next;
  }
}

function decorateEntryButtons() {
  const fileId = currentFileId();
  if (!fileId || !els.entryButtons) return;
  for (const button of els.entryButtons.querySelectorAll(".entry-button")) {
    const base = button.dataset.reviewBase || cleanLabel(button.textContent);
    button.dataset.reviewBase = base;
    const done = isEntryDone(progress, fileId, base);
    button.classList.toggle("reviewed", done);
    button.textContent = done ? `✓ ${base}` : base;
  }
}

function renderCurrentFileState() {
  const fileId = currentFileId();
  if (!els.fileState) return;
  const result = fileProgress(progress, fileId);
  els.fileState.dataset.state = result.state;
  els.fileState.textContent = result.state === "complete"
    ? "✓ 검수 완료"
    : result.state === "progress"
      ? `◐ 진행 중${result.expected ? ` · ${result.done}/${result.expected}` : ""}`
      : "○ 미완료";

  if (!els.completeEntry) return;
  const entryKey = currentEntryKey();
  const done = Boolean(fileId && entryKey && isEntryDone(progress, fileId, entryKey));
  els.completeEntry.disabled = !fileId || !entryKey;
  els.completeEntry.classList.toggle("completed", done);
  els.completeEntry.textContent = done ? "✓ 이 단계 검수 완료 · 취소" : "✓ 이 단계 검수 완료";
}

function renderProgress() {
  const mode = currentMode();
  const result = modeProgress(progress, mode);
  if (els.progressMode) els.progressMode.textContent = mode === "dlc" ? "DLC" : "본편";
  if (els.progressPercent) els.progressPercent.textContent = result.total ? `${result.percent}%` : "—";
  if (els.progressCount) {
    els.progressCount.textContent = result.total
      ? `완료 ${result.complete}/${result.total} · 진행 중 ${result.inProgress}`
      : "회화 목록 불러오는 중";
  }
  if (els.progressFill) els.progressFill.style.width = `${Math.max(0, Math.min(100, result.percent))}%`;
  if (els.progressMessage) els.progressMessage.textContent = progressMessage(result.percent);
  if (els.progressToday) els.progressToday.textContent = `오늘 완료 체크 ${completedToday(progress)}개`;
}

function renderAll() {
  if (decorating) return;
  decorating = true;
  try {
    snapshotCatalog();
    snapshotEntries();
    decorateFileSelect();
    decorateEntryButtons();
    renderCurrentFileState();
    renderProgress();
  } finally {
    decorating = false;
  }
}

function toggleCurrentEntry() {
  const mode = currentMode();
  const fileId = currentFileId();
  const entryKey = currentEntryKey();
  if (!fileId || !entryKey) return;

  if (els.controlState?.dataset.state === "error") {
    showToast("입력 오류를 먼저 수정한 뒤 완료로 표시하세요.", "error");
    return;
  }

  if (els.save && !els.save.disabled) els.save.click();

  const wasFileComplete = fileProgress(progress, fileId).state === "complete";
  const nextDone = !isEntryDone(progress, fileId, entryKey);
  setEntryDone(progress, { mode, fileId, entryKey, done: nextDone });
  persist();
  renderAll();

  const nowFile = fileProgress(progress, fileId);
  const modeNow = modeProgress(progress, mode);
  if (nextDone && !wasFileComplete && nowFile.state === "complete") {
    showToast(`회화 하나 완료. ${modeNow.percent}%까지 왔다.`, "ok");
  } else {
    showToast(nextDone ? `${entryKey} 검수 완료로 표시했습니다.` : `${entryKey} 완료 표시를 취소했습니다.`, nextDone ? "ok" : "info");
  }
}

els.completeEntry?.addEventListener("click", toggleCurrentEntry);
for (const element of [els.mainTab, els.dlcTab]) element?.addEventListener("click", () => setTimeout(renderAll, 0));
els.search?.addEventListener("input", () => setTimeout(renderAll, 0));
els.fileSelect?.addEventListener("change", () => setTimeout(renderAll, 0));
els.includeVariants?.addEventListener("change", () => setTimeout(renderAll, 0));

const selectObserver = new MutationObserver(() => { if (!decorating) queueMicrotask(renderAll); });
if (els.fileSelect) selectObserver.observe(els.fileSelect, { childList: true });
const entryObserver = new MutationObserver(() => { if (!decorating) queueMicrotask(renderAll); });
if (els.entryButtons) entryObserver.observe(els.entryButtons, { childList: true, subtree: true });

renderAll();
