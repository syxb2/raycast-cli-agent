import { getPreferenceValues } from "@raycast/api";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

// Both CLIs take the same levels: claude --effort, codex model_reasoning_effort.
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

export function defaultOptions(): RequestOptions {
  const prefs = getPreferenceValues<Preferences>();
  return {
    webSearch: prefs.webSearch || undefined,
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
