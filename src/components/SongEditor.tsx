import { useState, type Dispatch, type SetStateAction } from "react";
import type { QueueSave, SaveState } from "../App";
import type { Song, SongStage, SongWorkspace } from "../types";
import { LyricsTab } from "./tabs/LyricsTab";
import { IdeasTab } from "./tabs/IdeasTab";
import { MediaTab } from "./tabs/MediaTab";

export type TabProps = {
  song: Song;
  workspace: SongWorkspace;
  setWorkspace: Dispatch<SetStateAction<SongWorkspace>>;
  queueSave: QueueSave;
  notify(message: string): void;
};

const tabs = [["lyrics", "歌詞"], ["ideas", "アイデア"], ["media", "素材"]] as const;
export type SongTab = typeof tabs[number][0];
const stages: SongStage[] = ["種", "制作中", "推敲中", "完成", "保留"];

export function SongEditor(props: TabProps & { patchSong(patch: Partial<Song>): void; saveState: SaveState; initialTab: SongTab; onBack(): void; onDelete(song: Song): void }) {
  const [tab, setTab] = useState<SongTab>(props.initialTab);
  const [infoOpen, setInfoOpen] = useState(false);
  const common: TabProps = { song: props.song, workspace: props.workspace, setWorkspace: props.setWorkspace, queueSave: props.queueSave, notify: props.notify };
  const legacyFields = [
    ["仮タイトル", props.song.workingTitle], ["主人公", props.song.protagonist], ["相手", props.song.counterpart], ["場所", props.song.place], ["時間", props.song.time], ["視点", props.song.perspective], ["基本色", props.song.baseColor], ["繰り返す言葉", props.song.repeatedWords], ["繰り返す物", props.song.repeatedObjects], ["避けたい表現", props.song.avoidExpressions], ["残したい感情", props.song.lastingEmotion],
  ].filter(([, value]) => value);

  function confirmDelete() {
    if (window.confirm(`「${props.song.title || "無題の曲"}」を削除しますか？\n歌詞と素材も削除されます。`)) props.onDelete(props.song);
  }

  return (
    <main className="editor-shell">
      <header className="editor-header keyboard-hide"><button className="back-button" onClick={props.onBack} aria-label="曲一覧へ戻る">‹</button><div className="editor-title"><b>{props.song.title || "無題の曲"}</b><span className={`save-state ${props.saveState}`}>{props.saveState === "saving" ? "保存中" : props.saveState === "error" ? "保存失敗" : "保存済み"}</span></div><button className="menu-button" onClick={() => setInfoOpen(true)} aria-label="曲情報">•••</button></header>
      <div className="editor-content">
        {tab === "lyrics" && <LyricsTab {...common} />}
        {tab === "ideas" && <IdeasTab {...common} />}
        {tab === "media" && <MediaTab {...common} />}
      </div>
      <nav className="bottom-tabs keyboard-hide" aria-label="曲の編集タブ">{tabs.map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}><span>{label}</span></button>)}</nav>

      {infoOpen && <div className="modal-backdrop"><div className="modal song-info"><div className="modal-title"><h2>曲情報</h2><button onClick={() => setInfoOpen(false)} aria-label="閉じる">×</button></div><label>曲名<input value={props.song.title} onChange={(event) => props.patchSong({ title: event.target.value })} /></label><label>曲の概要<textarea value={props.song.summary} onChange={(event) => props.patchSong({ summary: event.target.value })} /></label><label>制作段階<select value={props.song.stage} onChange={(event) => props.patchSong({ stage: event.target.value as SongStage })}>{stages.map((stage) => <option key={stage}>{stage}</option>)}</select></label><label>タグ<input value={props.song.tags.join("、")} onChange={(event) => props.patchSong({ tags: event.target.value.split(/[、,]/).map((tag) => tag.trim()).filter(Boolean) })} placeholder="、で区切る" /></label><label className="switch-row"><span>アーカイブ</span><input type="checkbox" checked={props.song.archived} onChange={(event) => props.patchSong({ archived: event.target.checked })} /></label>{legacyFields.length > 0 && <details className="legacy-info"><summary>以前の曲情報</summary><dl>{legacyFields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></details>}<button className="danger full" onClick={confirmDelete}>曲を削除</button></div></div>}
    </main>
  );
}
