import JSZip from "jszip";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { BACKUP_FORMAT_VERSION, createBackupBlob, inspectBackup, restoreBackup } from "../src/backup";
import { createSong, db, loadWorkspace, now, uid } from "../src/db";
import type { AssociationCard, Idea, LyricLine, MediaAsset, MVScene, SketchRecord } from "../src/types";

beforeEach(async () => { await db.delete(); await db.open(); });
afterAll(async () => { await db.delete(); });

describe("バックアップ", () => {
  it("曲・複数行歌詞・アイデア・画像・音声を書き出して完全復元できる", async () => {
    const song = await createSong("バックアップ曲"); const section = (await loadWorkspace(song.id)).sections[0];
    await db.sections.update(section.id, { body: "消えない言葉\n次の行" });
    const stamp = now(); const imageId = uid();
    const idea: Idea = { id: uid(), songId: song.id, text: "映像の断片", category: "映像", sourceExcerpt: "消えない言葉", pinned: true, assetIds: [imageId], createdAt: stamp, updatedAt: stamp };
    const sketch: SketchRecord = { id: uid(), songId: song.id, name: "構図", aspect: "16:9", strokes: [], texts: [{ id: uid(), text: "主人公", position: { x: .2, y: .3 }, color: "#000000", size: "medium" }], arrows: [{ id: uid(), start: { x: .2, y: .3 }, end: { x: .7, y: .6 }, color: "#ff0000", width: 4 }], guideVisible: true, guideInExport: false, backgroundColor: "#ffffff", promptFields: { subject: "主人公" }, previewBlob: new Blob(["preview"], { type: "image/png" }), createdAt: stamp, updatedAt: stamp };
    const media: MediaAsset[] = [{ id: imageId, songId: song.id, kind: "image", name: "image.png", note: "参考", mimeType: "image/png", blob: new Blob(["image-bytes"], { type: "image/png" }), size: 11, links: [], createdAt: stamp, updatedAt: stamp }, { id: uid(), songId: song.id, kind: "audio", origin: "recording", name: "録音.m4a", note: "鼻歌", mimeType: "audio/mp4", blob: new Blob(["audio-bytes"], { type: "audio/mp4" }), size: 11, links: [], createdAt: stamp, updatedAt: stamp }];
    await db.ideas.add(idea); await db.media.bulkAdd(media); await db.sketches.add(sketch);
    const backup = await createBackupBlob(); const manifest = await inspectBackup(backup.blob);
    expect(manifest.formatVersion).toBe(BACKUP_FORMAT_VERSION); expect(manifest.counts.songs).toBe(1); expect(manifest.counts.media).toBe(2); expect(manifest.counts.ideas).toBe(1);
    await Promise.all(db.tables.map((table) => table.clear())); await restoreBackup(backup.blob, "replace");
    expect(await db.songs.count()).toBe(1);
    expect((await db.sections.get(section.id))?.body).toBe("消えない言葉\n次の行");
    expect((await db.ideas.get(idea.id))?.sourceExcerpt).toBeUndefined();
    const restoredSketch = await db.sketches.get(sketch.id); expect(restoredSketch?.texts?.[0].text).toBe("主人公"); expect(restoredSketch?.arrows).toHaveLength(1); expect(await restoredSketch?.previewBlob?.text()).toBe("preview");
    const restored = await db.media.toArray(); expect(restored).toHaveLength(2); expect((await restored[0].blob?.text())?.includes("bytes")).toBe(true);
    expect(restored.some((item) => item.origin === "recording")).toBe(true);
  });

  it("追加復元では既存データを上書きせずIDを再割当する", async () => {
    await createSong("追加曲"); const backup = await createBackupBlob(); await restoreBackup(backup.blob, "merge");
    const songs = await db.songs.toArray(); expect(songs).toHaveLength(2); expect(new Set(songs.map((item) => item.id)).size).toBe(2); expect(songs.some((item) => item.title.includes("復元"))).toBe(true);
  });

  it("旧形式v1を検証・復元し、歌詞行・連想・MV場面を新形式へ変換する", async () => {
    const stamp = now(); const song = await createSong("仮"); const legacySong = { ...song, id: "old-song", title: "旧バックアップ" };
    const section = { id: "old-section", songId: legacySong.id, name: "Aメロ", order: 0 };
    const line: LyricLine = { id: "old-line", songId: legacySong.id, sectionId: section.id, text: "旧い歌詞", status: "採用", alternate: "", note: "", order: 0, createdAt: stamp, updatedAt: stamp };
    const association: AssociationCard = { id: "old-card", songId: legacySong.id, category: "音", text: "低いピアノ", color: "#000", relatedLyricId: line.id, createdAt: stamp, updatedAt: stamp };
    const scene: MVScene = { id: "old-scene", songId: legacySong.id, order: 0, name: "夜道", relatedLyricIds: [line.id], startTime: "", endTime: "", characters: "", location: "", timeOfDay: "", action: "歩く", cameraPosition: "", cameraMovement: "", lighting: "", color: "", costume: "", props: "", editing: "", referenceAssetIds: [], note: "雨", createdAt: stamp, updatedAt: stamp };
    const data = { songs: [legacySong], sections: [section], lyricLines: [line], associations: [association], mvScenes: [scene], sketches: [], media: [], inbox: [] };
    const counts = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value.length]));
    const zip = new JSZip(); zip.file("manifest.json", JSON.stringify({ app: "yohaku-lyric-notebook", formatVersion: 1, createdAt: stamp, counts })); zip.file("data.json", JSON.stringify(data));
    const blob = await zip.generateAsync({ type: "blob" });
    expect((await inspectBackup(blob)).formatVersion).toBe(1);
    await restoreBackup(blob, "replace");
    expect((await db.sections.get(section.id))?.body).toBe("旧い歌詞");
    const ideas = await db.ideas.where("songId").equals(legacySong.id).toArray();
    expect(ideas.map((item) => item.text)).toEqual(expect.arrayContaining(["低いピアノ", "夜道\n歩く\n雨"]));
  });
});
