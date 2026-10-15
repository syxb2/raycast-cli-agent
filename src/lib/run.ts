import { runCodex } from "./codex";
import { runPi } from "./pi";
import { getProviderSettings } from "./settings";
import { currentModel } from "./models";
import { providerOf } from "./provider";
import { RunOptions, RunResult } from "./types";
import { claimSessionProvider, serializeSession } from "./backend/sessions";

export async function runModel(opts: RunOptions): Promise<RunResult> {
  const model = opts.model ?? currentModel();
  try {
    const provider = providerOf(model);
    if (!getProviderSettings(provider).enabled)
      throw new Error(
        `${provider} is disabled. Enable it in Cli Agent Settings.`,
      );
    return await serializeSession(opts.sessionId, () => {
      claimSessionProvider(opts.sessionId, provider);
      return provider === "codex"
        ? runCodex({ ...opts, model })
        : runPi({ ...opts, model });
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
