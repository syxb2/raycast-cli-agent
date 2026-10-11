import { LaunchProps } from "@raycast/api";
import { SelectionAnswer } from "./components/SelectionAnswer";
import { askAboutPrompt } from "./lib/prompts";

export default function Command(
  props: LaunchProps<{ arguments: Arguments.AskSelection }>,
) {
  const question =
    props.arguments.question?.trim() || "What can you tell me about this text?";
  return (
    <SelectionAnswer
      navigationTitle="About Selection"
      buildPrompt={(t) => askAboutPrompt(t, question)}
      question={() => question}
    />
  );
}
