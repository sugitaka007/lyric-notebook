import { useState } from "react";
import type { MediaAsset } from "../../types";
import { BlobAudio, BlobImage } from "../ui";

export function AssetCard({ asset, onPatch, onDelete }: { asset: MediaAsset; onPatch(values: Partial<MediaAsset>): void; onDelete(): void }) {
  const [expanded, setExpanded] = useState(false);
  const duration = asset.durationSeconds == null ? "長さ不明" : `${Math.floor(asset.durationSeconds / 60)}:${String(Math.round(asset.durationSeconds % 60)).padStart(2, "0")}`;
  if (asset.kind === "image") return <article className="material-card compact-material image"><button className="photo-preview" onClick={() => setExpanded(true)} aria-label={`${asset.name}を拡大`}><BlobImage blob={asset.blob} alt={asset.name} /></button><div className="material-info"><textarea rows={2} aria-label="写真の説明" value={asset.note ?? ""} onChange={(event) => onPatch({ note: event.target.value })} placeholder="説明（任意）" /></div><button className="material-delete danger-text" onClick={onDelete}>削除</button>{expanded && <div className="photo-lightbox" onClick={() => setExpanded(false)} role="dialog" aria-modal="true"><button aria-label="閉じる">×</button><BlobImage blob={asset.blob} alt={asset.name} /></div>}</article>;
  return <article className="material-card compact-material audio"><div className="audio-preview"><BlobAudio blob={asset.blob} /></div><div className="material-info"><input aria-label="音声名" value={asset.name} onChange={(event) => onPatch({ name: event.target.value })} /><small>{new Date(asset.createdAt).toLocaleString("ja-JP")}・{duration}</small></div><button className="material-delete danger-text" onClick={onDelete}>削除</button></article>;
}
