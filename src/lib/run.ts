import { runClaude } from "./claude";
import { runCodex } from "./codex";
import { currentModel } from "./models";
import { providerOf } from "./provider";
import { RunOptions, RunResult } from "./types";

// Sends the request to the CLI that owns the model.
export function runModel(opts: RunOptions): Promise<RunResult> {
  const model = opts.model ?? currentModel();
  return providerOf(model) === "codex"
    ? runCodex({ ...opts, model })
    : runClaude({ ...opts, model });
}
