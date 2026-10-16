import { useCallback, useEffect, useRef, useState } from "react";
import { runModel } from "./run";
import { ModelError, RateLimit, RunOptions, RunResult } from "./types";
import { saveRateLimit } from "./storage";

const FLUSH_MS = 80;

export interface StreamState {
  text: string;
  isLoading: boolean;
  error?: ModelError;
  rateLimit?: RateLimit;
  durationMs?: number;
  commands?: string[];
  steps?: string[];
}

export function useModelStream() {
  const [state, setState] = useState<StreamState>({
    text: "",
    isLoading: false,
  });
  const controller = useRef<AbortController | undefined>(undefined);
  const stop = useCallback(() => controller.current?.abort(), []);
  useEffect(() => stop, [stop]);

  const run = useCallback(
    async (
      opts: Omit<RunOptions, "onText" | "onSteps">,
    ): Promise<RunResult> => {
      controller.current?.abort();
      const ac = new AbortController();
      controller.current = ac;
      const abort = () => ac.abort();
      opts.signal?.addEventListener("abort", abort, { once: true });
      if (opts.signal?.aborted) ac.abort();
      let text = "";
      let steps: string[] | undefined;
      let receivedText = false;
      setState({ text: "", isLoading: true });
      const timer = setInterval(() => {
        if (controller.current !== ac) return;
        setState((s) =>
          s.text === text && s.steps === steps ? s : { ...s, text, steps },
        );
      }, FLUSH_MS);
      try {
        const result = await runModel({
          ...opts,
          signal: ac.signal,
          onText: (t) => {
            text = t;
            // Show the first content immediately. Coalesce subsequent deltas
            // at FLUSH_MS so a fast token stream does not overwhelm Raycast.
            if (!receivedText && t && controller.current === ac) {
              receivedText = true;
              setState((s) => ({ ...s, text: t, steps }));
            }
          },
          onSteps: (s) => {
            steps = s;
          },
        });
        await saveRateLimit(result.rateLimit);
        if (controller.current === ac)
          setState({ ...result, isLoading: false });
        return result;
      } finally {
        clearInterval(timer);
        opts.signal?.removeEventListener("abort", abort);
      }
    },
    [],
  );

  return { ...state, run, stop };
}
