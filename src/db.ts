import Dexie, { type EntityTable } from "dexie";
import type { AppMeta, AssociationCard, Idea, IdeaCategory, InboxItem, LyricLine, LyricSection, LyricVersion, MediaAsset, MVScene, SketchRecord, Song, SongWorkspace } from "./types";

export const DB_NAME = "yohaku-lyric-notebook";
export const DB_VERSION = 6;
export const STORES_V1 = {
  songs: "id, updatedAt, createdAt, stage, *tags",
  sections: "id, songId, [songId+order]",
  lyricLines: "id, songId, sectionId, [sectionId+order]",
  associations: "id, songId, relatedLyricId, category, updatedAt",
  mvScenes: "id, songId, [songId+order], *relatedLyricIds",
  sketches: "id, songId, relatedLyricId, relatedSceneId, updatedAt",
  media: "id, songId, kind, updatedAt",
  inbox: "id, kind, createdAt",
  meta: "key",
};
export const STORES_V2 = { ...STORES_V1, songs: "id, updatedAt, createdAt, stage, archived, *tags" };
export const STORES_V3 = {
  ...STORES_V2,
  ideas: "id, songId, category, pinned, updatedAt",
  inbox: "id, kind, createdAt, updatedAt, deletedAt",
};
export const STORES_V4 = { ...STORES_V3, ideas: "id, songId, category, updatedAt" };
export const STORES_V5 = { ...STORES_V4, inbox: "id, kind, createdAt, updatedAt, deletedAt, importKey, theme" };
export const STORES_V6 = {
  ...STORES_V5,
  ideas: "id, songId, category, sourceInboxId, updatedAt",
  lyricVersions: "id, songId, createdAt",
};

const legacyTableNames = Object.keys(STORES_V2);

export class LyricDatabase extends Dexie {
  songs!: EntityTable<Song, "id">; sections!: EntityTable<LyricSection, "id">;
  lyricLines!: EntityTable<LyricLine, "id">; associations!: EntityTable<AssociationCard, "id">;
  mvScenes!: EntityTable<MVScene, "id">; ideas!: EntityTable<Idea, "id">;
  sketches!: EntityTable<SketchRecord, "id">; media!: EntityTable<MediaAsset, "id">;
  inbox!: EntityTable<InboxItem, "id">; lyricVersions!: EntityTable<LyricVersion, "id">; meta!: EntityTable<AppMeta, "key">;
  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores(STORES_V1);
    this.version(2).stores(STORES_V2).upgrade(async (tx) => {
      await tx.table("songs").toCollection().modify((song: Partial<Song>) => {
        if (typeof song.archived !== "boolean") song.archived = false;
        if (!Array.isArray(song.tags)) song.tags = [];
        if (!song.workingTitle) song.workingTitle = "";
        if (!song.color) song.color = "#9a7189";
      });
    });
    this.version(3).stores(STORES_V3).upgrade(async (tx) => {
      // 最新の利用者指示に基づき、v2以前の端末データを今回だけ全消去する。
      for (const tableName of legacyTableNames) await tx.table(tableName).clear();
      await tx.table("meta").put({ key: "v3ResetComplete", value: new Date().toISOString() });
    });
    this.version(4).stores(STORES_V4).upgrade(async (tx) => {
      await tx.table("ideas").toCollection().modify((idea: Record<string, unknown>) => {
        delete idea.pinned;
        delete idea.sourceExcerpt;
        if (!Array.isArray(idea.assetIds)) idea.assetIds = [];
      });
      await tx.table("sketches").toCollection().modify((sketch: Partial<SketchRecord>) => {
        if (!Array.isArray(sketch.strokes)) sketch.strokes = [];
        if (!Array.isArray(sketch.texts)) sketch.texts = [];
        if (!Array.isArray(sketch.arrows)) sketch.arrows = [];
        if (typeof sketch.guideVisible !== "boolean") sketch.guideVisible = true;
        if (typeof sketch.guideInExport !== "boolean") sketch.guideInExport = false;
        if (!sketch.backgroundColor) sketch.backgroundColor = "#fffdf9";
        if (!sketch.promptFields || typeof sketch.promptFields !== "object") sketch.promptFields = {};
      });
    });
    this.version(5).stores(STORES_V5).upgrade(async (tx) => {
      const sections = await tx.table("sections").toArray() as LyricSection[];
      const existingLines = await tx.table("lyricLines").toArray() as LyricLine[];
      const linesBySection = new Map<string, LyricLine[]>();
      for (const line of existingLines) linesBySection.set(line.sectionId, [...(linesBySection.get(line.sectionId) ?? []), line]);
      const stamp = new Date().toISOString();
      const migratedLines: LyricLine[] = [];
      const reconciledLines: LyricLine[] = [];
      const removedLineIds: string[] = [];
      for (const section of sections) {
        const texts = typeof section.body === "string" && section.body.length > 0 ? section.body.split(/\r?\n/) : [""];
        const current = (linesBySection.get(section.id) ?? []).sort((a, b) => a.order - b.order);
        if (current.length === 0) {
          texts.forEach((text, order) => migratedLines.push({ id: uid(), songId: section.songId, sectionId: section.id, text, status: "仮採用", alternate: "", rhymes: "", ideaIds: [], note: "", order, createdAt: stamp, updatedAt: stamp }));
        } else if (typeof section.body === "string" && current.map((line) => line.text).join("\n") !== section.body) {
          texts.forEach((text, order) => reconciledLines.push(current[order] ? { ...current[order], text, order, updatedAt: stamp } : { id: uid(), songId: section.songId, sectionId: section.id, text, status: "仮採用", alternate: "", rhymes: "", ideaIds: [], note: "", order, createdAt: stamp, updatedAt: stamp }));
          removedLineIds.push(...current.slice(texts.length).map((line) => line.id));
        }
      }
      if (migratedLines.length) await tx.table("lyricLines").bulkAdd(migratedLines);
      if (reconciledLines.length) await tx.table("lyricLines").bulkPut(reconciledLines);
      if (removedLineIds.length) await tx.table("lyricLines").bulkDelete(removedLineIds);
      await tx.table("lyricLines").toCollection().modify((line: Partial<LyricLine>) => {
        if (typeof line.alternate !== "string") line.alternate = "";
        if (typeof line.rhymes !== "string") line.rhymes = "";
        if (!Array.isArray(line.ideaIds)) line.ideaIds = [];
        if (typeof line.note !== "string") line.note = "";
      });
    });
    this.version(6).stores(STORES_V6).upgrade(async (tx) => {
      // 利用者の指定に基づく一度だけの再構成。JSONファイルは再取込でき、以後の起動では実行されない。
      for (const tableName of ["songs", "sections", "lyricLines", "associations", "mvScenes", "ideas", "sketches", "media", "inbox", "lyricVersions"]) {
        await tx.table(tableName).clear();
      }
      await tx.table("meta").put({ key: "v6ResetComplete", value: new Date().toISOString() });
    });
  }
}

export const db = new LyricDatabase();
export const uid = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
};
export const now = () => new Date().toISOString();

export function emptySong(title = "無題の曲"): Song {
  const stamp = now();
  return { id: uid(), title, workingTitle: "", summary: "", protagonist: "", counterpart: "", place: "", time: "", perspective: "", baseColor: "#ffd60a", repeatedWords: "", repeatedObjects: "", avoidExpressions: "", lastingEmotion: "", stage: "構想中", color: "#ffd60a", tags: [], archived: false, draft: true, createdAt: stamp, updatedAt: stamp };
}

export async function createSong(title?: string, draft = true) {
  const song = { ...emptySong(title), draft };
  const section: LyricSection = { id: uid(), songId: song.id, name: "セクション 1", body: "", order: 0 };
  const stamp = now();
  const line: LyricLine = { id: uid(), songId: song.id, sectionId: section.id, text: "", status: "仮採用", alternate: "", rhymes: "", ideaIds: [], note: "", order: 0, createdAt: stamp, updatedAt: stamp };
  await db.transaction("rw", [db.songs, db.sections, db.lyricLines], async () => { await db.songs.add(song); await db.sections.add(section); await db.lyricLines.add(line); });
  return song;
}

export async function loadWorkspace(songId: string): Promise<SongWorkspace> {
  const [sections, lines, ideas, associations, scenes, sketches, media, lyricVersions] = await Promise.all([
    db.sections.where("songId").equals(songId).sortBy("order"), db.lyricLines.where("songId").equals(songId).toArray(),
    db.ideas.where("songId").equals(songId).toArray(), db.associations.where("songId").equals(songId).toArray(),
    db.mvScenes.where("songId").equals(songId).sortBy("order"), db.sketches.where("songId").equals(songId).toArray(),
    db.media.where("songId").equals(songId).toArray(), db.lyricVersions.where("songId").equals(songId).reverse().sortBy("createdAt"),
  ]);
  return { sections, lines, ideas, associations, scenes, sketches, media, lyricVersions };
}

export async function deleteSongCascade(songId: string) {
  await db.transaction("rw", db.tables, async () => {
    await Promise.all([db.sections.where("songId").equals(songId).delete(), db.lyricLines.where("songId").equals(songId).delete(), db.ideas.where("songId").equals(songId).delete(), db.associations.where("songId").equals(songId).delete(), db.mvScenes.where("songId").equals(songId).delete(), db.sketches.where("songId").equals(songId).delete(), db.media.where("songId").equals(songId).delete(), db.lyricVersions.where("songId").equals(songId).delete()]);
    await db.inbox.toCollection().modify((item: InboxItem) => { item.usedSongIds = (item.usedSongIds ?? []).filter((id) => id !== songId); });
    await db.songs.delete(songId);
  });
}

export const inboxAssetIds = (item: InboxItem) => Array.from(new Set([...(item.assetIds ?? []), ...(item.assetId ? [item.assetId] : [])]));

export async function useInboxInSong(item: InboxItem, songId: string) {
  const stamp = now(); const assetIds = inboxAssetIds(item);
  await db.transaction("rw", [db.ideas, db.inbox, db.songs], async () => {
    const existing = await db.ideas.where("sourceInboxId").equals(item.id).and((idea) => idea.songId === songId).first();
    if (item.text.trim() && !existing) await db.ideas.add({ id: uid(), songId, text: item.text.trim(), assetIds, sourceInboxId: item.id, createdAt: item.createdAt, updatedAt: stamp });
    await db.inbox.update(item.id, { usedSongIds: Array.from(new Set([...(item.usedSongIds ?? []), songId])), updatedAt: stamp });
    await db.songs.update(songId, { updatedAt: stamp, draft: false });
  });
}

const ideaCategoryForInbox = (kind: InboxItem["kind"]): IdeaCategory | undefined => kind === "lyric" ? "言葉・歌詞" : kind === "mv" || kind === "image" ? "映像" : kind === "audio" ? "音・メロディ" : undefined;

export async function moveInboxToSong(item: InboxItem, songId: string) {
  const stamp = now(); const assetIds = inboxAssetIds(item); const text = item.text.trim();
  await db.transaction("rw", [db.ideas, db.inbox, db.songs, db.media], async () => {
    const existing = await db.ideas.where("sourceInboxId").equals(item.id).and((idea) => idea.songId === songId).first();
    if (text && existing) await db.ideas.update(existing.id, { text, category: ideaCategoryForInbox(item.kind), assetIds, sourceExcerpt: text, sourceInboxId: undefined, updatedAt: stamp });
    else if (text) await db.ideas.add({ id: uid(), songId, text, category: ideaCategoryForInbox(item.kind), assetIds, sourceExcerpt: text, createdAt: item.createdAt, updatedAt: stamp });
    if (assetIds.length) {
      const assets = (await db.media.bulkGet(assetIds)).filter((asset): asset is MediaAsset => Boolean(asset));
      if (assets.length) await db.media.bulkPut(assets.map((asset) => ({ ...asset, songId, updatedAt: stamp })));
    }
    await db.ideas.where("sourceInboxId").equals(item.id).modify((idea) => { idea.sourceInboxId = undefined; idea.sourceExcerpt ||= text; });
    await db.inbox.delete(item.id);
    await db.songs.update(songId, { updatedAt: stamp, draft: false });
  });
}

export async function removeInboxUse(idea: Idea) {
  await db.transaction("rw", [db.ideas, db.inbox], async () => {
    await db.ideas.delete(idea.id);
    if (!idea.sourceInboxId) return;
    const other = await db.ideas.where("sourceInboxId").equals(idea.sourceInboxId).and((item) => item.songId === idea.songId && item.id !== idea.id).count();
    if (!other) {
      const source = await db.inbox.get(idea.sourceInboxId);
      if (source) await db.inbox.update(source.id, { usedSongIds: (source.usedSongIds ?? []).filter((id) => id !== idea.songId), updatedAt: now() });
    }
  });
}

export async function markSongUsed(songId: string) {
  await db.songs.update(songId, { draft: false, updatedAt: now() });
}

export async function duplicateSong(sourceId: string) {
  const source = await db.songs.get(sourceId); if (!source) throw new Error("複製元の曲が見つかりません。");
  const data = await loadWorkspace(sourceId); const songId = uid(); const stamp = now();
  const song: Song = { ...source, id: songId, title: `${source.title}（コピー）`, archived: false, createdAt: stamp, updatedAt: stamp };
  const sectionIds = new Map(data.sections.map((item) => [item.id, uid()])); const lineIds = new Map(data.lines.map((item) => [item.id, uid()]));
  const ideaIds = new Map(data.ideas.map((item) => [item.id, uid()])); const cardIds = new Map(data.associations.map((item) => [item.id, uid()]));
  const sceneIds = new Map(data.scenes.map((item) => [item.id, uid()])); const mediaIds = new Map(data.media.map((item) => [item.id, uid()]));
  const sections = data.sections.map((item) => ({ ...item, id: sectionIds.get(item.id)!, songId }));
  const lines = data.lines.map((item) => ({ ...item, id: lineIds.get(item.id)!, songId, sectionId: sectionIds.get(item.sectionId)!, ideaIds: (item.ideaIds ?? []).map((id) => ideaIds.get(id) ?? id) }));
  const ideas = data.ideas.map((item) => ({ ...item, id: ideaIds.get(item.id)!, songId, assetIds: item.assetIds.map((id) => mediaIds.get(id) ?? id) }));
  const associations = data.associations.map((item) => ({ ...item, id: cardIds.get(item.id)!, songId, relatedLyricId: item.relatedLyricId ? lineIds.get(item.relatedLyricId) : undefined, imageAssetId: item.imageAssetId ? mediaIds.get(item.imageAssetId) : undefined }));
  const scenes = data.scenes.map((item) => ({ ...item, id: sceneIds.get(item.id)!, songId, relatedLyricIds: item.relatedLyricIds.map((id) => lineIds.get(id) ?? id), referenceAssetIds: item.referenceAssetIds.map((id) => mediaIds.get(id) ?? id) }));
  const sketches = data.sketches.map((item) => ({ ...item, id: uid(), songId, relatedLyricId: item.relatedLyricId ? lineIds.get(item.relatedLyricId) : undefined, relatedSceneId: item.relatedSceneId ? sceneIds.get(item.relatedSceneId) : undefined }));
  const media = data.media.map((item) => ({ ...item, id: mediaIds.get(item.id)!, songId, links: item.links.map((link) => ({ ...link, id: link.type === "lyric" ? lineIds.get(link.id) ?? link.id : link.type === "association" ? cardIds.get(link.id) ?? link.id : sceneIds.get(link.id) ?? link.id })) }));
  await db.transaction("rw", db.tables, async () => { await db.songs.add(song); await Promise.all([db.sections.bulkAdd(sections), db.lyricLines.bulkAdd(lines), db.ideas.bulkAdd(ideas), db.associations.bulkAdd(associations), db.mvScenes.bulkAdd(scenes), db.sketches.bulkAdd(sketches), db.media.bulkAdd(media)]); });
  return song;
}

const ideaCategoryForAssociation = (category: AssociationCard["category"]): IdeaCategory | undefined => category === "次の歌詞" ? "言葉・歌詞" : category === "音" ? "音・メロディ" : category === "MV映像" ? "映像" : undefined;

export async function normalizeRestoredData() {
  const [sections, lines, associations, scenes, existingIdeas, sketches, media, inbox] = await Promise.all([db.sections.toArray(), db.lyricLines.toArray(), db.associations.toArray(), db.mvScenes.toArray(), db.ideas.toArray(), db.sketches.toArray(), db.media.toArray(), db.inbox.toArray()]);
  const ideaIds = new Set(existingIdeas.map((item) => item.id)); const linesBySection = new Map<string, LyricLine[]>();
  for (const line of lines) { const items = linesBySection.get(line.sectionId) ?? []; items.push(line); linesBySection.set(line.sectionId, items); }
  const normalizedSections = sections.map((section) => ({ ...section, body: typeof section.body === "string" ? section.body : (linesBySection.get(section.id) ?? []).sort((a, b) => a.order - b.order).map((line) => line.text).join("\n") }));
  const stamp = now(); const migratedLines: LyricLine[] = []; const reconciledLines: LyricLine[] = []; const removedLineIds: string[] = [];
  for (const section of normalizedSections) {
    const texts = section.body.length > 0 ? section.body.split(/\r?\n/) : [""];
    const current = (linesBySection.get(section.id) ?? []).sort((a, b) => a.order - b.order);
    if (current.length === 0) texts.forEach((text, order) => migratedLines.push({ id: uid(), songId: section.songId, sectionId: section.id, text, status: "仮採用", alternate: "", rhymes: "", ideaIds: [], note: "", order, createdAt: stamp, updatedAt: stamp }));
    else if (current.map((line) => line.text).join("\n") !== section.body) {
      texts.forEach((text, order) => reconciledLines.push(current[order] ? { ...current[order], text, order, updatedAt: stamp } : { id: uid(), songId: section.songId, sectionId: section.id, text, status: "仮採用", alternate: "", rhymes: "", ideaIds: [], note: "", order, createdAt: stamp, updatedAt: stamp }));
      removedLineIds.push(...current.slice(texts.length).map((line) => line.id));
    }
  }
  const migratedIdeas: Idea[] = [];
  for (const card of associations) {
    const id = `legacy-association-${card.id}`; if (ideaIds.has(id)) continue;
    migratedIdeas.push({ id, songId: card.songId, text: card.text, category: ideaCategoryForAssociation(card.category), assetIds: card.imageAssetId ? [card.imageAssetId] : [], legacyAssociationId: card.id, createdAt: card.createdAt, updatedAt: card.updatedAt }); ideaIds.add(id);
  }
  for (const scene of scenes) {
    const id = `legacy-scene-${scene.id}`; if (ideaIds.has(id)) continue;
    migratedIdeas.push({ id, songId: scene.songId, text: [scene.name, scene.action, scene.note].filter(Boolean).join("\n"), category: "映像", assetIds: scene.referenceAssetIds, legacySceneId: scene.id, createdAt: scene.createdAt, updatedAt: scene.updatedAt }); ideaIds.add(id);
  }
  await db.transaction("rw", [db.songs, db.sections, db.lyricLines, db.ideas, db.sketches, db.media, db.inbox], async () => {
    await db.sections.bulkPut(normalizedSections); if (migratedIdeas.length) await db.ideas.bulkAdd(migratedIdeas);
    if (migratedLines.length) await db.lyricLines.bulkAdd(migratedLines);
    if (reconciledLines.length) await db.lyricLines.bulkPut(reconciledLines);
    if (removedLineIds.length) await db.lyricLines.bulkDelete(removedLineIds);
    await db.lyricLines.toCollection().modify((line: LyricLine) => { line.alternate = line.alternate ?? ""; line.rhymes = line.rhymes ?? ""; line.ideaIds = line.ideaIds ?? []; line.note = line.note ?? ""; });
    await db.ideas.toCollection().modify((idea: Idea) => { delete idea.pinned; delete idea.sourceExcerpt; if (!Array.isArray(idea.assetIds)) idea.assetIds = []; });
    await db.sketches.bulkPut(sketches.map((sketch) => ({ ...sketch, strokes: sketch.strokes ?? [], texts: sketch.texts ?? [], arrows: sketch.arrows ?? [], shapes: sketch.shapes ?? [], annotations: sketch.annotations ?? [], guideVisible: sketch.guideVisible ?? true, guideInExport: sketch.guideInExport ?? false, underlayInExport: sketch.underlayInExport ?? true, backgroundColor: sketch.backgroundColor ?? "#fffdf9", promptFields: sketch.promptFields ?? {}, draft: false })));
    await db.media.bulkPut(media.map((item) => ({ ...item, note: item.note ?? "" })));
    await db.inbox.bulkPut(inbox.map((item) => ({ ...item, kind: "note" as const, assetIds: inboxAssetIds(item), usedSongIds: item.usedSongIds ?? [], updatedAt: item.updatedAt ?? item.createdAt })));
    await db.songs.toCollection().modify((song: Song) => {
      if (!["構想中", "歌詞制作中", "仮歌確認中", "調整中", "完成", "保留"].includes(song.stage)) song.stage = "構想中";
      song.draft = false;
    });
  });
}

export function storageErrorMessage(error: unknown) {
  if (error instanceof DOMException && (error.name === "QuotaExceededError" || error.name === "UnknownError")) return "保存容量が不足しています。不要な素材を削除するか、バックアップ後に整理してください。";
  return error instanceof Error ? `保存できませんでした：${error.message}` : "保存に失敗しました。";
}

export async function moveOrdered<T extends { id: string; order: number }>(table: EntityTable<T, "id">, items: T[], from: number, to: number) {
  if (to < 0 || to >= items.length || from === to) return items;
  const reordered = [...items]; const [moved] = reordered.splice(from, 1); reordered.splice(to, 0, moved);
  const updated = reordered.map((item, order) => ({ ...item, order })); await table.bulkPut(updated); return updated;
}
