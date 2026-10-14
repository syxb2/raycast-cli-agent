import { spawn } from "node:child_process";
import { homedir, userInfo } from "node:os";

const TIMEOUT_MS = 120_000;
// Enough for the model to work with; huge outputs would only cost tokens.
const MAX_OUTPUT = 20_000;

export interface ShellResult {
  output: string;
  exitCode: number | null;
  timedOut: boolean;
}

// Runs a command the user approved, in a login shell so Homebrew & co. are on
// PATH (Raycast's own PATH is minimal). stdout and stderr are interleaved.
export function runApprovedCommand(command: string): Promise<ShellResult> {
  const { username } = userInfo();
  return new Promise((resolve) => {
    const child = spawn("/bin/zsh", ["-lc", command], {
      cwd: homedir(),
      env: {
        ...process.env,
        USER: process.env.USER ?? username,
        LOGNAME: process.env.LOGNAME ?? username,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let timedOut = false;
    const collect = (chunk: Buffer) => (output += chunk.toString());
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ output: err.message, exitCode: null, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ output, exitCode: code, timedOut });
    });
  });
}

// The follow-up message that hands the result back to the model.
export function commandResultPrompt(command: string, r: ShellResult): string {
  const trimmed =
    r.output.length > MAX_OUTPUT
      ? `${r.output.slice(0, MAX_OUTPUT)}\n… (${r.output.length - MAX_OUTPUT} more characters cut)`
      : r.output;
  const status = r.timedOut
    ? `was stopped after ${TIMEOUT_MS / 1000} s`
    : `exited with code ${r.exitCode}`;
  return [
    `I approved and ran your command; it ${status}.`,
    "```sh",
    command,
    "```",
    "Output:",
    "```",
    trimmed.trimEnd() || "(no output)",
    "```",
    "Continue with my request.",
  ].join("\n");
}
