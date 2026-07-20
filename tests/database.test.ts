import Dexie from "dexie";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSong, db, deleteSongCascade, loadWorkspace, LyricDatabase, moveOrdered, now, STORES_V1, uid } from "../src/db";
import type { AssociationCard, LyricLine, MVScene, SketchRecord, Song } from "../src/types";

beforeEach(async () => { await db.delete(); await db.open(); });
afterAll(async () => { await db.delete(); });

describe("曲と関連データ", () => {
  it("曲を作成・編集・削除できる", async () => {
    const song = await createSong("テスト曲"); await db.songs.update(song.id, { workingTitle: "仮題", updatedAt: now() });
    expect((await db.songs.get(song.id))?.workingTitle).toBe("仮題");
    await deleteSongCascade(song.id); expect(await db.songs.count()).toBe(0); expect(await db.sections.count()).toBe(0);
  });

  it("歌詞本文を変更しても連想カードの行IDが維持される", async () => {
    const song = await createSong("関連テスト"); const section = (await loadWorkspace(song.id)).sections[0];
    const line: LyricLine = { id: uid(), songId: song.id, sectionId: section.id, text: "最初の言葉", status: "仮採用", alternate: "", note: "", order: 0, createdAt: now(), updatedAt: now() };
    const card: AssociationCard = { id: uid(), songId: song.id, category: "色", text: "薄紫", color: "#997789", relatedLyricId: line.id, createdAt: now(), updatedAt: now() };
    await db.lyricLines.add(line); await db.associations.add(card); await db.lyricLines.update(line.id, { text: "書き直した言葉", updatedAt: now() });
    expect((await db.associations.get(card.id))?.relatedLyricId).toBe(line.id); expect((await db.lyricLines.get(line.id))?.text).toBe("書き直した言葉");
    await db.close(); await db.open(); expect((await db.associations.get(card.id))?.relatedLyricId).toBe(line.id);
  });

  it("MV場面を並べ替えられる", async () => {
    const song = await createSong("MVテスト"); const base = (name: string, order: number): MVScene => ({ id: uid(), songId: song.id, name, order, relatedLyricIds: [], startTime: "", endTime: "", characters: "", location: "", timeOfDay: "", action: "", cameraPosition: "", cameraMovement: "", lighting: "", color: "#000000", costume: "", props: "", editing: "", referenceAssetIds: [], note: "", createdAt: now(), updatedAt: now() });
    const scenes = [base("A", 0), base("B", 1), base("C", 2)]; await db.mvScenes.bulkAdd(scenes);
    const result = await moveOrdered(db.mvScenes, scenes, 2, 0); expect(result.map((x) => x.name)).toEqual(["C", "A", "B"]);
    expect((await db.mvScenes.where("songId").equals(song.id).sortBy("order")).map((x) => x.name)).toEqual(["C", "A", "B"]);
  });

  it("スケッチと画像・音声Blobを保存し、再読込・削除できる", async () => {
    const song = await createSong("素材テスト"); const sketch: SketchRecord = { id: uid(), songId: song.id, name: "絵コンテ", aspect: "16:9", strokes: [{ tool: "pen", color: "#000", width: 3, points: [{ x: .1, y: .2 }, { x: .8, y: .7 }] }], previewBlob: new Blob(["png"], { type: "image/png" }), createdAt: now(), updatedAt: now() };
    await db.sketches.add(sketch); await db.media.bulkAdd([{ id: uid(), songId: song.id, kind: "image", name: "photo.jpg", mimeType: "image/jpeg", blob: new Blob(["image"], { type: "image/jpeg" }), size: 5, links: [], createdAt: now(), updatedAt: now() }, { id: uid(), songId: song.id, kind: "audio", name: "voice.m4a", mimeType: "audio/mp4", blob: new Blob(["audio"], { type: "audio/mp4" }), size: 5, links: [], createdAt: now(), updatedAt: now() }]);
    await db.close(); await db.open(); expect((await db.sketches.get(sketch.id))?.strokes[0].points).toHaveLength(2); expect(await db.media.count()).toBe(2);
    const audio = await db.media.where("kind").equals("audio").first(); await db.media.delete(audio!.id); expect(await db.media.count()).toBe(1);
  });
});

describe("データベース移行", () => {
  it("v1の曲を破棄せずv2へ移行する", async () => {
    const name = `migration-${uid()}`; const legacy = new Dexie(name); legacy.version(1).stores(STORES_V1);
    const stamp = now(); const oldSong = { id: uid(), title: "旧データ", stage: "種", tags: [], createdAt: stamp, updatedAt: stamp } as unknown as Song;
    await legacy.table("songs").add(oldSong); legacy.close(); const migrated = new LyricDatabase(name); const loaded = await migrated.songs.get(oldSong.id);
    expect(loaded?.title).toBe("旧データ"); expect(loaded?.archived).toBe(false); expect(loaded?.workingTitle).toBe("");
    await migrated.delete();
  });
});
