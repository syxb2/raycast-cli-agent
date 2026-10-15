import { ModelError, RunOptions, RunResult, systemPrompt } from "../types";
import { Provider } from "../provider";

export const APPROVAL_INSTRUCTIONS = [
  "File tools are read-only. Do not execute commands that modify files or processes.",
  "If a shell command is needed, propose it in a fenced code block tagged approve, containing only the exact command.",
  "The user will review it before the application runs it and sends its output back.",
].join(" ");

export function instructions(opts: RunOptions): string {
  const prompt = systemPrompt(opts.systemPrompt);
  return opts.tools ? `${prompt}\n\n${APPROVAL_INSTRUCTIONS}` : prompt;
}

export function splitCommands(text: string): {
  text: string;
  commands: string[];
} {
  const pattern = /(?:^|\n)```approve\r?\n([\s\S]*?)\r?\n```(?=\s|$)/g;
  return {
    text: text.replace(pattern, "\n").trim(),
    commands: [
      ...new Set(
        [...text.matchAll(pattern)].map((m) => m[1].trim()).filter(Boolean),
      ),
    ],
  };
}

export function classifyError(
  error: unknown,
  provider: Provider,
  cancelled = false,
): ModelError {
  const message = error instanceof Error ? error.message : String(error);
  const kind = cancelled
    ? "cancelled"
    : /401|unauthori[sz]ed|not logged in|login|authentication|api.?key|credentials/i.test(
          message,
        )
      ? "not-logged-in"
      : /usage limit|rate.?limit|429|quota/i.test(message)
        ? "usage-limit"
        : "other";
  return { kind, message: cancelled ? "Stopped." : message, provider };
}

export function finishResult(
  provider: Provider,
  opts: RunOptions,
  text: string,
  started: number,
  steps: string[],
  error?: unknown,
  commands: string[] = [],
): RunResult {
  const split = opts.tools ? splitCommands(text) : { text, commands: [] };
  const allCommands = [...new Set([...commands, ...split.commands])];
  return {
    text: split.text,
    isError: error !== undefined,
    error:
      error !== undefined
        ? classifyError(error, provider, opts.signal?.aborted)
        : undefined,
    durationMs: Date.now() - started,
    steps: steps.length ? steps : undefined,
    commands: allCommands.length ? allCommands : undefined,
  };
}
