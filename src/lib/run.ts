import { runCodex } from "./codex";
import { runPi } from "./pi";
import { runClaude } from "./claude";
import { getProviderSettings } from "./settings";
import { currentModel } from "./models";
import { providerOf } from "./provider";
import { RunOptions, RunResult } from "./types";
import { claimSessionProvider, serializeSession } from "./backend/sessions";

export async function runModel(opts: RunOptions): Promise<RunResult> {
  const model = opts.model ?? currentModel();
  try {
    const provider = providerOf(model);
    const settings = getProviderSettings(provider);
    if (!settings.enabled)
      throw new Error(
        `${provider} is disabled. Enable it in Cli Agent Settings.`,
      );
    return await serializeSession(opts.sessionId, () => {
      claimSessionProvider(opts.sessionId, provider);
      const current = getProviderSettings(provider);
      if (!current.enabled)
        throw new Error(
          `${provider} is disabled. Enable it in Cli Agent Settings.`,
        );
      const request = {
        ...opts,
        model,
        tools: current.toolAccess !== "none",
        allowAllTools: current.toolAccess === "all",
        readDirs: current.toolAccess === "none" ? undefined : opts.readDirs,
        webSearch:
          opts.webSearch ??
          ("webSearch" in current ? current.webSearch : false),
      };
      return provider === "codex"
        ? runCodex(request)
        : provider === "claude"
          ? runClaude(request)
          : runPi(request);
    });
  } catch (error) {
    return {
      text: "",
      isError: true,
      error: {
        kind: "other",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
