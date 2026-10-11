export type Provider = "claude" | "codex";

// Claude model values stay as the CLI takes them (haiku, claude-opus-5-5) so
// existing settings keep working; Codex models carry this prefix.
export const CODEX_PREFIX = "codex:";

// Runs Codex with its own configured default model (no -m).
export const CODEX_DEFAULT = `${CODEX_PREFIX}default`;

export function providerOf(model: string): Provider {
  return model.startsWith(CODEX_PREFIX) ? "codex" : "claude";
}

export function codexModelId(model: string): string | undefined {
  const id = model.slice(CODEX_PREFIX.length);
  return id && id !== "default" ? id : undefined;
}

export const PROVIDER_NAMES: Record<Provider, string> = {
  claude: "Claude Code",
  codex: "Codex",
};
