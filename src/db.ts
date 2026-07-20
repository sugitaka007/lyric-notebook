import Dexie, { type EntityTable } from "dexie";
import type { AppMeta, AssociationCard, InboxItem, LyricLine, LyricSection, MediaAsset, MVScene, SketchRecord, Song, SongWorkspace } from "./types";

export const DB_NAME = "yohaku-lyric-notebook";
export const DB_VERSION = 2;
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

export class LyricDatabase extends Dexie {
  songs!: EntityTable<Song, "id">; sections!: EntityTable<LyricSection, "id">;
  lyricLines!: EntityTable<LyricLine, "id">; associations!: EntityTable<AssociationCard, "id">;
  mvScenes!: EntityTable<MVScene, "id">; sketches!: EntityTable<SketchRecord, "id">;
  media!: EntityTable<MediaAsset, "id">; inbox!: EntityTable<InboxItem, "id">; meta!: EntityTable<AppMeta, "key">;
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
  }
}

export const db = new LyricDatabase();
export const uid = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
};
export const now = () => new Date().toISOString();

export function emptySong(title = "無題の曲"): Song {
  const stamp = now();
  return { id: uid(), title, workingTitle: "", summary: "", protagonist: "", counterpart: "", place: "", time: "", perspective: "", baseColor: "#ffd60a", repeatedWords: "", repeatedObjects: "", avoidExpressions: "", lastingEmotion: "", stage: "種", color: "#ffd60a", tags: [], archived: false, createdAt: stamp, updatedAt: stamp };
}

export async function createSong(title?: string) {
  const song = emptySong(title);
  const names = ["Aメロ", "サビ"];
  const sections = names.map((name, order) => ({ id: uid(), songId: song.id, name, order }));
  await db.transaction("rw", [db.songs, db.sections, db.lyricLines], async () => {
    await db.songs.add(song); await db.sections.bulkAdd(sections);
  });
  return song;
}

export async function loadWorkspace(songId: string): Promise<SongWorkspace> {
  const [sections, lines, associations, scenes, sketches, media] = await Promise.all([
    db.sections.where("songId").equals(songId).sortBy("order"), db.lyricLines.where("songId").equals(songId).toArray(),
    db.associations.where("songId").equals(songId).toArray(), db.mvScenes.where("songId").equals(songId).sortBy("order"),
    db.sketches.where("songId").equals(songId).toArray(), db.media.where("songId").equals(songId).toArray(),
  ]);
  return { sections, lines, associations, scenes, sketches, media };
}

export async function deleteSongCascade(songId: string) {
  await db.transaction("rw", db.tables, async () => {
    await Promise.all([db.sections.where("songId").equals(songId).delete(), db.lyricLines.where("songId").equals(songId).delete(), db.associations.where("songId").equals(songId).delete(), db.mvScenes.where("songId").equals(songId).delete(), db.sketches.where("songId").equals(songId).delete(), db.media.where("songId").equals(songId).delete()]);
    await db.songs.delete(songId);
  });
}

export async function duplicateSong(sourceId: string) {
  const source = await db.songs.get(sourceId); if (!source) throw new Error("複製元の曲が見つかりません。");
  const data = await loadWorkspace(sourceId); const songId = uid(); const stamp = now();
  const song: Song = { ...source, id: songId, title: `${source.title}（コピー）`, archived: false, createdAt: stamp, updatedAt: stamp };
  const sectionIds = new Map(data.sections.map((item) => [item.id, uid()])); const lineIds = new Map(data.lines.map((item) => [item.id, uid()]));
  const cardIds = new Map(data.associations.map((item) => [item.id, uid()])); const sceneIds = new Map(data.scenes.map((item) => [item.id, uid()])); const mediaIds = new Map(data.media.map((item) => [item.id, uid()]));
  const sections = data.sections.map((item) => ({ ...item, id: sectionIds.get(item.id)!, songId }));
  const lines = data.lines.map((item) => ({ ...item, id: lineIds.get(item.id)!, songId, sectionId: sectionIds.get(item.sectionId)! }));
  const associations = data.associations.map((item) => ({ ...item, id: cardIds.get(item.id)!, songId, relatedLyricId: item.relatedLyricId ? lineIds.get(item.relatedLyricId) : undefined, imageAssetId: item.imageAssetId ? mediaIds.get(item.imageAssetId) : undefined }));
  const scenes = data.scenes.map((item) => ({ ...item, id: sceneIds.get(item.id)!, songId, relatedLyricIds: item.relatedLyricIds.map((id) => lineIds.get(id) ?? id), referenceAssetIds: item.referenceAssetIds.map((id) => mediaIds.get(id) ?? id) }));
  const sketches = data.sketches.map((item) => ({ ...item, id: uid(), songId, relatedLyricId: item.relatedLyricId ? lineIds.get(item.relatedLyricId) : undefined, relatedSceneId: item.relatedSceneId ? sceneIds.get(item.relatedSceneId) : undefined }));
  const media = data.media.map((item) => ({ ...item, id: mediaIds.get(item.id)!, songId, links: item.links.map((link) => ({ ...link, id: link.type === "lyric" ? lineIds.get(link.id) ?? link.id : link.type === "association" ? cardIds.get(link.id) ?? link.id : sceneIds.get(link.id) ?? link.id })) }));
  await db.transaction("rw", db.tables, async () => { await db.songs.add(song); await Promise.all([db.sections.bulkAdd(sections), db.lyricLines.bulkAdd(lines), db.associations.bulkAdd(associations), db.mvScenes.bulkAdd(scenes), db.sketches.bulkAdd(sketches), db.media.bulkAdd(media)]); });
  return song;
}

export function storageErrorMessage(error: unknown) {
  if (error instanceof DOMException && (error.name === "QuotaExceededError" || error.name === "UnknownError")) return "端末の保存容量が不足しています。不要な素材を削除するか、バックアップ後に整理してください。";
  return error instanceof Error ? `保存できませんでした：${error.message}` : "IndexedDBへの保存に失敗しました。";
}

export async function moveOrdered<T extends { id: string; order: number }>(table: EntityTable<T, "id">, items: T[], from: number, to: number) {
  if (to < 0 || to >= items.length || from === to) return items;
  const reordered = [...items]; const [moved] = reordered.splice(from, 1); reordered.splice(to, 0, moved);
  const updated = reordered.map((item, order) => ({ ...item, order })); await table.bulkPut(updated); return updated;
}
