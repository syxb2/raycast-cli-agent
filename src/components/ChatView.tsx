import {
  Action,
  ActionPanel,
  Icon,
  Keyboard,
  List,
  useNavigation,
} from "@raycast/api";
import { useEffect, useRef, useState } from "react";
import { errorMarkdown } from "../lib/format";
import {
  currentModel,
  groupByProvider,
  matchingValue,
  modelLabel,
  setCurrentModel,
} from "../lib/models";
import { withMissingContext } from "../lib/chatContext";
import { useModels } from "../lib/modelCatalog";
import { PROVIDER_NAMES } from "../lib/provider";
import {
  Conversation,
  Message,
  newConversation,
  saveConversation,
  titleFrom,
} from "../lib/storage";
import { useModelStream } from "../lib/useModelStream";
import { HistoryView } from "./HistoryView";
import { ErrorActions, STOP_SHORTCUT } from "./shared";

export function ChatView({
  initial,
  firstQuestion,
}: {
  initial?: Conversation;
  firstQuestion?: string;
}) {
  const { push } = useNavigation();
  const [conversation, setConversation] = useState<Conversation>(
    () => initial ?? newConversation(currentModel()),
  );
  const [input, setInput] = useState("");
  const [selectedId, setSelectedId] = useState<string | undefined>(
    conversation.messages.at(-1)?.id,
  );
  const [pendingId, setPendingId] = useState<string | undefined>();
  const stream = useModelStream();
  const catalog = useModels();
  const sentFirst = useRef(false);
  // If "New Chat" is opened mid-request, the late answer must not land in the new chat.
  const activeId = useRef(conversation.id);

  const send = async (question: string) => {
    const q = question.trim();
    if (!q || stream.isLoading) return;
    const msg: Message = {
      id: crypto.randomUUID(),
      question: q,
      answer: "",
      createdAt: Date.now(),
      model: conversation.model,
    };
    const base: Conversation = {
      ...conversation,
      title: conversation.title || titleFrom(q),
      messages: [...conversation.messages, msg],
    };
    setConversation(base);
    setInput("");
    setSelectedId(msg.id);
    setPendingId(msg.id);

    const result = await stream.run({
      prompt: withMissingContext(conversation.messages, conversation.model, q),
      model: conversation.model,
      sessionId: conversation.sessionId,
    });
    const finished: Message = {
      ...msg,
      answer: result.text,
      error:
        result.isError && !result.text
          ? errorMarkdown(result.error!)
          : undefined,
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
    const timer = setTimeout(() => {
      sentFirst.current = true;
      send(firstQuestion);
    }, 0);
    return () => clearTimeout(timer);
  }, [firstQuestion]);

  const startNew = () => {
    stream.stop();
    const fresh = newConversation(conversation.model);
    activeId.current = fresh.id;
    setPendingId(undefined);
    setConversation(fresh);
    setSelectedId(undefined);
    setInput("");
  };

  const changeModel = (model: string) => {
    setCurrentModel(model);
    setConversation((c) => ({ ...c, model }));
  };

  const answerOf = (m: Message) => {
    if (m.id === pendingId) return stream.text || "_Thinking…_";
    return m.error ?? m.answer;
  };

  const messages = [...conversation.messages].reverse();
  const sendAction = input.trim() ? (
    <Action
      title="Send Message"
      icon={Icon.ArrowUp}
      onAction={() => send(input)}
    />
  ) : null;

  return (
    <List
      navigationTitle={conversation.title || "New Chat"}
      isLoading={stream.isLoading}
      isShowingDetail={messages.length > 0}
      searchBarPlaceholder={
        conversation.messages.length
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
        <List.Dropdown
          tooltip="Model"
          isLoading={catalog.isRefreshing}
          value={matchingValue(conversation.model, catalog.models)}
          onChange={changeModel}
        >
          {groupByProvider(catalog.models).map((g) => (
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
      }
      actions={
        <ActionPanel>
          {sendAction}
          <ChatActions
            onNew={startNew}
            onHistory={() => push(<HistoryView />)}
            onRefreshModels={() => catalog.refresh(true)}
          />
        </ActionPanel>
      }
    >
      {messages.length === 0 ? (
        <List.EmptyView
          icon={Icon.Bubble}
          title="New Chat"
          description={`${modelLabel(conversation.model)} · Type a question and press ↵`}
        />
      ) : (
        messages.map((m) => {
          const answer = answerOf(m);
          return (
            <List.Item
              key={m.id}
              id={m.id}
              title={m.question}
              icon={
                m.error
                  ? Icon.ExclamationMark
                  : m.id === pendingId
                    ? Icon.CircleProgress
                    : Icon.Message
              }
              detail={
                <List.Item.Detail
                  markdown={`**${m.question.replace(/\n+/g, " ")}**\n\n---\n\n${answer}${m.model ? `\n\n---\n\n_${modelLabel(m.model)}_` : ""}`}
                />
              }
              actions={
                <ActionPanel>
                  {sendAction}
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
                  {stream.isLoading ? (
                    <Action
                      title="Stop"
                      icon={Icon.Stop}
                      shortcut={STOP_SHORTCUT}
                      onAction={stream.stop}
                    />
                  ) : null}
                  {m.id === pendingId && stream.error ? (
                    <ErrorActions error={stream.error} />
                  ) : null}
                  <ChatActions
                    onNew={startNew}
                    onHistory={() => push(<HistoryView />)}
                    onRefreshModels={() => catalog.refresh(true)}
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
  onNew: () => void;
  onHistory: () => void;
  onRefreshModels: () => void;
}) {
  return (
    <ActionPanel.Section>
      <Action
        title="New Chat"
        icon={Icon.PlusCircle}
        shortcut={Keyboard.Shortcut.Common.New}
        onAction={onNew}
      />
      <Action
        title="Chat History"
        icon={Icon.Clock}
        shortcut={Keyboard.Shortcut.Common.ToggleQuickLook}
        onAction={onHistory}
      />
      <Action
        title="Refresh Model List"
        icon={Icon.ArrowClockwise}
        onAction={onRefreshModels}
      />
    </ActionPanel.Section>
  );
}
