import { useEffect, useState } from "react";
import type { MediaAsset } from "../../types";
import { formatBytes } from "../../media";
import { BlobImage } from "../ui";

function BlobAudio({ blob }: { blob?: Blob }) {
  const [url, setUrl] = useState("");
  useEffect(() => { if (!blob) return; const next = URL.createObjectURL(blob); setUrl(next); return () => URL.revokeObjectURL(next); }, [blob]);
  return url ? <audio controls preload="metadata" src={url} /> : <p>音声データがありません。</p>;
}

export function AssetCard({ asset, onPatch, onDelete }: { asset: MediaAsset; onPatch(values: Partial<MediaAsset>): void; onDelete(): void }) {
  return <article className={`material-card compact-material ${asset.kind}`}>{asset.kind === "image" ? <BlobImage blob={asset.blob} alt={asset.name} /> : <div className="audio-preview"><BlobAudio blob={asset.blob} /></div>}<div className="material-info"><input aria-label="素材名" value={asset.name} onChange={(event) => onPatch({ name: event.target.value })} /><textarea rows={2} aria-label="素材メモ" value={asset.note ?? ""} onChange={(event) => onPatch({ note: event.target.value })} placeholder="メモ" /><small>{formatBytes(asset.size)}</small></div><button className="material-delete danger-text" onClick={onDelete}>削除</button></article>;
}
