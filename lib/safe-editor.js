import { readControlToken } from "./validation.js";

const SPEAKER_RE = /^\$Ws([^|]*)\|/u;

export function buildSafeEditTemplate(source) {
  const script = String(source || "");
  const parts = [];
  let buffer = "";
  let speaker = "";
  let leadingLocked = [];
  let textIndex = 0;

  const flushText = () => {
    if (!buffer.length) return;
    parts.push({
      type: "text",
      value: buffer,
      original: buffer,
      textIndex,
      speaker,
      leadingLocked,
    });
    textIndex += 1;
    buffer = "";
    leadingLocked = [];
  };

  for (let index = 0; index < script.length;) {
    if (script.startsWith("\\n", index)) {
      flushText();
      const token = "\\n";
      parts.push({ type: "locked", value: token });
      leadingLocked.push(token);
      index += token.length;
      continue;
    }

    if (script[index] === "$") {
      const token = readControlToken(script, index);
      if (token) {
        flushText();
        parts.push({ type: "locked", value: token });
        leadingLocked.push(token);
        const speakerMatch = token.match(SPEAKER_RE);
        if (speakerMatch) speaker = speakerMatch[1] || speaker;
        index += token.length;
        continue;
      }
    }

    buffer += script[index];
    index += 1;
  }
  flushText();

  return {
    source: script,
    parts,
    textParts: parts.filter((part) => part.type === "text"),
  };
}

export function rebuildSafeEditTemplate(template, values) {
  const replacements = Array.isArray(values) ? values : [];
  return template.parts.map((part) => {
    if (part.type === "locked") return part.value;
    return String(replacements[part.textIndex] ?? part.value);
  }).join("");
}

export function validateSafeText(value) {
  const text = String(value ?? "");
  const errors = [];
  if (/[\r\n]/u.test(text)) errors.push("Enter 줄바꿈은 사용할 수 없습니다. 게임 줄바꿈은 잠겨 있습니다.");
  if (text.includes("\\n")) errors.push("\\n 제어 줄바꿈은 직접 입력할 수 없습니다.");
  if (text.includes("$")) errors.push("$ 제어코드는 대사 전용 편집기에서 입력할 수 없습니다.");
  return { valid: errors.length === 0, errors };
}

export function summarizeLockedContext(tokens = []) {
  const labels = [];
  for (const token of tokens) {
    if (token === "\\n") labels.push("줄바꿈");
    else if (token === "$k") labels.push("대사 넘김");
    else if (token === "$p") labels.push("문단 넘김");
    else if (token === "$Nu") labels.push("주인공 이름");
    else if (token.startsWith("$KrP")) labels.push("조사");
    else if (token.startsWith("$G")) labels.push("성별 분기");
  }
  return [...new Set(labels)];
}
