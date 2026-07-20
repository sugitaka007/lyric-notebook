import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBackupBlob, inspectBackup, restoreBackup } from "../src/backup";
import { createSong, db, loadWorkspace, now, uid } from "../src/db";
import type { LyricLine, MediaAsset } from "../src/types";

beforeEach(async () => { await db.delete(); await db.open(); });
afterAll(async () => { await db.delete(); });

describe("バックアップ", () => {
  it("曲・文章・画像・音声を書き出して完全復元できる", async () => {
    const song = await createSong("バックアップ曲"); const section = (await loadWorkspace(song.id)).sections[0];
    const line: LyricLine = { id: uid(), songId: song.id, sectionId: section.id, text: "消えない言葉", status: "採用", alternate: "", note: "大切", order: 0, createdAt: now(), updatedAt: now() };
    const media: MediaAsset[] = [{ id: uid(), songId: song.id, kind: "image", name: "image.png", mimeType: "image/png", blob: new Blob(["image-bytes"], { type: "image/png" }), size: 11, links: [{ type: "lyric", id: line.id }], createdAt: now(), updatedAt: now() }, { id: uid(), songId: song.id, kind: "audio", name: "voice.m4a", mimeType: "audio/mp4", blob: new Blob(["audio-bytes"], { type: "audio/mp4" }), size: 11, links: [], createdAt: now(), updatedAt: now() }];
    await db.lyricLines.add(line); await db.media.bulkAdd(media); const backup = await createBackupBlob(); const manifest = await inspectBackup(backup.blob);
    expect(manifest.counts.songs).toBe(1); expect(manifest.counts.media).toBe(2);
    await db.songs.clear(); await db.sections.clear(); await db.lyricLines.clear(); await db.media.clear(); await restoreBackup(backup.blob, "replace");
    expect(await db.songs.count()).toBe(1); expect((await db.lyricLines.get(line.id))?.text).toBe("消えない言葉");
    const restored = await db.media.toArray(); expect(restored).toHaveLength(2); expect(await restored[0].blob?.text()).toMatch(/bytes/);
  });

  it("追加復元では既存データを上書きせずIDを再割当する", async () => {
    await createSong("追加曲"); const backup = await createBackupBlob(); await restoreBackup(backup.blob, "merge");
    const songs = await db.songs.toArray(); expect(songs).toHaveLength(2); expect(new Set(songs.map((x) => x.id)).size).toBe(2); expect(songs.some((x) => x.title.includes("復元"))).toBe(true);
  });
});
