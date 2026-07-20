import JSZip from "jszip";
import { db, normalizeRestoredData, now, uid } from "./db";
import type { AssociationCard, Idea, InboxItem, LyricLine, LyricSection, MediaAsset, MVScene, SketchRecord, Song } from "./types";

export const BACKUP_FORMAT_VERSION = 2;

interface BackupData {
  songs: Song[];
  sections: LyricSection[];
  lyricLines: LyricLine[];
  ideas: Idea[];
  associations: AssociationCard[];
  mvScenes: MVScene[];
  sketches: Array<Omit<SketchRecord, "previewBlob" | "underlayBlob"> & { previewFile?: string; underlayFile?: string }>;
  media: Array<Omit<MediaAsset, "blob"> & { blobFile?: string }>;
  inbox: InboxItem[];
}

export interface BackupManifest {
  app: "yohaku-lyric-notebook";
  formatVersion: number;
  createdAt: string;
  counts: Record<string, number>;
}

const DATA_KEYS = ["songs", "sections", "lyricLines", "ideas", "associations", "mvScenes", "sketches", "media", "inbox"] as const;
const LEGACY_KEYS = DATA_KEYS.filter((key) => key !== "ideas");
const safeName = (name: string) => name.replace(/[^\p{L}\p{N}._-]+/gu, "_").slice(0, 60) || "file";
const extensionFor = (mime: string) => mime.includes("png") ? "png" : mime.includes("jpeg") ? "jpg" : mime.includes("webp") ? "webp" : mime.includes("mp4") ? "m4a" : mime.includes("webm") ? "webm" : mime.includes("ogg") ? "ogg" : "bin";

export async function createBackupBlob() {
  const [songs, sections, lyricLines, ideas, associations, mvScenes, sketchesRaw, mediaRaw, inbox] = await Promise.all([
    db.songs.toArray(), db.sections.toArray(), db.lyricLines.toArray(), db.ideas.toArray(), db.associations.toArray(),
    db.mvScenes.toArray(), db.sketches.toArray(), db.media.toArray(), db.inbox.toArray(),
  ]);
  const zip = new JSZip();
  const media: BackupData["media"] = [];
  for (const item of mediaRaw) {
    const { blob, ...record } = item;
    const blobFile = blob ? `files/media/${item.id}-${safeName(item.name)}.${extensionFor(item.mimeType)}` : undefined;
    if (blob && blobFile) zip.file(blobFile, await blob.arrayBuffer());
    media.push({ ...record, blobFile });
  }
  const sketches: BackupData["sketches"] = [];
  for (const item of sketchesRaw) {
    const { previewBlob, underlayBlob, ...record } = item;
    const previewFile = previewBlob ? `files/sketches/${item.id}-preview.png` : undefined;
    const underlayFile = underlayBlob ? `files/sketches/${item.id}-underlay.${extensionFor(underlayBlob.type)}` : undefined;
    if (previewBlob && previewFile) zip.file(previewFile, await previewBlob.arrayBuffer());
    if (underlayBlob && underlayFile) zip.file(underlayFile, await underlayBlob.arrayBuffer());
    sketches.push({ ...record, previewFile, underlayFile });
  }
  const data: BackupData = { songs, sections, lyricLines, ideas, associations, mvScenes, sketches, media, inbox };
  const createdAt = now();
  const counts = Object.fromEntries(DATA_KEYS.map((key) => [key, data[key].length]));
  const manifest: BackupManifest = { app: "yohaku-lyric-notebook", formatVersion: BACKUP_FORMAT_VERSION, createdAt, counts };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("data.json", JSON.stringify(data, null, 2));
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  await db.meta.put({ key: "lastBackupAt", value: createdAt });
  return { blob, manifest };
}

function assertArray(value: unknown, label: string): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} が正しい配列ではありません。`);
}

async function parseBackup(file: Blob) {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(await file.arrayBuffer()); } catch { throw new Error("ZIP形式のバックアップを読み込めませんでした。"); }
  const manifestFile = zip.file("manifest.json");
  const dataFile = zip.file("data.json");
  if (!manifestFile || !dataFile) throw new Error("manifest.json または data.json がありません。");
  let manifest: BackupManifest;
  let raw: Partial<BackupData>;
  try { manifest = JSON.parse(await manifestFile.async("text")); raw = JSON.parse(await dataFile.async("text")); }
  catch { throw new Error("バックアップ内のJSONが壊れています。"); }
  if (manifest.app !== "yohaku-lyric-notebook") throw new Error("このアプリのバックアップではありません。");
  if (![1, BACKUP_FORMAT_VERSION].includes(manifest.formatVersion)) throw new Error(`未対応のバックアップ形式（${manifest.formatVersion}）です。`);
  const required = manifest.formatVersion === 1 ? LEGACY_KEYS : DATA_KEYS;
  for (const key of required) {
    assertArray(raw[key], key);
    if (raw[key]!.length !== manifest.counts[key]) throw new Error(`${key} の件数がmanifestと一致しません。`);
  }
  const normalized = { ...raw, ideas: raw.ideas ?? [] } as BackupData;
  const media: MediaAsset[] = [];
  for (const item of normalized.media) {
    let blob: Blob | undefined;
    if (item.blobFile) {
      const entry = zip.file(item.blobFile);
      if (!entry) throw new Error(`素材ファイル ${item.blobFile} がありません。`);
      blob = await entry.async("blob");
    }
    const { blobFile: _blobFile, ...record } = item; void _blobFile;
    media.push({ ...record, note: record.note ?? "", blob });
  }
  const sketches: SketchRecord[] = [];
  for (const item of normalized.sketches) {
    let previewBlob: Blob | undefined;
    let underlayBlob: Blob | undefined;
    if (item.previewFile) { const entry = zip.file(item.previewFile); if (!entry) throw new Error(`スケッチ画像 ${item.previewFile} がありません。`); previewBlob = await entry.async("blob"); }
    if (item.underlayFile) { const entry = zip.file(item.underlayFile); if (!entry) throw new Error(`下敷き画像 ${item.underlayFile} がありません。`); underlayBlob = await entry.async("blob"); }
    const { previewFile: _previewFile, underlayFile: _underlayFile, ...record } = item; void _previewFile; void _underlayFile;
    sketches.push({ ...record, previewBlob, underlayBlob });
  }
  return { manifest, data: { ...normalized, media, sketches } };
}

function remapForMerge(data: Awaited<ReturnType<typeof parseBackup>>["data"]) {
  const maps = {
    song: new Map(data.songs.map((x) => [x.id, uid()])), section: new Map(data.sections.map((x) => [x.id, uid()])), lyric: new Map(data.lyricLines.map((x) => [x.id, uid()])),
    idea: new Map(data.ideas.map((x) => [x.id, uid()])), association: new Map(data.associations.map((x) => [x.id, uid()])), scene: new Map(data.mvScenes.map((x) => [x.id, uid()])),
    sketch: new Map(data.sketches.map((x) => [x.id, uid()])), media: new Map(data.media.map((x) => [x.id, uid()])), inbox: new Map(data.inbox.map((x) => [x.id, uid()])),
  };
  const songId = (id: string) => maps.song.get(id) ?? id;
  return {
    songs: data.songs.map((x) => ({ ...x, id: songId(x.id), title: `${x.title}（復元）` })),
    sections: data.sections.map((x) => ({ ...x, id: maps.section.get(x.id)!, songId: songId(x.songId) })),
    lyricLines: data.lyricLines.map((x) => ({ ...x, id: maps.lyric.get(x.id)!, songId: songId(x.songId), sectionId: maps.section.get(x.sectionId) ?? x.sectionId })),
    ideas: data.ideas.map((x) => ({ ...x, id: maps.idea.get(x.id)!, songId: songId(x.songId), assetIds: (x.assetIds ?? []).map((id) => maps.media.get(id) ?? id) })),
    associations: data.associations.map((x) => ({ ...x, id: maps.association.get(x.id)!, songId: songId(x.songId), relatedLyricId: x.relatedLyricId ? maps.lyric.get(x.relatedLyricId) : undefined, imageAssetId: x.imageAssetId ? maps.media.get(x.imageAssetId) : undefined })),
    mvScenes: data.mvScenes.map((x) => ({ ...x, id: maps.scene.get(x.id)!, songId: songId(x.songId), relatedLyricIds: x.relatedLyricIds.map((id) => maps.lyric.get(id) ?? id), referenceAssetIds: x.referenceAssetIds.map((id) => maps.media.get(id) ?? id) })),
    sketches: data.sketches.map((x) => ({ ...x, id: maps.sketch.get(x.id)!, songId: songId(x.songId), relatedLyricId: x.relatedLyricId ? maps.lyric.get(x.relatedLyricId) : undefined, relatedSceneId: x.relatedSceneId ? maps.scene.get(x.relatedSceneId) : undefined })),
    media: data.media.map((x) => ({ ...x, id: maps.media.get(x.id)!, songId: x.songId ? songId(x.songId) : undefined, links: (x.links ?? []).map((link) => ({ ...link, id: link.type === "lyric" ? maps.lyric.get(link.id) ?? link.id : link.type === "association" ? maps.association.get(link.id) ?? link.id : maps.scene.get(link.id) ?? link.id })) })),
    inbox: data.inbox.map((x) => ({ ...x, id: maps.inbox.get(x.id)!, assetId: x.assetId ? maps.media.get(x.assetId) : undefined, assetIds: (x.assetIds ?? []).map((id) => maps.media.get(id) ?? id) })),
  };
}

export async function inspectBackup(file: Blob) { return (await parseBackup(file)).manifest; }

export async function restoreBackup(file: Blob, mode: "merge" | "replace") {
  const parsed = await parseBackup(file);
  const data = mode === "merge" ? remapForMerge(parsed.data) : parsed.data;
  await db.transaction("rw", db.tables, async () => {
    if (mode === "replace") await Promise.all(db.tables.map((table) => table.clear()));
    await db.songs.bulkPut(data.songs); await db.sections.bulkPut(data.sections); await db.lyricLines.bulkPut(data.lyricLines); await db.ideas.bulkPut(data.ideas);
    await db.associations.bulkPut(data.associations); await db.mvScenes.bulkPut(data.mvScenes); await db.sketches.bulkPut(data.sketches); await db.media.bulkPut(data.media); await db.inbox.bulkPut(data.inbox);
    await db.meta.put({ key: "lastRestoreAt", value: now() });
  });
  await normalizeRestoredData();
  return parsed.manifest;
}
