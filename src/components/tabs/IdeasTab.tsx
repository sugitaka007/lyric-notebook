import { useState } from "react";
import { compressImage } from "../../media";
import { db, now, uid } from "../../db";
import type { Idea, IdeaCategory, MediaAsset } from "../../types";
import type { TabProps } from "../SongEditor";
import { BlobImage } from "../ui";

const categories: IdeaCategory[] = ["言葉・歌詞", "音・メロディ", "映像", "その他"];

export function IdeasTab({ song, workspace, setWorkspace, queueSave, notify }: TabProps) {
  const [draft, setDraft] = useState("");
  const [category, setCategory] = useState<IdeaCategory | "">("");
  const [sourceExcerpt, setSourceExcerpt] = useState("");
  const [urlText, setUrlText] = useState("");
  const ideas = [...workspace.ideas].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
  const lyricExcerpts = Array.from(new Set(workspace.sections.flatMap((section) => (section.body ?? "").split("\n").map((line) => line.trim()).filter(Boolean))));
  const links = workspace.media.filter((asset) => asset.kind === "url");

  async function addIdea() {
    if (!draft.trim()) return;
    const stamp = now();
    const idea: Idea = { id: uid(), songId: song.id, text: draft.trim(), category: category || undefined, sourceExcerpt: sourceExcerpt || undefined, pinned: false, assetIds: [], createdAt: stamp, updatedAt: stamp };
    try {
      await db.ideas.add(idea);
      setWorkspace((data) => ({ ...data, ideas: [idea, ...data.ideas] }));
      setDraft(""); setCategory(""); setSourceExcerpt("");
    } catch (error) { notify(error instanceof Error ? error.message : "アイデアを保存できませんでした。"); }
  }

  function patchIdea(idea: Idea, patch: Partial<Idea>) {
    const updated = { ...idea, ...patch, updatedAt: now() };
    setWorkspace((data) => ({ ...data, ideas: data.ideas.map((item) => item.id === updated.id ? updated : item) }));
    queueSave(db.ideas, updated);
  }

  async function removeIdea(idea: Idea) {
    if (!window.confirm("このアイデアを削除しますか？")) return;
    await db.ideas.delete(idea.id);
    setWorkspace((data) => ({ ...data, ideas: data.ideas.filter((item) => item.id !== idea.id) }));
  }

  async function addImage(idea: Idea, file?: File) {
    if (!file) return;
    try {
      const blob = await compressImage(file); const stamp = now();
      const asset: MediaAsset = { id: uid(), songId: song.id, kind: "image", name: file.name, note: "", mimeType: blob.type, blob, size: blob.size, links: [], createdAt: stamp, updatedAt: stamp };
      const updated = { ...idea, assetIds: [...idea.assetIds, asset.id], updatedAt: stamp };
      await db.transaction("rw", [db.media, db.ideas], async () => { await db.media.add(asset); await db.ideas.put(updated); });
      setWorkspace((data) => ({ ...data, media: [asset, ...data.media], ideas: data.ideas.map((item) => item.id === idea.id ? updated : item) }));
    } catch (error) { notify(error instanceof Error ? error.message : "画像を保存できませんでした。"); }
  }

  async function addUrl() {
    try {
      const parsed = new URL(urlText); const stamp = now();
      const asset: MediaAsset = { id: uid(), songId: song.id, kind: "url", name: parsed.hostname, note: "", mimeType: "text/uri-list", size: urlText.length, url: parsed.toString(), links: [], createdAt: stamp, updatedAt: stamp };
      await db.media.add(asset); setWorkspace((data) => ({ ...data, media: [asset, ...data.media] })); setUrlText("");
    } catch { notify("http:// または https:// から始まるURLを入力してください。"); }
  }

  async function removeLink(asset: MediaAsset) {
    if (!window.confirm("この参考リンクを削除しますか？")) return;
    await db.media.delete(asset.id); setWorkspace((data) => ({ ...data, media: data.media.filter((item) => item.id !== asset.id) }));
  }

  return (
    <section className="tab-page ideas-page"><div className="tab-heading"><h1>アイデア</h1></div>
      <div className="idea-composer"><textarea rows={3} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="" aria-label="新しいアイデア" /><div className="idea-options"><select aria-label="関連する歌詞（任意）" value={sourceExcerpt} onChange={(event) => setSourceExcerpt(event.target.value)}><option value="">歌詞との関連なし</option>{lyricExcerpts.map((line) => <option key={line} value={line}>{line}</option>)}</select><select aria-label="分類（任意）" value={category} onChange={(event) => setCategory(event.target.value as IdeaCategory | "")}><option value="">分類なし</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></div><button className="primary full" disabled={!draft.trim()} onClick={() => void addIdea()}>追加</button></div>
      <div className="idea-list">{ideas.map((idea) => <details className={idea.pinned ? "idea-card pinned" : "idea-card"} key={idea.id}><summary><span>{idea.pinned ? "固定・" : ""}{idea.category ?? "アイデア"}</span><b>{idea.text}</b>{idea.sourceExcerpt && <small>歌詞：{idea.sourceExcerpt}</small>}</summary><textarea rows={3} aria-label="アイデアの内容" value={idea.text} onChange={(event) => patchIdea(idea, { text: event.target.value })} />{idea.sourceExcerpt && <p className="source-excerpt">{idea.sourceExcerpt}</p>}<div className="idea-images">{idea.assetIds.map((id) => { const asset = workspace.media.find((item) => item.id === id); return asset?.blob ? <BlobImage key={id} blob={asset.blob} alt={asset.name} /> : null; })}</div><div className="idea-controls"><select aria-label="分類" value={idea.category ?? ""} onChange={(event) => patchIdea(idea, { category: (event.target.value || undefined) as IdeaCategory | undefined })}><option value="">分類なし</option>{categories.map((item) => <option key={item}>{item}</option>)}</select><button onClick={() => patchIdea(idea, { pinned: !idea.pinned })}>{idea.pinned ? "固定解除" : "固定"}</button><label className="inline-file"><input type="file" accept="image/*" onChange={(event) => void addImage(idea, event.target.files?.[0])} />画像</label><button className="danger-text" onClick={() => void removeIdea(idea)}>削除</button></div></details>)}</div>
      {ideas.length === 0 && <p className="plain-empty compact-empty">アイデアはありません。</p>}
      <details className="reference-panel"><summary>参考リンク {links.length}</summary><div className="url-adder"><input inputMode="url" value={urlText} onChange={(event) => setUrlText(event.target.value)} placeholder="URL" /><button disabled={!urlText} onClick={() => void addUrl()}>追加</button></div>{links.map((asset) => <div className="reference-link" key={asset.id}><a href={asset.url} target="_blank" rel="noreferrer">{asset.name}</a><button className="danger-text" onClick={() => void removeLink(asset)}>削除</button></div>)}</details>
    </section>
  );
}
