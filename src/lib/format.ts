import { ModelError, RateLimit } from "./types";

function clock(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  const sameDay = d.toDateString() === new Date().toDateString();
  return d.toLocaleString(
    undefined,
    sameDay
      ? { hour: "2-digit", minute: "2-digit" }
      : { weekday: "short", hour: "2-digit", minute: "2-digit" },
  );
}

export function rateLimitLines(
  r?: RateLimit,
): { title: string; text: string }[] {
  const lines: { title: string; text: string }[] = [];
  if (r?.fiveHour) {
    lines.push({
      title: "5-Hour Limit",
      text: `${Math.round(r.fiveHour.utilization * 100)}% · resets ${clock(r.fiveHour.resetsAt)}`,
    });
  }
  if (r?.sevenDay) {
    lines.push({
      title: "Weekly Limit",
      text: `${Math.round(r.sevenDay.utilization * 100)}% · resets ${clock(r.sevenDay.resetsAt)}`,
    });
  }
  return lines;
}

export function errorMarkdown(error: ModelError): string {
  const codex = error.provider === "codex";
  switch (error.kind) {
    case "not-installed":
      return codex
        ? "## Codex CLI not found\n\nInstall it: `brew install codex` (or `npm i -g @openai/codex`). The ChatGPT app also ships one.\n\nIf it lives elsewhere, set **Codex CLI Path** in the extension preferences."
        : "## Claude Code CLI not found\n\nInstall it: `curl -fsSL https://claude.ai/install.sh | bash`\n\nIf it lives elsewhere, set **Claude CLI Path** in the extension preferences.";
    case "not-logged-in":
      return codex
        ? `## Not logged in to Codex\n\nRun \`codex login\` in a terminal and sign in with your ChatGPT account.\n\n\`\`\`\n${error.message}\n\`\`\``
        : `## Not logged in to Claude\n\nRun \`claude\` in a terminal and sign in with \`/login\`.\n\n\`\`\`\n${error.message}\n\`\`\``;
    case "usage-limit":
      return `## Usage limit reached\n\n${error.message}`;
    case "cancelled":
      return "_Stopped._";
    default:
      return `## Error\n\n\`\`\`\n${error.message}\n\`\`\``;
  }
}
