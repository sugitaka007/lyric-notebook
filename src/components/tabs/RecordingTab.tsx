import { useEffect, useRef, useState } from "react";
import { db, now, uid } from "../../db";
import type { MediaAsset } from "../../types";
import type { TabProps } from "../SongEditor";
import { AssetCard } from "./AssetCard";

const isRecordingAsset = (asset: MediaAsset) => asset.kind === "audio" && (asset.origin === "recording" || (!asset.origin && asset.name.startsWith("録音")));

export function RecordingTab({ song, workspace, setWorkspace, queueSave, notify }: TabProps) {
  const [recording, setRecording] = useState(false); const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | undefined>(undefined); const chunks = useRef<Blob[]>([]); const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const recordings = workspace.media.filter(isRecordingAsset);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); recorder.current?.stream.getTracks().forEach((track) => track.stop()); }, []);
  async function start() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { notify("この環境では直接録音できません。音声からファイルを追加してください。"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); const mime = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type)); const next = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunks.current = []; next.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
      next.onstop = async () => { const type = next.mimeType || chunks.current[0]?.type || "audio/webm"; const blob = new Blob(chunks.current, { type }); const stamp = now(); const asset: MediaAsset = { id: uid(), songId: song.id, kind: "audio", origin: "recording", name: `録音 ${new Date().toLocaleString("ja-JP")}`, note: "", mimeType: type, blob, size: blob.size, links: [], createdAt: stamp, updatedAt: stamp }; try { await db.media.add(asset); setWorkspace((data) => ({ ...data, media: [asset, ...data.media] })); } catch (error) { notify(error instanceof Error ? error.message : "録音を保存できませんでした。"); } finally { stream.getTracks().forEach((track) => track.stop()); } };
      recorder.current = next; next.start(1000); setSeconds(0); setRecording(true); timer.current = setInterval(() => setSeconds((value) => value + 1), 1000);
    } catch (error) { notify(error instanceof DOMException && error.name === "NotAllowedError" ? "マイクの使用を許可してください。" : "録音を開始できませんでした。"); }
  }
  function stop() { recorder.current?.stop(); setRecording(false); if (timer.current) clearInterval(timer.current); }
  function patch(asset: MediaAsset, values: Partial<MediaAsset>) { const updated = { ...asset, ...values, updatedAt: now() }; setWorkspace((data) => ({ ...data, media: data.media.map((item) => item.id === asset.id ? updated : item) })); queueSave(db.media, updated); }
  async function remove(asset: MediaAsset) { if (!window.confirm(`「${asset.name}」を削除しますか？`)) return; await db.media.delete(asset.id); setWorkspace((data) => ({ ...data, media: data.media.filter((item) => item.id !== asset.id) })); }
  return <section className="tab-page"><div className="tab-heading"><h1>録音</h1></div><button className={recording ? "record-button recording" : "record-button primary"} onClick={recording ? stop : start}>{recording ? `停止 ${seconds}秒` : "録音を開始"}</button><div className="material-list">{recordings.map((asset) => <AssetCard key={asset.id} asset={asset} onPatch={(values) => patch(asset, values)} onDelete={() => void remove(asset)} />)}</div>{recordings.length === 0 && <p className="plain-empty compact-empty">録音はありません。</p>}</section>;
}
