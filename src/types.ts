export type LyricStatus = "仮採用" | "採用" | "要修正" | "別案あり" | "重要";
export type AssociationCategory = "次の歌詞" | "物語" | "人物" | "感情" | "MV映像" | "色" | "音" | "小道具" | "自由メモ";
export type SongStage = "種" | "制作中" | "推敲中" | "完成" | "保留";
export type AspectRatio = "16:9" | "9:16" | "1:1";
export type MediaKind = "image" | "audio" | "url";

export interface Song {
  id: string; title: string; workingTitle: string; summary: string; protagonist: string;
  counterpart: string; place: string; time: string; perspective: string; baseColor: string;
  repeatedWords: string; repeatedObjects: string; avoidExpressions: string; lastingEmotion: string;
  stage: SongStage; color: string; tags: string[]; archived: boolean; createdAt: string; updatedAt: string;
}
export interface LyricSection { id: string; songId: string; name: string; order: number; }
export interface LyricLine {
  id: string; songId: string; sectionId: string; text: string; status: LyricStatus;
  alternate: string; note: string; order: number; createdAt: string; updatedAt: string;
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
export interface Point { x: number; y: number; }
export interface Stroke { tool: "pen" | "eraser"; color: string; width: number; points: Point[]; }
export interface SketchRecord {
  id: string; songId: string; name: string; aspect: AspectRatio; strokes: Stroke[];
  previewBlob?: Blob; underlayBlob?: Blob; relatedLyricId?: string; relatedSceneId?: string;
  createdAt: string; updatedAt: string;
}
export interface MediaLink { type: "lyric" | "association" | "scene"; id: string; }
export interface MediaAsset {
  id: string; songId?: string; kind: MediaKind; name: string; mimeType: string; blob?: Blob;
  size: number; url?: string; links: MediaLink[]; createdAt: string; updatedAt: string;
}
export interface InboxItem {
  id: string; kind: "lyric" | "mv" | "audio" | "image"; text: string; assetId?: string; createdAt: string;
}
export interface AppMeta { key: string; value: unknown; }
export interface SongWorkspace {
  sections: LyricSection[]; lines: LyricLine[]; associations: AssociationCard[];
  scenes: MVScene[]; sketches: SketchRecord[]; media: MediaAsset[];
}
export const EMPTY_WORKSPACE: SongWorkspace = { sections: [], lines: [], associations: [], scenes: [], sketches: [], media: [] };
