import { useEffect, useMemo, useRef, useState } from "react";
import { createBackupBlob, inspectBackup, restoreBackup } from "../backup";
import { db, now } from "../db";
import { downloadBlob } from "../media";
import type { InboxItem, Song } from "../types";
import { GPT_REQUEST_OPTIONS, type AppSettings, type GptRequestId } from "../settings";
import { GptCopySheet, type CopyPhrase } from "./GptCopySheet";

type Props = {
  songs: Song[];
  inbox: InboxItem[];
  settings: AppSettings;
  onSettings(patch: Partial<AppSettings>): Promise<void>;
  onResetAll(): Promise<void>;
  onOpen(song: Song): void;
  onCreate(): void;
  onQuickAdd(text: string, files: File[]): Promise<void>;
  onImportInbox(file: File): Promise<{ added: number; skipped: number; themes: number }>;
  onUpdateInbox(item: InboxItem): Promise<void>;
  onDeleteInbox(item: InboxItem): Promise<void>;
  onMoveInbox(item: InboxItem, songId: string): Promise<void>;
  onSongFromInbox(item: InboxItem, title: string): Promise<void>;
  onRefresh(): Promise<void>;
  notify(message: string): void;
};

const formatDate = (date: string) => new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(date));
const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
};

export function Home(props: Props) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [memoSearch, setMemoSearch] = useState("");
  const [importing, setImporting] = useState(false);
  const [openMemoGroups, setOpenMemoGroups] = useState<string[]>([]);
  const [importsOpen, setImportsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [storageInfo, setStorageInfo] = useState<{ usage: number; quota?: number }>();
  const [restoreFile, setRestoreFile] = useState<File>();
  const [restoreInfo, setRestoreInfo] = useState("");
  const [restoreMode, setRestoreMode] = useState<"merge" | "replace">("merge");
  const [lastBackupAt, setLastBackupAt] = useState<string>();
  const [selectedSongs, setSelectedSongs] = useState<Record<string, string>>({});
  const [newSongTitles, setNewSongTitles] = useState<Record<string, string>>({});
  const [copyRequest, setCopyRequest] = useState<{ phrases: CopyPhrase[]; initialIds: string[] }>();
  const imageInput = useRef<HTMLInputElement>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const restoreInput = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | undefined>(undefined);
  const chunks = useRef<Blob[]>([]);
  const recordingTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);

  useEffect(() => {
    void db.meta.get("lastBackupAt").then((item) => setLastBackupAt(typeof item?.value === "string" ? item.value : undefined));
    return () => { if (recordingTimer.current) clearInterval(recordingTimer.current); recorder.current?.stream.getTracks().forEach((track) => track.stop()); };
  }, []);

  useEffect(() => {
    if (!settingsOpen || !navigator.storage?.estimate) return;
    let active = true;
    void navigator.storage.estimate().then(({ usage = 0, quota }) => {
      if (active) setStorageInfo({ usage, quota });
    }).catch(() => { if (active) setStorageInfo(undefined); });
    return () => { active = false; };
  }, [settingsOpen]);

  const visibleSongs = useMemo(() => [...props.songs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [props.songs]);
  const regularMemos = useMemo(() => props.inbox.filter((item) => !item.importKey), [props.inbox]);
  const importedMemos = useMemo(() => props.inbox.filter((item) => item.importKey), [props.inbox]);
  const filteredImports = useMemo(() => {
    const query = memoSearch.trim().toLowerCase();
    if (!query) return importedMemos;
    return importedMemos.filter((item) => [item.text, item.theme, item.sourceType, ...(item.tags ?? [])].filter(Boolean).join(" ").toLowerCase().includes(query));
  }, [importedMemos, memoSearch]);
  const importGroups = useMemo(() => {
    const groups = new Map<string, InboxItem[]>();
    for (const item of filteredImports) {
      const name = item.theme || "テーマなし";
      groups.set(name, [...(groups.get(name) ?? []), item]);
    }
    return [...groups.entries()].map(([name, items]) => ({ name, items: items.sort((a, b) => (a.sourceOrder ?? 0) - (b.sourceOrder ?? 0)), order: Math.min(...items.map((item) => item.themeOrder ?? 999)) })).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, "ja"));
  }, [filteredImports]);

  async function saveMemo() {
    if (!text.trim() && files.length === 0) return;
    setSaving(true);
    try { await props.onQuickAdd(text, files); setText(""); setFiles([]); }
    finally { setSaving(false); }
  }

  async function importJson(file?: File) {
    if (!file) return;
    setImporting(true);
    try {
      const result = await props.onImportInbox(file);
      props.notify(result.added > 0 ? `${result.added}件を${result.themes}テーマに分けて追加しました。${result.skipped ? ` 重複${result.skipped}件は追加していません。` : ""}` : "このファイルのメモはすべて取込済みです。");
    } catch (error) { props.notify(error instanceof Error ? error.message : "JSONを取り込めませんでした。"); }
    finally { setImporting(false); if (importInput.current) importInput.current.value = ""; }
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { props.notify("この環境では直接録音できません。曲の「音声」からファイルを追加してください。"); return; }
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
    if (!window.confirm("この未整理メモを削除しますか？")) return;
    await props.onDeleteInbox(item);
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
    const warning = restoreMode === "replace" ? "現在の全データを削除し、バックアップの内容に置き換えます。" : "現在のデータへバックアップ内容を追加します。同じ曲が重複する場合があります。";
    if (!window.confirm(`${warning}\n復元を続けますか？`)) return;
    try { await restoreBackup(restoreFile, restoreMode); await props.onRefresh(); setSettingsOpen(false); props.notify("復元しました。"); }
    catch (error) { props.notify(error instanceof Error ? error.message : "復元に失敗しました。"); }
  }

  async function resetAll() {
    if (!window.confirm("すべての曲、メモ、画像、音声、スケッチを削除しますか？\nこの操作は取り消せません。")) return;
    if (!window.confirm("最終確認です。本当にすべてのデータを初期化しますか？")) return;
    try { await props.onResetAll(); setSettingsOpen(false); props.notify("すべてのデータを初期化しました。"); }
    catch (error) { props.notify(error instanceof Error ? error.message : "初期化できませんでした。"); }
  }

  function openCopy(id: string, extra?: CopyPhrase) {
    const selected = extra ?? props.inbox.find((item) => item.id === id && item.text.trim());
    if (!selected) return;
    const phrase = { id: selected.id, text: selected.text.trim() };
    setCopyRequest({ phrases: [phrase], initialIds: [phrase.id] });
  }

  function toggleDefaultRequest(id: GptRequestId) {
    const current = props.settings.gptDefaultRequests;
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
    if (next.length) void props.onSettings({ gptDefaultRequests: next });
  }

  function memoCard(item: InboxItem) {
    const selection = selectedSongs[item.id] ?? "";
    const usedSongs = visibleSongs.filter((song) => (item.usedSongIds ?? []).includes(song.id));
    return <details className="memo-card" key={item.id}>
      <summary><span>{item.text.trim() || "添付メモ"}</span><time>{item.sourceType || formatDate(item.updatedAt ?? item.createdAt)}</time></summary>
      <textarea rows={3} aria-label="未整理メモの内容" value={item.text} onChange={(event) => void props.onUpdateInbox({ ...item, text: event.target.value, updatedAt: now() })} />
      {item.tags && item.tags.length > 0 && <div className="memo-tags">{item.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
      {(item.assetIds?.length || item.assetId) && <small>添付あり</small>}
      {usedSongs.length > 0 && <p className="memo-usage">使用中：{usedSongs.map((song) => song.title).join("、")}</p>}
      <div className="memo-actions">
        <select aria-label="使用する曲" value={selection} onChange={(event) => setSelectedSongs((current) => ({ ...current, [item.id]: event.target.value }))}><option value="">曲を選択</option>{visibleSongs.map((song) => <option key={song.id} value={song.id}>{song.title}</option>)}<option value="__new__">＋ 新しい曲を作る</option></select>
        {selection === "__new__" && <input aria-label="新しい曲名" value={newSongTitles[item.id] ?? ""} onChange={(event) => setNewSongTitles((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="曲名" />}
        <button disabled={!selection || (selection === "__new__" && !newSongTitles[item.id]?.trim())} onClick={() => selection === "__new__" ? void props.onSongFromInbox(item, newSongTitles[item.id].trim()) : void props.onMoveInbox(item, selection)}>この曲で使う</button>
        {item.text.trim() && <button onClick={() => openCopy(item.id)}>GPT用にコピー</button>}
        <button className="danger-text" onClick={() => void removeMemo(item)}>削除</button>
      </div>
    </details>;
  }

  return (
    <main className="home-shell">
      <header className="home-header"><h1>アートメモ</h1><button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="全体設定">設定</button></header>
      {isIos && !standalone && <div className="install-tip"><p>共有ボタン →「ホーム画面に追加」でアプリとして使えます。</p><button aria-label="案内を閉じる" onClick={(event) => event.currentTarget.parentElement?.remove()}>×</button></div>}

      <section className="quick-composer">
        <h2>クイック追加</h2>
        <textarea aria-label="クイック追加のメモ" value={text} onChange={(event) => setText(event.target.value)} placeholder="" rows={2} />
        {files.length > 0 && <ul className="attachment-list">{files.map((file, index) => <li key={`${file.name}-${index}`}><span>{file.name}</span><button onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`${file.name}を外す`}>×</button></li>)}</ul>}
        <div className="quick-actions">
          <button className={recording ? "recording" : ""} onClick={recording ? stopRecording : startRecording}>{recording ? `録音停止 ${recordSeconds}秒` : "音声録音"}</button>
          <button onClick={() => imageInput.current?.click()}>画像追加</button>
          <input ref={imageInput} hidden type="file" accept="image/*" multiple onChange={(event) => { if (event.target.files) setFiles((current) => [...current, ...Array.from(event.target.files!)]); event.target.value = ""; }} />
          <button className="primary" disabled={saving || (!text.trim() && files.length === 0)} onClick={saveMemo}>{saving ? "保存中" : "保存"}</button>
        </div>
        {text.trim() && <button className="copy-link" onClick={() => openCopy("quick-draft", { id: "quick-draft", text: text.trim() })}>GPT用にコピー</button>}
      </section>

      <section className="memo-section">
        <div className="section-heading memo-section-heading"><div><h2>未整理メモ</h2><span>{regularMemos.length}</span></div><button className="import-toggle" aria-expanded={importsOpen} onClick={() => setImportsOpen((open) => !open)}>取込メモ <em>{importedMemos.length}</em></button></div>
        {regularMemos.length > 0 && <div className="memo-list">{regularMemos.map(memoCard)}</div>}
        {regularMemos.length === 0 && <p className="plain-empty">未整理メモはありません。</p>}
        {importsOpen && <div className="import-library-body"><div className="memo-heading-actions"><button onClick={() => importInput.current?.click()} disabled={importing}>{importing ? "取込中" : "JSONを取り込む"}</button><input ref={importInput} hidden type="file" accept=".json,application/json" onChange={(event) => void importJson(event.target.files?.[0])} /></div>{importedMemos.length > 0 && <input className="memo-search" aria-label="取込メモを検索" value={memoSearch} onChange={(event) => setMemoSearch(event.target.value)} placeholder="取込メモを検索" />}{importGroups.length > 0 && <div className="memo-groups">{importGroups.map((group) => { const expanded = Boolean(memoSearch.trim()) || openMemoGroups.includes(group.name); return <details className="memo-group" key={group.name} open={expanded} onToggle={(event) => { if (memoSearch.trim()) return; const open = event.currentTarget.open; setOpenMemoGroups((current) => open ? Array.from(new Set([...current, group.name])) : current.filter((name) => name !== group.name)); }}><summary><b>{group.name}</b><span>{group.items.length}</span></summary>{expanded && <div className="memo-list">{group.items.map(memoCard)}</div>}</details>; })}</div>}{importedMemos.length === 0 && <p className="plain-empty">取込メモはありません。</p>}{importedMemos.length > 0 && filteredImports.length === 0 && <p className="plain-empty">一致するメモはありません。</p>}</div>}
      </section>

      <section className="library-section">
        <div className="section-heading"><h2>曲一覧</h2><button className="primary compact" onClick={props.onCreate}>＋ 新しい曲</button></div>
        <div className="song-list">{visibleSongs.map((song) => <button className="song-row" key={song.id} onClick={() => props.onOpen(song)}><span><b>{song.title || "無題の曲"}</b></span><time>{formatDate(song.updatedAt)}</time><i aria-hidden="true">›</i></button>)}</div>
        {visibleSongs.length === 0 && <p className="plain-empty">曲はありません。</p>}
      </section>

      {settingsOpen && <div className="modal-backdrop"><div className="modal settings-modal"><div className="modal-title"><h2>設定</h2><button onClick={() => setSettingsOpen(false)} aria-label="閉じる">×</button></div>
        <details className="settings-group" open><summary>表示</summary><label>テーマ<select value={props.settings.theme} onChange={(event) => void props.onSettings({ theme: event.target.value as AppSettings["theme"] })}><option value="system">端末に合わせる</option><option value="light">明るい</option><option value="dark">暗い</option></select></label><label>文字サイズ<select value={props.settings.fontSize} onChange={(event) => void props.onSettings({ fontSize: event.target.value as AppSettings["fontSize"] })}><option value="small">小</option><option value="standard">標準</option><option value="large">大</option></select></label><label className="setting-color">アクセントカラー<input type="color" value={props.settings.accentColor} onChange={(event) => void props.onSettings({ accentColor: event.target.value })} /></label></details>
        <details className="settings-group"><summary>GPT用コピー</summary><fieldset><legend>初期状態の依頼内容</legend><div className="check-list compact">{GPT_REQUEST_OPTIONS.map((item) => <label key={item.id}><input type="checkbox" checked={props.settings.gptDefaultRequests.includes(item.id)} onChange={() => toggleDefaultRequest(item.id)} /><span>{item.label}</span></label>)}</div></fieldset><label>提示してもらう案の数<select value={props.settings.gptSuggestionCount} onChange={(event) => void props.onSettings({ gptSuggestionCount: Number(event.target.value) as 5 | 10 | 20 })}><option value="5">5案</option><option value="10">10案</option><option value="20">20案</option></select></label><label className="switch-row"><span>コピー前に文章を確認</span><input type="checkbox" checked={props.settings.gptConfirmBeforeCopy} onChange={(event) => void props.onSettings({ gptConfirmBeforeCopy: event.target.checked })} /></label></details>
        <details className="settings-group"><summary>スケッチ</summary><label>初期キャンバス比率<select value={props.settings.sketchDefaultAspect} onChange={(event) => void props.onSettings({ sketchDefaultAspect: event.target.value as AppSettings["sketchDefaultAspect"] })}><option>16:9</option><option>9:16</option><option>1:1</option></select></label><label>構図ガイド<select value={props.settings.sketchGuideDefault ? "show" : "hide"} onChange={(event) => void props.onSettings({ sketchGuideDefault: event.target.value === "show" })}><option value="show">表示</option><option value="hide">非表示</option></select></label><label className="setting-color">ペンの初期色<input type="color" value={props.settings.sketchPenColor} onChange={(event) => void props.onSettings({ sketchPenColor: event.target.value })} /></label><label>ペンの初期太さ<input type="range" min="1" max="28" value={props.settings.sketchPenWidth} onChange={(event) => void props.onSettings({ sketchPenWidth: Number(event.target.value) })} /></label><label>文字の初期サイズ<select value={props.settings.sketchTextSize} onChange={(event) => void props.onSettings({ sketchTextSize: event.target.value as AppSettings["sketchTextSize"] })}><option value="small">小</option><option value="medium">中</option><option value="large">大</option></select></label><label>画像保存時の背景<select value={props.settings.sketchExportBackground} onChange={(event) => void props.onSettings({ sketchExportBackground: event.target.value as AppSettings["sketchExportBackground"] })}><option value="white">白</option><option value="current">現在の背景色</option><option value="transparent">透明</option></select></label></details>
        <details className="settings-group"><summary>データ管理</summary>{storageInfo && <div className="storage-usage"><div><span>アプリの使用容量</span><b>{formatBytes(storageInfo.usage)}</b></div>{storageInfo.quota && <><div><span>利用可能な上限</span><b>{formatBytes(storageInfo.quota)}</b></div><progress aria-label="アプリの使用容量" max={storageInfo.quota} value={storageInfo.usage} /></>}</div>}{lastBackupAt && <p>最終バックアップ：{new Date(lastBackupAt).toLocaleString("ja-JP")}</p>}<button className="primary full" onClick={exportBackup}>バックアップを書き出す</button><button className="file-picker full" onClick={() => restoreInput.current?.click()}>{restoreFile?.name || "バックアップから復元"}</button><input ref={restoreInput} hidden type="file" accept=".zip,application/zip" onChange={(event) => void chooseRestore(event.target.files?.[0])} />{restoreInfo && <><p className="restore-info">検証済み：{restoreInfo}</p><div className="segmented"><button className={restoreMode === "merge" ? "active" : ""} onClick={() => setRestoreMode("merge")}>追加</button><button className={restoreMode === "replace" ? "active" : ""} onClick={() => setRestoreMode("replace")}>置き換え</button></div><button className={restoreMode === "replace" ? "danger full" : "primary full"} onClick={runRestore}>復元する</button></>}<button className="danger full" onClick={() => void resetAll()}>すべてのデータを初期化</button></details>
      </div></div>}
      {copyRequest && <GptCopySheet {...copyRequest} settings={props.settings} onClose={() => setCopyRequest(undefined)} notify={props.notify} />}
    </main>
  );
}
