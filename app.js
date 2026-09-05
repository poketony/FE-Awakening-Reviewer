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
const koRenderer = new AwakeningRenderer();
const jaRenderer = new AwakeningRenderer();
const AWAKENING_ASSET_ROOT = "https://raw.githubusercontent.com/poketony/FE-Awakening/main/Awakening/Awakening-Live-Renderer/assets/awakening/";
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
let renderTimer = null;

const $ = (selector) => document.querySelector(selector);
const els = {
  status: $("#status"), token: $("#token"), connect: $("#connect"), readOnly: $("#read-only"),
  mainTab: $("#main-tab"), dlcTab: $("#dlc-tab"), search: $("#search"), fileSelect: $("#file-select"),
  includeVariants: $("#include-variants"),
  workspace: $("#workspace"), empty: $("#empty"), sourcePath: $("#source-path"), entryButtons: $("#entry-buttons"),
  draftState: $("#draft-state"), controlState: $("#control-state"), widthState: $("#width-state"), sceneSync: $("#scene-sync"),
  jaCanvas: $("#ja-canvas"), koCanvas: $("#ko-canvas"), japaneseSceneText: $("#japanese-scene-text"),
  safeEditor: $("#safe-editor"), safeHint: $("#safe-hint"), editor: $("#editor"),
  jaFramePrev: $("#ja-frame-prev"), jaFrameNext: $("#ja-frame-next"), jaFrameLabel: $("#ja-frame-label"),
  koFramePrev: $("#ko-frame-prev"), koFrameNext: $("#ko-frame-next"), koFrameLabel: $("#ko-frame-label"),
  save: $("#save"), revert: $("#revert"), renderDiagnostics: $("#render-diagnostics"),
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
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function escapeAttribute(value) { return escapeHtml(value); }

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
    renderFilePicker();
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
    await Promise.all([koRenderer.initialize(), initializeJapaneseRenderer()]);
    rendererReady = true;
    if (activeItem) await renderPair();
  } catch (error) {
    els.renderDiagnostics.hidden = false;
    els.renderDiagnostics.textContent = `렌더러 초기화 실패: ${error.message}`;
  }
}

async function initializeJapaneseRenderer() {
  await jaRenderer.initialize();
  const [charsBuffer, atlas0, atlas1] = await Promise.all([
    fetch(new URL("ja/bin/chars.bin", AWAKENING_ASSET_ROOT)).then((response) => {
      if (!response.ok) throw new Error("일본어 chars.bin을 불러오지 못했습니다.");
      return response.arrayBuffer();
    }),
    loadRemoteImage(new URL("ja/img/Awakening_0.png", AWAKENING_ASSET_ROOT).href),
    loadRemoteImage(new URL("ja/img/Awakening_1.png", AWAKENING_ASSET_ROOT).href),
  ]);
  jaRenderer.fontCharacters.clear();
  jaRenderer.glyphs.clear();
  jaRenderer.loadFontCharacters(charsBuffer);
  jaRenderer.atlases = [atlas0, atlas1];
}

function loadRemoteImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`이미지를 불러오지 못했습니다: ${url}`));
    image.src = url;
  });
}

function filteredCatalog() {
  const list = catalog[mode] || [];
  const query = filterText.trim().toLocaleLowerCase("ko");
  return list.filter((item) => {
    const label = fileDisplayName(item, names);
    return !query || `${label} ${item.fileName}`.toLocaleLowerCase("ko").includes(query);
  });
}

function renderFilePicker() {
  const filtered = filteredCatalog();
  const options = [new Option(filtered.length ? "지원회화를 선택하세요" : "조건에 맞는 회화가 없습니다", "")];
  for (const item of filtered) {
    const changed = Boolean(drafts[item.koreanPath]);
    options.push(new Option(`${changed ? "● " : ""}${fileDisplayName(item, names)}`, item.id));
  }
  els.fileSelect.replaceChildren(...options);
  if (activeItem?.mode === mode && filtered.some((item) => item.id === activeItem.id)) els.fileSelect.value = activeItem.id;
  else els.fileSelect.value = "";
}

function resetWorkspaceForMode() {
  activeItem = null;
  koreanDocument = null;
  japaneseDocument = null;
  activeEntries = [];
  safeTemplate = null;
  safeValues = [];
  frameIndex = 0;
  els.workspace.hidden = true;
  els.empty.hidden = false;
}

function switchMode(nextMode) {
  if (nextMode === mode) return;
  if (!flushCurrentFrame({ persist: true, silent: true })) return;
  mode = nextMode;
  els.mainTab.classList.toggle("active", mode === "main");
  els.dlcTab.classList.toggle("active", mode === "dlc");
  els.mainTab.setAttribute("aria-selected", String(mode === "main"));
  els.dlcTab.setAttribute("aria-selected", String(mode === "dlc"));
  resetWorkspaceForMode();
  renderFilePicker();
}

async function openSelectedItem(id) {
  const item = (catalog[mode] || []).find((candidate) => candidate.id === id);
  if (!item) return;
  if (!flushCurrentFrame({ persist: true, silent: true })) {
    els.fileSelect.value = activeItem?.id || "";
    return;
  }
  await openItem(item);
}

async function openItem(item) {
  try {
    activeItem = item;
    frameIndex = 0;
    renderFilePicker();
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
    els.sourcePath.textContent = item.koreanPath;
    renderEntryButtons();
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
    rows.push({ key: entry.key, label: entryLabel(entry.key), japanese: jDoc.byKey.get(entry.key), characters });
  }
  return rows;
}

function renderEntryButtons() {
  const counts = new Map();
  for (const entry of activeEntries) counts.set(entry.label, (counts.get(entry.label) || 0) + 1);
  const seen = new Map();
  els.entryButtons.replaceChildren(...activeEntries.map((entry, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "entry-button" + (index === activeEntryIndex ? " active" : "");
    const nth = (seen.get(entry.label) || 0) + 1;
    seen.set(entry.label, nth);
    button.textContent = counts.get(entry.label) > 1 ? `${entry.label} ${nth}` : entry.label;
    button.setAttribute("aria-pressed", String(index === activeEntryIndex));
    button.addEventListener("click", () => changeEntry(index));
    return button;
  }));
}

function changeEntry(index) {
  if (index === activeEntryIndex) return;
  if (!flushCurrentFrame({ persist: true, silent: true })) return;
  loadEntry(index);
}

function loadEntry(index) {
  if (!activeEntries.length) {
    safeTemplate = null;
    safeValues = [];
    els.editor.value = "";
    els.safeEditor.innerHTML = '<p class="safe-empty">지원회화 항목을 찾지 못했습니다.</p>';
    els.japaneseSceneText.textContent = "일본어 대응 회화를 찾지 못했습니다.";
    return;
  }
  activeEntryIndex = Math.max(0, Math.min(index, activeEntries.length - 1));
  frameIndex = 0;
  renderEntryButtons();
  prepareCurrentFrameEditor();
  validateEditor();
  renderPair();
}

function splitFrameStructure(value) {
  const source = String(value || "");
  const separator = /(?:\$k\$p|\$k\\n|\r?\n)/g;
  const pieces = [];
  const frames = [];
  let last = 0;
  let match;
  while ((match = separator.exec(source)) !== null) {
    const text = source.slice(last, match.index);
    const frameNumber = text.length ? frames.length : null;
    if (frameNumber !== null) frames.push(text);
    pieces.push({ type: "frame", value: text, frameNumber });
    pieces.push({ type: "separator", value: match[0], frameNumber: null });
    last = separator.lastIndex;
  }
  const text = source.slice(last);
  const frameNumber = text.length ? frames.length : null;
  if (frameNumber !== null) frames.push(text);
  pieces.push({ type: "frame", value: text, frameNumber });
  return { pieces, frames };
}

function frameAt(value, index) {
  return splitFrameStructure(value).frames[index] ?? "";
}

function replaceFrameAt(value, index, nextFrame) {
  const structure = splitFrameStructure(value);
  let found = false;
  const text = structure.pieces.map((piece) => {
    if (piece.type === "frame" && piece.frameNumber === index) {
      found = true;
      return nextFrame;
    }
    return piece.value;
  }).join("");
  return found ? text : value;
}

function currentRow() { return activeEntries[activeEntryIndex] || null; }
function currentKoreanValue() {
  const row = currentRow();
  return row ? koreanDocument?.byKey.get(row.key)?.value || "" : "";
}
function currentJapaneseValue() { return currentRow()?.japanese?.value || ""; }

function prepareCurrentFrameEditor() {
  const frame = frameAt(currentKoreanValue(), frameIndex);
  safeTemplate = buildSafeEditTemplate(frame);
  safeValues = safeTemplate.textParts.map((part) => part.value);
  renderSafeEditor();
  syncRawView();
  updateSceneText();
}

function editedFrameValue() {
  if (!safeTemplate) return "";
  return rebuildSafeEditTemplate(safeTemplate, safeValues);
}

function editedRawValue() {
  const current = currentKoreanValue();
  if (!safeTemplate) return current;
  return replaceFrameAt(current, frameIndex, editedFrameValue());
}

function speakerDisplayName(speaker) {
  if (!speaker) return "나레이션/연출";
  if (speaker === "username" || speaker.startsWith("プレイヤー")) return "러플레";
  return names.get(speaker) || speaker;
}

function renderSafeEditor() {
  if (!safeTemplate?.textParts.length) {
    els.safeEditor.innerHTML = '<p class="safe-empty">이 장면에는 편집 가능한 대사 문자가 없습니다.</p>';
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
    seq.textContent = safeTemplate.textParts.length > 1 ? `문장 ${index + 1}` : "";
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
    textarea.rows = Math.max(2, Math.min(5, Math.ceil(Math.max(1, textarea.value.length) / 24)));
    textarea.spellcheck = true;
    textarea.autocapitalize = "off";
    textarea.autocomplete = "off";
    textarea.setAttribute("aria-label", `${speaker.textContent} 대사`);
    textarea.addEventListener("input", () => {
      safeValues[index] = textarea.value;
      updateSafePieceState(card, textarea, part);
      syncRawView();
      updateSceneText();
      if (validateEditor()) schedulePairRender();
      else {
        els.widthState.textContent = "입력 수정 필요";
        els.widthState.dataset.state = "error";
      }
    });
    card.append(textarea);

    const meta = document.createElement("div");
    meta.className = "safe-piece-meta";
    const count = document.createElement("span");
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

function updateSceneText() {
  const japaneseFrame = frameAt(currentJapaneseValue(), frameIndex);
  els.japaneseSceneText.textContent = japaneseFrame ? stripCommands(japaneseFrame, "ルフレ") : "해당 일본어 장면이 없습니다.";
}

function validateEditor() {
  if (!activeEntries.length || !safeTemplate) return false;
  const current = currentKoreanValue();
  const edited = editedRawValue();
  const safeValid = safeValues.map(validateSafeText).every((check) => check.valid);
  const control = compareControlCodes(current, edited);
  const valid = safeValid && control.same;
  els.controlState.textContent = valid ? "구조 잠금 정상" : safeValid ? "구조 변경 감지" : "대사 입력 확인 필요";
  els.controlState.dataset.state = valid ? "ok" : "error";
  els.save.disabled = !valid || edited === current;
  const draft = activeItem ? drafts[activeItem.koreanPath] : null;
  els.draftState.textContent = draft ? "파일 초안 있음" : "원격 원본";
  return valid;
}

function currentFrameChanged() {
  return Boolean(safeTemplate) && editedRawValue() !== currentKoreanValue();
}

function flushCurrentFrame({ persist = false, silent = false } = {}) {
  if (!activeItem || !currentRow() || !safeTemplate || !currentFrameChanged()) return true;
  if (!validateEditor()) {
    if (!silent) toast("현재 장면의 입력 오류를 먼저 고쳐주세요.", "error");
    return false;
  }
  const row = currentRow();
  koreanDocument = replaceEntryValue(koreanDocument, row.key, editedRawValue());
  if (persist) {
    drafts[activeItem.koreanPath] = {
      path: activeItem.koreanPath,
      baseSha: activeItem.koreanSha,
      text: koreanDocument.text,
      updatedAt: new Date().toISOString(),
    };
    persistDrafts();
    renderFilePicker();
  }
  return true;
}

function saveCurrentEntry() {
  if (!activeItem || !currentRow()) return;
  if (!currentFrameChanged()) {
    toast("현재 장면에 새 수정사항이 없습니다.");
    return;
  }
  if (!flushCurrentFrame({ persist: true })) return;
  prepareCurrentFrameEditor();
  validateEditor();
  renderPair();
  toast("로컬 초안에 저장했습니다.", "ok");
}

function schedulePairRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderPair, 160);
}

async function renderPair() {
  if (!rendererReady || !activeEntries.length) return;
  const japaneseRaw = currentJapaneseValue();
  const koreanRaw = editedRawValue();
  try {
    const [jaResult, koResult] = await Promise.all([
      jaRenderer.render(japaneseRaw, els.jaCanvas, { frameIndex, nameMap: new Map(), playerName: "ルフレ", playerGender: "male" }),
      koRenderer.render(koreanRaw, els.koCanvas, { frameIndex, nameMap: names, playerName: "러플레", playerGender: "male" }),
    ]);
    const jaCount = Math.max(1, jaResult.frameCount || 1);
    const koCount = Math.max(1, koResult.frameCount || 1);
    const sharedCount = Math.max(jaCount, koCount);
    frameIndex = Math.max(0, Math.min(frameIndex, sharedCount - 1));
    const disabledPrev = frameIndex <= 0;
    const disabledNext = frameIndex >= sharedCount - 1;
    for (const button of [els.jaFramePrev, els.koFramePrev]) button.disabled = disabledPrev;
    for (const button of [els.jaFrameNext, els.koFrameNext]) button.disabled = disabledNext;
    els.jaFrameLabel.textContent = `${frameIndex + 1} / ${sharedCount}`;
    els.koFrameLabel.textContent = `${frameIndex + 1} / ${sharedCount}`;
    if (jaCount === koCount) {
      els.sceneSync.textContent = `${sharedCount}장면 동기화`;
      els.sceneSync.dataset.state = "ok";
    } else {
      els.sceneSync.textContent = `J ${jaCount} / K ${koCount} · 장면 수 확인`;
      els.sceneSync.dataset.state = "warn";
    }
    const maxWidth = Math.max(0, ...(koResult.lineWidths || []));
    els.widthState.textContent = `현재 장면 최대 ${maxWidth}px`;
    els.widthState.dataset.state = maxWidth > 320 ? "warn" : "ok";
    const diagnostics = [...(jaResult.diagnostics || []), ...(koResult.diagnostics || [])];
    els.renderDiagnostics.hidden = !diagnostics.length;
    els.renderDiagnostics.textContent = diagnostics.map((item) => item.message).join("\n");
    updateSceneText();
  } catch (error) {
    els.renderDiagnostics.hidden = false;
    els.renderDiagnostics.textContent = `렌더링 오류: ${error.message}`;
  }
}

function navigateFrame(delta) {
  if (!flushCurrentFrame({ persist: true, silent: true })) {
    toast("현재 장면의 입력 오류를 먼저 고쳐주세요.", "error");
    return;
  }
  const jaCount = splitFrameStructure(currentJapaneseValue()).frames.length || 1;
  const koCount = splitFrameStructure(currentKoreanValue()).frames.length || 1;
  const sharedCount = Math.max(jaCount, koCount);
  const next = Math.max(0, Math.min(frameIndex + delta, sharedCount - 1));
  if (next === frameIndex) return;
  frameIndex = next;
  prepareCurrentFrameEditor();
  validateEditor();
  renderPair();
}

async function revertCurrentFile() {
  if (!activeItem) return;
  if (!confirm("이 파일의 로컬 수정사항을 전부 버릴까요?")) return;
  delete drafts[activeItem.koreanPath];
  persistDrafts();
  const text = await client.getBlobText(activeItem.koreanSha);
  koreanDocument = parseMessageDocument(text, { path: activeItem.koreanPath, sha: activeItem.koreanSha });
  activeEntries = collectEntries(activeItem.mode, koreanDocument, japaneseDocument);
  activeEntryIndex = Math.min(activeEntryIndex, Math.max(0, activeEntries.length - 1));
  frameIndex = 0;
  renderEntryButtons();
  prepareCurrentFrameEditor();
  validateEditor();
  renderFilePicker();
  renderPair();
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
    if (!flushCurrentFrame({ persist: true, silent: true })) throw new Error("현재 장면의 입력 오류를 먼저 고쳐주세요.");
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
    renderFilePicker();
    setStatus(`PR #${pr.number} 생성 완료`, "ok");
    toast("검수 PR을 만들었습니다.", "ok");
  } catch (error) {
    setStatus(error.message, "error");
    toast(error.message, "error");
  } finally {
    renderPending();
  }
}

els.connect.addEventListener("click", () => bootstrap(true));
els.readOnly.addEventListener("click", () => bootstrap(false));
els.mainTab.addEventListener("click", () => switchMode("main"));
els.dlcTab.addEventListener("click", () => switchMode("dlc"));
els.search.addEventListener("input", () => { filterText = els.search.value; renderFilePicker(); });
els.fileSelect.addEventListener("change", () => { if (els.fileSelect.value) openSelectedItem(els.fileSelect.value); });
els.includeVariants.addEventListener("change", () => {
  includeVariants = els.includeVariants.checked;
  if (!activeItem) return;
  if (!flushCurrentFrame({ persist: true, silent: true })) return;
  activeEntries = collectEntries(activeItem.mode, koreanDocument, japaneseDocument);
  activeEntryIndex = 0;
  frameIndex = 0;
  renderEntryButtons();
  loadEntry(0);
});
els.save.addEventListener("click", saveCurrentEntry);
els.revert.addEventListener("click", revertCurrentFile);
for (const button of [els.jaFramePrev, els.koFramePrev]) button.addEventListener("click", () => navigateFrame(-1));
for (const button of [els.jaFrameNext, els.koFrameNext]) button.addEventListener("click", () => navigateFrame(1));
els.clearDrafts.addEventListener("click", () => {
  if (!confirm("모든 로컬 초안을 삭제할까요?")) return;
  drafts = {};
  persistDrafts();
  renderFilePicker();
  if (activeItem) {
    client.getBlobText(activeItem.koreanSha).then((text) => {
      koreanDocument = parseMessageDocument(text, { path: activeItem.koreanPath, sha: activeItem.koreanSha });
      activeEntries = collectEntries(activeItem.mode, koreanDocument, japaneseDocument);
      loadEntry(0);
    });
  }
  toast("초안을 모두 삭제했습니다.");
});
els.publish.addEventListener("click", publishDrafts);

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
bootstrap(false);
