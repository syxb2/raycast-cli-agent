import { environment, getPreferenceValues } from "@raycast/api";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ModelOption {
  title: string;
  value: string;
}

// --model hem tam kimligi hem takma adlari (sonnet, opus) ve [1m] gibi
// ekleri kabul ediyor (2026-10-11'de CLI ile denendi).
export const BUILTIN_MODELS: ModelOption[] = [
  { title: "Haiku 5.5", value: "claude-haiku-5-5" },
  { title: "Sonnet 5.5", value: "claude-sonnet-5-5" },
  { title: "Opus 5.5", value: "claude-opus-5-5" },
  { title: "Fable 5.1", value: "claude-fable-5-1" },
];

// Son secilen model tum komutlarda ortak ve kalici. LocalStorage async oldugu
// icin senkron okunabilen kucuk bir dosyada tutuluyor.
function currentFile(): string {
  mkdirSync(environment.supportPath, { recursive: true });
  return join(environment.supportPath, "current-model");
}

export function currentModel(): string {
  try {
    const saved = readFileSync(currentFile(), "utf8").trim();
    if (saved) return saved;
  } catch {
    // henuz secilmemis
  }
  return getPreferenceValues<Preferences>().model || "claude-haiku-5-5";
}

export function setCurrentModel(model: string): void {
  writeFileSync(currentFile(), model);
}

export function modelLabel(model: string): string {
  const m = model.match(/^claude-([a-z]+)-(\d+)-(\d+)(\[1m\])?$/i);
  if (!m) return model;
  const name = `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}`;
  return m[4] ? `${name} (1M)` : name;
}

// Hazir liste + ayarlardaki ek modeller + (listede yoksa) su anki model.
export function availableModels(): ModelOption[] {
  const custom = (getPreferenceValues<Preferences>().customModels ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const list = [...BUILTIN_MODELS];
  for (const value of [...custom, currentModel()]) {
    if (!list.some((m) => m.value === value)) {
      list.push({ title: modelLabel(value), value });
    }
  }
  return list;
}
