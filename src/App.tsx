import { useCallback, useEffect, useRef, useState } from "react";
import type { Table } from "dexie";
import { compressImage } from "./media";
import { createSong, db, deleteSongCascade, loadWorkspace, moveInboxToSong, now, storageErrorMessage, uid } from "./db";
import type { InboxItem, MediaAsset, Song, SongWorkspace } from "./types";
import { EMPTY_WORKSPACE } from "./types";
import { Home } from "./components/Home";
import { SongEditor, type SongTab } from "./components/SongEditor";
import { DEFAULT_SETTINGS, normalizeSettings, type AppSettings } from "./settings";
import { parseArtMemoImport } from "./artMemoImport";

export type SaveState = "saved" | "saving" | "error";
export type QueueSave = (table: Table, value: { id?: string; key?: string; songId?: string; updatedAt?: string }) => void;

export default function App() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [activeSong, setActiveSong] = useState<Song | null>(null);
  const [initialTab, setInitialTab] = useState<SongTab>("lyrics");
  const [focusSongTitle, setFocusSongTitle] = useState(false);
  const [workspace, setWorkspace] = useState<SongWorkspace>(EMPTY_WORKSPACE);
  const [ready, setReady] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [notice, setNotice] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const [settings, setSettingsState] = useState<AppSettings>(DEFAULT_SETTINGS);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const refreshHome = useCallback(async () => {
    const [allSongs, allInbox] = await Promise.all([db.songs.toArray(), db.inbox.orderBy("createdAt").reverse().toArray()]);
    setSongs(allSongs);
    setInbox(allInbox.filter((item) => !item.deletedAt));
  }, []);

  useEffect(() => {
    let mounted = true;
    const pendingTimers = timers.current;
    Promise.all([refreshHome(), db.meta.get("settings"), db.meta.get("theme")])
      .then(([, stored, legacyTheme]) => {
        if (!mounted) return;
        setSettingsState(normalizeSettings(stored?.value, legacyTheme?.value));
        setReady(true);
      })
      .catch((error) => { setNotice(storageErrorMessage(error)); setReady(true); });
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => { mounted = false; window.removeEventListener("online", goOnline); window.removeEventListener("offline", goOffline); pendingTimers.forEach(clearTimeout); };
  }, [refreshHome]);

  useEffect(() => {
    if (settings.theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.dataset.theme = settings.theme;
    document.documentElement.dataset.fontSize = settings.fontSize;
    document.documentElement.style.setProperty("--accent", settings.accentColor);
    document.documentElement.style.setProperty("--accent-2", settings.accentColor);
    document.documentElement.style.setProperty("--accent-fill", settings.accentColor);
    document.documentElement.style.setProperty("--accent-soft", `color-mix(in srgb, ${settings.accentColor} 18%, transparent)`);
  }, [settings]);

  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 5200); return () => clearTimeout(timer); }, [notice]);

  const queueSave: QueueSave = useCallback((table, value) => {
    const key = `${table.name}:${value.id ?? value.key}`;
    setSaveState("saving");
    const previous = timers.current.get(key);
    if (previous) clearTimeout(previous);
    timers.current.set(key, setTimeout(async () => {
      try {
        const record = "updatedAt" in value ? { ...value, updatedAt: now() } : value;
        await table.put(record as never);
        const songId = value.songId;
        if (songId && table.name !== "songs") {
          const updatedAt = now();
          await db.songs.update(songId, { updatedAt });
          setSongs((items) => items.map((song) => song.id === songId ? { ...song, updatedAt } : song));
          setActiveSong((song) => song?.id === songId ? { ...song, updatedAt } : song);
        }
        setSaveState("saved");
      } catch (error) { setSaveState("error"); setNotice(storageErrorMessage(error)); }
    }, 420));
  }, []);

  async function openSong(song: Song, tab: SongTab = "lyrics", focusTitle = false) {
    try { setInitialTab(tab); setFocusSongTitle(focusTitle); setActiveSong(song); setWorkspace(await loadWorkspace(song.id)); window.scrollTo({ top: 0 }); }
    catch (error) { setNotice(storageErrorMessage(error)); }
  }

  async function addSong() {
    try { const song = await createSong(); await refreshHome(); await openSong(song, "lyrics", true); }
    catch (error) { setNotice(storageErrorMessage(error)); }
  }

  async function removeSong(song: Song) {
    try { await deleteSongCascade(song.id); if (activeSong?.id === song.id) setActiveSong(null); await refreshHome(); setNotice("曲を削除しました。"); }
    catch (error) { setNotice(storageErrorMessage(error)); }
  }

  async function addInbox(text: string, files: File[]) {
    try {
      const stamp = now();
      const assets: MediaAsset[] = [];
      for (const file of files) {
        const isImage = file.type.startsWith("image/");
        const blob = isImage ? await compressImage(file) : file;
        assets.push({ id: uid(), kind: isImage ? "image" : "audio", origin: isImage ? undefined : file.name.startsWith("録音-") ? "recording" : "file", name: file.name, note: "", mimeType: blob.type || file.type, blob, size: blob.size, links: [], createdAt: stamp, updatedAt: stamp });
      }
      const item: InboxItem = { id: uid(), kind: "note", text, assetIds: assets.map((asset) => asset.id), createdAt: stamp, updatedAt: stamp };
      await db.transaction("rw", [db.media, db.inbox], async () => { if (assets.length) await db.media.bulkAdd(assets); await db.inbox.add(item); });
      await refreshHome(); setNotice("未整理メモに保存しました。");
    } catch (error) { setNotice(storageErrorMessage(error)); }
  }

  async function importInboxJson(file: File) {
    const parsed = parseArtMemoImport(await file.text(), now());
    const existingKeys = new Set((await db.inbox.toArray()).map((item) => item.importKey).filter(Boolean));
    const additions = parsed.items.filter((item) => !existingKeys.has(item.importKey));
    if (additions.length) await db.inbox.bulkAdd(additions);
    await refreshHome();
    return { added: additions.length, skipped: parsed.items.length - additions.length, themes: parsed.themeCount };
  }

  async function updateInbox(item: InboxItem) {
    try { await db.inbox.put({ ...item, updatedAt: now() }); await refreshHome(); }
    catch (error) { setNotice(storageErrorMessage(error)); }
  }

  async function deleteInbox(item: InboxItem) {
    try {
      const assetIds = [...(item.assetIds ?? []), ...(item.assetId ? [item.assetId] : [])];
      await db.transaction("rw", [db.inbox, db.media], async () => { await db.inbox.delete(item.id); if (assetIds.length) await db.media.bulkDelete(assetIds); });
      await refreshHome();
    } catch (error) { setNotice(storageErrorMessage(error)); }
  }

  async function moveInbox(item: InboxItem, songId: string) {
    try { await moveInboxToSong(item, songId); await refreshHome(); setNotice("曲のアイデアに移動しました。"); }
    catch (error) { setNotice(storageErrorMessage(error)); }
  }

  async function songFromInbox(item: InboxItem) {
    try { const song = await createSong(); await moveInboxToSong(item, song.id); await refreshHome(); await openSong(song, "ideas", true); }
    catch (error) { setNotice(storageErrorMessage(error)); }
  }

  function patchSong(patch: Partial<Song>) {
    if (!activeSong) return;
    const updated = { ...activeSong, ...patch, updatedAt: now() };
    setActiveSong(updated);
    setSongs((items) => items.map((song) => song.id === updated.id ? updated : song));
    queueSave(db.songs, updated);
  }

  async function updateSettings(patch: Partial<AppSettings>) {
    const next = normalizeSettings({ ...settings, ...patch });
    setSettingsState(next);
    await db.meta.put({ key: "settings", value: next });
  }

  async function resetAllData() {
    await db.transaction("rw", db.tables, async () => { await Promise.all(db.tables.map((table) => table.clear())); await db.meta.put({ key: "settings", value: DEFAULT_SETTINGS }); });
    setSettingsState(DEFAULT_SETTINGS); setActiveSong(null); setWorkspace(EMPTY_WORKSPACE); await refreshHome();
  }

  if (!ready) return <div className="launch-screen"><span aria-hidden="true" /><p>アートメモを起動中…</p></div>;

  return (
    <div className="app" data-online={online}>
      {!online && <div className="offline-banner" role="status">オフライン</div>}
      {activeSong ? (
        <SongEditor song={activeSong} workspace={workspace} setWorkspace={setWorkspace} settings={settings} patchSong={patchSong} queueSave={queueSave} saveState={saveState} initialTab={initialTab} focusTitle={focusSongTitle} onDelete={removeSong} onBack={async () => { setActiveSong(null); await refreshHome(); }} notify={setNotice} />
      ) : (
        <Home songs={songs} inbox={inbox} settings={settings} onSettings={updateSettings} onResetAll={resetAllData} onOpen={openSong} onCreate={addSong} onQuickAdd={addInbox} onImportInbox={importInboxJson} onUpdateInbox={updateInbox} onDeleteInbox={deleteInbox} onMoveInbox={moveInbox} onSongFromInbox={songFromInbox} onRefresh={refreshHome} notify={setNotice} />
      )}
      {notice && <div className="toast" role="status">{notice}</div>}
    </div>
  );
}

