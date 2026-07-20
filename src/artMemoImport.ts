import type { InboxItem } from "./types";

type ImportPhrase = {
  id?: unknown;
  text?: unknown;
  sourceOrder?: unknown;
  type?: unknown;
  theme?: unknown;
  tags?: unknown;
};

type ImportDocument = {
  version?: unknown;
  sourceTitle?: unknown;
  categories?: unknown;
  phrases?: unknown;
};

export type ArtMemoImportResult = {
  items: InboxItem[];
  sourceTitle: string;
  themeCount: number;
};

function smallHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function parseArtMemoImport(raw: string, stamp = new Date().toISOString()): ArtMemoImportResult {
  let parsed: ImportDocument;
  try { parsed = JSON.parse(raw) as ImportDocument; }
  catch { throw new Error("JSONファイルを読み取れませんでした。"); }

  if (!parsed || !Array.isArray(parsed.phrases)) throw new Error("このJSONには phrases の一覧がありません。");
  const categories = Array.isArray(parsed.categories) ? parsed.categories.filter((item): item is string => typeof item === "string") : [];
  const sourceTitle = typeof parsed.sourceTitle === "string" && parsed.sourceTitle.trim() ? parsed.sourceTitle.trim() : "一括取込";
  const version = typeof parsed.version === "number" ? parsed.version : 1;
  const items: InboxItem[] = [];

  for (const [index, value] of parsed.phrases.entries()) {
    if (!value || typeof value !== "object") continue;
    const phrase = value as ImportPhrase;
    const text = typeof phrase.text === "string" ? phrase.text.trim() : "";
    if (!text) continue;
    const sourceId = typeof phrase.id === "string" && phrase.id ? phrase.id : String(index + 1);
    const theme = typeof phrase.theme === "string" && phrase.theme.trim() ? phrase.theme.trim() : "テーマなし";
    const tags = Array.isArray(phrase.tags) ? phrase.tags.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim()) : [];
    const sourceOrder = typeof phrase.sourceOrder === "number" && Number.isFinite(phrase.sourceOrder) ? phrase.sourceOrder : index + 1;
    const themeIndex = categories.indexOf(theme);
    items.push({
      id: crypto.randomUUID(),
      kind: "note",
      text,
      assetIds: [],
      theme,
      sourceType: typeof phrase.type === "string" ? phrase.type : undefined,
      tags,
      sourceOrder,
      themeOrder: themeIndex >= 0 ? themeIndex : categories.length,
      importKey: `art-memo:v${version}:${sourceId}:${smallHash(text)}`,
      createdAt: stamp,
      updatedAt: stamp,
    });
  }

  if (items.length === 0) throw new Error("取り込める文章がありませんでした。");
  return { items, sourceTitle, themeCount: new Set(items.map((item) => item.theme)).size };
}

