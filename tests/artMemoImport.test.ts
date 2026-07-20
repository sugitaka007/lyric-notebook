import { describe, expect, it } from "vitest";
import { parseArtMemoImport } from "../src/artMemoImport";

describe("整理済みJSONの取込", () => {
  it("フレーズをテーマ・種類・タグ付きの未整理メモへ変換する", () => {
    const result = parseArtMemoImport(JSON.stringify({
      version: 1,
      sourceTitle: "歌詞ストック",
      categories: ["芸術・音楽観", "映像・制作構想"],
      phrases: [
        { id: "import-0001", text: "最初の言葉", sourceOrder: 1, type: "歌詞", theme: "芸術・音楽観", tags: ["音楽"] },
        { id: "import-0002", text: "夜の道路", sourceOrder: 2, type: "MV", theme: "映像・制作構想", tags: ["MV"] },
      ],
    }), "2026-07-21T00:00:00.000Z");
    expect(result.themeCount).toBe(2);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ text: "最初の言葉", theme: "芸術・音楽観", sourceType: "歌詞", tags: ["音楽"], sourceOrder: 1, themeOrder: 0 });
    expect(result.items[1].importKey).not.toBe(result.items[0].importKey);
  });

  it("同じ入力から同じ重複判定キーを作り、不正な形式を拒否する", () => {
    const raw = JSON.stringify({ version: 1, phrases: [{ id: "a", text: "同じ文章", theme: "分類" }] });
    expect(parseArtMemoImport(raw).items[0].importKey).toBe(parseArtMemoImport(raw).items[0].importKey);
    expect(() => parseArtMemoImport("{broken")).toThrow("JSONファイル");
    expect(() => parseArtMemoImport(JSON.stringify({ items: [] }))).toThrow("phrases");
  });
});

