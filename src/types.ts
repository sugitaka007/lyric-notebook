export type LyricStatus = "仮採用" | "採用" | "要修正" | "別案あり" | "重要";
export type AssociationCategory = "次の歌詞" | "物語" | "人物" | "感情" | "MV映像" | "色" | "音" | "小道具" | "自由メモ";
export type IdeaCategory = "言葉・歌詞" | "音・メロディ" | "映像" | "その他";
export type SongStage = "構想中" | "歌詞制作中" | "仮歌確認中" | "調整中" | "完成" | "保留";
export type AspectRatio = "16:9" | "9:16" | "1:1";
export type MediaKind = "image" | "audio" | "url";
export type MediaOrigin = "recording" | "file";

export interface Song {
  id: string; title: string; workingTitle: string; summary: string; protagonist: string;
  counterpart: string; place: string; time: string; perspective: string; baseColor: string;
  repeatedWords: string; repeatedObjects: string; avoidExpressions: string; lastingEmotion: string;
  stage: SongStage; color: string; tags: string[]; archived: boolean; draft?: boolean; createdAt: string; updatedAt: string;
}
export interface LyricSection { id: string; songId: string; name: string; order: number; body: string; }
export interface LyricLine {
  id: string; songId: string; sectionId: string; text: string; status: LyricStatus;
  alternate: string; rhymes?: string; ideaIds?: string[]; note: string; order: number; createdAt: string; updatedAt: string;
}
export interface AssociationCard {
  id: string; songId: string; category: AssociationCategory; text: string; color: string;
  relatedLyricId?: string; imageAssetId?: string; createdAt: string; updatedAt: string;
}
export interface MVScene {
  id: string; songId: string; order: number; name: string; relatedLyricIds: string[];
  startTime: string; endTime: string; characters: string; location: string; timeOfDay: string;
  action: string; cameraPosition: string; cameraMovement: string; lighting: string; color: string;
  costume: string; props: string; editing: string; referenceAssetIds: string[]; note: string;
  createdAt: string; updatedAt: string;
}
export interface Idea {
  id: string; songId: string; text: string; category?: IdeaCategory; pinned?: boolean; assetIds: string[];
  sourceInboxId?: string; sourceExcerpt?: string; legacyAssociationId?: string; legacySceneId?: string; createdAt: string; updatedAt: string;
}
export interface LyricVersionLine {
  text: string; alternate: string; rhymes: string; status: LyricStatus; ideaIds: string[]; note: string; order: number;
}
export interface LyricVersionSection { name: string; order: number; lines: LyricVersionLine[]; }
export interface LyricVersion {
  id: string; songId: string; name: string; sections: LyricVersionSection[]; createdAt: string;
}
export interface Point { x: number; y: number; }
export interface Stroke { id?: string; tool: "pen" | "eraser"; color: string; width: number; points: Point[]; }
export interface SketchLayerRef { type: "stroke" | "shape" | "annotation" | "text"; id: string; }
export type SketchTextSize = "small" | "medium" | "large";
export interface SketchTextElement { id: string; text: string; position: Point; color: string; size: SketchTextSize; }
export interface SketchArrowElement { id: string; start: Point; end: Point; color: string; width: number; }
export type SketchShapeType = "rectangle" | "ellipse" | "line" | "triangle" | "person";
export type SketchFill = "none" | "translucent" | "solid";
export interface SketchShapeElement {
  id: string; type: SketchShapeType; position: Point; size: Point; rotation: number;
  color: string; width: number; fill: SketchFill;
}
export interface SketchAnnotationElement {
  id: string; text: string; target: Point; label: Point; textColor: string; textSize: SketchTextSize;
  arrowColor: string; arrowWidth: number;
}
export type SketchPromptKey = "subject" | "action" | "composition" | "background" | "lighting" | "colors" | "mood" | "style" | "include" | "exclude";
export type SketchPromptFields = Partial<Record<SketchPromptKey, string>>;
export interface SketchRecord {
  id: string; songId: string; name: string; aspect: AspectRatio; strokes: Stroke[];
  texts?: SketchTextElement[]; arrows?: SketchArrowElement[]; guideVisible?: boolean; guideInExport?: boolean;
  shapes?: SketchShapeElement[]; annotations?: SketchAnnotationElement[];
  layerOrder?: SketchLayerRef[];
  underlayInExport?: boolean; initialName?: string; draft?: boolean;
  backgroundColor?: string; promptFields?: SketchPromptFields;
  previewBlob?: Blob; underlayBlob?: Blob; relatedLyricId?: string; relatedSceneId?: string;
  createdAt: string; updatedAt: string;
}
export interface MediaLink { type: "lyric" | "association" | "scene"; id: string; }
export interface MediaAsset {
  id: string; songId?: string; kind: MediaKind; origin?: MediaOrigin; name: string; note?: string; mimeType: string; blob?: Blob;
  size: number; durationSeconds?: number; url?: string; links: MediaLink[]; createdAt: string; updatedAt: string;
}
export interface InboxItem {
  id: string; kind: "note" | "lyric" | "mv" | "audio" | "image" | "sketch"; text: string;
  assetId?: string; assetIds?: string[]; deletedAt?: string; createdAt: string; updatedAt?: string;
  theme?: string; sourceType?: string; tags?: string[]; sourceOrder?: number; themeOrder?: number; importKey?: string;
  usedSongIds?: string[];
}
export interface AppMeta { key: string; value: unknown; }
export interface SongWorkspace {
  sections: LyricSection[]; lines: LyricLine[]; ideas: Idea[]; associations: AssociationCard[];
  scenes: MVScene[]; sketches: SketchRecord[]; media: MediaAsset[]; lyricVersions: LyricVersion[];
}
export const EMPTY_WORKSPACE: SongWorkspace = { sections: [], lines: [], ideas: [], associations: [], scenes: [], sketches: [], media: [], lyricVersions: [] };
