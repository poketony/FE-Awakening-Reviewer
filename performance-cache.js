import { GitHubClient } from "./lib/github.js";
import { AwakeningRenderer, splitConversationFrames } from "./lib/game-renderer.js";

const ASSET_ROOT = "https://raw.githubusercontent.com/poketony/FE-Awakening/main/Awakening/Awakening-Live-Renderer/assets/awakening/";
const MAX_BLOB_TEXT_CACHE = 160;
const MAX_SHARED_IMAGE_CACHE = 220;
const MAX_SHARED_RECOLOR_CACHE = 96;
const MAX_RENDER_CACHE = 48;

const blobTextCache = new Map();
const blobTextInflight = new Map();
const sharedImages = new Map();
const sharedBinary = new Map();
const sharedText = new Map();
const sharedRecolored = new Map();
const renderedFrames = new Map();
const rendererIds = new WeakMap();
let nextRendererId = 1;
let entryHostPath = "";

function putCapped(map, key, value, limit) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > limit) map.delete(map.keys().next().value);
}

function relevantFrameSource(value, frameIndex = 0) {
  const frames = splitConversationFrames(value || "");
  const end = Math.max(0, Math.min(Number(frameIndex) || 0, Math.max(0, frames.length - 1)));
  return frames.slice(0, end + 1).join("$k$p");
}

function warmPortraits(renderer, value, frameIndex = 0, playerGender = "male") {
  if (!value || typeof renderer?.loadImage !== "function") return;
  const source = relevantFrameSource(value, frameIndex);
  const names = [];
  const seenNames = new Set();
  for (const match of source.matchAll(/\$Wm([^|]+)\|./gu)) {
    const name = match[1]?.trim();
    if (!name || seenNames.has(name)) continue;
    seenNames.add(name);
    names.push(name);
    if (names.length >= 4) break;
  }

  const emotions = ["通常"];
  const seenEmotions = new Set(emotions);
  for (const match of source.matchAll(/\$E([^|]+)\|/gu)) {
    const emotion = String(match[1] || "").split(",")[0].trim();
    if (!emotion || seenEmotions.has(emotion)) continue;
    seenEmotions.add(emotion);
    emotions.push(emotion);
    if (emotions.length >= 4) break;
  }

  let budget = 12;
  for (const name of names) {
    if (name.startsWith("プレイヤー")) continue;
    const asset = renderer.resolveCharacter(name, playerGender === "female" ? "female" : "male");
    const base = asset?.base;
    if (!base) continue;
    for (const emotion of emotions) {
      renderer.loadImage(`img/face/${base}_bu_${emotion}.png`);
      budget -= 1;
      if (budget <= 0) return;
    }
  }
}

function stripEntryStatus(value) {
  return String(value || "")
    .replace(/^[✓!◇—]\s+/u, "")
    .trim();
}

function stripFileStatus(value) {
  return String(value || "")
    .replace(/^(?:✓ 완료|! 수정 필요|◇ 보류|◐ 진행|○ 미완료) · /u, "")
    .trim();
}

// app.js가 같은 C/B/A/S 버튼과 같은 파일 목록을 사소한 상태 변화마다 통째로
// 갈아끼우면 progress.js의 MutationObserver가 다시 전체 매핑/진행률 계산을 시작한다.
// 같은 화면에서는 실제 DOM을 재생성하지 않고 active 상태만 갱신한다.
const nativeReplaceChildren = Element.prototype.replaceChildren;
Element.prototype.replaceChildren = function reviewerReplaceChildren(...nodes) {
  if (this.id === "entry-buttons" && nodes.every((node) => node instanceof HTMLElement)) {
    const currentPath = document.querySelector("#source-path")?.textContent || "";
    const current = [...this.children];
    const samePath = Boolean(currentPath) && currentPath === entryHostPath;
    const sameEntries = samePath
      && current.length === nodes.length
      && current.every((node, index) => stripEntryStatus(node.dataset.reviewBase || node.textContent) === stripEntryStatus(nodes[index]?.textContent));

    if (sameEntries) {
      let activeChanged = false;
      current.forEach((node, index) => {
        const next = nodes[index];
        const active = next.classList.contains("active");
        if (node.classList.contains("active") !== active) activeChanged = true;
        node.classList.toggle("active", active);
        node.setAttribute("aria-pressed", String(active));
      });
      if (activeChanged) queueMicrotask(() => document.dispatchEvent(new CustomEvent("reviewer:active-entry-changed")));
      return;
    }
    entryHostPath = currentPath;
  }

  if (this.id === "file-select" && nodes.every((node) => node instanceof HTMLOptionElement)) {
    const current = [...this.options];
    if (current.length === nodes.length) {
      const incoming = new Map(nodes.map((node) => [node.value, stripFileStatus(node.textContent)]));
      const sameOptions = current.every((node) => incoming.get(node.value) === stripFileStatus(node.textContent));
      if (sameOptions) return;
    }
  }

  return nativeReplaceChildren.apply(this, nodes);
};

if (!GitHubClient.prototype.__reviewerPerformanceCachePatched) {
  const originalGetBlobText = GitHubClient.prototype.getBlobText;
  GitHubClient.prototype.getBlobText = function getBlobTextCached(sha) {
    const key = String(sha || "");
    if (!key) return originalGetBlobText.call(this, sha);
    if (blobTextCache.has(key)) return Promise.resolve(blobTextCache.get(key));
    if (blobTextInflight.has(key)) return blobTextInflight.get(key);

    const request = originalGetBlobText.call(this, sha)
      .then((text) => {
        putCapped(blobTextCache, key, text, MAX_BLOB_TEXT_CACHE);
        warmPortraits(warmRenderer, text, 0, "male");
        return text;
      })
      .finally(() => blobTextInflight.delete(key));
    blobTextInflight.set(key, request);
    return request;
  };
  GitHubClient.prototype.__reviewerPerformanceCachePatched = true;
}

function rendererId(renderer) {
  if (!rendererIds.has(renderer)) rendererIds.set(renderer, nextRendererId++);
  return rendererIds.get(renderer);
}

function renderCacheKey(renderer, value, options) {
  return [
    rendererId(renderer),
    Number(options?.frameIndex) || 0,
    options?.playerGender || "male",
    options?.playerName || "",
    String(value || ""),
  ].join("\u0000");
}

const rendererProto = AwakeningRenderer.prototype;
if (!rendererProto.__reviewerPerformanceCachePatched) {
  const originalLoadImage = rendererProto.loadImage;
  const originalFetchBinary = rendererProto.fetchBinary;
  const originalFetchText = rendererProto.fetchText;
  const originalRecolorHair = rendererProto.recolorHair;
  const originalRender = rendererProto.render;

  rendererProto.loadImage = function loadImageShared(relativePath) {
    const key = String(relativePath || "");
    if (this.images?.has(key)) return this.images.get(key);
    if (sharedImages.has(key)) {
      const shared = sharedImages.get(key);
      this.images?.set(key, shared);
      return shared;
    }
    const promise = originalLoadImage.call(this, relativePath);
    putCapped(sharedImages, key, promise, MAX_SHARED_IMAGE_CACHE);
    return promise;
  };

  rendererProto.fetchBinary = function fetchBinaryShared(relativePath) {
    const key = String(relativePath || "");
    if (sharedBinary.has(key)) return sharedBinary.get(key);
    const promise = originalFetchBinary.call(this, relativePath).catch((error) => {
      sharedBinary.delete(key);
      throw error;
    });
    sharedBinary.set(key, promise);
    return promise;
  };

  rendererProto.fetchText = function fetchTextShared(relativePath) {
    const key = String(relativePath || "");
    if (sharedText.has(key)) return sharedText.get(key);
    const promise = originalFetchText.call(this, relativePath).catch((error) => {
      sharedText.delete(key);
      throw error;
    });
    sharedText.set(key, promise);
    return promise;
  };

  if (typeof originalRecolorHair === "function") {
    rendererProto.recolorHair = function recolorHairShared(image, cacheKey) {
      const key = String(cacheKey || "");
      if (sharedRecolored.has(key)) return sharedRecolored.get(key);
      const result = originalRecolorHair.call(this, image, cacheKey);
      putCapped(sharedRecolored, key, result, MAX_SHARED_RECOLOR_CACHE);
      return result;
    };
  }

  rendererProto.render = async function renderAtomically(value, canvas, options = {}) {
    const guarded = canvas instanceof HTMLCanvasElement && ["ja-canvas", "ko-canvas"].includes(canvas.id);
    warmPortraits(this, value, options.frameIndex ?? 0, options.playerGender || "male");
    if (!guarded) return originalRender.call(this, value, canvas, options);

    const generation = Number(canvas.dataset.renderGeneration || 0);
    const key = renderCacheKey(this, value, options);
    const cached = renderedFrames.get(key);
    if (cached) {
      const context = canvas.getContext("2d");
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(cached.canvas, 0, 0);
      return cached.result;
    }

    const buffer = document.createElement("canvas");
    buffer.width = canvas.width;
    buffer.height = canvas.height;
    const result = await originalRender.call(this, value, buffer, options);
    putCapped(renderedFrames, key, { canvas: buffer, result }, MAX_RENDER_CACHE);

    if (Number(canvas.dataset.renderGeneration || 0) === generation) {
      const context = canvas.getContext("2d");
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(buffer, 0, 0);
    }
    return result;
  };

  rendererProto.__reviewerPerformanceCachePatched = true;
}

const warmRenderer = new AwakeningRenderer();
for (const path of [
  "img/SupportBG.png", "img/TextBox.png", "img/NameBox.png", "img/KeyPress.png",
  "img/Awakening_0.png", "img/Awakening_1.png",
]) warmRenderer.loadImage(path);

void warmRenderer.fetchBinary("bin/chars.bin").catch(() => {});
void warmRenderer.fetchBinary("bin/faces.bin").catch(() => {});
void warmRenderer.fetchText("txt/FID.txt").catch(() => {});

for (const path of ["ja/img/Awakening_0.png", "ja/img/Awakening_1.png"]) {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = new URL(path, ASSET_ROOT).href;
}
void fetch(new URL("ja/bin/chars.bin", ASSET_ROOT)).catch(() => {});
