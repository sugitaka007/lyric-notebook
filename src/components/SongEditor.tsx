import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { QueueSave, SaveState } from "../App";
import { db, now, uid } from "../db";
import type { LyricLine, LyricSection, LyricVersion, Song, SongStage, SongWorkspace } from "../types";
import { LyricsTab } from "./tabs/LyricsTab";
import { IdeasTab } from "./tabs/IdeasTab";
import { PhotosTab } from "./tabs/PhotosTab";
import { VoiceTab } from "./tabs/VoiceTab";
import { SketchTab } from "./tabs/SketchTab";
import type { AppSettings } from "../settings";

export type TabProps = {
  song: Song;
  workspace: SongWorkspace;
  setWorkspace: Dispatch<SetStateAction<SongWorkspace>>;
  queueSave: QueueSave;
  settings: AppSettings;
  notify(message: string): void;
};

const tabs = [["lyrics", "歌詞"], ["ideas", "アイデア"], ["photos", "写真"], ["audio", "音声"], ["sketches", "スケッチ"]] as const;
export type SongTab = typeof tabs[number][0];
const stages: SongStage[] = ["構想中", "歌詞制作中", "仮歌確認中", "調整中", "完成", "保留"];

function snapshotLyrics(workspace: SongWorkspace, songId: string, name: string): LyricVersion {
  const sections = [...workspace.sections].sort((a, b) => a.order - b.order).map((section) => ({
    name: section.name, order: section.order,
    lines: workspace.lines.filter((line) => line.sectionId === section.id).sort((a, b) => a.order - b.order).map((line) => ({ text: line.text, alternate: line.alternate, rhymes: line.rhymes ?? "", status: line.status, ideaIds: [...(line.ideaIds ?? [])], note: line.note, order: line.order })),
  }));
  return { id: uid(), songId, name: name.trim(), sections, createdAt: now() };
}

export function SongEditor(props: TabProps & { patchSong(patch: Partial<Song>): void; saveState: SaveState; initialTab: SongTab; focusTitle: boolean; onTabChange(tab: SongTab): void; onRetry(): void; onBack(): void; onDelete(song: Song): void }) {
  const [tab, setTab] = useState<SongTab>(props.initialTab);
  const [infoOpen, setInfoOpen] = useState(false);
  const [versionName, setVersionName] = useState("");
  const titleInput = useRef<HTMLInputElement>(null);
  const common: TabProps = { song: props.song, workspace: props.workspace, setWorkspace: props.setWorkspace, queueSave: props.queueSave, settings: props.settings, notify: props.notify };

  useEffect(() => { if (props.focusTitle) { titleInput.current?.focus(); titleInput.current?.select(); } }, [props.focusTitle]);
  useEffect(() => { setTab(props.initialTab); }, [props.initialTab, props.song.id]);

  function changeTab(next: SongTab) { setTab(next); props.onTabChange(next); }
  function confirmDelete() { if (window.confirm(`「${props.song.title || "無題の曲"}」を削除しますか？\n歌詞と素材も削除されます。`)) props.onDelete(props.song); }

  async function saveVersion(name = versionName) {
    const version = snapshotLyrics(props.workspace, props.song.id, name || new Date().toLocaleString("ja-JP"));
    await db.lyricVersions.add(version);
    props.setWorkspace((data) => ({ ...data, lyricVersions: [version, ...data.lyricVersions] }));
    setVersionName(""); props.notify("現在の歌詞をバージョン保存しました。");
    return version;
  }

  async function restoreVersion(version: LyricVersion) {
    if (!window.confirm(`「${version.name || new Date(version.createdAt).toLocaleString("ja-JP")}」を復元しますか？\n現在の歌詞は先にバージョン保存されます。`)) return;
    const safety = snapshotLyrics(props.workspace, props.song.id, `復元前 ${new Date().toLocaleString("ja-JP")}`);
    const sections: LyricSection[] = []; const lines: LyricLine[] = []; const stamp = now();
    for (const sourceSection of [...version.sections].sort((a, b) => a.order - b.order)) {
      const sectionId = uid();
      const nextLines = [...sourceSection.lines].sort((a, b) => a.order - b.order).map((line, order): LyricLine => ({ id: uid(), songId: props.song.id, sectionId, text: line.text, alternate: line.alternate, rhymes: line.rhymes, status: line.status, ideaIds: [...line.ideaIds], note: line.note, order, createdAt: stamp, updatedAt: stamp }));
      sections.push({ id: sectionId, songId: props.song.id, name: sourceSection.name, order: sections.length, body: nextLines.map((line) => line.text).join("\n") }); lines.push(...nextLines);
    }
    if (!sections.length) {
      const sectionId = uid(); sections.push({ id: sectionId, songId: props.song.id, name: "セクション 1", order: 0, body: "" }); lines.push({ id: uid(), songId: props.song.id, sectionId, text: "", alternate: "", rhymes: "", status: "仮採用", ideaIds: [], note: "", order: 0, createdAt: stamp, updatedAt: stamp });
    }
    await db.transaction("rw", [db.sections, db.lyricLines, db.lyricVersions, db.songs], async () => {
      await db.lyricVersions.add(safety); await db.sections.where("songId").equals(props.song.id).delete(); await db.lyricLines.where("songId").equals(props.song.id).delete(); await db.sections.bulkAdd(sections); await db.lyricLines.bulkAdd(lines); await db.songs.update(props.song.id, { updatedAt: stamp, draft: false });
    });
    props.setWorkspace((data) => ({ ...data, sections, lines, lyricVersions: [safety, ...data.lyricVersions] })); props.notify("歌詞を復元しました。");
  }

  return <main className="editor-shell">
    <header className="editor-header"><button className="back-button" onClick={props.onBack} aria-label="曲一覧へ戻る">‹</button><div className="editor-title"><input ref={titleInput} aria-label="曲名" value={props.song.title} onChange={(event) => props.patchSong({ title: event.target.value })} placeholder="曲名" /><span className={`save-state ${props.saveState}`}>{props.saveState === "saving" ? "保存中" : props.saveState === "error" ? <button onClick={props.onRetry}>保存できませんでした・再試行</button> : "保存済み"}</span></div><button className="menu-button" onClick={() => setInfoOpen(true)} aria-label="曲情報">•••</button></header>
    <div className="editor-content">
      {tab === "lyrics" && <LyricsTab {...common} />}{tab === "ideas" && <IdeasTab {...common} />}{tab === "photos" && <PhotosTab {...common} />}{tab === "audio" && <VoiceTab {...common} />}{tab === "sketches" && <SketchTab {...common} />}
    </div>
    <nav className="bottom-tabs" aria-label="曲の編集タブ">{tabs.map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => changeTab(id)}><span>{label}</span></button>)}</nav>

    {infoOpen && <div className="modal-backdrop"><div className="modal song-info"><div className="modal-title"><h2>曲情報</h2><button onClick={() => setInfoOpen(false)} aria-label="閉じる">×</button></div>
      <label>曲名<input value={props.song.title} onChange={(event) => props.patchSong({ title: event.target.value })} /></label><label>曲の概要<textarea value={props.song.summary} onChange={(event) => props.patchSong({ summary: event.target.value })} /></label><label>制作段階<select value={props.song.stage} onChange={(event) => props.patchSong({ stage: event.target.value as SongStage })}>{stages.map((stage) => <option key={stage}>{stage}</option>)}</select></label>
      <section className="version-panel"><h3>歌詞のバージョン</h3><div className="version-save"><input value={versionName} onChange={(event) => setVersionName(event.target.value)} placeholder="名前（任意）" /><button onClick={() => void saveVersion()}>現在の歌詞を保存</button></div>{props.workspace.lyricVersions.length === 0 ? <p>保存したバージョンはありません。</p> : props.workspace.lyricVersions.map((version) => <details key={version.id} className="version-item"><summary><span>{version.name || "名称なし"}</span><time>{new Date(version.createdAt).toLocaleString("ja-JP")}</time></summary>{version.sections.map((section, index) => <div className="version-section" key={`${version.id}-${index}`}><b>{section.name}</b><p>{section.lines.map((line) => line.text).join("\n") || "（空）"}</p></div>)}<button onClick={() => void restoreVersion(version)}>このバージョンを復元</button></details>)}</section>
      <button className="danger full" onClick={confirmDelete}>曲を削除</button></div></div>}
  </main>;
}
