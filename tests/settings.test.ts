import { describe, expect, it } from "vitest";
import { buildGptPrompt, buildSketchPrompt, normalizeSettings } from "../src/settings";
import { shouldUndoTwoFingerTap } from "../src/sketch-gesture";

describe("GPT用コピー", () => {
  it("選択した複数フレーズ・依頼だけを指定件数で文章化する", () => {
    const text = buildGptPrompt(["夜の窓", "名前のない声"], ["paraphrase", "rhythm"], 20);
    expect(text).toContain("・夜の窓"); expect(text).toContain("・名前のない声"); expect(text).toContain("20案"); expect(text).toContain("音数、リズム、語感"); expect(text).not.toContain("情景を具体的に");
  });

  it("設定値を補正し、初期依頼を必ず一つ保持する", () => {
    const settings = normalizeSettings({ gptSuggestionCount: 5, gptDefaultRequests: [], sketchDefaultAspect: "9:16" });
    expect(settings.gptSuggestionCount).toBe(5); expect(settings.gptDefaultRequests).toEqual(["paraphrase"]); expect(settings.sketchDefaultAspect).toBe("9:16");
  });
});

describe("画像生成用コピー", () => {
  it("入力済みの項目だけを命令文へ含める", () => {
    const text = buildSketchPrompt({ subject: "赤い傘の人物", lighting: "夜の逆光", exclude: "文字", mood: "" });
    expect(text).toContain("【主役】\n赤い傘の人物"); expect(text).toContain("【時間帯・照明】\n夜の逆光"); expect(text).toContain("【含めないもの】\n文字"); expect(text).not.toContain("【雰囲気】");
  });

  it("二本指の短い静止タップだけを一回の取り消しとして判定する", () => {
    expect(shouldUndoTwoFingerTap({ active: true, start: 1000, moved: false, undone: false }, 1200)).toBe(true);
    expect(shouldUndoTwoFingerTap({ active: true, start: 1000, moved: true, undone: false }, 1200)).toBe(false);
    expect(shouldUndoTwoFingerTap({ active: true, start: 1000, moved: false, undone: true }, 1200)).toBe(false);
    expect(shouldUndoTwoFingerTap({ active: true, start: 1000, moved: false, undone: false }, 1500)).toBe(false);
  });
});
