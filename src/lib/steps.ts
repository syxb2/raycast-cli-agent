import { homedir } from "node:os";

// What the model did while answering (searches, files read, commands run),
// shown live and kept above the answer. Read-only commands can run without
// asking, so this is also where the user sees them.

const clip = (s: string, n = 90) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;
const code = (s: string) =>
  `\`${clip(s.replace(/\s+/g, " ")).replace(/`/g, "'")}\``;

function shortPath(p: string): string {
  const home = homedir();
  return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

function webStep(queryOrUrl: string): string {
  return /^https?:\/\//.test(queryOrUrl)
    ? `🌐 Opened ${clip(queryOrUrl)}`
    : `🔎 Searched the web: ${clip(queryOrUrl)}`;
}

export const SEARCHING_STEP = "🔎 Searching the web…";

export function piToolStep(
  name: string,
  input: Record<string, unknown>,
): string {
  if (name === "read")
    return `📄 Read ${shortPath(String(input.path || input.file_path || "file"))}`;
  if (name === "grep")
    return `🗂 Searched files for ${code(String(input.pattern || ""))}`;
  if (name === "find" || name === "ls")
    return `🗂 Listed ${shortPath(String(input.path || input.pattern || "."))}`;
  return `🔧 Used ${name}`;
}

// Codex reports commands wrapped as /bin/zsh -lc '<command>' (or "<command>").
export function codexCommandStep(command: string): string {
  const m = command.match(/^\S*\/(?:ba|z)?sh -l?c (['"])([\s\S]*)\1$/);
  const inner = !m
    ? command
    : m[1] === "'"
      ? m[2].replace(/'\\''/g, "'")
      : m[2].replace(/\\(["\\$`])/g, "$1");
  return `💻 Ran ${code(inner)}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function codexWebStep(item: any): string {
  const q = item?.action?.query || item?.query;
  return q ? webStep(q) : SEARCHING_STEP;
}

export function stepsMarkdown(steps: string[] | undefined): string {
  if (!steps?.length) return "";
  return `${steps.map((s) => `> ${s}`).join("  \n")}\n\n`;
}

export function claudeToolStep(
  name: string,
  input: Record<string, unknown>,
): string {
  if (name === "WebSearch") return webStep(String(input.query || ""));
  if (name === "WebFetch") return webStep(String(input.url || ""));
  return piToolStep(
    name === "Read"
      ? "read"
      : name === "Grep"
        ? "grep"
        : name === "Glob"
          ? "find"
          : name,
    input,
  );
}

export function antigravityToolStep(
  name: string,
  input: Record<string, unknown>,
): string {
  const normalized = name.trim();
  if (normalized === "search_web") {
    const query = String(input.query || "").trim();
    return query ? webStep(query) : SEARCHING_STEP;
  }
  if (normalized === "read_file")
    return `📄 Read ${shortPath(String(input.Path || input.file_path || "file"))}`;
  if (normalized === "write_file")
    return `✏️ Wrote ${shortPath(String(input.Path || input.file_path || "file"))}`;
  if (normalized === "edit_file")
    return `✏️ Edited ${shortPath(String(input.Path || input.file_path || "file"))}`;
  if (normalized === "run_command")
    return `💻 Ran ${code(String(input.CommandLine || input.command || ""))}`;
  if (normalized === "call_mcp_tool") {
    const server =
      typeof input.ServerName === "string" ? input.ServerName.trim() : "";
    const tool =
      typeof input.ToolName === "string" ? input.ToolName.trim() : "";
    return server && tool ? `🔧 Used ${server}/${tool}` : "🔧 Used MCP tool";
  }
  return `🔧 Used ${normalized || "tool"}`;
}
