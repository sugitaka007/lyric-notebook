import { useEffect, useMemo, useRef, useState } from "react";
import { createBackupBlob, inspectBackup, restoreBackup } from "../backup";
import type { ThemeMode } from "../App";
import { db, now } from "../db";
import { downloadBlob } from "../media";
import type { InboxItem, Song } from "../types";

type Props = {
  songs: Song[];
  inbox: InboxItem[];
  theme: ThemeMode;
  onTheme(theme: ThemeMode): void;
  onOpen(song: Song): void;
  onCreate(): void;
  onQuickAdd(text: string, files: File[]): Promise<void>;
  onUpdateInbox(item: InboxItem): Promise<void>;
  onDeleteInbox(item: InboxItem): Promise<void>;
  onMoveInbox(item: InboxItem, songId: string): Promise<void>;
  onSongFromInbox(item: InboxItem): Promise<void>;
  onRefresh(): Promise<void>;
  notify(message: string): void;
};

const formatDate = (date: string) => new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(date));

export function Home(props: Props) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"updated" | "created">("updated");
  const [archiveView, setArchiveView] = useState<"active" | "archived" | "all">("active");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File>();
  const [restoreInfo, setRestoreInfo] = useState("");
  const [restoreMode, setRestoreMode] = useState<"merge" | "replace">("merge");
  const [lastBackupAt, setLastBackupAt] = useState<string>();
  const [undo, setUndo] = useState<InboxItem>();
  const [selectedSongs, setSelectedSongs] = useState<Record<string, string>>({});
  const imageInput = useRef<HTMLInputElement>(null);
  const restoreInput = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | undefined>(undefined);
  const chunks = useRef<Blob[]>([]);
  const recordingTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);

  useEffect(() => {
    void db.meta.get("lastBackupAt").then((item) => setLastBackupAt(typeof item?.value === "string" ? item.value : undefined));
    return () => { if (recordingTimer.current) clearInterval(recordingTimer.current); if (deleteTimer.current) clearTimeout(deleteTimer.current); recorder.current?.stream.getTracks().forEach((track) => track.stop()); };
  }, []);

  const visibleSongs = useMemo(() => props.songs
    .filter((song) => archiveView === "all" || song.archived === (archiveView === "archived"))
    .filter((song) => `${song.title} ${song.tags.join(" ")}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => sort === "updated" ? b.updatedAt.localeCompare(a.updatedAt) : b.createdAt.localeCompare(a.createdAt)), [props.songs, search, sort, archiveView]);

  async function saveMemo() {
    if (!text.trim() && files.length === 0) return;
    setSaving(true);
    try { await props.onQuickAdd(text, files); setText(""); setFiles([]); }
    finally { setSaving(false); }
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { props.notify("この環境では直接録音できません。素材画面から音声ファイルを追加してください。"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const supported = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type));
      const next = supported ? new MediaRecorder(stream, { mimeType: supported }) : new MediaRecorder(stream);
      chunks.current = [];
      next.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
      next.onstop = () => {
        const mime = next.mimeType || chunks.current[0]?.type || "audio/webm";
        const extension = mime.includes("mp4") ? "m4a" : "webm";
        const blob = new Blob(chunks.current, { type: mime });
        setFiles((current) => [...current, new File([blob], `録音-${Date.now()}.${extension}`, { type: mime })]);
        stream.getTracks().forEach((track) => track.stop());
      };
      recorder.current = next;
      next.start(1000);
      setRecordSeconds(0); setRecording(true);
      recordingTimer.current = setInterval(() => setRecordSeconds((value) => value + 1), 1000);
    } catch (error) { props.notify(error instanceof DOMException && error.name === "NotAllowedError" ? "マイクの使用を許可してください。" : "録音を開始できませんでした。"); }
  }

  function stopRecording() {
    recorder.current?.stop(); setRecording(false);
    if (recordingTimer.current) clearInterval(recordingTimer.current);
  }

  async function removeMemo(item: InboxItem) {
    if (deleteTimer.current && undo) await props.onDeleteInbox(undo);
    const deleted = { ...item, deletedAt: now(), updatedAt: now() };
    await props.onUpdateInbox(deleted); setUndo(deleted);
    deleteTimer.current = setTimeout(() => { void props.onDeleteInbox(deleted); setUndo(undefined); }, 6000);
  }

  async function undoDelete() {
    if (!undo) return;
    if (deleteTimer.current) clearTimeout(deleteTimer.current);
    const restored = { ...undo, deletedAt: undefined, updatedAt: now() };
    await props.onUpdateInbox(restored); setUndo(undefined);
  }

  async function exportBackup() {
    try {
      const { blob, manifest } = await createBackupBlob();
      downloadBlob(blob, `アートメモバックアップ-${manifest.createdAt.slice(0, 10)}.zip`);
      setLastBackupAt(manifest.createdAt); props.notify("バックアップを書き出しました。");
    } catch (error) { props.notify(error instanceof Error ? error.message : "バックアップに失敗しました。"); }
  }

  async function chooseRestore(file?: File) {
    if (!file) return;
    try { const info = await inspectBackup(file); setRestoreFile(file); setRestoreInfo(`${new Date(info.createdAt).toLocaleString("ja-JP")}／${info.counts.songs}曲／素材${info.counts.media}件`); }
    catch (error) { setRestoreFile(undefined); setRestoreInfo(""); props.notify(error instanceof Error ? error.message : "バックアップを検証できませんでした。"); }
  }

  async function runRestore() {
    if (!restoreFile) return;
    if (restoreMode === "replace" && !window.confirm("現在の全データを削除し、バックアップの内容に置き換えます。続けますか？")) return;
    try { await restoreBackup(restoreFile, restoreMode); await props.onRefresh(); setSettingsOpen(false); props.notify("復元しました。"); }
    catch (error) { props.notify(error instanceof Error ? error.message : "復元に失敗しました。"); }
  }

  return (
    <main className="home-shell">
      <header className="home-header"><h1>アートメモ</h1><button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="全体設定">設定</button></header>
      {isIos && !standalone && <div className="install-tip keyboard-hide"><p>共有ボタン →「ホーム画面に追加」でアプリとして使えます。</p><button aria-label="案内を閉じる" onClick={(event) => event.currentTarget.parentElement?.remove()}>×</button></div>}

      <section className="quick-composer">
        <h2>クイック追加</h2>
        <textarea aria-label="クイック追加のメモ" value={text} onChange={(event) => setText(event.target.value)} placeholder="" rows={7} />
        {files.length > 0 && <ul className="attachment-list">{files.map((file, index) => <li key={`${file.name}-${index}`}><span>{file.name}</span><button onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`${file.name}を外す`}>×</button></li>)}</ul>}
        <div className="quick-actions keyboard-hide">
          <button className={recording ? "recording" : ""} onClick={recording ? stopRecording : startRecording}>{recording ? `録音停止 ${recordSeconds}秒` : "音声録音"}</button>
          <button onClick={() => imageInput.current?.click()}>画像追加</button>
          <input ref={imageInput} hidden type="file" accept="image/*" multiple onChange={(event) => { if (event.target.files) setFiles((current) => [...current, ...Array.from(event.target.files!)]); event.target.value = ""; }} />
          <button className="primary" disabled={saving || (!text.trim() && files.length === 0)} onClick={saveMemo}>{saving ? "保存中" : "保存"}</button>
        </div>
      </section>

      <section className="memo-section">
        <div className="section-heading"><h2>未整理メモ</h2><span>{props.inbox.length}</span></div>
        <div className="memo-list">{props.inbox.map((item) => <article className="memo-card" key={item.id}>
          <textarea aria-label="未整理メモの内容" value={item.text} onChange={(event) => void props.onUpdateInbox({ ...item, text: event.target.value, updatedAt: now() })} />
          {(item.assetIds?.length || item.assetId) && <small>添付あり</small>}
          <time>{formatDate(item.updatedAt ?? item.createdAt)}</time>
          <div className="memo-actions">
            <select aria-label="移動先の曲" value={selectedSongs[item.id] ?? ""} onChange={(event) => setSelectedSongs((current) => ({ ...current, [item.id]: event.target.value }))}><option value="">既存の曲を選択</option>{props.songs.filter((song) => !song.archived).map((song) => <option key={song.id} value={song.id}>{song.title}</option>)}</select>
            <button disabled={!selectedSongs[item.id]} onClick={() => void props.onMoveInbox(item, selectedSongs[item.id])}>曲へ入れる</button>
            <button onClick={() => void props.onSongFromInbox(item)}>新しい曲にする</button>
            <button className="danger-text" onClick={() => void removeMemo(item)}>削除</button>
          </div>
        </article>)}</div>
        {props.inbox.length === 0 && <p className="plain-empty">未整理メモはありません。</p>}
      </section>

      <section className="library-section">
        <div className="section-heading"><h2>曲一覧</h2><button className="primary compact" onClick={props.onCreate}>＋ 新しい曲</button></div>
        <details className="filter-menu"><summary>検索・並べ替え・アーカイブ</summary><div><input aria-label="曲名検索" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="曲名を検索" /><select aria-label="並べ替え" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="updated">更新日時順</option><option value="created">作成日時順</option></select><select aria-label="表示する曲" value={archiveView} onChange={(event) => setArchiveView(event.target.value as typeof archiveView)}><option value="active">通常の曲</option><option value="archived">アーカイブ</option><option value="all">すべて</option></select></div></details>
        <div className="song-list">{visibleSongs.map((song) => <button className="song-row" key={song.id} onClick={() => props.onOpen(song)}><span><b>{song.title || "無題の曲"}</b><small>{song.stage}</small></span><time>{formatDate(song.updatedAt)}</time><i aria-hidden="true">›</i></button>)}</div>
        {visibleSongs.length === 0 && <p className="plain-empty">曲はありません。</p>}
      </section>

      {undo && <div className="undo-bar keyboard-hide">メモを削除しました<button onClick={() => void undoDelete()}>元に戻す</button></div>}

      {settingsOpen && <div className="modal-backdrop"><div className="modal settings-modal"><div className="modal-title"><h2>全体設定</h2><button onClick={() => setSettingsOpen(false)} aria-label="閉じる">×</button></div><h3>表示</h3><div className="segmented"><button className={props.theme === "system" ? "active" : ""} onClick={() => props.onTheme("system")}>端末設定</button><button className={props.theme === "light" ? "active" : ""} onClick={() => props.onTheme("light")}>ライト</button><button className={props.theme === "dark" ? "active" : ""} onClick={() => props.onTheme("dark")}>ダーク</button></div><hr /><h3>バックアップ</h3>{lastBackupAt && <p>最終バックアップ：{new Date(lastBackupAt).toLocaleString("ja-JP")}</p>}<button className="primary full" onClick={exportBackup}>書き出す</button><button className="file-picker full" onClick={() => restoreInput.current?.click()}>{restoreFile?.name || "バックアップを選択"}</button><input ref={restoreInput} hidden type="file" accept=".zip,application/zip" onChange={(event) => void chooseRestore(event.target.files?.[0])} />{restoreInfo && <><p className="restore-info">検証済み：{restoreInfo}</p><div className="segmented"><button className={restoreMode === "merge" ? "active" : ""} onClick={() => setRestoreMode("merge")}>追加</button><button className={restoreMode === "replace" ? "active" : ""} onClick={() => setRestoreMode("replace")}>置き換え</button></div><button className={restoreMode === "replace" ? "danger full" : "primary full"} onClick={runRestore}>復元</button></>}</div></div>}
    </main>
  );
}
