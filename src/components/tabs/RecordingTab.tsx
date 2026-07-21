import { db, markSongUsed, now, uid } from "../../db";
import type { MediaAsset } from "../../types";
import { AudioRecorder } from "../AudioRecorder";
import type { TabProps } from "../SongEditor";
import { AssetCard } from "./AssetCard";

const isRecordingAsset = (asset: MediaAsset) => asset.kind === "audio" && (asset.origin === "recording" || (!asset.origin && asset.name.startsWith("録音")));

export function RecordingTab({ song, workspace, setWorkspace, queueSave, notify }: TabProps) {
  const recordings = workspace.media.filter(isRecordingAsset);
  async function saveRecording(file: File, durationSeconds: number) {
    try {
      const stamp = now(); const asset: MediaAsset = { id: uid(), songId: song.id, kind: "audio", origin: "recording", name: `録音 ${new Date().toLocaleString("ja-JP")}`, note: "", mimeType: file.type, blob: file, size: file.size, durationSeconds, links: [], createdAt: stamp, updatedAt: stamp };
      await db.media.add(asset); await markSongUsed(song.id); setWorkspace((data) => ({ ...data, media: [asset, ...data.media] }));
    } catch (error) { notify(error instanceof Error ? error.message : "録音を保存できませんでした。"); }
  }
  function patch(asset: MediaAsset, values: Partial<MediaAsset>) { const updated = { ...asset, ...values, updatedAt: now() }; setWorkspace((data) => ({ ...data, media: data.media.map((item) => item.id === asset.id ? updated : item) })); queueSave(db.media, updated); }
  async function remove(asset: MediaAsset) { if (!window.confirm(`「${asset.name}」を削除しますか？`)) return; await db.media.delete(asset.id); setWorkspace((data) => ({ ...data, media: data.media.filter((item) => item.id !== asset.id) })); }
  return <section className="tab-page"><div className="tab-heading"><h1>録音</h1></div><AudioRecorder onRecorded={saveRecording} notify={notify} /><div className="material-list">{recordings.map((asset) => <AssetCard key={asset.id} asset={asset} onPatch={(values) => patch(asset, values)} onDelete={() => void remove(asset)} />)}</div>{recordings.length === 0 && <p className="plain-empty compact-empty">録音はありません。</p>}</section>;
}
