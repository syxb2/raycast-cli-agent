import { ClaudeError, RateLimit } from "./claude";

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

export function errorMarkdown(error: ClaudeError): string {
  switch (error.kind) {
    case "not-installed":
      return "## Claude Code CLI not found\n\nInstall it: `curl -fsSL https://claude.ai/install.sh | bash`\n\nIf it lives elsewhere, set **Claude CLI Path** in the extension preferences.";
    case "not-logged-in":
      return `## Not logged in to Claude\n\nRun \`claude\` in a terminal and sign in with \`/login\`.\n\n\`\`\`\n${error.message}\n\`\`\``;
    case "usage-limit":
      return `## Usage limit reached\n\n${error.message}`;
    case "cancelled":
      return "_Stopped._";
    default:
      return `## Error\n\n\`\`\`\n${error.message}\n\`\`\``;
  }
}
