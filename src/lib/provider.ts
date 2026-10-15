export type Provider = "codex" | "pi";

export const CODEX_PREFIX = "codex:";
export const PI_PREFIX = "pi:";

// Runs Codex with its own configured default model (no -m).
export const CODEX_DEFAULT = `${CODEX_PREFIX}default`;
export const PI_DEFAULT = `${PI_PREFIX}default`;

export function isSupportedModel(model: string): boolean {
  return model.startsWith(CODEX_PREFIX) || model.startsWith(PI_PREFIX);
}

export function providerOf(model: string): Provider {
  if (!isSupportedModel(model)) throw new Error(`Unsupported model: ${model}`);
  return model.startsWith(PI_PREFIX) ? "pi" : "codex";
}

export function codexModelId(model: string): string | undefined {
  const id = model.slice(CODEX_PREFIX.length);
  return id && id !== "default" ? id : undefined;
}

export const PROVIDER_NAMES: Record<Provider, string> = {
  codex: "Codex",
  pi: "Pi Agent",
};

export function piModelId(
  model: string,
): { provider: string; modelId: string } | undefined {
  if (model === PI_DEFAULT) return undefined;
  const raw = model.slice(PI_PREFIX.length);
  const slash = raw.indexOf("/");
  if (slash <= 0 || slash === raw.length - 1)
    throw new Error("Pi models use pi:provider/model-id.");
  return { provider: raw.slice(0, slash), modelId: raw.slice(slash + 1) };
}
