import { db, markSongUsed, now, uid } from "../../db";
import { compressImage } from "../../media";
import type { MediaAsset } from "../../types";
import type { TabProps } from "../SongEditor";
import { AssetCard } from "./AssetCard";

export function PhotosTab({ song, workspace, setWorkspace, queueSave, notify }: TabProps) {
  const photos = workspace.media.filter((asset) => asset.kind === "image");
  async function addImages(files?: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      try { const blob = await compressImage(file); const stamp = now(); const asset: MediaAsset = { id: uid(), songId: song.id, kind: "image", name: file.name, note: "", mimeType: blob.type, blob, size: blob.size, links: [], createdAt: stamp, updatedAt: stamp }; await db.media.add(asset); await markSongUsed(song.id); setWorkspace((data) => ({ ...data, media: [asset, ...data.media] })); }
      catch (error) { notify(error instanceof Error ? error.message : "写真を保存できませんでした。"); }
    }
  }
  function patch(asset: MediaAsset, values: Partial<MediaAsset>) { const updated = { ...asset, ...values, updatedAt: now() }; setWorkspace((data) => ({ ...data, media: data.media.map((item) => item.id === asset.id ? updated : item) })); queueSave(db.media, updated); }
  async function remove(asset: MediaAsset) { if (!window.confirm(`「${asset.name}」を削除しますか？`)) return; await db.media.delete(asset.id); setWorkspace((data) => ({ ...data, media: data.media.filter((item) => item.id !== asset.id), ideas: data.ideas.map((idea) => ({ ...idea, assetIds: idea.assetIds.filter((id) => id !== asset.id) })) })); }
  return <section className="tab-page"><div className="tab-heading"><h1>写真</h1></div><label className="single-file"><input type="file" accept="image/*" multiple onChange={(event) => { void addImages(event.target.files); event.currentTarget.value = ""; }} />画像を追加</label><div className="material-list">{photos.map((asset) => <AssetCard key={asset.id} asset={asset} onPatch={(values) => patch(asset, values)} onDelete={() => void remove(asset)} />)}</div>{photos.length === 0 && <p className="plain-empty compact-empty">写真はありません。</p>}</section>;
}
