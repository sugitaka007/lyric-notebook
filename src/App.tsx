import { useCallback, useEffect, useRef, useState } from "react";
import type { Table } from "dexie";
import { createSong, db, deleteSongCascade, duplicateSong, loadWorkspace, now, storageErrorMessage, uid } from "./db";
import type { InboxItem, MediaAsset, Song, SongWorkspace } from "./types";
import { EMPTY_WORKSPACE } from "./types";
import { Home } from "./components/Home";
import { SongEditor } from "./components/SongEditor";

export type SaveState = "saved" | "saving" | "error";
export type QueueSave = (table: Table, value: { id?: string; key?: string; songId?: string; updatedAt?: string }) => void;

export default function App() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [activeSong, setActiveSong] = useState<Song | null>(null);
  const [workspace, setWorkspace] = useState<SongWorkspace>(EMPTY_WORKSPACE);
  const [ready, setReady] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [notice, setNotice] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const refreshHome = useCallback(async () => {
    const [allSongs, allInbox] = await Promise.all([db.songs.toArray(), db.inbox.orderBy("createdAt").reverse().toArray()]);
    setSongs(allSongs); setInbox(allInbox);
  }, []);

  useEffect(() => {
    let mounted = true;
    const pendingTimers = timers.current;
    Promise.all([refreshHome(), db.meta.get("onboardingDone")])
      .then(([, done]) => { if (mounted) { setOnboarding(!done); setReady(true); } })
      .catch((error) => { setNotice(storageErrorMessage(error)); setReady(true); });
    const goOnline = () => setOnline(true); const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline); window.addEventListener("offline", goOffline);
    return () => { mounted = false; window.removeEventListener("online", goOnline); window.removeEventListener("offline", goOffline); pendingTimers.forEach(clearTimeout); };
  }, [refreshHome]);

  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 5200); return () => clearTimeout(timer); }, [notice]);

  const queueSave: QueueSave = useCallback((table, value) => {
    const key = `${table.name}:${value.id ?? value.key}`; setSaveState("saving");
    const previous = timers.current.get(key); if (previous) clearTimeout(previous);
    timers.current.set(key, setTimeout(async () => {
      try {
        const record = "updatedAt" in value ? { ...value, updatedAt: now() } : value;
        await table.put(record as never);
        if (value.songId && table.name !== "songs") {
          const updatedAt = now(); await db.songs.update(value.songId, { updatedAt });
          setSongs((items) => items.map((song) => song.id === value.songId ? { ...song, updatedAt } : song));
          setActiveSong((song) => song && song.id === value.songId ? { ...song, updatedAt } : song);
        }
        setSaveState("saved");
      } catch (error) { setSaveState("error"); setNotice(storageErrorMessage(error)); }
    }, 450));
  }, []);

  async function finishOnboarding(withSample: boolean) {
    try {
      if (withSample) await createSong(undefined, true);
      await db.meta.put({ key: "onboardingDone", value: true }); setOnboarding(false); await refreshHome();
    } catch (error) { setNotice(storageErrorMessage(error)); }
  }

  async function openSong(song: Song) {
    try { setActiveSong(song); setWorkspace(await loadWorkspace(song.id)); window.scrollTo({ top: 0 }); }
    catch (error) { setNotice(storageErrorMessage(error)); }
  }

  async function addSong(title: string) {
    try { const song = await createSong(title.trim() || undefined); await refreshHome(); await openSong(song); }
    catch (error) { setNotice(storageErrorMessage(error)); }
  }

  async function removeSong(song: Song) {
    try { await deleteSongCascade(song.id); if (activeSong?.id === song.id) setActiveSong(null); await refreshHome(); setNotice("曲を削除しました。"); }
    catch (error) { setNotice(storageErrorMessage(error)); }
  }

  async function copySong(song: Song) {
    try { const copy = await duplicateSong(song.id); await refreshHome(); setNotice("曲を複製しました。"); await openSong(copy); }
    catch (error) { setNotice(storageErrorMessage(error)); }
  }

  async function toggleArchive(song: Song) {
    const updated = { ...song, archived: !song.archived, updatedAt: now() };
    try { await db.songs.put(updated); await refreshHome(); }
    catch (error) { setNotice(storageErrorMessage(error)); }
  }

  async function addInbox(kind: InboxItem["kind"], text: string, file?: File) {
    try {
      let assetId: string | undefined;
      if (file) {
        assetId = uid(); const asset: MediaAsset = { id: assetId, kind: kind === "audio" ? "audio" : "image", name: file.name, mimeType: file.type, blob: file, size: file.size, links: [], createdAt: now(), updatedAt: now() };
        await db.media.add(asset);
      }
      await db.inbox.add({ id: uid(), kind, text, assetId, createdAt: now() }); await refreshHome(); setNotice("受信箱へ記録しました。");
    } catch (error) { setNotice(storageErrorMessage(error)); }
  }

  function patchSong(patch: Partial<Song>) {
    if (!activeSong) return; const updated = { ...activeSong, ...patch, updatedAt: now() };
    setActiveSong(updated); setSongs((items) => items.map((song) => song.id === updated.id ? updated : song)); queueSave(db.songs, updated);
  }

  if (!ready) return <div className="launch-screen"><span>余</span><p>創作ノートを開いています…</p></div>;

  return (
    <div className="app" data-online={online}>
      {!online && <div className="offline-banner" role="status">オフライン — 端末内へ保存しています</div>}
      {activeSong ? (
        <SongEditor song={activeSong} workspace={workspace} setWorkspace={setWorkspace} patchSong={patchSong} queueSave={queueSave} saveState={saveState} onBack={async () => { setActiveSong(null); await refreshHome(); }} notify={setNotice} />
      ) : (
        <Home songs={songs} inbox={inbox} onOpen={openSong} onCreate={addSong} onDelete={removeSong} onDuplicate={copySong} onArchive={toggleArchive} onQuickAdd={addInbox} onRefresh={refreshHome} notify={setNotice} />
      )}
      {onboarding && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
          <div className="modal welcome-modal"><div className="brand-seal">余</div><p className="eyebrow">PRIVATE LYRIC NOTEBOOK</p><h1 id="welcome-title">あなたの言葉に、<br />静かな余白を。</h1><p>すべてのデータはこの端末の中だけに保存されます。最初のノートをどう始めますか？</p><div className="modal-actions stack"><button className="primary" onClick={() => finishOnboarding(false)}>空のノートで始める</button><button onClick={() => finishOnboarding(true)}>サンプルを見て始める</button></div></div>
        </div>
      )}
      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  );
}
