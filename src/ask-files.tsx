import { getSelectedFinderItems, Icon, LaunchProps, List } from "@raycast/api";
import { statSync } from "node:fs";
import { basename, dirname } from "node:path";
import { useEffect, useState } from "react";
import { AnswerView } from "./components/AnswerView";
import { defaultOptions } from "./lib/options";
import { askAboutFilesPrompt } from "./lib/prompts";

interface Selection {
  paths: string[];
  // Folders the model may read: selected folders and the folders of selected
  // files.
  dirs: string[];
}

async function readFinderSelection(): Promise<Selection> {
  let paths: string[] = [];
  try {
    paths = (await getSelectedFinderItems()).map((i) => i.path);
  } catch {
    // Finder is not frontmost or nothing is selected
  }
  const dirs = paths.map((p) => {
    try {
      return statSync(p).isDirectory() ? p : dirname(p);
    } catch {
      return dirname(p);
    }
  });
  return { paths, dirs: [...new Set(dirs)] };
}

export default function Command(
  props: LaunchProps<{ arguments: Arguments.AskFiles }>,
) {
  const [selection, setSelection] = useState<Selection>();
  useEffect(() => {
    readFinderSelection().then(setSelection);
  }, []);

  if (!selection) return <List isLoading />;
  if (!selection.paths.length) {
    return (
      <List>
        <List.EmptyView
          icon={Icon.Finder}
          title="Nothing Selected in Finder"
          description="Select files or folders in Finder, then run this command."
        />
      </List>
    );
  }

  const question =
    props.arguments.question?.trim() || "What is this, in short?";
  const names = selection.paths.map((p) => basename(p));
  const shown =
    names.length > 3 ? `${names.slice(0, 3).join(", ")}…` : names.join(", ");
  const { effort, webSearch } = defaultOptions();
  return (
    <AnswerView
      navigationTitle="About Finder Selection"
      prompt={askAboutFilesPrompt(selection.paths, question)}
      question={`${question} (${shown})`}
      options={{ effort, webSearch, readDirs: selection.dirs }}
    />
  );
}
