import { useState, type Dispatch, type SetStateAction } from "react";
import type { QueueSave, SaveState } from "../App";
import type { Song, SongWorkspace } from "../types";
import { LyricsTab } from "./tabs/LyricsTab";
import { AssociationsTab } from "./tabs/AssociationsTab";
import { MVTab } from "./tabs/MVTab";
import { SketchTab } from "./tabs/SketchTab";
import { MediaTab } from "./tabs/MediaTab";
import { SettingsTab } from "./tabs/SettingsTab";

export type TabProps = {
  song: Song; workspace: SongWorkspace; setWorkspace: Dispatch<SetStateAction<SongWorkspace>>;
  queueSave: QueueSave; notify(message: string): void;
};

const tabs = [
  ["lyrics", "歌詞", "〽"], ["associations", "連想", "◇"], ["mv", "MV", "▣"],
  ["sketch", "スケッチ", "✎"], ["media", "素材", "▧"], ["settings", "設定", "⚙"],
] as const;
type Tab = typeof tabs[number][0];

export function SongEditor(props: TabProps & { patchSong(patch: Partial<Song>): void; saveState: SaveState; onBack(): void }) {
  const [tab, setTab] = useState<Tab>("lyrics");
  const common: TabProps = { song: props.song, workspace: props.workspace, setWorkspace: props.setWorkspace, queueSave: props.queueSave, notify: props.notify };
  return (
    <main className="editor-shell">
      <header className="editor-header"><button className="back-button" onClick={props.onBack} aria-label="曲一覧へ戻る">‹</button><div><p>{props.song.workingTitle ? `仮タイトル：${props.song.workingTitle}` : "曲名"}</p><input aria-label="曲名" value={props.song.title} onChange={(e) => props.patchSong({ title: e.target.value })} /></div><span className={`save-state ${props.saveState}`}>{props.saveState === "saving" ? "保存中…" : props.saveState === "error" ? "保存失敗" : "保存済み"}</span></header>
      <div className="editor-content">
        {tab === "lyrics" && <LyricsTab {...common} />}
        {tab === "associations" && <AssociationsTab {...common} />}
        {tab === "mv" && <MVTab {...common} />}
        {tab === "sketch" && <SketchTab {...common} />}
        {tab === "media" && <MediaTab {...common} />}
        {tab === "settings" && <SettingsTab {...common} patchSong={props.patchSong} />}
      </div>
      <nav className="bottom-tabs" aria-label="曲の編集タブ">{tabs.map(([id, label, icon]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}><b>{icon}</b><span>{label}</span></button>)}</nav>
    </main>
  );
}
