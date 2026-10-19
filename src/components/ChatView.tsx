import {
  Action,
  ActionPanel,
  Icon,
  Keyboard,
  List,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useEffect, useRef, useState } from "react";
import { errorMarkdown, footerMarkdown } from "../lib/format";
import { stepsMarkdown } from "../lib/steps";
import {
  currentModel,
  availableModels,
  groupByProvider,
  matchingValue,
  modelLabel,
  setCurrentModel,
} from "../lib/models";
import { useModels } from "../lib/modelCatalog";
import { defaultOptions, optionBadges, RequestOptions } from "../lib/options";
import { Provider, PROVIDER_NAMES, providerOf } from "../lib/provider";
import { commandResultPrompt, runApprovedCommand } from "../lib/shell";
import {
  Conversation,
  Message,
  newConversation,
  saveConversation,
  titleFrom,
} from "../lib/storage";
import { useModelStream } from "../lib/useModelStream";
import { useLoadingIndicator } from "../lib/useLoadingIndicator";
import { chatModelChoices, selectChatModel } from "../lib/chat";
import { HistoryView } from "./HistoryView";
import { SettingsView } from "./SettingsView";
import {
  enabledProviders,
  getProviderSettings,
  getSettings,
} from "../lib/settings";
import { ErrorActions, OptionActions, STOP_SHORTCUT } from "./shared";

export function ChatView({
  initial,
  firstQuestion,
  autoRun,
}: {
  initial?: Conversation;
  firstQuestion?: string;
  // A command approved before the chat opened (on an Ask AI answer); it is
  // run against the last message right away.
  autoRun?: string;
}) {
  const { push } = useNavigation();
  const [conversation, setConversationState] = useState<Conversation>(
    () => initial ?? newConversation(currentModel(), defaultOptions()),
  );
  // Native dropdown callbacks can arrive from a render before send(). Keep
  // their source current synchronously, even before React renders the message.
  const currentConversation = useRef(conversation);
  const setConversation = (
    update: Conversation | ((previous: Conversation) => Conversation),
  ) => {
    const next =
      typeof update === "function"
        ? update(currentConversation.current)
        : update;
    currentConversation.current = next;
    setConversationState(next);
  };
  // Match Raycast's initial fallback search text, then clear it when sending.
  // Starting with an empty value lets its delayed prefill overwrite our reset.
  const [input, setInput] = useState(firstQuestion?.trim() || "");
  // Fallback launches already contain a question. Render its pending row on
  // the first frame, before model discovery or the CLI has finished starting.
  const [queuedQuestion, setQueuedQuestion] = useState<Message | undefined>(
    () =>
      firstQuestion?.trim()
        ? {
            id: crypto.randomUUID(),
            question: firstQuestion.trim(),
            answer: "",
            createdAt: Date.now(),
            model: conversation.model,
          }
        : undefined,
  );
  const [selectedId, setSelectedId] = useState<string | undefined>(
    queuedQuestion?.id ?? conversation.messages.at(-1)?.id,
  );
  const [pendingId, setPendingId] = useState<string | undefined>();
  const stream = useModelStream();
  const isLoading = Boolean(queuedQuestion) || stream.isLoading;
  const spinner = useLoadingIndicator(isLoading);
  const displayedPendingId = queuedQuestion?.id ?? pendingId;
  const catalog = useModels();
  const models = chatModelChoices(conversation, catalog.models);
  const currentModelValue = matchingValue(conversation.model, models);
  // Resolve the restored draft selection in the same render as the new model
  // list. Discovery can finish before the effect updates the conversation.
  const modelToRestore =
    !currentModelValue &&
    !conversation.messages.length &&
    getProviderSettings(conversation.provider).enabled
      ? matchingValue(currentModel(conversation.provider), models)
      : "";
  const selectedModelValue = currentModelValue || modelToRestore;
  const selectedModel = models.find((m) => m.value === selectedModelValue);
  const sentFirst = useRef(false);
  // If "New Chat" is opened mid-request, the late answer must not land in the new chat.
  const activeId = useRef(conversation.id);

  useEffect(() => {
    if (!firstQuestion?.trim() || sentFirst.current || queuedQuestion) return;
    // Raycast can deliver fallback launch props after the initial render.
    const message: Message = {
      id: crypto.randomUUID(),
      question: firstQuestion.trim(),
      answer: "",
      createdAt: Date.now(),
      model: conversation.model,
    };
    setQueuedQuestion(message);
    setSelectedId(message.id);
    setInput(firstQuestion.trim());
  }, [firstQuestion]);

  useEffect(() => {
    if (!modelToRestore) return;
    setConversation((previous) =>
      previous.id !== conversation.id ||
      previous.messages.length ||
      matchingValue(previous.model, models)
        ? previous
        : selectChatModel(previous, modelToRestore),
    );
  }, [conversation.id, modelToRestore]);

  // `prompt` replaces the question for the model (approved command results);
  // `from` is the conversation to continue when state isn't updated yet.
  const send = async (
    question: string,
    prompt?: string,
    from: Conversation = conversation,
  ) => {
    const q = question.trim();
    if (!q || stream.isLoading) return;
    if (!matchingValue(from.model, availableModels())) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Select a visible model",
        message:
          "Open Settings → Model Browser to choose an authenticated model.",
      });
      return;
    }
    const msg: Message = {
      id: queuedQuestion?.id ?? crypto.randomUUID(),
      question: q,
      answer: "",
      createdAt: Date.now(),
      model: from.model,
    };
    const base: Conversation = {
      ...from,
      title: from.title || titleFrom(q),
      messages: [...from.messages, msg],
    };
    setConversation(base);
    setQueuedQuestion(undefined);
    setInput("");
    setSelectedId(msg.id);
    setPendingId(msg.id);

    const result = await stream.run({
      prompt: prompt ?? q,
      model: from.model,
      sessionId: from.sessionId,
      ...from.options,
    });
    const finished: Message = {
      ...msg,
      answer: result.text,
      error:
        result.isError && !result.text
          ? errorMarkdown(result.error!)
          : undefined,
      commands: result.commands,
      steps: result.steps,
      durationMs: result.durationMs,
    };
    const updated = {
      ...base,
      updatedAt: Date.now(),
      messages: base.messages.map((m) => (m.id === msg.id ? finished : m)),
    };
    await saveConversation(updated);
    if (activeId.current !== updated.id) return;
    setConversation(updated);
    setPendingId(undefined);
  };

  useEffect(() => {
    // Deferred for the same StrictMode reason as in AnswerView.
    if (!firstQuestion || sentFirst.current) return;
    if (!matchingValue(conversation.model, models)) {
      if (catalog.isRefreshing) return;
      // The default may have become available after loading the shell's
      // environment; let the normalization effect select it before sending.
      if (matchingValue(currentModel(conversation.provider), models)) return;
      sentFirst.current = true;
      setQueuedQuestion(undefined);
      setInput(firstQuestion);
      return;
    }
    const timer = setTimeout(() => {
      if (sentFirst.current) return;
      sentFirst.current = true;
      send(firstQuestion);
    }, 0);
    return () => clearTimeout(timer);
  }, [firstQuestion, catalog.isRefreshing, catalog.models, conversation.model]);

  useEffect(() => {
    const last = conversation.messages.at(-1);
    if (!autoRun || !last || sentFirst.current) return;
    const timer = setTimeout(() => {
      sentFirst.current = true;
      runCommand(last, autoRun);
    }, 0);
    return () => clearTimeout(timer);
  }, [autoRun]);

  const stop = () => {
    if (queuedQuestion) {
      sentFirst.current = true;
      setInput(queuedQuestion.question);
      setQueuedQuestion(undefined);
    }
    stream.stop();
  };

  const startNew = (
    provider: Provider = getSettings().general.defaultProvider,
  ) => {
    sentFirst.current = true;
    setQueuedQuestion(undefined);
    stream.stop();
    const model =
      provider === conversation.provider
        ? conversation.model
        : currentModel(provider);
    const fresh = newConversation(
      model,
      provider === conversation.provider
        ? conversation.options
        : defaultOptions(model),
    );
    setCurrentModel(model);
    activeId.current = fresh.id;
    setPendingId(undefined);
    setConversation(fresh);
    setSelectedId(undefined);
    setInput("");
  };

  const changeModel = (model: string) => {
    const current = currentConversation.current;
    if (
      current.id !== conversation.id ||
      model === current.model ||
      !availableModels().some((m) => m.value === model) ||
      !getProviderSettings(providerOf(model)).enabled ||
      (current.messages.length > 0 && providerOf(model) !== current.provider)
    )
      return;
    setCurrentModel(model);
    const updated = selectChatModel(current, model);
    activeId.current = updated.id;
    setConversation(updated);
    if (updated.messages.length) void saveConversation(updated);
  };

  const changeOptions = (options: RequestOptions) => {
    const current = currentConversation.current;
    if (current.id !== conversation.id) return;
    const updated = { ...current, options };
    setConversation(updated);
    if (updated.messages.length) saveConversation(updated);
  };

  // The approved command runs here, not in the CLI; its output goes back as
  // the next message.
  const runCommand = async (m: Message, command: string) => {
    const cleared = withoutCommands(conversation, m.id);
    setConversation(cleared);
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Running command…",
      message: command,
    });
    const result = await runApprovedCommand(command);
    toast.hide();
    await send(`$ ${command}`, commandResultPrompt(command, result), cleared);
  };

  const dismissCommands = (m: Message) => {
    const cleared = withoutCommands(conversation, m.id);
    setConversation(cleared);
    saveConversation(cleared);
  };

  // Pending: what the model is doing so far, then the text as it arrives.
  const detailOf = (m: Message) => {
    const question = `**${m.question.replace(/\n+/g, " ")}**\n\n---\n\n`;
    if (m.id === displayedPendingId) {
      const status = stream.text ? "Generating…" : "thinking...";
      return `${question}${stepsMarkdown(stream.steps)}${stream.text}${stream.text ? "\n\n" : ""}_${spinner} ${status}_`;
    }
    return `${question}${stepsMarkdown(m.steps)}${m.error ?? m.answer}${commandsMarkdown(m.commands)}${footerMarkdown(m.model, modelLabel, m.durationMs)}`;
  };

  const messages = queuedQuestion
    ? [queuedQuestion, ...[...conversation.messages].reverse()]
    : [...conversation.messages].reverse();
  const sendAction =
    input.trim() && !isLoading ? (
      <Action
        title="Send Message"
        icon={Icon.ArrowUp}
        onAction={() => send(input)}
      />
    ) : null;

  return (
    <List
      navigationTitle={[
        conversation.title || queuedQuestion?.question || "New Chat",
        ...optionBadges(conversation.options, conversation.model),
      ].join(" · ")}
      isShowingDetail={messages.length > 0}
      searchBarPlaceholder={
        messages.length
          ? "Ask a follow-up, press ↵ to send"
          : "Ask anything, press ↵ to send"
      }
      searchText={input}
      onSearchTextChange={setInput}
      // The search bar is the message input here; it must not filter the list.
      filtering={false}
      selectedItemId={selectedId}
      onSelectionChange={(id) => id && setSelectedId(id)}
      searchBarAccessory={
        // Only expose an empty selection once discovery confirms it. A valid
        // cached selection stays visible without entering a loading state.
        models.length > 0 && (selectedModel || !catalog.isRefreshing) ? (
          <List.Dropdown
            key={conversation.provider}
            tooltip={
              conversation.messages.length
                ? `Model (${PROVIDER_NAMES[conversation.provider]})`
                : "Choose Agent and Model"
            }
            placeholder="Search Models"
            value={selectedModelValue}
            defaultValue={selectedModelValue}
            onChange={changeModel}
          >
            {!selectedModel ? (
              <List.Dropdown.Item value="" title="Select Model" />
            ) : null}
            {groupByProvider(models, selectedModelValue).map((g) => (
              <List.Dropdown.Section
                key={g.provider}
                title={PROVIDER_NAMES[g.provider]}
              >
                {g.models.map((m) => (
                  <List.Dropdown.Item
                    key={m.value}
                    title={m.title}
                    value={m.value}
                  />
                ))}
              </List.Dropdown.Section>
            ))}
          </List.Dropdown>
        ) : undefined
      }
      actions={
        <ActionPanel>
          {sendAction}
          <ChatActions
            onNew={startNew}
            onHistory={() => push(<HistoryView />)}
            onRefreshModels={(force) => catalog.refresh(force)}
          />
          <OptionActions
            model={conversation.model}
            options={conversation.options ?? {}}
            onChange={changeOptions}
            showTools
          />
        </ActionPanel>
      }
    >
      {messages.length === 0 ? (
        <List.EmptyView
          icon={Icon.Bubble}
          title="New Chat"
          description={[
            modelLabel(conversation.model),
            ...optionBadges(conversation.options, conversation.model),
            catalog.error,
            "Type a question and press ↵",
          ]
            .filter(Boolean)
            .join(" · ")}
        />
      ) : (
        messages.map((m) => {
          return (
            <List.Item
              key={m.id}
              id={m.id}
              title={m.question}
              accessories={
                m.id === displayedPendingId ? [{ text: spinner }] : undefined
              }
              icon={
                m.error
                  ? Icon.ExclamationMark
                  : m.id === displayedPendingId
                    ? Icon.CircleProgress
                    : m.commands?.length
                      ? Icon.Terminal
                      : Icon.Message
              }
              detail={<List.Item.Detail markdown={detailOf(m)} />}
              actions={
                <ActionPanel>
                  {sendAction}
                  {m.commands?.length && !stream.isLoading ? (
                    <ActionPanel.Section>
                      {m.commands.map((c) => (
                        <Action
                          key={c}
                          title={
                            m.commands!.length === 1
                              ? "Run Command"
                              : `Run ${c.length > 40 ? `${c.slice(0, 39)}…` : c}`
                          }
                          icon={Icon.Terminal}
                          onAction={() => runCommand(m, c)}
                        />
                      ))}
                      <Action
                        title="Dismiss Command"
                        icon={Icon.XMarkCircle}
                        onAction={() => dismissCommands(m)}
                      />
                    </ActionPanel.Section>
                  ) : null}
                  {m.answer ? (
                    <>
                      <Action.Paste
                        title="Paste to Active App"
                        content={m.answer}
                      />
                      <Action.CopyToClipboard
                        title="Copy Answer"
                        content={m.answer}
                        shortcut={Keyboard.Shortcut.Common.Copy}
                      />
                    </>
                  ) : null}
                  {isLoading ? (
                    <Action
                      title="Stop"
                      icon={Icon.Stop}
                      shortcut={STOP_SHORTCUT}
                      onAction={stop}
                    />
                  ) : null}
                  {m.id === pendingId && stream.error ? (
                    <ErrorActions error={stream.error} />
                  ) : null}
                  <ChatActions
                    onNew={startNew}
                    onHistory={() => push(<HistoryView />)}
                    onRefreshModels={(force) => catalog.refresh(force)}
                  />
                  <OptionActions
                    model={conversation.model}
                    options={conversation.options ?? {}}
                    onChange={changeOptions}
                    showTools
                  />
                </ActionPanel>
              }
            />
          );
        })
      )}
    </List>
  );
}

function ChatActions({
  onNew,
  onHistory,
  onRefreshModels,
}: {
  onNew: (provider?: Provider) => void;
  onHistory: () => void;
  onRefreshModels: (force?: boolean) => void;
}) {
  return (
    <ActionPanel.Section>
      <Action
        title="New Chat"
        icon={Icon.PlusCircle}
        shortcut={Keyboard.Shortcut.Common.New}
        onAction={() => onNew()}
      />
      <ActionPanel.Submenu title="New Chat with Agent" icon={Icon.PlusCircle}>
        {enabledProviders().map((provider) => (
          <Action
            key={provider}
            title={`New ${PROVIDER_NAMES[provider]} Chat`}
            onAction={() => onNew(provider)}
          />
        ))}
      </ActionPanel.Submenu>
      <Action
        title="Chat History"
        icon={Icon.Clock}
        shortcut={Keyboard.Shortcut.Common.ToggleQuickLook}
        onAction={onHistory}
      />
      <Action.Push
        title="Settings"
        icon={Icon.Gear}
        target={<SettingsView />}
        onPop={() => queueMicrotask(onRefreshModels)}
      />
      <Action
        title="Refresh Model List"
        icon={Icon.ArrowClockwise}
        onAction={() => onRefreshModels(true)}
      />
    </ActionPanel.Section>
  );
}

function withoutCommands(c: Conversation, messageId: string): Conversation {
  return {
    ...c,
    messages: c.messages.map((m) =>
      m.id === messageId ? { ...m, commands: undefined } : m,
    ),
  };
}

export function commandsMarkdown(commands: string[] | undefined): string {
  if (!commands?.length) return "";
  const blocks = commands.map((c) => `\`\`\`sh\n${c}\n\`\`\``).join("\n\n");
  const verb = commands.length === 1 ? "this command" : "these commands";
  return `\n\n---\n\n**Wants to run ${verb}** (runs only if you approve it; ↵ or ⌘K):\n\n${blocks}`;
}
