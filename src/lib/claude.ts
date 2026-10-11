import { environment, getPreferenceValues } from "@raycast/api";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { currentModel } from "./models";

export interface RateLimit {
  fiveHour?: { utilization: number; resetsAt: number };
  sevenDay?: { utilization: number; resetsAt: number };
}

export interface RunOptions {
  prompt: string;
  model?: string;
  systemPrompt?: string;
  // Multi-turn chat: --session-id if the session is not on disk yet, else --resume.
  sessionId?: string;
  signal?: AbortSignal;
  onText?: (fullText: string) => void;
}

export interface RunResult {
  text: string;
  isError: boolean;
  error?: ClaudeError;
  rateLimit?: RateLimit;
  durationMs?: number;
}

export type ClaudeErrorKind =
  "not-installed" | "not-logged-in" | "usage-limit" | "cancelled" | "other";

export interface ClaudeError {
  kind: ClaudeErrorKind;
  message: string;
}

const DEFAULT_SYSTEM_PROMPT = [
  "You are a concise assistant invoked from Raycast.",
  "Reply in the language the user writes in.",
  "Skip filler and preambles; get straight to the answer.",
  "Use Markdown when helpful; use fenced code blocks with a language tag for code.",
].join(" ");

export function systemPrompt(base = DEFAULT_SYSTEM_PROMPT): string {
  const extra = getPreferenceValues<Preferences>().extraInstructions?.trim();
  return extra
    ? `${base}\n\nAdditional instructions from the user: ${extra}`
    : base;
}

// Raycast's Node process does not inherit the shell PATH; absolute paths only.
export function resolveClaudeBinary(): string | undefined {
  const custom = getPreferenceValues<Preferences>().claudePath?.trim();
  const candidates = custom
    ? [custom.replace(/^~(?=\/)/, homedir())]
    : [
        join(homedir(), ".local/bin/claude"),
        "/opt/homebrew/bin/claude",
        "/usr/local/bin/claude",
      ];
  return candidates.find((p) => existsSync(p));
}

// --setting-sources "" also skips the user's settings.json, so its proxy
// variables are read here and passed to the child process.
function proxyEnv(): Record<string, string> {
  try {
    const settings = JSON.parse(
      readFileSync(join(homedir(), ".claude/settings.json"), "utf8"),
    );
    const env = settings?.env ?? {};
    const keys = ["HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"];
    return Object.fromEntries(
      keys.filter((k) => typeof env[k] === "string").map((k) => [k, env[k]]),
    );
  } catch {
    return {};
  }
}

export function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...proxyEnv() };
  // Raycast extension processes have no USER/LOGNAME. Claude Code looks up its
  // Keychain login with them and reports "Not logged in" without them
  // (verified 2026-10-11).
  const { username } = userInfo();
  env.USER ??= username;
  env.LOGNAME ??= username;
  // With ANTHROPIC_API_KEY set, -p always uses it instead of the subscription.
  delete env.ANTHROPIC_API_KEY;
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = "1";
  env.CLAUDE_CODE_DISABLE_CLAUDE_MDS = "1";
  env.DISABLE_AUTOUPDATER = "1";
  return env;
}

// Session files go to ~/.claude/projects/<cwd>; run in the extension's own
// folder so they don't mix with real projects.
export function workDir(): string {
  const dir = join(environment.supportPath, "sessions");
  mkdirSync(dir, { recursive: true });
  return dir;
}

// A cancelled first turn can still leave a session file, so check the disk
// instead of guessing: reusing an id with --session-id fails as "in use".
function sessionExists(sessionId: string): boolean {
  const root = join(homedir(), ".claude/projects");
  try {
    return readdirSync(root).some((d) =>
      existsSync(join(root, d, `${sessionId}.jsonl`)),
    );
  } catch {
    return false;
  }
}

export function classifyError(message: string): ClaudeError {
  if (
    /not logged in|login expired|\/login|invalid api key|authentication/i.test(
      message,
    )
  ) {
    return { kind: "not-logged-in", message };
  }
  if (/hit your .*limit|usage limit|rate.?limit/i.test(message)) {
    return { kind: "usage-limit", message };
  }
  return { kind: "other", message };
}

function parseRateLimit(
  info: Record<string, unknown> | undefined,
): RateLimit | undefined {
  const windows = info?.unifiedWindows as
    Record<string, { utilization: number; resetsAt: number }> | undefined;
  if (!windows) return undefined;
  return { fiveHour: windows.five_hour, sevenDay: windows.seven_day };
}

export function runClaude(opts: RunOptions): Promise<RunResult> {
  const bin = resolveClaudeBinary();
  if (!bin) {
    return Promise.resolve({
      text: "",
      isError: true,
      error: { kind: "not-installed", message: "Claude Code CLI not found." },
    });
  }

  const args = [
    "-p",
    "--model",
    opts.model ?? currentModel(),
    // A chat assistant, not a coding agent: tools, MCP, settings files and
    // slash commands are off. Time to answer drops from ~9 s to ~3 s
    // (measured 2026-10-11). --bare is faster but ignores OAuth logins.
    "--tools",
    "",
    "--strict-mcp-config",
    "--setting-sources",
    "",
    "--disable-slash-commands",
    "--system-prompt",
    opts.systemPrompt ?? systemPrompt(),
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--verbose",
  ];
  if (opts.sessionId) {
    args.push(
      sessionExists(opts.sessionId) ? "--resume" : "--session-id",
      opts.sessionId,
    );
  } else {
    args.push("--no-session-persistence");
  }

  return new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: workDir(),
      env: childEnv(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    // Prompt via stdin avoids argv length/escaping issues. -p never returns
    // while stdin is open, so end() right away.
    child.stdin.end(opts.prompt);

    let text = "";
    let resultText: string | undefined;
    let resultIsError = false;
    let durationMs: number | undefined;
    let rateLimit: RateLimit | undefined;
    let stderr = "";
    let cancelled = false;

    const onAbort = () => {
      cancelled = true;
      // SIGINT ends the turn cleanly; SIGTERM leaves a partial session record.
      child.kill("SIGINT");
    };
    if (opts.signal?.aborted) onAbort();
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    createInterface({ input: child.stdout }).on("line", (line) => {
      let event: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      if (event.type === "stream_event") {
        const delta = event.event?.delta;
        if (
          event.event?.type === "content_block_delta" &&
          delta?.type === "text_delta"
        ) {
          text += delta.text;
          opts.onText?.(text);
        }
      } else if (event.type === "rate_limit_event") {
        rateLimit = parseRateLimit(event.rate_limit_info) ?? rateLimit;
      } else if (event.type === "result") {
        resultText =
          typeof event.result === "string" ? event.result : undefined;
        resultIsError = Boolean(event.is_error) || event.subtype !== "success";
        durationMs = event.duration_ms;
      }
    });
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));

    child.on("error", (err) => {
      resolve({
        text,
        isError: true,
        error: { kind: "other", message: err.message },
      });
    });

    child.on("close", (code) => {
      opts.signal?.removeEventListener("abort", onAbort);
      if (cancelled) {
        resolve({
          text,
          isError: true,
          error: { kind: "cancelled", message: "Stopped." },
          rateLimit,
        });
        return;
      }
      // -p reports in-run errors in the result text, not on stderr.
      const finalText = text || resultText || "";
      if (resultIsError || (code !== 0 && !finalText)) {
        const message = (
          resultText ||
          stderr ||
          finalText ||
          `claude exited with code ${code}`
        ).trim();
        resolve({
          text: finalText,
          isError: true,
          error: classifyError(message),
          rateLimit,
          durationMs,
        });
        return;
      }
      resolve({ text: finalText, isError: false, rateLimit, durationMs });
    });
  });
}
