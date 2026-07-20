import Dexie from "dexie";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSong, db, deleteSongCascade, loadWorkspace, LyricDatabase, moveInboxToSong, moveOrdered, now, STORES_V2, STORES_V3, uid } from "../src/db";
import type { InboxItem, MVScene, SketchRecord, Song } from "../src/types";

beforeEach(async () => { await db.delete(); await db.open(); });
afterAll(async () => { await db.delete(); });

describe("曲・メモ・素材", () => {
  it("無題の曲と空のセクションを作成し、編集・削除できる", async () => {
    const song = await createSong();
    const workspace = await loadWorkspace(song.id);
    expect(song.title).toBe("無題の曲");
    expect(workspace.sections).toHaveLength(1);
    expect(workspace.sections[0].body).toBe("");
    await db.sections.update(workspace.sections[0].id, { body: "一行目\n二行目" });
    await db.close(); await db.open();
    expect((await loadWorkspace(song.id)).sections[0].body).toBe("一行目\n二行目");
    await deleteSongCascade(song.id);
    expect(await db.songs.count()).toBe(0);
    expect(await db.sections.count()).toBe(0);
  });

  it("未整理メモの文章と添付を曲のアイデアへ移動できる", async () => {
    const song = await createSong(); const stamp = now(); const assetId = uid();
    await db.media.add({ id: assetId, kind: "audio", name: "録音.m4a", note: "", mimeType: "audio/mp4", blob: new Blob(["audio"]), size: 5, links: [], createdAt: stamp, updatedAt: stamp });
    const memo: InboxItem = { id: uid(), kind: "note", text: "曖昧な思いつき", assetIds: [assetId], createdAt: stamp, updatedAt: stamp };
    await db.inbox.add(memo); await moveInboxToSong(memo, song.id);
    const idea = await db.ideas.where("songId").equals(song.id).first();
    expect(idea?.text).toBe("曖昧な思いつき");
    expect(idea?.assetIds).toEqual([assetId]);
    expect((await db.media.get(assetId))?.songId).toBe(song.id);
    expect(await db.inbox.count()).toBe(0);
  });

  it("MV場面を並べ替えられる", async () => {
    const song = await createSong("MVテスト");
    const base = (name: string, order: number): MVScene => ({ id: uid(), songId: song.id, name, order, relatedLyricIds: [], startTime: "", endTime: "", characters: "", location: "", timeOfDay: "", action: "", cameraPosition: "", cameraMovement: "", lighting: "", color: "#000000", costume: "", props: "", editing: "", referenceAssetIds: [], note: "", createdAt: now(), updatedAt: now() });
    const scenes = [base("A", 0), base("B", 1), base("C", 2)]; await db.mvScenes.bulkAdd(scenes);
    const result = await moveOrdered(db.mvScenes, scenes, 2, 0);
    expect(result.map((item) => item.name)).toEqual(["C", "A", "B"]);
  });

  it("スケッチと画像・音声Blobを保存し、再読込・削除できる", async () => {
    const song = await createSong("素材テスト");
    const sketch: SketchRecord = { id: uid(), songId: song.id, name: "絵コンテ", aspect: "16:9", strokes: [{ tool: "pen", color: "#000", width: 3, points: [{ x: .1, y: .2 }, { x: .8, y: .7 }] }], previewBlob: new Blob(["png"], { type: "image/png" }), createdAt: now(), updatedAt: now() };
    await db.sketches.add(sketch);
    await db.media.bulkAdd([{ id: uid(), songId: song.id, kind: "image", name: "photo.jpg", note: "", mimeType: "image/jpeg", blob: new Blob(["image"]), size: 5, links: [], createdAt: now(), updatedAt: now() }, { id: uid(), songId: song.id, kind: "audio", name: "voice.m4a", note: "", mimeType: "audio/mp4", blob: new Blob(["audio"]), size: 5, links: [], createdAt: now(), updatedAt: now() }]);
    await db.close(); await db.open();
    expect((await db.sketches.get(sketch.id))?.strokes[0].points).toHaveLength(2);
    expect(await db.media.count()).toBe(2);
    const audio = await db.media.where("kind").equals("audio").first(); await db.media.delete(audio!.id);
    expect(await db.media.count()).toBe(1);
  });
});

describe("データベース更新", () => {
  it("v2以前の既存データをv3更新時に一度だけ消去する", async () => {
    const name = `reset-${uid()}`; const legacy = new Dexie(name); legacy.version(2).stores(STORES_V2);
    const stamp = now(); const oldSong = { id: uid(), title: "旧データ", stage: "種", tags: [], archived: false, createdAt: stamp, updatedAt: stamp } as unknown as Song;
    await legacy.table("songs").add(oldSong); await legacy.table("inbox").add({ id: uid(), kind: "lyric", text: "旧メモ", createdAt: stamp }); legacy.close();
    const migrated = new LyricDatabase(name); await migrated.open();
    expect(await migrated.songs.count()).toBe(0);
    expect(await migrated.inbox.count()).toBe(0);
    expect((await migrated.meta.get("v3ResetComplete"))?.value).toBeTruthy();
    await migrated.songs.add({ ...oldSong, id: uid(), title: "更新後の曲", workingTitle: "", summary: "", protagonist: "", counterpart: "", place: "", time: "", perspective: "", baseColor: "#ffd60a", repeatedWords: "", repeatedObjects: "", avoidExpressions: "", lastingEmotion: "", color: "#ffd60a" });
    migrated.close(); await migrated.open();
    expect(await migrated.songs.count()).toBe(1);
    await migrated.delete();
  });

  it("v3からv4への更新では本文とスケッチを残し、不要なアイデア情報だけ除く", async () => {
    const name = `preserve-${uid()}`; const legacy = new Dexie(name); legacy.version(3).stores(STORES_V3); const stamp = now();
    const song = { id: uid(), title: "保持する曲", stage: "種", tags: [], archived: false, createdAt: stamp, updatedAt: stamp } as unknown as Song;
    await legacy.table("songs").add(song);
    await legacy.table("ideas").add({ id: "idea", songId: song.id, text: "残す本文", pinned: true, sourceExcerpt: "旧関連", assetIds: [], createdAt: stamp, updatedAt: stamp });
    await legacy.table("sketches").add({ id: "sketch", songId: song.id, name: "構図", aspect: "16:9", strokes: [], createdAt: stamp, updatedAt: stamp }); legacy.close();
    const migrated = new LyricDatabase(name); await migrated.open();
    expect(await migrated.songs.count()).toBe(1); const idea = await migrated.ideas.get("idea"); expect(idea?.text).toBe("残す本文"); expect(idea?.pinned).toBeUndefined(); expect(idea?.sourceExcerpt).toBeUndefined();
    const sketch = await migrated.sketches.get("sketch"); expect(sketch?.texts).toEqual([]); expect(sketch?.arrows).toEqual([]); expect(sketch?.guideVisible).toBe(true);
    await migrated.delete();
  });
});
