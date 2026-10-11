import { environment, getPreferenceValues } from "@raycast/api";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ModelOption {
  title: string;
  value: string;
  description?: string;
  // Takma adin (opus, haiku) su an karsilik geldigi tam model kimligi.
  resolvedModel?: string;
}

export interface ModelCatalog {
  fetchedAt: number;
  models: ModelOption[];
}

// CLI'ye ulasilamazsa kullanilan yedek liste. Takma adlar bilerek tercih
// edildi: yeni bir surum ciktiginda CLI onlari kendiliginden yeniye cozer.
export const FALLBACK_MODELS: ModelOption[] = [
  { title: "Haiku", value: "haiku" },
  { title: "Sonnet", value: "sonnet" },
  { title: "Opus", value: "opus" },
  { title: "Fable", value: "fable" },
];

function supportFile(name: string): string {
  mkdirSync(environment.supportPath, { recursive: true });
  return join(environment.supportPath, name);
}

// Son secilen model tum komutlarda ortak ve kalici. LocalStorage async oldugu
// icin senkron okunabilen kucuk bir dosyada tutuluyor.
export function currentModel(): string {
  try {
    const saved = readFileSync(supportFile("current-model"), "utf8").trim();
    if (saved) return saved;
  } catch {
    // henuz secilmemis
  }
  return getPreferenceValues<Preferences>().model || "haiku";
}

export function setCurrentModel(model: string): void {
  writeFileSync(supportFile("current-model"), model);
}

export function loadCatalog(): ModelCatalog | undefined {
  try {
    return JSON.parse(readFileSync(supportFile("models.json"), "utf8"));
  } catch {
    return undefined;
  }
}

export function saveCatalog(catalog: ModelCatalog): void {
  writeFileSync(supportFile("models.json"), JSON.stringify(catalog));
}

// "opus" ile "claude-opus-5-5" ayni modeli gosterebilir; ikisi de "secili" sayilir.
export function sameModel(a: string, b: string): boolean {
  if (a === b) return true;
  const models = loadCatalog()?.models ?? [];
  const resolve = (v: string) =>
    models.find((m) => m.value === v)?.resolvedModel ?? v;
  return resolve(a) === resolve(b);
}

export function modelLabel(model: string): string {
  const known = loadCatalog()?.models.find((m) => m.value === model);
  if (known) return known.title;
  const m = model.match(/^claude-([a-z]+)-(\d+)-(\d+)(\[1m\])?$/i);
  if (!m) return model;
  const name = `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}`;
  return m[4] ? `${name} (1M)` : name;
}

// CLI'nin listesi (yoksa yedek) + ayarlardaki ek modeller + listede yoksa su anki model.
export function availableModels(): ModelOption[] {
  const list = [...(loadCatalog()?.models ?? FALLBACK_MODELS)];
  const custom = (getPreferenceValues<Preferences>().customModels ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const value of [...custom, currentModel()]) {
    if (!list.some((m) => sameModel(m.value, value))) {
      list.push({ title: modelLabel(value), value });
    }
  }
  return list;
}

// Acilir menude secili gorunmesi icin su anki modelin listedeki karsiligi.
export function matchingValue(model: string, list: ModelOption[]): string {
  return list.find((m) => sameModel(m.value, model))?.value ?? model;
}
