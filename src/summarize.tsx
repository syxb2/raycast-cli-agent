import { SelectionAnswer } from "./components/SelectionAnswer";
import { summarizePrompt } from "./lib/prompts";

export default function Command() {
  return (
    <SelectionAnswer
      navigationTitle="Summary"
      buildPrompt={summarizePrompt}
      question={(s) => `Summarize: ${s.text}`}
    />
  );
}
