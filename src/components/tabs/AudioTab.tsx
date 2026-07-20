import { db, now, uid } from "../../db";
import type { MediaAsset } from "../../types";
import type { TabProps } from "../SongEditor";
import { AssetCard } from "./AssetCard";

const isRecordingAsset = (asset: MediaAsset) => asset.kind === "audio" && (asset.origin === "recording" || (!asset.origin && asset.name.startsWith("録音")));

export function AudioTab({ song, workspace, setWorkspace, queueSave, notify }: TabProps) {
  const audio = workspace.media.filter((asset) => asset.kind === "audio" && !isRecordingAsset(asset));
  async function addAudio(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("audio/") && !/\.(m4a|mp3|wav|webm|ogg)$/i.test(file.name)) { notify("m4a、mp3、wav、webm、oggの音声ファイルを選んでください。"); return; }
    try { const stamp = now(); const asset: MediaAsset = { id: uid(), songId: song.id, kind: "audio", origin: "file", name: file.name, note: "", mimeType: file.type || "audio/mpeg", blob: file, size: file.size, links: [], createdAt: stamp, updatedAt: stamp }; await db.media.add(asset); setWorkspace((data) => ({ ...data, media: [asset, ...data.media] })); }
    catch (error) { notify(error instanceof Error ? error.message : "音声を保存できませんでした。"); }
  }
  function patch(asset: MediaAsset, values: Partial<MediaAsset>) { const updated = { ...asset, ...values, updatedAt: now() }; setWorkspace((data) => ({ ...data, media: data.media.map((item) => item.id === asset.id ? updated : item) })); queueSave(db.media, updated); }
  async function remove(asset: MediaAsset) { if (!window.confirm(`「${asset.name}」を削除しますか？`)) return; await db.media.delete(asset.id); setWorkspace((data) => ({ ...data, media: data.media.filter((item) => item.id !== asset.id) })); }
  return <section className="tab-page"><div className="tab-heading"><h1>音声</h1></div><label className="single-file"><input type="file" accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg" onChange={(event) => void addAudio(event.target.files?.[0])} />音声ファイルを追加</label><div className="material-list">{audio.map((asset) => <AssetCard key={asset.id} asset={asset} onPatch={(values) => patch(asset, values)} onDelete={() => void remove(asset)} />)}</div>{audio.length === 0 && <p className="plain-empty compact-empty">音声ファイルはありません。</p>}</section>;
}
