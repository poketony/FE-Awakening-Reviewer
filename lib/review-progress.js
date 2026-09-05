export const PROGRESS_VERSION = 1;

export function emptyProgress() {
  return {
    version: PROGRESS_VERSION,
    knownIds: { main: [], dlc: [] },
    files: {},
  };
}

export function parseProgress(raw) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object") return emptyProgress();
    return {
      version: PROGRESS_VERSION,
      knownIds: {
        main: uniqueStrings(parsed.knownIds?.main),
        dlc: uniqueStrings(parsed.knownIds?.dlc),
      },
      files: normalizeFiles(parsed.files),
    };
  } catch {
    return emptyProgress();
  }
}

function uniqueStrings(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value) => typeof value === "string" && value))];
}

function normalizeFiles(files) {
  if (!files || typeof files !== "object") return {};
  const output = {};
  for (const [id, file] of Object.entries(files)) {
    if (!id || !file || typeof file !== "object") continue;
    const expected = uniqueStrings(file.expected);
    const done = {};
    if (file.done && typeof file.done === "object") {
      for (const [key, value] of Object.entries(file.done)) {
        if (!key || !value) continue;
        done[key] = typeof value === "string" ? value : new Date(0).toISOString();
      }
    }
    output[id] = {
      mode: file.mode === "dlc" ? "dlc" : "main",
      expected,
      done,
    };
  }
  return output;
}

export function rememberCatalog(progress, mode, ids) {
  const target = mode === "dlc" ? "dlc" : "main";
  progress.knownIds[target] = uniqueStrings((ids || []).map(String));
  return progress;
}

export function rememberExpected(progress, { mode, fileId, labels }) {
  if (!fileId) return progress;
  const file = ensureFile(progress, mode, fileId);
  const unique = uniqueStrings(labels);
  if (unique.length) file.expected = unique;
  return progress;
}

export function setEntryDone(progress, { mode, fileId, entryKey, done, at = new Date().toISOString() }) {
  if (!fileId || !entryKey) return progress;
  const file = ensureFile(progress, mode, fileId);
  if (done) file.done[entryKey] = at;
  else delete file.done[entryKey];
  return progress;
}

function ensureFile(progress, mode, fileId) {
  if (!progress.files[fileId]) {
    progress.files[fileId] = {
      mode: mode === "dlc" ? "dlc" : "main",
      expected: [],
      done: {},
    };
  }
  return progress.files[fileId];
}

export function isEntryDone(progress, fileId, entryKey) {
  return Boolean(progress.files?.[fileId]?.done?.[entryKey]);
}

export function fileProgress(progress, fileId) {
  const file = progress.files?.[fileId];
  if (!file) return { expected: 0, done: 0, fraction: 0, state: "incomplete" };
  const expected = uniqueStrings(file.expected);
  const done = expected.length
    ? expected.filter((key) => file.done?.[key]).length
    : Object.keys(file.done || {}).length;
  const fraction = expected.length ? Math.min(1, done / expected.length) : 0;
  const state = expected.length && done >= expected.length
    ? "complete"
    : done > 0
      ? "progress"
      : "incomplete";
  return { expected: expected.length, done, fraction, state };
}

function roundedPercent(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function modeProgress(progress, mode) {
  const target = mode === "dlc" ? "dlc" : "main";
  const ids = uniqueStrings(progress.knownIds?.[target]);
  let weighted = 0;
  let complete = 0;
  let inProgress = 0;
  for (const id of ids) {
    const file = fileProgress(progress, id);
    weighted += file.fraction;
    if (file.state === "complete") complete += 1;
    else if (file.state === "progress") inProgress += 1;
  }
  const total = ids.length;
  const percent = roundedPercent(complete, total);
  const weightedPercent = roundedPercent(weighted, total);
  return {
    total,
    complete,
    inProgress,
    remaining: Math.max(0, total - complete),
    percent,
    weightedPercent,
  };
}

export function completedToday(progress, now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  let count = 0;
  for (const file of Object.values(progress.files || {})) {
    for (const timestamp of Object.values(file.done || {})) {
      const date = new Date(timestamp);
      if (Number.isNaN(date.getTime())) continue;
      if (date.getFullYear() === year && date.getMonth() === month && date.getDate() === day) count += 1;
    }
  }
  return count;
}

export function progressMessage(input) {
  const result = typeof input === "number"
    ? { percent: input, complete: 0, total: 0, remaining: 0, inProgress: 0 }
    : (input || {});
  const percent = Number(result.percent) || 0;
  const complete = Number(result.complete) || 0;
  const total = Number(result.total) || 0;
  const remaining = Number.isFinite(result.remaining) ? result.remaining : Math.max(0, total - complete);
  const inProgress = Number(result.inProgress) || 0;

  if (percent >= 100) return "끝. 전부 검수 완료. 이 숫자는 네가 직접 밀어 올린 거다.";
  if (percent >= 90) return `90% 넘겼다. 남은 ${remaining}개. 이제 마무리만 하면 끝이다.`;
  if (percent >= 75) return `3/4 돌파. 남은 ${remaining}개. 끝이 숫자로 보인다.`;
  if (percent >= 50) return "절반 넘겼다. 이제 끝낸 파일이 남은 파일보다 많다.";
  if (percent >= 25) return `4분의 1 돌파. 벌써 ${complete}개를 실제로 끝냈다. 계속 밀자.`;
  if (percent >= 10) return "두 자릿수 진입. 이제 이건 '시작'이 아니라 제대로 진행 중이다.";
  if (complete >= 5) return `좋다. ${complete}개 끝냈다. 총량은 도망 못 간다. 한 파일씩 지우자.`;
  if (complete >= 1) return "첫 파일 넘겼다. 이제 0%가 아니다. 다음 하나만 보자.";
  if (inProgress > 0) return "첫 파일이 진행 중이다. 지금 것만 끝내면 큰 숫자가 움직인다.";
  return "첫 파일 하나만 끝내자. 0 → 1이 제일 큰 변화다.";
}
