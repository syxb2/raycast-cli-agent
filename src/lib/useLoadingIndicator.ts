import { useEffect, useState } from "react";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// Markdown has no native spinner. Advance a compact dot spinner while a request
// is running, including time spent waiting for the CLI or its tools.
export function useLoadingIndicator(active: boolean): string {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    setFrame(0);
    const timer = setInterval(
      () => setFrame((value) => (value + 1) % FRAMES.length),
      80,
    );
    return () => clearInterval(timer);
  }, [active]);
  return FRAMES[frame];
}
