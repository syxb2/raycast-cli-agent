import { ClaudeError, RateLimit } from "./claude";

function clock(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  const sameDay = d.toDateString() === new Date().toDateString();
  return d.toLocaleString(
    "tr-TR",
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
      title: "5 Saatlik Kota",
      text: `%${Math.round(r.fiveHour.utilization * 100)} · ${clock(r.fiveHour.resetsAt)}'de sıfırlanır`,
    });
  }
  if (r?.sevenDay) {
    lines.push({
      title: "Haftalık Kota",
      text: `%${Math.round(r.sevenDay.utilization * 100)} · ${clock(r.sevenDay.resetsAt)}'de sıfırlanır`,
    });
  }
  return lines;
}

export function errorMarkdown(error: ClaudeError): string {
  switch (error.kind) {
    case "not-installed":
      return "## Claude Code CLI bulunamadı\n\nKur: `curl -fsSL https://claude.ai/install.sh | bash`\n\nFarklı bir yerdeyse eklenti ayarlarından **Claude CLI Yolu**'nu gir.";
    case "not-logged-in":
      return `## Claude'a giriş yapılmamış\n\nTerminalde \`claude\` çalıştırıp \`/login\` ile Claude hesabınla giriş yap.\n\n\`\`\`\n${error.message}\n\`\`\``;
    case "usage-limit":
      return `## Kullanım sınırına ulaşıldı\n\n${error.message}`;
    case "cancelled":
      return "_Durduruldu._";
    default:
      return `## Hata\n\n\`\`\`\n${error.message}\n\`\`\``;
  }
}

export function modelLabel(model: string): string {
  const m = model.match(/claude-(\w+)-(\d+)-(\d+)/);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}.${m[3]}` : model;
}
