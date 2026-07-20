import type { AspectRatio, SketchPromptFields, SketchTextSize } from "./types";

export type ThemeMode = "system" | "light" | "dark";
export type FontSizeMode = "small" | "standard" | "large";
export type GptRequestId = "paraphrase" | "natural" | "scene" | "emotion" | "rhythm";
export type ExportBackground = "white" | "current" | "transparent";

export interface AppSettings {
  theme: ThemeMode;
  fontSize: FontSizeMode;
  accentColor: string;
  gptDefaultRequests: GptRequestId[];
  gptSuggestionCount: 5 | 10 | 20;
  gptConfirmBeforeCopy: boolean;
  sketchDefaultAspect: AspectRatio;
  sketchGuideDefault: boolean;
  sketchPenColor: string;
  sketchPenWidth: number;
  sketchTextSize: SketchTextSize;
  sketchExportBackground: ExportBackground;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  fontSize: "standard",
  accentColor: "#ffd60a",
  gptDefaultRequests: ["paraphrase"],
  gptSuggestionCount: 10,
  gptConfirmBeforeCopy: true,
  sketchDefaultAspect: "16:9",
  sketchGuideDefault: true,
  sketchPenColor: "#382f35",
  sketchPenWidth: 4,
  sketchTextSize: "medium",
  sketchExportBackground: "white",
};

export const GPT_REQUEST_OPTIONS: Array<{ id: GptRequestId; label: string }> = [
  { id: "paraphrase", label: "別の言い回しを考える" },
  { id: "natural", label: "歌詞として自然な表現に整える" },
  { id: "scene", label: "情景が伝わる表現にする" },
  { id: "emotion", label: "感情が伝わる表現にする" },
  { id: "rhythm", label: "音数や語感を整える" },
];

const requestLine = (id: GptRequestId, count: number) => ({
  paraphrase: `意味や感情の中心を残したまま、別の言い回しを${count}案提示してください。`,
  natural: "歌詞として口にしたときに自然な表現に整えてください。",
  scene: "聴いた人が情景を具体的に想像できる表現にしてください。",
  emotion: "感情の動きが伝わる表現にしてください。",
  rhythm: "歌ったときの音数、リズム、語感が整う表現にしてください。",
}[id]);

export function normalizeSettings(value: unknown, legacyTheme?: unknown): AppSettings {
  const raw = value && typeof value === "object" ? value as Partial<AppSettings> : {};
  const theme = ["system", "light", "dark"].includes(String(raw.theme)) ? raw.theme! : ["system", "light", "dark"].includes(String(legacyTheme)) ? legacyTheme as ThemeMode : DEFAULT_SETTINGS.theme;
  const requests = Array.isArray(raw.gptDefaultRequests) ? raw.gptDefaultRequests.filter((item): item is GptRequestId => GPT_REQUEST_OPTIONS.some((option) => option.id === item)) : DEFAULT_SETTINGS.gptDefaultRequests;
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    theme,
    fontSize: ["small", "standard", "large"].includes(String(raw.fontSize)) ? raw.fontSize! : DEFAULT_SETTINGS.fontSize,
    accentColor: /^#[0-9a-f]{6}$/i.test(raw.accentColor ?? "") ? raw.accentColor! : DEFAULT_SETTINGS.accentColor,
    gptDefaultRequests: requests.length ? requests : DEFAULT_SETTINGS.gptDefaultRequests,
    gptSuggestionCount: [5, 10, 20].includes(Number(raw.gptSuggestionCount)) ? raw.gptSuggestionCount as 5 | 10 | 20 : 10,
    sketchDefaultAspect: ["16:9", "9:16", "1:1"].includes(String(raw.sketchDefaultAspect)) ? raw.sketchDefaultAspect! : "16:9",
    sketchPenWidth: Math.min(28, Math.max(1, Number(raw.sketchPenWidth) || 4)),
    sketchTextSize: ["small", "medium", "large"].includes(String(raw.sketchTextSize)) ? raw.sketchTextSize! : "medium",
    sketchExportBackground: ["white", "current", "transparent"].includes(String(raw.sketchExportBackground)) ? raw.sketchExportBackground! : "white",
  };
}

export function buildGptPrompt(phrases: string[], requests: GptRequestId[], count: number) {
  const cleanPhrases = phrases.map((item) => item.trim()).filter(Boolean);
  const cleanRequests = requests.length ? requests : ["paraphrase" as const];
  return `以下のフレーズについて、選択した条件に沿った案を提示してください。\n\n【対象のフレーズ】\n${cleanPhrases.map((item) => `・${item}`).join("\n")}\n\n【依頼内容】\n${cleanRequests.map((item) => `・${requestLine(item, count)}`).join("\n")}\n\n【共通条件】\n・元のフレーズが持つ意味や感情を大きく変えないでください。\n・単語を置き換えるだけではなく、文の構造や視点が異なる案も含めてください。\n・似た案を重複させないでください。\n・各案は一行で、すぐ歌詞に利用できる形にしてください。\n・長い解説は付けず、必要な場合だけ短く補足してください。`;
}

export const SKETCH_PROMPT_OPTIONS: Array<{ key: keyof SketchPromptFields; label: string; heading: string }> = [
  { key: "subject", label: "主役となる人物や物", heading: "主役" },
  { key: "action", label: "人物の動きや表情", heading: "動き・表情" },
  { key: "composition", label: "構図とカメラ位置", heading: "構図・カメラ" },
  { key: "background", label: "場所と背景", heading: "場所・背景" },
  { key: "lighting", label: "時間帯と照明", heading: "時間帯・照明" },
  { key: "colors", label: "主な色", heading: "色" },
  { key: "mood", label: "雰囲気", heading: "雰囲気" },
  { key: "style", label: "映像や絵の表現方法", heading: "表現方法" },
  { key: "include", label: "必ず含めたいもの", heading: "必ず含めるもの" },
  { key: "exclude", label: "含めたくないもの", heading: "含めないもの" },
];

export function buildSketchPrompt(fields: SketchPromptFields = {}) {
  const sections = SKETCH_PROMPT_OPTIONS.flatMap(({ key, heading }) => fields[key]?.trim() ? [`【${heading}】\n${fields[key]!.trim()}`] : []);
  return `添付したスケッチを構図の参考画像として使用し、以下の条件でMV用の一場面を生成してください。\n\nスケッチ内の線、文字、矢印は、人物や物の位置、向き、動き、画面内の大きさ、カメラとの距離を説明するためのものです。手描きの線、説明用の文字、矢印を完成画像へそのまま描写する必要はありません。${sections.length ? `\n\n${sections.join("\n\n")}` : ""}\n\n人物や主要な物の配置は、添付したスケッチをできるだけ維持してください。不足している細部は、全体の雰囲気を損なわない範囲で補ってください。`;
}

export async function copyToClipboard(text: string) {
  if (!navigator.clipboard?.writeText) return false;
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
