import { GitHubClient, makeReviewBranchName } from "./lib/github.js";
import { buildCatalog, fileDisplayName, paths } from "./lib/catalog.js";
import {
  parseMessageDocument, replaceEntryValue, formatEntryForEditing,
  parseNameMap, stripCommands, isMainSupportEntry, extractDlcCharacters, entryLabel,
} from "./lib/message-format.js";
import { compareControlCodes } from "./lib/validation.js";
import { buildSafeEditTemplate, rebuildSafeEditTemplate, validateSafeText, summarizeLockedContext } from "./lib/safe-editor.js";
import { AwakeningRenderer } from "./lib/game-renderer.js";

const OWNER = "poketony";
const REPO = "FE-Awakening";
const BASE_BRANCH = "main";
const DRAFT_KEY = "fe-awakening-reviewer:drafts:v1";

const client = new GitHubClient({ owner: OWNER, repo: REPO });
const renderer = new AwakeningRenderer();
let rendererReady = false;
let repoTree = [];
let catalog = { main: [], dlc: [] };
let names = new Map();
let mode = "main";
let activeItem = null;
let koreanDocument = null;
let japaneseDocument = null;
let activeEntries = [];
let activeEntryIndex = 0;
let frameIndex = 0;
let tokenConnected = false;
let filterText = "";
let includeVariants = false;
let drafts = loadDrafts();
let safeTemplate = null;
let safeValues = [];
let editorView = "safe";

const $ = (selector) => document.querySelector(selector);
const els = {
  status: $("#status"), token: $("#token"), connect: $("#connect"), readOnly: $("#read-only"),
  mainTab: $("#main-tab"), dlcTab: $("#dlc-tab"), search: $("#search"), fileList: $("#file-list"),
  includeVariants: $("#include-variants"),
  workspace: $("#workspace"), empty: $("#empty"), fileTitle: $("#file-title"), sourcePath: $("#source-path"),
  entrySelect: $("#entry-select"), prevEntry: $("#prev-entry"), nextEntry: $("#next-entry"),
  japanesePlain: $("#japanese-plain"), koreanPlain: $("#korean-plain"), editor: $("#editor"),
  safeEditor: $("#safe-editor"), safeTab: $("#safe-tab"), rawTab: $("#raw-tab"), rawPanel: $("#raw-panel"), safeHint: $("#safe-hint"),
  controlState: $("#control-state"), draftState: $("#draft-state"), widthState: $("#width-state"),
  save: $("#save"), revert: $("#revert"),
  canvas: $("#canvas"), framePrev: $("#frame-prev"), frameNext: $("#frame-next"), frameLabel: $("#frame-label"),
  renderDiagnostics: $("#render-diagnostics"),
  pendingCount: $("#pending-count"), pendingList: $("#pending-list"), clearDrafts: $("#clear-drafts"), publish: $("#publish"),
  prResult: $("#pr-result"), toast: $("#toast"),
};

function loadDrafts() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}"); } catch { return {}; }
}
function persistDrafts() {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));
  renderPending();
}
function toast(message, type = "info") {
  els.toast.textContent = message;
  els.toast.dataset.type = type;
  els.toast.classList.add("show");
  setTimeout(() => els.toast.classList.remove("show"), 2600);
}
function setStatus(message, tone = "muted") {
  els.status.textContent = message;
  els.status.dataset.tone = tone;
}

async function bootstrap(useToken = false) {
  try {
    setStatus("저장소 목록을 불러오는 중…");
    if (useToken) {
      client.setToken(els.token.value);
      const verified = await client.verifyToken();
      tokenConnected = true;
      setStatus(`${verified.login} · ${verified.repo}`, "ok");
    } else {
      client.setToken("");
      tokenConnected = false;
      setStatus("읽기 전용 · 토큰은 PR 생성 때만 필요", "muted");
    }
    repoTree = await client.getTree(BASE_BRANCH);
    catalog = buildCatalog(repoTree);
    const gameData = repoTree.find((item) => item.path === `${paths.MAIN_K}GameData.txt`);
    if (!gameData) throw new Error("GameData.txt를 찾지 못했습니다.");
    names = parseNameMap(await client.getBlobText(gameData.sha));
    renderFileList();
    renderPending();
    initializeRenderer();
  } catch (error) {
    setStatus(error.message, "error");
    toast(error.message, "error");
  }
}

async function initializeRenderer() {
  if (rendererReady) return;
  try {
    await renderer.initialize();
    rendererReady = true;
    if (activeItem) await renderPreview();
  } catch (error) {
    els.renderDiagnostics.textContent = `렌더러 초기화 실패: ${error.message}`;
  }
}

function renderFileList() {
  const list = catalog[mode] || [];
  const query = filterText.trim().toLocaleLowerCase("ko");
  const filtered = list.filter((item) => {
    const label = fileDisplayName(item, names);
    return !query || `${label} ${item.fileName}`.toLocaleLowerCase("ko").includes(query);
  });
  els.fileList.replaceChildren(...filtered.map((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "file-item" + (activeItem?.id === item.id ? " active" : "");
    const changed = Boolean(drafts[item.koreanPath]);
    button.innerHTML = `<span>${escapeHtml(fileDisplayName(item, names))}</span>${changed ? '<span class="dot" title="수정됨"></span>' : ""}`;
    button.addEventListener("click", () => openItem(item));
    return button;
  }));
  if (!filtered.length) {
    const empty = document.createElement("p"); empty.className = "list-empty"; empty.textContent = "조건에 맞는 회화가 없습니다."; els.fileList.append(empty);
  }
}

async function openItem(item) {
  try {
    activeItem = item;
    frameIndex = 0;
    renderFileList();
    setStatus(`${fileDisplayName(item, names)} 불러오는 중…`);
    const [jText, kText] = await Promise.all([client.getBlobText(item.japaneseSha), client.getBlobText(item.koreanSha)]);
    japaneseDocument = parseMessageDocument(jText, { path: item.japanesePath, sha: item.japaneseSha });
    const draft = drafts[item.koreanPath];
    if (draft && draft.baseSha !== item.koreanSha) {
      toast("이 파일의 로컬 초안은 원격 main보다 오래되었습니다. 초안을 자동 적용하지 않았습니다.", "error");
    }
    const effectiveK = draft && draft.baseSha === item.koreanSha ? draft.text : kText;
    koreanDocument = parseMessageDocument(effectiveK, { path: item.koreanPath, sha: item.koreanSha });
    activeEntries = collectEntries(item.mode, koreanDocument, japaneseDocument);
    activeEntryIndex = 0;
    els.empty.hidden = true;
    els.workspace.hidden = false;
    els.fileTitle.textContent = fileDisplayName(item, names);
    els.sourcePath.textContent = item.koreanPath;
    renderEntrySelect();
    loadEntry(0);
    setStatus(tokenConnected ? "GitHub 쓰기 연결됨" : "읽기/로컬 수정 모드", tokenConnected ? "ok" : "muted");
  } catch (error) {
    toast(error.message, "error");
  }
}

function collectEntries(itemMode, kDoc, jDoc) {
  const rows = [];
  for (const entry of kDoc.entries) {
    let allowed = false;
    let characters = null;
    if (itemMode === "main") allowed = isMainSupportEntry(entry.key, includeVariants);
    else {
      characters = extractDlcCharacters(entry.key, names, includeVariants);
      allowed = Boolean(characters);
    }
    if (!allowed) continue;
    const japanese = jDoc.byKey.get(entry.key);
    rows.push({ key: entry.key, label: entryLabel(entry.key), japanese, characters });
  }
  return rows;
}

function renderEntrySelect() {
  els.entrySelect.replaceChildren(...activeEntries.map((entry, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${entry.label} · ${entry.key}`;
    return option;
  }));
}

function loadEntry(index) {
  if (!activeEntries.length) {
    safeTemplate = null; safeValues = []; els.editor.value = ""; els.safeEditor.replaceChildren(); els.japanesePlain.textContent = "지원회화 항목을 찾지 못했습니다."; return;
  }
  activeEntryIndex = Math.max(0, Math.min(index, activeEntries.length - 1));
  els.entrySelect.value = String(activeEntryIndex);
  const row = activeEntries[activeEntryIndex];
  const kEntry = koreanDocument.byKey.get(row.key);
  els.japanesePlain.textContent = row.japanese ? stripCommands(row.japanese.value, "ルフレ") : "일본어 대응 MID 없음";
  els.koreanPlain.textContent = stripCommands(kEntry?.value || "");
  safeTemplate = buildSafeEditTemplate(kEntry?.value || "");
  safeValues = safeTemplate.textParts.map((part) => part.value);
  renderSafeEditor();
  syncRawView();
  els.prevEntry.disabled = activeEntryIndex === 0;
  els.nextEntry.disabled = activeEntryIndex >= activeEntries.length - 1;
  frameIndex = 0;
  validateEditor();
  renderPreview();
}

function editedRawValue() {
  if (!safeTemplate) return "";
  return rebuildSafeEditTemplate(safeTemplate, safeValues);
}

function speakerDisplayName(speaker) {
  if (!speaker) return "나레이션/연출";
  if (speaker === "username" || speaker.startsWith("プレイヤー")) return "러플레";
  return names.get(speaker) || speaker;
}

function renderSafeEditor() {
  if (!safeTemplate?.textParts.length) {
    els.safeEditor.innerHTML = '<p class="safe-empty">편집 가능한 대사 문자가 없습니다.</p>';
    return;
  }
  els.safeEditor.replaceChildren(...safeTemplate.textParts.map((part, index) => {
    const card = document.createElement("section");
    card.className = "safe-piece";
    card.dataset.index = String(index);

    const head = document.createElement("div");
    head.className = "safe-piece-head";
    const speaker = document.createElement("span");
    speaker.className = "safe-speaker";
    speaker.textContent = speakerDisplayName(part.speaker);
    const seq = document.createElement("span");
    seq.className = "safe-seq";
    seq.textContent = `대사 ${index + 1}`;
    head.append(speaker, seq);
    card.append(head);

    const contextLabels = summarizeLockedContext(part.leadingLocked);
    if (contextLabels.length) {
      const context = document.createElement("div");
      context.className = "safe-context";
      for (const label of contextLabels) {
        const chip = document.createElement("span");
        chip.className = "lock-chip";
        chip.textContent = `🔒 ${label}`;
        context.append(chip);
      }
      card.append(context);
    }

    const textarea = document.createElement("textarea");
    textarea.className = "safe-text";
    textarea.value = safeValues[index] ?? part.value;
    textarea.rows = Math.max(2, Math.min(6, Math.ceil(Math.max(1, textarea.value.length) / 26)));
    textarea.spellcheck = true;
    textarea.autocapitalize = "off";
    textarea.autocomplete = "off";
    textarea.setAttribute("aria-label", `${speaker.textContent} 대사 ${index + 1}`);
    textarea.addEventListener("input", () => {
      safeValues[index] = textarea.value;
      updateSafePieceState(card, textarea, part);
      syncRawView();
      if (validateEditor()) schedulePreview();
      else {
        els.widthState.textContent = "입력 수정 필요";
        els.widthState.dataset.state = "error";
        els.renderDiagnostics.textContent = "대사 입력에 잠긴 스크립트 문법이 포함되어 있어 미리보기를 갱신하지 않았습니다.";
      }
    });
    card.append(textarea);

    const meta = document.createElement("div");
    meta.className = "safe-piece-meta";
    const count = document.createElement("span");
    count.textContent = `${textarea.value.length}자`;
    count.dataset.role = "count";
    const error = document.createElement("span");
    error.className = "safe-error";
    error.dataset.role = "error";
    meta.append(count, error);
    card.append(meta);
    updateSafePieceState(card, textarea, part);
    return card;
  }));
}

function updateSafePieceState(card, textarea, part) {
  const check = validateSafeText(textarea.value);
  const changed = textarea.value !== part.original;
  card.classList.toggle("changed", changed);
  card.classList.toggle("invalid", !check.valid);
  const count = card.querySelector('[data-role="count"]');
  const error = card.querySelector('[data-role="error"]');
  if (count) count.textContent = `${textarea.value.length}자${changed ? " · 수정됨" : ""}`;
  if (error) error.textContent = check.errors[0] || "";
}

function syncRawView() {
  els.editor.value = formatEntryForEditing(editedRawValue());
}

function setEditorView(view) {
  editorView = view === "raw" ? "raw" : "safe";
  const raw = editorView === "raw";
  els.safeEditor.hidden = raw;
  els.safeHint.hidden = raw;
  els.rawPanel.hidden = !raw;
  els.safeTab.classList.toggle("active", !raw);
  els.rawTab.classList.toggle("active", raw);
  els.safeTab.setAttribute("aria-selected", String(!raw));
  els.rawTab.setAttribute("aria-selected", String(raw));
  if (raw) syncRawView();
}

function validateEditor() {
  if (!activeEntries.length || !safeTemplate) return false;
  const row = activeEntries[activeEntryIndex];
  const current = koreanDocument.byKey.get(row.key)?.value || "";
  const edited = editedRawValue();
  const safeChecks = safeValues.map(validateSafeText);
  const safeValid = safeChecks.every((check) => check.valid);
  const control = compareControlCodes(current, edited);
  const valid = safeValid && control.same;
  els.controlState.textContent = valid ? "구조 잠금 정상" : safeValid ? "구조 변경 감지" : "대사 입력 확인 필요";
  els.controlState.dataset.state = valid ? "ok" : "error";
  els.save.disabled = !valid || edited === current;
  const draft = drafts[activeItem.koreanPath];
  els.draftState.textContent = draft ? "파일 초안 있음" : "원격 원본";
  return valid;
}

let renderTimer = null;
function schedulePreview() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderPreview, 180);
}

async function renderPreview() {
  if (!rendererReady || !activeEntries.length) return;
  const raw = editedRawValue();
  try {
    const result = await renderer.render(raw, els.canvas, { frameIndex, nameMap: names, playerName: "러플레", playerGender: "male" });
    frameIndex = result.frameIndex || 0;
    els.framePrev.disabled = frameIndex <= 0;
    els.frameNext.disabled = frameIndex >= result.frameCount - 1;
    els.frameLabel.textContent = `${frameIndex + 1} / ${Math.max(1, result.frameCount)}`;
    const maxWidth = Math.max(0, ...(result.lineWidths || []));
    els.widthState.textContent = `현재 프레임 최대 ${maxWidth}px`;
    els.widthState.dataset.state = maxWidth > 320 ? "warn" : "ok";
    els.renderDiagnostics.textContent = result.diagnostics?.length ? result.diagnostics.map((item) => item.message).join("\n") : "렌더링 진단 이상 없음";
  } catch (error) {
    els.renderDiagnostics.textContent = `렌더링 오류: ${error.message}`;
  }
}

function saveCurrentEntry() {
  if (!activeEntries.length || !validateEditor()) return;
  const row = activeEntries[activeEntryIndex];
  const nextValue = editedRawValue();
  koreanDocument = replaceEntryValue(koreanDocument, row.key, nextValue);
  drafts[activeItem.koreanPath] = {
    path: activeItem.koreanPath,
    baseSha: activeItem.koreanSha,
    text: koreanDocument.text,
    updatedAt: new Date().toISOString(),
  };
  persistDrafts();
  els.koreanPlain.textContent = stripCommands(nextValue);
  validateEditor();
  renderFileList();
  toast("로컬 초안에 저장했습니다.", "ok");
}

async function revertCurrentFile() {
  if (!activeItem) return;
  if (!confirm("이 파일의 로컬 수정사항을 전부 버릴까요?")) return;
  delete drafts[activeItem.koreanPath];
  persistDrafts();
  const text = await client.getBlobText(activeItem.koreanSha);
  koreanDocument = parseMessageDocument(text, { path: activeItem.koreanPath, sha: activeItem.koreanSha });
  activeEntries = collectEntries(activeItem.mode, koreanDocument, japaneseDocument);
  renderEntrySelect();
  loadEntry(Math.min(activeEntryIndex, activeEntries.length - 1));
  renderFileList();
  toast("파일 초안을 버렸습니다.", "ok");
}

function renderPending() {
  const items = Object.values(drafts);
  els.pendingCount.textContent = `${items.length}개 파일`;
  els.pendingList.replaceChildren(...items.map((draft) => {
    const li = document.createElement("li");
    li.textContent = draft.path.replace("Awakening/Messages (K)/", "").replace("Awakening/DLC Message (K)/", "DLC · ");
    return li;
  }));
  els.publish.disabled = !items.length;
  els.clearDrafts.disabled = !items.length;
}

async function publishDrafts() {
  try {
    if (!Object.keys(drafts).length) return;
    if (!client.token) {
      if (!els.token.value.trim()) throw new Error("PR을 만들려면 GitHub 토큰을 입력하세요.");
      client.setToken(els.token.value);
      await client.verifyToken();
      tokenConnected = true;
    }
    const list = Object.values(drafts);
    const branchName = makeReviewBranchName();
    els.publish.disabled = true;
    setStatus("수정 파일 검증 및 커밋 생성 중…");
    const commit = await client.commitDrafts({
      drafts: list,
      baseBranch: BASE_BRANCH,
      branchName,
      message: `모바일 지원회화 검수 ${new Date().toISOString().slice(0, 10)}`,
    });
    setStatus("Pull Request 생성 중…");
    const pr = await client.createPullRequest({
      branchName: commit.branchName,
      baseBranch: BASE_BRANCH,
      title: `모바일 지원회화 검수 ${new Date().toLocaleDateString("ko-KR")}`,
      body: `모바일 검수 앱에서 생성한 수정입니다.\n\n변경 파일:\n${list.map((item) => `- \`${item.path}\``).join("\n")}`,
    });
    els.prResult.innerHTML = `<a href="${escapeAttribute(pr.html_url)}" target="_blank" rel="noreferrer">PR #${pr.number} 열기</a>`;
    drafts = {};
    persistDrafts();
    renderFileList();
    setStatus(`PR #${pr.number} 생성 완료`, "ok");
    toast("검수 PR을 만들었습니다.", "ok");
  } catch (error) {
    setStatus(error.message, "error");
    toast(error.message, "error");
  } finally {
    renderPending();
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function escapeAttribute(value) { return escapeHtml(value); }

els.connect.addEventListener("click", () => bootstrap(true));
els.readOnly.addEventListener("click", () => bootstrap(false));
els.mainTab.addEventListener("click", () => { mode = "main"; els.mainTab.classList.add("active"); els.dlcTab.classList.remove("active"); renderFileList(); });
els.dlcTab.addEventListener("click", () => { mode = "dlc"; els.dlcTab.classList.add("active"); els.mainTab.classList.remove("active"); renderFileList(); });
els.search.addEventListener("input", () => { filterText = els.search.value; renderFileList(); });
els.includeVariants.addEventListener("change", () => { includeVariants = els.includeVariants.checked; if (activeItem) { activeEntries = collectEntries(activeItem.mode, koreanDocument, japaneseDocument); renderEntrySelect(); loadEntry(0); } });
els.entrySelect.addEventListener("change", () => loadEntry(Number(els.entrySelect.value)));
els.prevEntry.addEventListener("click", () => loadEntry(activeEntryIndex - 1));
els.nextEntry.addEventListener("click", () => loadEntry(activeEntryIndex + 1));
els.safeTab.addEventListener("click", () => setEditorView("safe"));
els.rawTab.addEventListener("click", () => setEditorView("raw"));
els.save.addEventListener("click", saveCurrentEntry);
els.revert.addEventListener("click", revertCurrentFile);
els.framePrev.addEventListener("click", () => { frameIndex -= 1; renderPreview(); });
els.frameNext.addEventListener("click", () => { frameIndex += 1; renderPreview(); });
els.clearDrafts.addEventListener("click", () => { if (confirm("모든 로컬 초안을 삭제할까요?")) { drafts = {}; persistDrafts(); renderFileList(); toast("초안을 모두 삭제했습니다."); } });
els.publish.addEventListener("click", publishDrafts);

setEditorView("safe");

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
bootstrap(false);
