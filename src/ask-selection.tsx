import { LaunchProps } from "@raycast/api";
import { SelectionAnswer } from "./components/SelectionAnswer";
import { askAboutPrompt } from "./lib/prompts";

export default function Command(
  props: LaunchProps<{ arguments: Arguments.AskSelection }>,
) {
  const question =
    props.arguments.question?.trim() || "Bu metin hakkında ne söyleyebilirsin?";
  return (
    <SelectionAnswer
      navigationTitle="Seçim Hakkında"
      buildPrompt={(t) => askAboutPrompt(t, question)}
      question={() => question}
    />
  );
}
