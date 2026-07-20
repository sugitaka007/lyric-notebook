import { useMemo, useRef, useState } from "react";
import { createBackupBlob, inspectBackup, restoreBackup } from "../backup";
import { db } from "../db";
import { downloadBlob } from "../media";
import type { InboxItem, Song } from "../types";

type Props = {
  songs: Song[]; inbox: InboxItem[]; onOpen(song: Song): void; onCreate(title: string): void;
  onDelete(song: Song): void; onDuplicate(song: Song): void; onArchive(song: Song): void;
  onQuickAdd(kind: InboxItem["kind"], text: string, file?: File): void; onRefresh(): Promise<void>; notify(message: string): void;
};

const formatDate = (date: string) => new Intl.DateTimeFormat("ja-JP", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(date));

export function Home(props: Props) {
  const [search, setSearch] = useState(""); const [sort, setSort] = useState<"updated" | "created">("updated");
  const [showArchived, setShowArchived] = useState(false); const [newOpen, setNewOpen] = useState(false); const [title, setTitle] = useState("");
  const [quick, setQuick] = useState<InboxItem["kind"] | null>(null); const [quickText, setQuickText] = useState(""); const [quickFile, setQuickFile] = useState<File>();
  const [deleteTarget, setDeleteTarget] = useState<Song>(); const [backupOpen, setBackupOpen] = useState(false); const [restoreFile, setRestoreFile] = useState<File>();
  const [restoreInfo, setRestoreInfo] = useState(""); const [restoreMode, setRestoreMode] = useState<"merge" | "replace">("merge");
  const restoreInput = useRef<HTMLInputElement>(null);
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent); const standalone = window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);

  const visibleSongs = useMemo(() => props.songs.filter((song) => song.archived === showArchived && `${song.title} ${song.workingTitle} ${song.tags.join(" ")}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => sort === "updated" ? b.updatedAt.localeCompare(a.updatedAt) : b.createdAt.localeCompare(a.createdAt)), [props.songs, search, sort, showArchived]);

  async function exportBackup() {
    try { const { blob, manifest } = await createBackupBlob(); downloadBlob(blob, `余白バックアップ-${manifest.createdAt.slice(0, 10)}.zip`); props.notify("バックアップを書き出しました。iPhoneでは共有メニューからファイルに保存できます。"); }
    catch (error) { props.notify(error instanceof Error ? error.message : "バックアップに失敗しました。"); }
  }

  async function chooseRestore(file?: File) {
    if (!file) return; setRestoreFile(file);
    try { const info = await inspectBackup(file); setRestoreInfo(`${new Date(info.createdAt).toLocaleString("ja-JP")}／${info.counts.songs}曲／素材${info.counts.media}件`); }
    catch (error) { setRestoreFile(undefined); setRestoreInfo(""); props.notify(error instanceof Error ? error.message : "バックアップを検証できませんでした。"); }
  }

  async function runRestore() {
    if (!restoreFile) return;
    if (restoreMode === "replace" && !window.confirm("現在の全データを削除し、バックアップの内容に完全に置き換えます。元に戻せません。続けますか？")) return;
    try { await restoreBackup(restoreFile, restoreMode); await props.onRefresh(); setBackupOpen(false); setRestoreFile(undefined); props.notify(restoreMode === "merge" ? "バックアップを追加しました。" : "バックアップから完全に復元しました。"); }
    catch (error) { props.notify(error instanceof Error ? error.message : "復元に失敗しました。"); }
  }

  return (
    <main className="home-shell">
      <header className="home-header"><div className="brand"><span className="brand-seal">余</span><div><p>PRIVATE LYRIC NOTEBOOK</p><h1>余白</h1></div></div><div className="header-buttons"><button className="icon-button" onClick={() => setBackupOpen(true)} aria-label="バックアップ">⇩</button><button className="primary compact" onClick={() => setNewOpen(true)}>＋ 新しい曲</button></div></header>
      {isIos && !standalone && <div className="install-tip"><span>ホーム画面で使う</span><p>Safariの共有 <b>□↑</b> →「ホーム画面に追加」</p><button aria-label="案内を閉じる" onClick={(e) => e.currentTarget.parentElement?.remove()}>×</button></div>}
      <section className="quick-section"><div className="section-heading"><div><p className="eyebrow">QUICK CAPTURE</p><h2>いま浮かんだもの</h2></div><span>受信箱 {props.inbox.length}</span></div><div className="quick-grid">{([ ["lyric", "一行", "ことば"], ["mv", "MV案", "場面"], ["audio", "音声", "録る"], ["image", "画像", "残す"] ] as const).map(([kind, label, sub]) => <button key={kind} onClick={() => setQuick(kind)}><b>{kind === "lyric" ? "〽" : kind === "mv" ? "▣" : kind === "audio" ? "●" : "▧"}</b><span>{label}<small>{sub}</small></span></button>)}</div></section>
      {props.inbox.length > 0 && <details className="inbox-panel"><summary>受信箱の断片 <span>{props.inbox.length}</span></summary><div>{props.inbox.map((item) => <article key={item.id}><i>{item.kind === "lyric" ? "歌詞" : item.kind === "mv" ? "MV" : item.kind === "audio" ? "音声" : "画像"}</i><p>{item.text || "添付素材"}</p><time>{formatDate(item.createdAt)}</time><button aria-label="受信箱から削除" onClick={async () => { if (window.confirm("この断片を削除しますか？")) { await db.inbox.delete(item.id); await props.onRefresh(); } }}>×</button></article>)}</div></details>}
      <section className="library-section"><div className="section-heading library-title"><div><p className="eyebrow">SONG LIBRARY</p><h2>{showArchived ? "アーカイブ" : "曲の棚"}</h2></div><span>{visibleSongs.length} 曲</span></div><div className="library-tools"><label className="search"><span>⌕</span><input aria-label="曲名検索" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="曲名・仮タイトル・タグを検索" /></label><select aria-label="並べ替え" value={sort} onChange={(e) => setSort(e.target.value as "updated" | "created")}><option value="updated">更新日時順</option><option value="created">作成日時順</option></select><button className="text-button" onClick={() => setShowArchived((v) => !v)}>{showArchived ? "曲の棚へ" : "アーカイブ"}</button></div>
        {visibleSongs.length ? <div className="song-grid">{visibleSongs.map((song) => <article className="song-card" key={song.id} style={{ "--song-color": song.color } as React.CSSProperties}><button className="song-open" onClick={() => props.onOpen(song)}><div className="song-card-top"><span className="stage">{song.stage}</span><time>{formatDate(song.updatedAt)}</time></div><h3>{song.title || "無題の曲"}</h3>{song.workingTitle && <p className="working-title">仮題：{song.workingTitle}</p>}<div className="tag-row">{song.tags.slice(0, 3).map((tag) => <span key={tag}>#{tag}</span>)}</div></button><details className="card-menu"><summary aria-label="曲の操作">•••</summary><div><button onClick={() => props.onDuplicate(song)}>複製</button><button onClick={() => props.onArchive(song)}>{song.archived ? "棚に戻す" : "アーカイブ"}</button><button className="danger-text" onClick={() => setDeleteTarget(song)}>削除</button></div></details></article>)}</div> : <div className="empty-card"><div>〽</div><h3>{search ? "見つかりませんでした" : showArchived ? "アーカイブは空です" : "最初の一曲を置きましょう"}</h3><p>{search ? "検索語を変えてみてください。" : "ひらめきは小さいうちに残しておくと、あとから歌になります。"}</p>{!search && !showArchived && <button className="primary" onClick={() => setNewOpen(true)}>新しい曲を作る</button>}</div>}
      </section>
      <footer className="home-footer"><span>● 端末内だけに保存</span><small>外部送信・広告・解析なし</small></footer>

      {newOpen && <div className="modal-backdrop"><form className="modal" onSubmit={(e) => { e.preventDefault(); props.onCreate(title); setTitle(""); setNewOpen(false); }}><p className="eyebrow">NEW SONG</p><h2>新しい曲</h2><label>曲名（あとで変更できます）<input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="無題の曲" /></label><div className="modal-actions"><button type="button" onClick={() => setNewOpen(false)}>やめる</button><button className="primary">作成する</button></div></form></div>}
      {quick && <div className="modal-backdrop"><form className="modal" onSubmit={(e) => { e.preventDefault(); props.onQuickAdd(quick, quickText, quickFile); setQuick(null); setQuickText(""); setQuickFile(undefined); }}><p className="eyebrow">QUICK CAPTURE</p><h2>{quick === "lyric" ? "歌詞を一行" : quick === "mv" ? "MVの場面案" : quick === "audio" ? "音声を追加" : "画像を追加"}</h2>{quick === "lyric" || quick === "mv" ? <textarea autoFocus value={quickText} onChange={(e) => setQuickText(e.target.value)} placeholder="忘れたくない断片を…" /> : <><label className="file-picker"><input type="file" accept={quick === "audio" ? "audio/*" : "image/*"} capture={quick === "image" ? "environment" : undefined} onChange={(e) => setQuickFile(e.target.files?.[0])} />{quickFile?.name || (quick === "audio" ? "音声ファイルを選ぶ" : "写真を選ぶ・撮影する")}</label><input value={quickText} onChange={(e) => setQuickText(e.target.value)} placeholder="短いメモ（任意）" /></>}<div className="modal-actions"><button type="button" onClick={() => setQuick(null)}>やめる</button><button className="primary" disabled={!quickText.trim() && !quickFile}>受信箱へ</button></div></form></div>}
      {deleteTarget && <div className="modal-backdrop"><div className="modal confirm"><div className="warning-mark">!</div><h2>「{deleteTarget.title}」を削除しますか？</h2><p>歌詞、素材、スケッチも端末から削除されます。必要なら先にバックアップしてください。</p><div className="modal-actions"><button onClick={() => setDeleteTarget(undefined)}>やめる</button><button className="danger" onClick={() => { props.onDelete(deleteTarget); setDeleteTarget(undefined); }}>削除する</button></div></div></div>}
      {backupOpen && <div className="modal-backdrop"><div className="modal backup-modal"><p className="eyebrow">BACKUP & RESTORE</p><h2>バックアップ</h2><p>すべての曲・画像・音声・スケッチを、ひとつのZIPにまとめます。</p><button className="primary full" onClick={exportBackup}>バックアップを書き出す</button><hr /><h3>バックアップから復元</h3><button className="file-picker" onClick={() => restoreInput.current?.click()}>{restoreFile?.name || "ZIPファイルを選ぶ"}</button><input ref={restoreInput} hidden type="file" accept=".zip,application/zip" onChange={(e) => chooseRestore(e.target.files?.[0])} />{restoreInfo && <><p className="restore-info">検証済み：{restoreInfo}</p><div className="segmented"><button className={restoreMode === "merge" ? "active" : ""} onClick={() => setRestoreMode("merge")}>既存へ追加</button><button className={restoreMode === "replace" ? "active" : ""} onClick={() => setRestoreMode("replace")}>完全に置換</button></div><button className={restoreMode === "replace" ? "danger full" : "primary full"} onClick={runRestore}>この方法で復元</button></>}<button className="text-button full" onClick={() => setBackupOpen(false)}>閉じる</button></div></div>}
    </main>
  );
}
