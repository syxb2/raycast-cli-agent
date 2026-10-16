import { isNativeDefault, ModelOption, modelsForProvider } from "./models";
import { defaultOptions, optionsForModel } from "./options";
import { providerOf } from "./provider";
import { Conversation, newConversation } from "./storage";

export function chatModelChoices(
  conversation: Conversation,
  models: ModelOption[],
): ModelOption[] {
  const boundModels = modelsForProvider(models, conversation.provider);
  return conversation.messages.length
    ? boundModels
    : [
        ...models.filter(
          (m) =>
            providerOf(m.value) !== conversation.provider &&
            !isNativeDefault(m.value),
        ),
        ...boundModels,
      ];
}

export function selectChatModel(
  conversation: Conversation,
  model: string,
): Conversation {
  if (providerOf(model) !== conversation.provider) {
    if (conversation.messages.length)
      throw new Error("Start a new chat to use another agent.");
    // Replace an unsent draft with a new identity; never rebind its session.
    return newConversation(model, defaultOptions(model));
  }
  return {
    ...conversation,
    model,
    options: optionsForModel(conversation.options ?? {}, model),
  };
}
