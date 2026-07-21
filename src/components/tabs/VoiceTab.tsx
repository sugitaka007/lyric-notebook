import { useEffect, useRef, useState } from "react";
import { db, markSongUsed, now, uid } from "../../db";
import { getAudioDuration } from "../../media";
import type { MediaAsset } from "../../types";
import type { TabProps } from "../SongEditor";
import { AssetCard } from "./AssetCard";

const isRecording = (asset: MediaAsset) => asset.kind === "audio" && (asset.origin === "recording" || (!asset.origin && asset.name.startsWith("録音")));

export function VoiceTab({ song, workspace, setWorkspace, queueSave, notify }: TabProps) {
  const [mode, setMode] = useState<"recording" | "file">("recording");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | undefined>(undefined);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const elapsed = useRef(0);
  const items = workspace.media.filter((asset) => asset.kind === "audio" && (mode === "recording" ? isRecording(asset) : !isRecording(asset))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
    recorder.current?.stream.getTracks().forEach((track) => track.stop());
  }, []);

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { notify("この環境では直接録音できません。ファイルから追加してください。"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type));
      const next = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunks.current = [];
      next.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
      next.onstop = async () => {
        const type = next.mimeType || chunks.current[0]?.type || "audio/webm";
        const blob = new Blob(chunks.current, { type }); const stamp = now();
        const asset: MediaAsset = { id: uid(), songId: song.id, kind: "audio", origin: "recording", name: `録音 ${new Date(stamp).toLocaleString("ja-JP")}`, note: "", mimeType: type, blob, size: blob.size, durationSeconds: elapsed.current, links: [], createdAt: stamp, updatedAt: stamp };
        try { await db.media.add(asset); await markSongUsed(song.id); setWorkspace((data) => ({ ...data, media: [asset, ...data.media] })); }
        catch (error) { notify(error instanceof Error ? error.message : "録音を保存できませんでした。"); }
        finally { stream.getTracks().forEach((track) => track.stop()); }
      };
      recorder.current = next; next.start(1000); elapsed.current = 0; setSeconds(0); setRecording(true);
      timer.current = setInterval(() => { elapsed.current += 1; setSeconds(elapsed.current); }, 1000);
    } catch (error) { notify(error instanceof DOMException && error.name === "NotAllowedError" ? "マイクの使用を許可してください。" : "録音を開始できませんでした。"); }
  }

  function stop() { recorder.current?.stop(); setRecording(false); if (timer.current) clearInterval(timer.current); }

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
    {mode === "recording" ? <button className={recording ? "record-button recording" : "record-button primary"} onClick={recording ? stop : start}>{recording ? `停止 ${seconds}秒` : "録音を開始"}</button> : <label className="single-file"><input type="file" accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg" onChange={(event) => { void addFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />音声ファイルを追加</label>}
    <div className="material-list">{items.map((asset) => <AssetCard key={asset.id} asset={asset} onPatch={(values) => patch(asset, values)} onDelete={() => void remove(asset)} />)}</div>
    {items.length === 0 && <p className="plain-empty compact-empty">{mode === "recording" ? "録音はありません。" : "音声ファイルはありません。"}</p>}
  </section>;
}
