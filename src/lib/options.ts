import { getPreferenceValues } from "@raycast/api";
import { currentModel } from "./models";
import { providerOf } from "./provider";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

// Codex turn effort and Pi thinking levels. Support depends on the selected model.
export const EFFORTS: { value: Effort; title: string }[] = [
  { value: "low", title: "Low" },
  { value: "medium", title: "Medium" },
  { value: "high", title: "High" },
  { value: "xhigh", title: "Extra High" },
  { value: "max", title: "Max" },
];

// What a request may use beyond plain text. Everything is off by default:
// each one makes answers slower and requests bigger.
export interface RequestOptions {
  webSearch?: boolean;
  effort?: Effort;
  // Read files anywhere in the home folder and propose shell commands, which
  // run only after the user approves them.
  tools?: boolean;
  // Folders that may be read (Finder selection), without shell commands.
  readDirs?: string[];
}

export function defaultOptions(model = currentModel()): RequestOptions {
  const prefs = getPreferenceValues<Preferences>();
  return {
    webSearch:
      providerOf(model) === "codex" ? prefs.webSearch || undefined : undefined,
    effort: (prefs.effort as Effort) || undefined,
    tools: prefs.chatTools || undefined,
  };
}

export function effortTitle(effort: Effort | undefined): string {
  return EFFORTS.find((e) => e.value === effort)?.title ?? "CLI Default";
}

// Short markers for titles: "Web · Tools · High".
export function optionBadges(o: RequestOptions | undefined): string[] {
  const badges: string[] = [];
  if (o?.webSearch) badges.push("Web");
  if (o?.tools) badges.push("Tools");
  if (o?.effort) badges.push(effortTitle(o.effort));
  return badges;
}

export function optionsForModel(
  options: RequestOptions,
  model: string,
): RequestOptions {
  return providerOf(model) === "pi"
    ? { ...options, webSearch: undefined }
    : options;
}
