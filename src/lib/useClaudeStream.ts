import { useCallback, useEffect, useRef, useState } from "react";
import {
  ClaudeError,
  RunOptions,
  RunResult,
  RateLimit,
  runClaude,
} from "./claude";
import { saveRateLimit } from "./storage";

// Her delta'da setState Raycast'te gorunur gecikme yaratir; metni ref'te
// biriktirip bu aralikla ekrana basiyoruz.
const FLUSH_MS = 80;

export interface StreamState {
  text: string;
  isLoading: boolean;
  error?: ClaudeError;
  rateLimit?: RateLimit;
  durationMs?: number;
}

export function useClaudeStream() {
  const [state, setState] = useState<StreamState>({
    text: "",
    isLoading: false,
  });
  const controller = useRef<AbortController | undefined>(undefined);
  const buffer = useRef("");
  const timer = useRef<NodeJS.Timeout | undefined>(undefined);

  const stop = useCallback(() => controller.current?.abort(), []);

  // Gorunumden cikilinca (Esc) calisan istek durdurulur.
  useEffect(() => stop, [stop]);

  const run = useCallback(
    async (opts: Omit<RunOptions, "signal" | "onText">): Promise<RunResult> => {
      controller.current?.abort();
      const ac = new AbortController();
      controller.current = ac;
      buffer.current = "";
      setState({ text: "", isLoading: true });

      timer.current = setInterval(() => {
        setState((s) =>
          s.text === buffer.current ? s : { ...s, text: buffer.current },
        );
      }, FLUSH_MS);

      const result = await runClaude({
        ...opts,
        signal: ac.signal,
        onText: (t) => (buffer.current = t),
      });
      clearInterval(timer.current);
      await saveRateLimit(result.rateLimit);

      if (controller.current === ac) {
        setState({
          text: result.text,
          isLoading: false,
          error: result.error,
          rateLimit: result.rateLimit,
          durationMs: result.durationMs,
        });
      }
      return result;
    },
    [],
  );

  return { ...state, run, stop };
}
