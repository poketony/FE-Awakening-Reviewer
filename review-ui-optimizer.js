import { GitHubClient } from "./lib/github.js";
import { parseProgress, mergeProgress, serializeProgress } from "./lib/review-progress.js";

const STORAGE_KEY = "fe-awakening-reviewer:review-progress:v2";
const REMOTE_PROGRESS_PATH = "Awakening/review-progress.json";
const refreshClient = new GitHubClient({ owner: "poketony", repo: "FE-Awakening" });
const naturalRank = new Map();
let nextRank = 0;
let sorting = false;
let sortQueued = false;
let refreshBusy = false;
let lastRemoteCheck = 0;

const fileSelect = document.querySelector("#file-select");
const entryButtons = document.querySelector("#entry-buttons");
const completeEntry = document.querySelector("#complete-entry");
let nextFileButton = null;

function normalizePath(path) {
  return String(path || "").replaceAll("\\", "/").replace(/^\.\//u, "").toLocaleLowerCase();
}

function currentStatus() {
  const path = fileSelect?.value || "";
  const active = entryButtons?.querySelector(".entry-button.active");
  const key = active?.dataset.reviewKey || "";
  const eligible = active?.dataset.reviewEligible !== "false" && Boolean(path && key);
  if (!eligible) return { eligible: false, status: "unreviewed" };
  try {
    const progress = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const id = `${normalizePath(path)}\u0000${key}`;
    return { eligible: true, status: progress?.entries?.[id]?.status || "unreviewed" };
  } catch {
    return { eligible: true, status: "unreviewed" };
  }
}

function syncActiveReviewControls() {
  const { eligible, status } = currentStatus();
  const select = document.querySelector("#review-status-select");
  if (select) {
    select.disabled = !eligible;
    select.value = status;
  }
  if (completeEntry) {
    completeEntry.disabled = !eligible;
    completeEntry.classList.toggle("completed", status === "approved");
    completeEntry.textContent = status === "approved" ? "✓ 확인 완료 · 취소" : "✓ 확인 완료";
  }
  syncNextFileButton();
}

function isCompleteOption(option) {
  return /^✓ 완료 · /u.test(option.textContent || "");
}

function rememberNaturalOrder(options) {
  for (const option of options) {
    if (!option.value || naturalRank.has(option.value)) continue;
    naturalRank.set(option.value, nextRank++);
  }
}

function nextIncompleteOption() {
  if (!fileSelect) return null;
  const options = [...fileSelect.options].filter((option) => option.value);
  rememberNaturalOrder(options);
  const currentValue = fileSelect.value;
  const currentRank = naturalRank.get(currentValue) ?? -1;
  const candidates = options
    .filter((option) => option.value !== currentValue && !isCompleteOption(option))
    .sort((left, right) => (naturalRank.get(left.value) ?? Number.MAX_SAFE_INTEGER) - (naturalRank.get(right.value) ?? Number.MAX_SAFE_INTEGER));
  if (!candidates.length) return null;
  return candidates.find((option) => (naturalRank.get(option.value) ?? -1) > currentRank) || candidates[0];
}

function syncNextFileButton() {
  if (!nextFileButton) return;
  const next = nextIncompleteOption();
  nextFileButton.disabled = !next;
  nextFileButton.textContent = next ? "다음 미완료 회화 →" : "남은 미완료 회화 없음";
}

function goToNextIncomplete() {
  const next = nextIncompleteOption();
  if (!next || !fileSelect) return;
  fileSelect.value = next.value;
  fileSelect.dispatchEvent(new Event("change", { bubbles: true }));
  requestAnimationFrame(() => {
    document.querySelector(".japanese-scene")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function ensureNextFileButton() {
  if (nextFileButton || !completeEntry) return;
  nextFileButton = document.createElement("button");
  nextFileButton.id = "next-review-file";
  nextFileButton.type = "button";
  nextFileButton.className = "primary next-review-file";
  nextFileButton.textContent = "다음 미완료 회화 →";
  nextFileButton.addEventListener("click", goToNextIncomplete);

  const anchor = completeEntry.closest(".synced-review-row") || completeEntry;
  anchor.insertAdjacentElement("afterend", nextFileButton);

  if (!document.querySelector("#next-review-file-style")) {
    const style = document.createElement("style");
    style.id = "next-review-file-style";
    style.textContent = `
      .next-review-file{width:100%;margin-top:.55rem;min-height:50px;font-weight:800}
      .next-review-file:disabled{background:#242129;border-color:var(--line);color:var(--muted)}
    `;
    document.head.append(style);
  }
  syncNextFileButton();
}

function sortReviewedToBottom() {
  sortQueued = false;
  if (!fileSelect || sorting) return;
  const options = [...fileSelect.options];
  rememberNaturalOrder(options);
  if (options.length <= 2) {
    syncNextFileButton();
    return;
  }

  const placeholder = options.find((option) => !option.value) || null;
  const items = options.filter((option) => option.value);
  const sorted = [...items].sort((left, right) => {
    const completeDelta = Number(isCompleteOption(left)) - Number(isCompleteOption(right));
    if (completeDelta) return completeDelta;
    return (naturalRank.get(left.value) ?? Number.MAX_SAFE_INTEGER) - (naturalRank.get(right.value) ?? Number.MAX_SAFE_INTEGER);
  });
  const target = placeholder ? [placeholder, ...sorted] : sorted;
  if (target.every((option, index) => option === options[index])) {
    syncNextFileButton();
    return;
  }

  const selected = fileSelect.value;
  sorting = true;
  for (const option of target) fileSelect.append(option);
  fileSelect.value = selected;
  queueMicrotask(() => {
    sorting = false;
    syncNextFileButton();
  });
}

function queueSort() {
  if (sortQueued) return;
  sortQueued = true;
  requestAnimationFrame(sortReviewedToBottom);
}

function showRemoteToast(message) {
  const toast = document.querySelector("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.dataset.type = "ok";
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2600);
}

async function refreshRemoteProgress() {
  const now = Date.now();
  if (refreshBusy || now - lastRemoteCheck < 3000) return;
  refreshBusy = true;
  lastRemoteCheck = now;
  try {
    const tree = await refreshClient.getTree("main");
    const descriptor = tree.find((entry) => entry.path === REMOTE_PROGRESS_PATH);
    if (!descriptor) return;
    const remote = parseProgress(await refreshClient.getBlobText(descriptor.sha));
    const local = parseProgress(localStorage.getItem(STORAGE_KEY));
    const merged = mergeProgress(remote, local);
    const before = serializeProgress(local);
    const after = serializeProgress(merged);
    if (before === after) return;
    localStorage.setItem(STORAGE_KEY, after);

    const save = document.querySelector("#save");
    const hasUnsavedEditor = Boolean(save && !save.disabled);
    if (hasUnsavedEditor) {
      showRemoteToast("PC 검수 기록을 받았습니다. 현재 수정 저장 후 새로고침하면 반영됩니다.");
      return;
    }
    location.reload();
  } catch {
    // 네트워크가 없거나 GitHub가 일시적으로 실패해도 모바일 검수는 로컬에서 계속한다.
  } finally {
    refreshBusy = false;
  }
}

document.addEventListener("reviewer:active-entry-changed", syncActiveReviewControls);

if (fileSelect) {
  const observer = new MutationObserver(() => {
    if (!sorting) queueSort();
  });
  observer.observe(fileSelect, { childList: true, characterData: true, subtree: true });
  fileSelect.addEventListener("change", () => {
    queueMicrotask(syncActiveReviewControls);
    queueSort();
  });
}

window.addEventListener("focus", () => { void refreshRemoteProgress(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void refreshRemoteProgress();
});

queueMicrotask(() => {
  ensureNextFileButton();
  syncActiveReviewControls();
  queueSort();
});
