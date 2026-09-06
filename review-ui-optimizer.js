const STORAGE_KEY = "fe-awakening-reviewer:review-progress:v2";
const naturalRank = new Map();
let nextRank = 0;
let sorting = false;
let sortQueued = false;

const fileSelect = document.querySelector("#file-select");
const entryButtons = document.querySelector("#entry-buttons");
const completeEntry = document.querySelector("#complete-entry");

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

function sortReviewedToBottom() {
  sortQueued = false;
  if (!fileSelect || sorting) return;
  const options = [...fileSelect.options];
  rememberNaturalOrder(options);
  if (options.length <= 2) return;

  const placeholder = options.find((option) => !option.value) || null;
  const items = options.filter((option) => option.value);
  const sorted = [...items].sort((left, right) => {
    const completeDelta = Number(isCompleteOption(left)) - Number(isCompleteOption(right));
    if (completeDelta) return completeDelta;
    return (naturalRank.get(left.value) ?? Number.MAX_SAFE_INTEGER) - (naturalRank.get(right.value) ?? Number.MAX_SAFE_INTEGER);
  });
  const target = placeholder ? [placeholder, ...sorted] : sorted;
  if (target.every((option, index) => option === options[index])) return;

  const selected = fileSelect.value;
  sorting = true;
  for (const option of target) fileSelect.append(option);
  fileSelect.value = selected;
  queueMicrotask(() => { sorting = false; });
}

function queueSort() {
  if (sortQueued) return;
  sortQueued = true;
  requestAnimationFrame(sortReviewedToBottom);
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

queueMicrotask(() => {
  syncActiveReviewControls();
  queueSort();
});
