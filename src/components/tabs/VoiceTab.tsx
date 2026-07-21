import { useState } from "react";
import { db, markSongUsed, now, uid } from "../../db";
import { getAudioDuration } from "../../media";
import type { MediaAsset } from "../../types";
import { AudioRecorder } from "../AudioRecorder";
import type { TabProps } from "../SongEditor";
import { AssetCard } from "./AssetCard";

const isRecording = (asset: MediaAsset) => asset.kind === "audio" && (asset.origin === "recording" || (!asset.origin && asset.name.startsWith("録音")));

export function VoiceTab({ song, workspace, setWorkspace, queueSave, notify }: TabProps) {
  const [mode, setMode] = useState<"recording" | "file">("recording");
  const items = workspace.media.filter((asset) => asset.kind === "audio" && (mode === "recording" ? isRecording(asset) : !isRecording(asset))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  async function saveRecording(file: File, durationSeconds: number) {
    try {
      const stamp = now(); const asset: MediaAsset = { id: uid(), songId: song.id, kind: "audio", origin: "recording", name: `録音 ${new Date(stamp).toLocaleString("ja-JP")}`, note: "", mimeType: file.type, blob: file, size: file.size, durationSeconds, links: [], createdAt: stamp, updatedAt: stamp };
      await db.media.add(asset); await markSongUsed(song.id); setWorkspace((data) => ({ ...data, media: [asset, ...data.media] }));
    } catch (error) { notify(error instanceof Error ? error.message : "録音を保存できませんでした。"); }
  }

  async function addFile(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("audio/") && !/\.(m4a|mp3|wav|webm|ogg)$/i.test(file.name)) { notify("m4a、mp3、wav、webm、oggの音声ファイルを選んでください。"); return; }
    try {
      const stamp = now(); const durationSeconds = await getAudioDuration(file);
      const asset: MediaAsset = { id: uid(), songId: song.id, kind: "audio", origin: "file", name: file.name, note: "", mimeType: file.type || "audio/mpeg", blob: file, size: file.size, durationSeconds, links: [], createdAt: stamp, updatedAt: stamp };
      await db.media.add(asset); await markSongUsed(song.id); setWorkspace((data) => ({ ...data, media: [asset, ...data.media] }));
    } catch (error) { notify(error instanceof Error ? error.message : "音声ファイルを保存できませんでした。"); }
  }

  function patch(asset: MediaAsset, values: Partial<MediaAsset>) {
    const updated = { ...asset, ...values, updatedAt: now() };
    setWorkspace((data) => ({ ...data, media: data.media.map((item) => item.id === asset.id ? updated : item) })); queueSave(db.media, updated);
  }
  async function remove(asset: MediaAsset) {
    if (!window.confirm(`「${asset.name}」を削除しますか？`)) return;
    await db.media.delete(asset.id); setWorkspace((data) => ({ ...data, media: data.media.filter((item) => item.id !== asset.id) }));
  }

  return <section className="tab-page voice-page"><div className="tab-heading"><h1>音声</h1></div>
    <div className="segmented voice-switch"><button className={mode === "recording" ? "active" : ""} onClick={() => setMode("recording")}>録音</button><button className={mode === "file" ? "active" : ""} onClick={() => setMode("file")}>ファイル</button></div>
    {mode === "recording" ? <AudioRecorder onRecorded={saveRecording} notify={notify} /> : <label className="single-file"><input type="file" accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg" onChange={(event) => { void addFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />音声ファイルを追加</label>}
    <div className="material-list">{items.map((asset) => <AssetCard key={asset.id} asset={asset} onPatch={(values) => patch(asset, values)} onDelete={() => void remove(asset)} />)}</div>
    {items.length === 0 && <p className="plain-empty compact-empty">{mode === "recording" ? "録音はありません。" : "音声ファイルはありません。"}</p>}
  </section>;
}
