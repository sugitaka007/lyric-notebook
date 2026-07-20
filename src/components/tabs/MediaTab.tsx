import { useEffect, useRef, useState } from "react";
import { db, now, uid } from "../../db";
import { compressImage, formatBytes } from "../../media";
import type { MediaAsset } from "../../types";
import type { TabProps } from "../SongEditor";
import { BlobImage } from "../ui";
import { SketchPanel } from "./SketchTab";

function BlobAudio({ blob }: { blob?: Blob }) {
  const [url, setUrl] = useState("");
  useEffect(() => { if (!blob) return; const next = URL.createObjectURL(blob); setUrl(next); return () => URL.revokeObjectURL(next); }, [blob]);
  return url ? <audio controls preload="metadata" src={url} /> : <p>音声データがありません。</p>;
}

export function MediaTab(props: TabProps) {
  const { song, workspace, setWorkspace, queueSave, notify } = props;
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [urlText, setUrlText] = useState("");
  const recorder = useRef<MediaRecorder | undefined>(undefined);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); recorder.current?.stream.getTracks().forEach((track) => track.stop()); }, []);

  async function saveAsset(asset: MediaAsset) { await db.media.add(asset); setWorkspace((data) => ({ ...data, media: [asset, ...data.media] })); }

  async function addImages(files?: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      try { const blob = await compressImage(file); const stamp = now(); await saveAsset({ id: uid(), songId: song.id, kind: "image", name: file.name, note: "", mimeType: blob.type, blob, size: blob.size, links: [], createdAt: stamp, updatedAt: stamp }); }
      catch (error) { notify(error instanceof Error ? error.message : "画像を保存できませんでした。"); }
    }
  }

  async function addAudio(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("audio/") && !/\.(m4a|mp3|wav|webm|ogg)$/i.test(file.name)) { notify("m4a、mp3、wav、webm、oggの音声ファイルを選んでください。"); return; }
    try { const stamp = now(); await saveAsset({ id: uid(), songId: song.id, kind: "audio", name: file.name, note: "", mimeType: file.type || "audio/mpeg", blob: file, size: file.size, links: [], createdAt: stamp, updatedAt: stamp }); }
    catch (error) { notify(error instanceof Error ? error.message : "音声を保存できませんでした。"); }
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { notify("この環境では直接録音できません。ボイスメモで録音し、音声ファイルとして追加してください。"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type));
      const next = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunks.current = [];
      next.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
      next.onstop = async () => {
        const type = next.mimeType || chunks.current[0]?.type || "audio/webm"; const blob = new Blob(chunks.current, { type }); const stamp = now();
        try { await saveAsset({ id: uid(), songId: song.id, kind: "audio", name: `録音 ${new Date().toLocaleString("ja-JP")}`, note: "", mimeType: type, blob, size: blob.size, links: [], createdAt: stamp, updatedAt: stamp }); }
        catch (error) { notify(error instanceof Error ? error.message : "録音を保存できませんでした。"); }
        finally { stream.getTracks().forEach((track) => track.stop()); }
      };
      recorder.current = next; next.start(1000); setRecordSeconds(0); setRecording(true); timer.current = setInterval(() => setRecordSeconds((seconds) => seconds + 1), 1000);
    } catch (error) { notify(error instanceof DOMException && error.name === "NotAllowedError" ? "マイクの使用を許可してください。" : "録音を開始できませんでした。"); }
  }

  function stopRecording() { recorder.current?.stop(); setRecording(false); if (timer.current) clearInterval(timer.current); }

  async function addUrl() {
    try { const parsed = new URL(urlText); const stamp = now(); await saveAsset({ id: uid(), songId: song.id, kind: "url", name: parsed.hostname, note: "", mimeType: "text/uri-list", size: urlText.length, url: parsed.toString(), links: [], createdAt: stamp, updatedAt: stamp }); setUrlText(""); }
    catch { notify("http:// または https:// から始まるURLを入力してください。"); }
  }

  function patch(asset: MediaAsset, values: Partial<MediaAsset>) {
    const updated = { ...asset, ...values, updatedAt: now() };
    setWorkspace((data) => ({ ...data, media: data.media.map((item) => item.id === asset.id ? updated : item) }));
    queueSave(db.media, updated);
  }

  async function remove(asset: MediaAsset) {
    if (!window.confirm(`「${asset.name}」を削除しますか？`)) return;
    await db.media.delete(asset.id);
    setWorkspace((data) => ({ ...data, media: data.media.filter((item) => item.id !== asset.id), ideas: data.ideas.map((idea) => ({ ...idea, assetIds: idea.assetIds.filter((id) => id !== asset.id) })) }));
  }

  return (
    <section className="tab-page materials-page"><div className="tab-heading"><h1>素材</h1></div><div className="material-actions"><label><input type="file" accept="image/*" multiple onChange={(event) => void addImages(event.target.files)} /><span>写真</span></label><label><input type="file" accept="image/*" capture="environment" onChange={(event) => void addImages(event.target.files)} /><span>カメラ</span></label><button className={recording ? "recording" : ""} onClick={recording ? stopRecording : startRecording}><span>{recording ? `停止 ${recordSeconds}秒` : "録音"}</span></button><label><input type="file" accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg" onChange={(event) => void addAudio(event.target.files?.[0])} /><span>音声ファイル</span></label></div><div className="url-adder"><input inputMode="url" value={urlText} onChange={(event) => setUrlText(event.target.value)} placeholder="参考URL" /><button onClick={() => void addUrl()} disabled={!urlText}>追加</button></div>
      <div className="material-list">{workspace.media.map((asset) => <article key={asset.id} className={`material-card ${asset.kind}`}>{asset.kind === "image" ? <BlobImage blob={asset.blob} alt={asset.name} /> : asset.kind === "audio" ? <div className="audio-preview"><BlobAudio blob={asset.blob} /></div> : <div className="url-preview">URL</div>}<div className="material-info"><input aria-label="素材名" value={asset.name} onChange={(event) => patch(asset, { name: event.target.value })} /><textarea aria-label="素材メモ" value={asset.note ?? ""} onChange={(event) => patch(asset, { note: event.target.value })} placeholder="メモ" />{asset.kind === "url" ? <a href={asset.url} target="_blank" rel="noreferrer">URLを開く</a> : <small>{formatBytes(asset.size)}</small>}</div><button className="material-delete danger-text" onClick={() => void remove(asset)}>削除</button></article>)}</div>
      {workspace.media.length === 0 && <p className="plain-empty">写真・音声・URLはありません。</p>}
      <SketchPanel {...props} />
    </section>
  );
}
