import { useState } from "react";
import { db, moveOrdered, now, uid } from "../../db";
import type { LyricLine, LyricSection, LyricStatus } from "../../types";
import type { TabProps } from "../SongEditor";

const sectionPresets = ["イントロ", "Aメロ", "Bメロ", "サビ", "2番", "ブリッジ", "アウトロ"];
const statuses: LyricStatus[] = ["仮採用", "採用", "要修正", "別案あり", "重要"];

export function LyricsTab({ song, workspace, setWorkspace, queueSave, notify }: TabProps) {
  const [undoLine, setUndoLine] = useState<LyricLine>(); const [details, setDetails] = useState<string>();
  const sortedSections = [...workspace.sections].sort((a, b) => a.order - b.order);

  async function addSection(name: string) {
    const section: LyricSection = { id: uid(), songId: song.id, name, order: workspace.sections.length };
    await db.sections.add(section); setWorkspace((data) => ({ ...data, sections: [...data.sections, section] }));
  }
  async function deleteSection(section: LyricSection) {
    const lines = workspace.lines.filter((line) => line.sectionId === section.id);
    if (!window.confirm(`「${section.name}」と中の${lines.length}行を削除しますか？`)) return;
    await db.transaction("rw", [db.sections, db.lyricLines], async () => { await db.sections.delete(section.id); await db.lyricLines.where("sectionId").equals(section.id).delete(); });
    setWorkspace((data) => ({ ...data, sections: data.sections.filter((x) => x.id !== section.id), lines: data.lines.filter((x) => x.sectionId !== section.id) }));
  }
  function patchSection(section: LyricSection, patch: Partial<LyricSection>) {
    const updated = { ...section, ...patch }; setWorkspace((data) => ({ ...data, sections: data.sections.map((x) => x.id === updated.id ? updated : x) })); queueSave(db.sections, updated);
  }
  async function moveSection(index: number, delta: number) {
    const updated = await moveOrdered(db.sections, sortedSections, index, index + delta); setWorkspace((data) => ({ ...data, sections: updated }));
  }
  async function addLine(sectionId: string, after = -1) {
    const current = workspace.lines.filter((line) => line.sectionId === sectionId).sort((a, b) => a.order - b.order);
    const line: LyricLine = { id: uid(), songId: song.id, sectionId, text: "", status: "仮採用", alternate: "", note: "", order: after < 0 ? current.length : after + 1, createdAt: now(), updatedAt: now() };
    if (after >= 0) await db.lyricLines.bulkPut(current.map((item) => item.order > after ? { ...item, order: item.order + 1 } : item));
    await db.lyricLines.add(line); setWorkspace((data) => ({ ...data, lines: [...data.lines.map((item) => item.sectionId === sectionId && item.order > after && after >= 0 ? { ...item, order: item.order + 1 } : item), line] })); setTimeout(() => document.getElementById(`line-${line.id}`)?.focus(), 0);
  }
  function patchLine(line: LyricLine, patch: Partial<LyricLine>) {
    const updated = { ...line, ...patch, updatedAt: now() }; setWorkspace((data) => ({ ...data, lines: data.lines.map((x) => x.id === updated.id ? updated : x) })); queueSave(db.lyricLines, updated);
  }
  async function deleteLine(line: LyricLine) {
    await db.lyricLines.delete(line.id); setWorkspace((data) => ({ ...data, lines: data.lines.filter((x) => x.id !== line.id) })); setUndoLine(line); notify("歌詞を削除しました。画面下の「元に戻す」で復元できます。");
  }
  async function restoreLine() { if (!undoLine) return; await db.lyricLines.put(undoLine); setWorkspace((data) => ({ ...data, lines: [...data.lines, undoLine] })); setUndoLine(undefined); notify("歌詞を元に戻しました。"); }
  async function duplicateLine(line: LyricLine) { const current = workspace.lines.filter((x) => x.sectionId === line.sectionId).sort((a, b) => a.order - b.order); const shifted = current.map((item) => item.order > line.order ? { ...item, order: item.order + 1 } : item); const copy = { ...line, id: uid(), order: line.order + 1, createdAt: now(), updatedAt: now() }; await db.lyricLines.bulkPut([...shifted, copy]); const ids = new Set(current.map((x) => x.id)); setWorkspace((data) => ({ ...data, lines: [...data.lines.filter((x) => !ids.has(x.id)), ...shifted, copy] })); }
  async function moveLine(sectionId: string, index: number, delta: number) { const current = workspace.lines.filter((x) => x.sectionId === sectionId).sort((a, b) => a.order - b.order); const updated = await moveOrdered(db.lyricLines, current, index, index + delta); const ids = new Set(updated.map((x) => x.id)); setWorkspace((data) => ({ ...data, lines: [...data.lines.filter((x) => !ids.has(x.id)), ...updated] })); }

  return <section className="tab-page lyrics-page"><div className="tab-heading"><div><p className="eyebrow">LYRICS</p><h2>言葉を編む</h2></div><select aria-label="歌詞セクションを追加" value="" onChange={(e) => { if (e.target.value) addSection(e.target.value); }}><option value="">＋ セクション</option>{sectionPresets.map((x) => <option key={x}>{x}</option>)}<option>自由セクション</option></select></div>
    {sortedSections.map((section, sectionIndex) => { const lines = workspace.lines.filter((line) => line.sectionId === section.id).sort((a, b) => a.order - b.order); return <article className="lyric-section" key={section.id}><header><input aria-label="セクション名" value={section.name} onChange={(e) => patchSection(section, { name: e.target.value })} /><div className="order-tools"><button disabled={sectionIndex === 0} onClick={() => moveSection(sectionIndex, -1)} aria-label="セクションを上へ">↑</button><button disabled={sectionIndex === sortedSections.length - 1} onClick={() => moveSection(sectionIndex, 1)} aria-label="セクションを下へ">↓</button><button className="danger-text" onClick={() => deleteSection(section)} aria-label="セクションを削除">×</button></div></header><div className="lyric-lines">
      {lines.map((line, index) => <div className={`lyric-line status-${line.status}`} key={line.id}><div className="line-number">{String(index + 1).padStart(2, "0")}</div><div className="line-body"><textarea id={`line-${line.id}`} rows={1} value={line.text} onChange={(e) => patchLine(line, { text: e.target.value })} placeholder="歌詞を一行…" /><div className="line-meta"><select aria-label="行の状態" value={line.status} onChange={(e) => patchLine(line, { status: e.target.value as LyricStatus })}>{statuses.map((x) => <option key={x}>{x}</option>)}</select><button onClick={() => setDetails(details === line.id ? undefined : line.id)}>{details === line.id ? "閉じる" : "別案・メモ"}</button><button onClick={() => duplicateLine(line)}>複製</button><button disabled={index === 0} onClick={() => moveLine(section.id, index, -1)} aria-label="歌詞行を上へ">↑</button><button disabled={index === lines.length - 1} onClick={() => moveLine(section.id, index, 1)} aria-label="歌詞行を下へ">↓</button><button className="danger-text" onClick={() => deleteLine(line)}>削除</button></div>{details === line.id && <div className="line-details"><label>別案<textarea value={line.alternate} onChange={(e) => patchLine(line, { alternate: e.target.value })} placeholder="言い換えや別の一行" /></label><label>補足メモ<textarea value={line.note} onChange={(e) => patchLine(line, { note: e.target.value })} placeholder="意図、韻、歌い方など" /></label><small>行ID: {line.id}</small></div>}</div></div>)}
      <button className="add-line" onClick={() => addLine(section.id)}>＋ 一行を追加</button></div></article>; })}
    {sortedSections.length === 0 && <div className="empty-card"><h3>歌詞セクションがありません</h3><button className="primary" onClick={() => addSection("Aメロ")}>Aメロを追加</button></div>}
    {undoLine && <div className="undo-bar">一行を削除しました<button onClick={restoreLine}>元に戻す</button><button aria-label="閉じる" onClick={() => setUndoLine(undefined)}>×</button></div>}
  </section>;
}
