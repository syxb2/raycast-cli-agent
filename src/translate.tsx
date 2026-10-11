import {
  Action,
  ActionPanel,
  Icon,
  Keyboard,
  List,
  LocalStorage,
} from "@raycast/api";
import { useEffect, useRef, useState } from "react";
import { errorMarkdown } from "./lib/format";
import {
  LANGUAGES,
  resolveTargetLanguage,
  translateSystemPrompt,
} from "./lib/prompts";
import { readSourceText } from "./lib/selection";
import { useClaudeStream } from "./lib/useClaudeStream";
import { currentModel, modelLabel, setCurrentModel } from "./lib/models";
import { ModelSubmenu } from "./components/shared";

// Raycast'in Translate'i gibi: arama kutusu girdi, yazmayi birakinca cevirir.
// Her istek ~3 sn surdugu icin tus basimlarini bekletip tek istek atiyoruz.
const DEBOUNCE_MS = 600;
const LANG_KEY = "translate-language";

export default function Command() {
  const [text, setText] = useState("");
  const [language, setLanguage] = useState<string>();
  const [ready, setReady] = useState(false);
  const [model, setModel] = useState(currentModel);
  const stream = useClaudeStream();
  const lastRequest = useRef("");

  useEffect(() => {
    Promise.all([
      readSourceText({ allowClipboard: false }),
      LocalStorage.getItem<string>(LANG_KEY),
    ]).then(([source, lang]) => {
      if (source) setText(source.text);
      setLanguage(lang ?? "auto");
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!ready || !language) return;
    const input = text.trim();
    if (!input) {
      stream.stop();
      return;
    }
    const key = `${model}:${language}:${input}`;
    if (key === lastRequest.current) return;
    const t = setTimeout(() => {
      lastRequest.current = key;
      stream.run({
        prompt: input,
        model,
        systemPrompt: translateSystemPrompt(
          resolveTargetLanguage(input, language),
        ),
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, language, model, ready]);

  const changeModel = (value: string) => {
    setCurrentModel(value);
    setModel(value);
  };

  const changeLanguage = (value: string) => {
    setLanguage(value);
    LocalStorage.setItem(LANG_KEY, value);
  };

  const translation = stream.text.trim();
  const hasInput = text.trim().length > 0;
  const markdown =
    stream.error && !translation
      ? errorMarkdown(stream.error)
      : translation || "_Çevriliyor…_";

  return (
    <List
      isLoading={!ready || stream.isLoading}
      searchText={text}
      onSearchTextChange={setText}
      searchBarPlaceholder="Çevrilecek metni yaz veya yapıştır"
      filtering={false}
      isShowingDetail={hasInput}
      searchBarAccessory={
        language ? (
          <List.Dropdown
            tooltip="Hedef Dil"
            value={language}
            onChange={changeLanguage}
          >
            {LANGUAGES.map((l) => (
              <List.Dropdown.Item
                key={l.value}
                title={l.title}
                value={l.value}
              />
            ))}
          </List.Dropdown>
        ) : undefined
      }
    >
      {!hasInput ? (
        <List.EmptyView
          icon={Icon.Globe}
          title="Çevrilecek metni yaz"
          description="Metin seçiliyken açarsan kendiliğinden gelir"
        />
      ) : (
        <List.Item
          title={`→ ${LANGUAGES.find((l) => l.value === resolveTargetLanguage(text, language ?? "auto"))?.title ?? ""}`}
          icon={Icon.Globe}
          detail={<List.Item.Detail markdown={markdown} />}
          subtitle={modelLabel(model)}
          actions={
            <ActionPanel>
              {translation ? (
                <>
                  <Action.Paste
                    title="Ön Uygulamaya Yapıştır"
                    content={translation}
                  />
                  <Action.CopyToClipboard
                    title="Kopyala"
                    content={translation}
                    shortcut={Keyboard.Shortcut.Common.Copy}
                  />
                  {language === "auto" ? (
                    <Action
                      title="Ters Yöne Çevir"
                      icon={Icon.Switch}
                      shortcut={{ modifiers: ["cmd"], key: "t" }}
                      onAction={() => setText(translation)}
                    />
                  ) : null}
                </>
              ) : null}
              <ModelSubmenu
                title="Model Değiştir"
                current={model}
                onSelect={changeModel}
              />
            </ActionPanel>
          }
        />
      )}
    </List>
  );
}
