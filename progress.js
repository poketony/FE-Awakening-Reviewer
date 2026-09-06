import { GitHubClient } from "./lib/github.js";
import {
  emptyProgress, parseProgress, mergeProgress, registerFile, setReviewStatus, getReviewStatus,
  fileProgress, summarizeMode, completedToday, progressMessage, serializeProgress,
} from "./lib/review-progress.js";
import {
  parseMessageDocument, parseNameMap, isMainSupportEntry, extractDlcCharacters, entryLabel,
} from "./lib/message-format.js";

const OWNER = "poketony";
const REPO = "FE-Awakening";
const BASE_BRANCH = "main";
const PROGRESS_PATH = "Awakening/review-progress.json";
const STORAGE_KEY = "fe-awakening-reviewer:review-progress:v2";
const LEGACY_KEY = "fe-awakening-reviewer:review-progress:v1";
const DRAFT_KEY = "fe-awakening-reviewer:drafts:v1";
const client = new GitHubClient({ owner: OWNER, repo: REPO });

let progress = parseProgress(localStorage.getItem(STORAGE_KEY));
let remoteBaseline = emptyProgress();
let treeByPath = new Map();
let names = new Map();
let namesReady = false;
let mappingRevision = 0;
let renderGuard = false;
let publishGuard = false;
const catalogPaths = { main: [], dlc: [] };
const catalogReady = { main: false, dlc: false };

const $ = (selector) => document.querySelector(selector);
const els = {
  mainTab: $("#main-tab"), dlcTab: $("#dlc-tab"), search: $("#search"), fileSelect: $("#file-select"),
  includeVariants: $("#include-variants"), entryButtons: $("#entry-buttons"), sourcePath: $("#source-path"),
  completeEntry: $("#complete-entry"), controlState: $("#control-state"), save: $("#save"),
  progressMode: $("#progress-mode"), progressPercent: $("#progress-percent"), progressCount: $("#progress-count"),
  progressFill: $("#progress-fill"), progressMessage: $("#progress-message"), progressToday: $("#progress-today"),
  fileState: $("#review-file-state"), toast: $("#toast"), token: $("#token"), publish: $("#publish"),
  pendingCount: $("#pending-count"), prResult: $("#pr-result"), status: $("#status"),
};

function currentMode() {
  return els.dlcTab?.classList.contains("active") ? "dlc" : "main";
}

function currentFilePath() {
  return els.fileSelect?.value || "";
}

function readDrafts() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}"); } catch { return {}; }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, serializeProgress(progress));
}

function formatPercent(value) {
  const number = Number(value) || 0;
  return Number.isInteger(number) ? `${number}%` : `${number.toFixed(1)}%`;
}

function cleanFileLabel(value) {
  return String(value || "")
    .replace(/^(?:✓ 완료|! 수정 필요|◇ 보류|◐ 진행|○ 미완료) · /u, "")
    .replace(/^●\s+/u, "")
    .trim();
}

function cleanEntryLabel(value) {
  return String(value || "")
    .replace(/^[✓!◇]\s+/u, "")
    .replace(/^—\s+/u, "")
    .trim();
}

function showToast(message, type = "ok") {
  if (!els.toast) return;
  els.toast.textContent = message;
  els.toast.dataset.type = type;
  els.toast.classList.add("show");
  setTimeout(() => els.toast.classList.remove("show"), 2600);
}

function setTopStatus(message, tone = "muted") {
  if (!els.status) return;
  els.status.textContent = message;
  els.status.dataset.tone = tone;
}

function injectUi() {
  if (els.completeEntry && !$("#review-status-select")) {
    const row = document.createElement("div");
    row.className = "synced-review-row";
    const select = document.createElement("select");
    select.id = "review-status-select";
    select.setAttribute("aria-label", "현재 단계 검수 상태");
    for (const [value, label] of [
      ["unreviewed", "○ 미검수"], ["approved", "✓ 확인 완료"],
      ["needs_fix", "! 수정 필요"], ["deferred", "◇ 보류"],
    ]) select.add(new Option(label, value));
    els.completeEntry.parentNode.insertBefore(row, els.completeEntry);
    row.append(select, els.completeEntry);
    select.addEventListener("change", () => setCurrentStatus(select.value));
  }
  if (!$("#review-sync-style")) {
    const style = document.createElement("style");
    style.id = "review-sync-style";
    style.textContent = `
      .synced-review-row{display:grid;grid-template-columns:minmax(130px,.72fr) minmax(0,1.28fr);gap:.55rem;margin-top:.55rem}
      .synced-review-row #complete-entry{margin-top:0}
      #review-status-select{width:100%;min-height:44px;padding:.62rem .7rem;background:#0f0e13;border:1px solid var(--line);border-radius:10px;color:var(--text)}
      .entry-button.review-fix{border-color:#7d444b;color:#ffaaaa;background:#211518}
      .entry-button.review-deferred{border-color:#6e5b30;color:var(--warn);background:#2b2417}
      .entry-button.review-excluded{opacity:.62}
      @media(max-width:480px){.synced-review-row{grid-template-columns:1fr}}
    `;
    document.head.append(style);
  }
  const authCopy = document.querySelector(".auth-copy span");
  if (authCopy) authCopy.textContent = "읽기와 로컬 검수는 토큰 없이 가능합니다. GitHub에 반영할 때만 토큰이 필요합니다.";
  const pendingTitle = document.querySelector(".pending h2");
  if (pendingTitle) pendingTitle.textContent = "수정·검수 대기";
  if (els.publish) els.publish.textContent = "GitHub에 반영";
}

function statusSelect() { return $("#review-status-select"); }

async function refreshTree() {
  const tree = await client.getTree(BASE_BRANCH);
  treeByPath = new Map(tree.map((entry) => [entry.path, entry]));
  if (!namesReady) {
    const gameData = treeByPath.get("Awakening/Messages (K)/GameData.txt");
    if (gameData) {
      names = parseNameMap(await client.getBlobText(gameData.sha));
      namesReady = true;
    }
  }
  return tree;
}

async function readRemoteProgress(tree = null) {
  if (!treeByPath.size || tree) {
    if (tree) treeByPath = new Map(tree.map((entry) => [entry.path, entry]));
    else await refreshTree();
  }
  const descriptor = treeByPath.get(PROGRESS_PATH);
  if (!descriptor) return { progress: emptyProgress(), sha: null };
  const text = await client.getBlobText(descriptor.sha);
  return { progress: parseProgress(text), sha: descriptor.sha };
}

async function syncRemoteIntoLocal() {
  try {
    await refreshTree();
    const remote = await readRemoteProgress();
    progress = mergeProgress(remote.progress, progress);
    remoteBaseline = remote.progress;
    persist();
    renderAll();
  } catch (error) {
    // 검수 자체는 오프라인/일시적 API 오류에서도 계속할 수 있다.
    console.warn("공용 검수 기록을 불러오지 못했습니다.", error);
  }
}

function snapshotCatalog() {
  if (!els.fileSelect || els.search?.value.trim()) return;
  const ids = [...els.fileSelect.options].map((option) => option.value).filter(Boolean);
  if (!ids.length) return;
  const mode = currentMode();
  catalogPaths[mode] = ids;
  catalogReady[mode] = true;
}

function eligibleRows(document, mode, includeVariants) {
  if (mode === "main") {
    return document.entries
      .filter((entry) => isMainSupportEntry(entry.key, includeVariants))
      .map((entry) => ({ key: entry.key, label: entryLabel(entry.key), eligible: isMainSupportEntry(entry.key, false) }));
  }
  return document.entries
    .filter((entry) => Boolean(extractDlcCharacters(entry.key, names, includeVariants)))
    .map((entry) => ({ key: entry.key, label: entryLabel(entry.key), eligible: Boolean(extractDlcCharacters(entry.key, names, false)) }));
}

function mergeLegacyForFile(path, rows) {
  let legacy;
  try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || "null"); } catch { legacy = null; }
  const file = legacy?.files?.[path];
  if (!file?.done) return;
  const legacyProgress = emptyProgress();
  for (const [label, timestamp] of Object.entries(file.done)) {
    const normalized = String(label).normalize("NFKC");
    const row = rows.find((candidate) => candidate.eligible && candidate.label.normalize("NFKC") === normalized);
    if (!row) continue;
    setReviewStatus(legacyProgress, {
      path,
      entryKey: row.key,
      status: "approved",
      at: typeof timestamp === "string" ? timestamp : new Date(0).toISOString(),
    });
  }
  progress = mergeProgress(progress, legacyProgress);
}

async function mapCurrentEntries() {
  const revision = ++mappingRevision;
  const path = currentFilePath();
  if (!path || !els.entryButtons) {
    renderAll();
    return;
  }
  try {
    if (!treeByPath.size || !treeByPath.has(path)) await refreshTree();
    const descriptor = treeByPath.get(path);
    if (!descriptor) return;
    if (currentMode() === "dlc" && !namesReady) await refreshTree();
    const document = parseMessageDocument(await client.getBlobText(descriptor.sha));
    if (revision !== mappingRevision || path !== currentFilePath()) return;
    const displayRows = eligibleRows(document, currentMode(), Boolean(els.includeVariants?.checked));
    const expectedRows = eligibleRows(document, currentMode(), false).filter((row) => row.eligible);
    const buttons = [...els.entryButtons.querySelectorAll(".entry-button")];
    buttons.forEach((button, index) => {
      const row = displayRows[index];
      const base = button.dataset.reviewBase || cleanEntryLabel(button.textContent);
      button.dataset.reviewBase = base;
      if (row) {
        button.dataset.reviewKey = row.key;
        button.dataset.reviewEligible = String(row.eligible);
      } else {
        delete button.dataset.reviewKey;
        button.dataset.reviewEligible = "false";
      }
    });
    mergeLegacyForFile(path, expectedRows);
    registerFile(progress, {
      path,
      mode: currentMode(),
      expected: expectedRows.map((row) => row.key),
    });
    persist();
    renderAll();
  } catch (error) {
    console.warn("현재 파일의 MID 매핑에 실패했습니다.", error);
  }
}

function currentEntry() {
  const active = els.entryButtons?.querySelector(".entry-button.active");
  if (!active) return null;
  return {
    key: active.dataset.reviewKey || "",
    eligible: active.dataset.reviewEligible !== "false",
    label: active.dataset.reviewBase || cleanEntryLabel(active.textContent),
  };
}

function decorateFileSelect() {
  if (!els.fileSelect) return;
  const drafts = readDrafts();
  for (const option of els.fileSelect.options) {
    if (!option.value) continue;
    const base = option.dataset.reviewBase || cleanFileLabel(option.textContent);
    option.dataset.reviewBase = base;
    const result = fileProgress(progress, option.value);
    let prefix = "○ 미완료";
    if (result.state === "complete") prefix = "✓ 완료";
    else if (result.needsFix) prefix = "! 수정 필요";
    else if (result.deferred) prefix = "◇ 보류";
    else if (result.state === "progress") prefix = "◐ 진행";
    const changed = drafts[option.value] ? "● " : "";
    const nextText = `${prefix} · ${changed}${base}`;
    if (option.textContent !== nextText) option.textContent = nextText;
  }
}

function decorateEntryButtons() {
  const path = currentFilePath();
  if (!path || !els.entryButtons) return;
  for (const button of els.entryButtons.querySelectorAll(".entry-button")) {
    const base = button.dataset.reviewBase || cleanEntryLabel(button.textContent);
    button.dataset.reviewBase = base;
    const key = button.dataset.reviewKey || "";
    const eligible = button.dataset.reviewEligible !== "false" && Boolean(key);
    const status = eligible ? getReviewStatus(progress, path, key) : "unreviewed";
    button.classList.toggle("reviewed", status === "approved");
    button.classList.toggle("review-fix", status === "needs_fix");
    button.classList.toggle("review-deferred", status === "deferred");
    button.classList.toggle("review-excluded", !eligible);
    const prefix = status === "approved" ? "✓ " : status === "needs_fix" ? "! " : status === "deferred" ? "◇ " : !eligible ? "— " : "";
    const nextText = `${prefix}${base}`;
    if (button.textContent !== nextText) button.textContent = nextText;
  }
}

function renderCurrentFileState() {
  const path = currentFilePath();
  const result = fileProgress(progress, path);
  if (els.fileState) {
    els.fileState.dataset.state = result.state;
    if (result.state === "complete") els.fileState.textContent = "✓ 검수 완료";
    else if (result.needsFix) els.fileState.textContent = `! 수정 필요 · ${result.needsFix}`;
    else if (result.deferred) els.fileState.textContent = `◇ 보류 · ${result.deferred}`;
    else if (result.state === "progress") els.fileState.textContent = `◐ 진행 중${result.expected ? ` · ${result.touched}/${result.expected}` : ""}`;
    else els.fileState.textContent = "○ 미완료";
  }
  const entry = currentEntry();
  const eligible = Boolean(path && entry?.key && entry.eligible);
  const status = eligible ? getReviewStatus(progress, path, entry.key) : "unreviewed";
  const select = statusSelect();
  if (select) {
    select.disabled = !eligible;
    select.value = status;
  }
  if (els.completeEntry) {
    els.completeEntry.disabled = !eligible;
    els.completeEntry.classList.toggle("completed", status === "approved");
    els.completeEntry.textContent = status === "approved" ? "✓ 확인 완료 · 취소" : "✓ 확인 완료";
  }
}

function renderProgressLoading(mode) {
  if (els.progressMode) els.progressMode.textContent = mode === "dlc" ? "DLC" : "본편";
  if (els.progressPercent) els.progressPercent.textContent = "—";
  if (els.progressCount) els.progressCount.textContent = "회화 목록 불러오는 중";
  if (els.progressFill) els.progressFill.style.width = "0%";
  if (els.progressMessage) els.progressMessage.textContent = "검수 진행도 불러오는 중…";
  if (els.progressToday) els.progressToday.textContent = "단계 기준 계산 중";
}

function renderProgress() {
  snapshotCatalog();
  const mode = currentMode();
  if (!catalogReady[mode] || !catalogPaths[mode].length) {
    renderProgressLoading(mode);
    return;
  }
  const result = summarizeMode(progress, mode, catalogPaths[mode]);
  if (els.progressMode) els.progressMode.textContent = mode === "dlc" ? "DLC" : "본편";
  if (els.progressPercent) els.progressPercent.textContent = formatPercent(result.percent);
  if (els.progressCount) {
    els.progressCount.textContent = `검수 완료 파일 ${result.complete} / ${result.total} · 진행 중 ${result.inProgress}`;
  }
  if (els.progressFill) els.progressFill.style.width = `${Math.max(0, Math.min(100, result.percent))}%`;
  if (els.progressMessage) els.progressMessage.textContent = progressMessage(result);
  if (els.progressToday) {
    const today = completedToday(progress);
    const details = result.totalEntries ? `단계 기준 ${formatPercent(result.entryPercent)}` : "단계 기준 계산 중";
    const flags = [result.needsFix ? `수정 필요 ${result.needsFix}` : "", result.deferred ? `보류 ${result.deferred}` : ""].filter(Boolean).join(" · ");
    els.progressToday.textContent = `${details} · 오늘 +${today}단계${flags ? ` · ${flags}` : ""}`;
  }
}

function entrySignature(value) {
  const parsed = parseProgress(value);
  const entries = {};
  for (const id of Object.keys(parsed.entries).sort()) entries[id] = parsed.entries[id];
  return JSON.stringify(entries);
}

function progressDirty() {
  return entrySignature(progress) !== entrySignature(remoteBaseline);
}

function renderPublishState() {
  if (!els.publish) return;
  const draftCount = Object.keys(readDrafts()).length;
  const hasProgress = progressDirty();
  if (els.publish.textContent !== "GitHub에 반영") els.publish.textContent = "GitHub에 반영";
  const shouldDisable = !draftCount && !hasProgress;
  if (els.publish.disabled !== shouldDisable) els.publish.disabled = shouldDisable;
  if (els.pendingCount) {
    const nextCount = draftCount
      ? `${draftCount}개 파일${hasProgress ? " · 검수 기록" : ""}`
      : hasProgress ? "검수 기록만" : "0개 파일";
    if (els.pendingCount.textContent !== nextCount) els.pendingCount.textContent = nextCount;
  }
}

function renderAll() {
  if (renderGuard) return;
  renderGuard = true;
  try {
    injectUi();
    snapshotCatalog();
    decorateFileSelect();
    decorateEntryButtons();
    renderCurrentFileState();
    renderProgress();
    renderPublishState();
  } finally {
    renderGuard = false;
  }
}

function setCurrentStatus(status) {
  const path = currentFilePath();
  const entry = currentEntry();
  if (!path || !entry?.key || !entry.eligible) return;
  if (status === "approved" && els.controlState?.dataset.state === "error") {
    showToast("입력 오류를 먼저 수정한 뒤 확인 완료로 표시하세요.", "error");
    renderCurrentFileState();
    return;
  }
  if (els.save && !els.save.disabled && els.controlState?.dataset.state !== "error") els.save.click();
  const changed = setReviewStatus(progress, { path, entryKey: entry.key, status });
  if (!changed) return;
  persist();
  renderAll();
  const label = status === "approved" ? "확인 완료" : status === "needs_fix" ? "수정 필요" : status === "deferred" ? "보류" : "미검수";
  showToast(`${entry.label} · ${label}`);
}

function toggleApproved() {
  const path = currentFilePath();
  const entry = currentEntry();
  if (!path || !entry?.key || !entry.eligible) return;
  const current = getReviewStatus(progress, path, entry.key);
  setCurrentStatus(current === "approved" ? "unreviewed" : "approved");
}

async function latestRemoteForPublish() {
  const tree = await client.getTree(BASE_BRANCH);
  treeByPath = new Map(tree.map((entry) => [entry.path, entry]));
  const descriptor = treeByPath.get(PROGRESS_PATH);
  const remote = descriptor ? parseProgress(await client.getBlobText(descriptor.sha)) : emptyProgress();
  return { tree, descriptor, remote };
}

async function publishDirect(event) {
  event?.preventDefault();
  event?.stopImmediatePropagation();
  if (publishGuard) return;
  publishGuard = true;
  try {
    if (els.controlState?.dataset.state === "error") throw new Error("현재 장면의 입력 오류를 먼저 고쳐주세요.");
    if (els.save && !els.save.disabled) {
      els.save.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const token = els.token?.value?.trim() || "";
    if (!token) throw new Error("GitHub에 반영하려면 Fine-grained PAT를 입력하세요.");
    client.setToken(token);
    setTopStatus("최신 main과 검수 기록을 확인하는 중…");
    await client.verifyToken();

    const { descriptor, remote } = await latestRemoteForPublish();
    progress = mergeProgress(remote, progress);
    persist();
    const remoteText = serializeProgress(remote);
    const progressText = serializeProgress(progress);
    const drafts = Object.values(readDrafts()).filter((draft) => draft?.path && typeof draft.text === "string");
    const entryChanged = entrySignature(remote) !== entrySignature(progress);
    const progressChanged = remoteText !== progressText && (entryChanged || drafts.length > 0);
    if (!drafts.length && !entryChanged) {
      showToast("GitHub에 반영할 변경사항이 없습니다.", "info");
      remoteBaseline = remote;
      return;
    }

    const summary = [
      `main에 직접 반영합니다.`,
      `번역 수정: ${drafts.length}개 파일`,
      `검수 기록: ${entryChanged ? "상태 변경 있음" : progressChanged ? "메타데이터 갱신" : "변경 없음"}`,
      "",
      "최신 main과 SHA를 다시 검사하고 fast-forward일 때만 반영합니다.",
    ].join("\n");
    if (!window.confirm(summary)) return;

    const files = drafts.map((draft) => ({ path: draft.path, text: draft.text, baseSha: draft.baseSha }));
    if (progressChanged) files.push({ path: PROGRESS_PATH, text: progressText, baseSha: descriptor?.sha || null });
    setTopStatus("main에 안전하게 커밋하는 중…");
    const result = await client.commitFilesToBranch({
      files,
      branch: BASE_BRANCH,
      message: `모바일 각성 검수 반영 ${new Date().toISOString().slice(0, 10)}`,
    });

    remoteBaseline = parseProgress(progressText);
    if (els.prResult) {
      els.prResult.innerHTML = `<a href="${result.htmlUrl}" target="_blank" rel="noreferrer">커밋 확인</a>`;
    }
    setTopStatus(`main 반영 완료 · ${result.commitSha.slice(0, 8)}`, "ok");
    showToast(`main 반영 완료 · 번역 ${drafts.length}개${progressChanged ? " + 검수 기록" : ""}`, "ok");

    if (drafts.length) {
      localStorage.setItem(DRAFT_KEY, "{}");
      setTimeout(() => location.reload(), 1500);
    } else {
      renderAll();
    }
  } catch (error) {
    setTopStatus(error.message, "error");
    showToast(error.message, "error");
  } finally {
    publishGuard = false;
  }
}

injectUi();
els.completeEntry?.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopImmediatePropagation();
  toggleApproved();
}, true);
els.publish?.addEventListener("click", publishDirect, true);
for (const element of [els.mainTab, els.dlcTab]) element?.addEventListener("click", () => {
  setTimeout(() => { renderAll(); void mapCurrentEntries(); }, 0);
});
els.search?.addEventListener("input", () => setTimeout(renderAll, 0));
els.fileSelect?.addEventListener("change", () => setTimeout(() => { renderAll(); void mapCurrentEntries(); }, 0));
els.includeVariants?.addEventListener("change", () => setTimeout(() => { renderAll(); void mapCurrentEntries(); }, 0));
els.token?.addEventListener("input", renderPublishState);

const selectObserver = new MutationObserver(() => { if (!renderGuard) queueMicrotask(renderAll); });
if (els.fileSelect) selectObserver.observe(els.fileSelect, { childList: true });
const entryObserver = new MutationObserver(() => {
  if (renderGuard) return;
  queueMicrotask(() => { renderAll(); void mapCurrentEntries(); });
});
if (els.entryButtons) entryObserver.observe(els.entryButtons, { childList: true, subtree: true });
const pendingObserver = new MutationObserver(() => { if (!renderGuard) queueMicrotask(renderPublishState); });
if (els.pendingCount) pendingObserver.observe(els.pendingCount, { childList: true, characterData: true, subtree: true });
if (els.publish) pendingObserver.observe(els.publish, { attributes: true, attributeFilter: ["disabled"] });

renderProgressLoading(currentMode());
injectUi();
void syncRemoteIntoLocal().then(() => mapCurrentEntries());
