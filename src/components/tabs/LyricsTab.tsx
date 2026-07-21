import { useEffect, useState } from "react";
import { db, moveOrdered, now, uid } from "../../db";
import type { LyricLine, LyricSection } from "../../types";
import type { TabProps } from "../SongEditor";

const sectionPresets = ["イントロ", "Aメロ", "Bメロ", "サビ", "2番", "ブリッジ", "アウトロ", "自由セクション"];
const listEntries = (value = "") => value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);

const newLine = (songId: string, sectionId: string, order: number): LyricLine => {
  const stamp = now();
  return { id: uid(), songId, sectionId, text: "", status: "仮採用", alternate: "", rhymes: "", ideaIds: [], note: "", order, createdAt: stamp, updatedAt: stamp };
};

export function LyricsTab({ song, workspace, setWorkspace, queueSave }: TabProps) {
  const [focusLineId, setFocusLineId] = useState<string>();
  const [candidateDrafts, setCandidateDrafts] = useState<Record<string, string>>({});
  const [rhymeDrafts, setRhymeDrafts] = useState<Record<string, string>>({});
  const sortedSections = [...workspace.sections].sort((a, b) => a.order - b.order);
  const sectionLines = (sectionId: string) => workspace.lines.filter((line) => line.sectionId === sectionId).sort((a, b) => a.order - b.order);

  useEffect(() => {
    if (!focusLineId) return;
    const input = document.getElementById(`line-${focusLineId}`);
    if (input instanceof HTMLInputElement) { input.focus(); setFocusLineId(undefined); }
  }, [focusLineId, workspace.lines]);

  function sectionWithBody(sectionId: string, lines: LyricLine[]) {
    const section = workspace.sections.find((item) => item.id === sectionId);
    return section ? { ...section, body: [...lines].sort((a, b) => a.order - b.order).map((line) => line.text).join("\n") } : undefined;
  }

  async function addSection(name: string) {
    if (!name) return;
    const section: LyricSection = { id: uid(), songId: song.id, name, body: "", order: sortedSections.length };
    const line = newLine(song.id, section.id, 0);
    await db.transaction("rw", [db.sections, db.lyricLines], async () => { await db.sections.add(section); await db.lyricLines.add(line); });
    setWorkspace((data) => ({ ...data, sections: [...data.sections, section], lines: [...data.lines, line] }));
    setFocusLineId(line.id);
  }

  function patchSection(section: LyricSection, patch: Partial<LyricSection>) {
    const updated = { ...section, ...patch };
    setWorkspace((data) => ({ ...data, sections: data.sections.map((item) => item.id === updated.id ? updated : item) }));
    queueSave(db.sections, updated);
  }

  function patchLine(line: LyricLine, patch: Partial<LyricLine>) {
    const updated = { ...line, ...patch, updatedAt: now() };
    const nextLines = workspace.lines.map((item) => item.id === updated.id ? updated : item);
    const nextSection = sectionWithBody(line.sectionId, nextLines.filter((item) => item.sectionId === line.sectionId));
    setWorkspace((data) => ({ ...data, lines: nextLines, sections: nextSection ? data.sections.map((item) => item.id === nextSection.id ? nextSection : item) : data.sections }));
    queueSave(db.lyricLines, updated);
    if (nextSection) queueSave(db.sections, nextSection);
  }

  async function moveSection(index: number, delta: number) {
    const updated = await moveOrdered(db.sections, sortedSections, index, index + delta);
    setWorkspace((data) => ({ ...data, sections: updated }));
  }

  async function addLyricLine(section: LyricSection, insertAt = sectionLines(section.id).length) {
    const current = sectionLines(section.id);
    const shifted = current.map((item) => item.order >= insertAt ? { ...item, order: item.order + 1 } : item);
    const line = newLine(song.id, section.id, insertAt);
    const next = [...shifted, line].sort((a, b) => a.order - b.order);
    const updatedSection = sectionWithBody(section.id, next) ?? section;
    await db.transaction("rw", [db.lyricLines, db.sections], async () => { await db.lyricLines.bulkPut([...shifted, line]); await db.sections.put(updatedSection); });
    setWorkspace((data) => ({ ...data, lines: [...data.lines.filter((item) => item.sectionId !== section.id), ...next], sections: data.sections.map((item) => item.id === section.id ? updatedSection : item) }));
    setFocusLineId(line.id);
  }

  async function moveLine(section: LyricSection, index: number, delta: number) {
    const updated = await moveOrdered(db.lyricLines, sectionLines(section.id), index, index + delta);
    const updatedSection = sectionWithBody(section.id, updated) ?? section;
    await db.sections.put(updatedSection);
    setWorkspace((data) => ({ ...data, lines: [...data.lines.filter((item) => item.sectionId !== section.id), ...updated], sections: data.sections.map((item) => item.id === section.id ? updatedSection : item) }));
  }

  async function deleteLine(section: LyricSection, line: LyricLine) {
    if (!window.confirm("この歌詞行を削除しますか？")) return;
    const current = sectionLines(section.id);
    if (current.length === 1) { patchLine(line, { text: "", alternate: "", rhymes: "", ideaIds: [], note: "" }); return; }
    const remaining = current.filter((item) => item.id !== line.id).map((item, order) => ({ ...item, order }));
    const updatedSection = sectionWithBody(section.id, remaining) ?? section;
    await db.transaction("rw", [db.lyricLines, db.sections], async () => { await db.lyricLines.delete(line.id); await db.lyricLines.bulkPut(remaining); await db.sections.put(updatedSection); });
    setWorkspace((data) => ({ ...data, lines: [...data.lines.filter((item) => item.sectionId !== section.id), ...remaining], sections: data.sections.map((item) => item.id === section.id ? updatedSection : item) }));
  }

  async function deleteSection(section: LyricSection) {
    if (!window.confirm(`「${section.name}」を削除しますか？`)) return;
    await db.transaction("rw", [db.sections, db.lyricLines], async () => { await db.sections.delete(section.id); await db.lyricLines.where("sectionId").equals(section.id).delete(); });
    const remaining = sortedSections.filter((item) => item.id !== section.id).map((item, order) => ({ ...item, order }));
    await db.sections.bulkPut(remaining);
    setWorkspace((data) => ({ ...data, sections: remaining, lines: data.lines.filter((line) => line.sectionId !== section.id) }));
  }

  function addCandidates(line: LyricLine) {
    const additions = listEntries(candidateDrafts[line.id]); if (!additions.length) return;
    const next = Array.from(new Set([...listEntries(line.alternate), ...additions]));
    patchLine(line, { alternate: next.join("\n") }); setCandidateDrafts((items) => ({ ...items, [line.id]: "" }));
  }

  function adoptCandidate(line: LyricLine, candidate: string) {
    const current = line.text.trim(); const remaining = listEntries(line.alternate).filter((item) => item !== candidate);
    if (current && current !== candidate && !remaining.includes(current)) remaining.push(current);
    patchLine(line, { text: candidate, alternate: remaining.join("\n") });
  }

  function removeCandidate(line: LyricLine, candidate: string) { patchLine(line, { alternate: listEntries(line.alternate).filter((item) => item !== candidate).join("\n") }); }

  function addRhymes(line: LyricLine) {
    const additions = (rhymeDrafts[line.id] ?? "").split(/[\r\n、,]+/).map((item) => item.trim()).filter(Boolean); if (!additions.length) return;
    const next = Array.from(new Set([...listEntries(line.rhymes), ...additions]));
    patchLine(line, { rhymes: next.join("\n") }); setRhymeDrafts((items) => ({ ...items, [line.id]: "" }));
  }

  return (
    <section className="tab-page lyrics-page"><div className="tab-heading"><h1>歌詞</h1><div className="lyrics-heading-actions"><select aria-label="セクションを追加" value="" onChange={(event) => { void addSection(event.target.value); event.target.value = ""; }}><option value="">＋ セクション</option>{sectionPresets.map((name) => <option key={name}>{name}</option>)}</select></div></div>
      {sortedSections.map((section, sectionIndex) => {
        const lines = sectionLines(section.id);
        return <article className="lyric-section simple-section" key={section.id}>
          <header><input aria-label="セクション名" value={section.name} onChange={(event) => patchSection(section, { name: event.target.value })} /><details className="section-menu"><summary aria-label="セクション操作">•••</summary><div><button disabled={sectionIndex === 0} onClick={() => void moveSection(sectionIndex, -1)}>上へ</button><button disabled={sectionIndex === sortedSections.length - 1} onClick={() => void moveSection(sectionIndex, 1)}>下へ</button><button className="danger-text" onClick={() => void deleteSection(section)}>削除</button></div></details></header>
          <div className="lyric-line-list">{lines.map((line, lineIndex) => {
            const candidates = listEntries(line.alternate); const rhymeWords = listEntries(line.rhymes);
            return <div className="lyric-line-editor" key={line.id}>
              <span className="lyric-line-number">{lineIndex + 1}</span>
              <input id={`line-${line.id}`} className="lyric-line-input" aria-label={`${section.name} ${lineIndex + 1}行目`} value={line.text} onChange={(event) => patchLine(line, { text: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void addLyricLine(section, lineIndex + 1); } }} />
              <div className="lyric-explore-panels">
                <details className="lyric-explore-panel"><summary><span>言い換え候補</span><em>{candidates.length}</em></summary><div><div className="lyric-entry-adder"><input aria-label="言い換え候補を追加" value={candidateDrafts[line.id] ?? ""} onChange={(event) => setCandidateDrafts((items) => ({ ...items, [line.id]: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); addCandidates(line); } }} placeholder="候補を入力" /><button disabled={!candidateDrafts[line.id]?.trim()} onClick={() => addCandidates(line)}>追加</button></div>{candidates.length > 0 ? <div className="lyric-candidate-list">{candidates.map((candidate, index) => <div key={`${candidate}-${index}`}><span>{candidate}</span><button onClick={() => adoptCandidate(line, candidate)}>採用</button><button aria-label={`${candidate}を削除`} onClick={() => removeCandidate(line, candidate)}>×</button></div>)}</div> : <small>候補はまだありません。</small>}</div></details>
                <details className="lyric-explore-panel"><summary><span>韻</span><em>{rhymeWords.length}</em></summary><div><div className="lyric-entry-adder"><input aria-label="韻を追加" value={rhymeDrafts[line.id] ?? ""} onChange={(event) => setRhymeDrafts((items) => ({ ...items, [line.id]: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); addRhymes(line); } }} placeholder="1語入力" /><button disabled={!rhymeDrafts[line.id]?.trim()} onClick={() => addRhymes(line)}>追加</button></div>{rhymeWords.length > 0 ? <div className="rhyme-bank">{rhymeWords.map((word, index) => <span key={`${word}-${index}`}><b>{word}</b><button aria-label={`${word}を削除`} onClick={() => patchLine(line, { rhymes: rhymeWords.filter((item) => item !== word).join("\n") })}>×</button></span>)}</div> : <small>韻はまだありません。</small>}</div></details>
              </div>
              <div className="lyric-line-actions"><button disabled={lineIndex === 0} onClick={() => void moveLine(section, lineIndex, -1)}>上へ</button><button disabled={lineIndex === lines.length - 1} onClick={() => void moveLine(section, lineIndex, 1)}>下へ</button><button className="danger-text" onClick={() => void deleteLine(section, line)}>削除</button></div>
            </div>;
          })}</div>
          <button className="add-line" onClick={() => void addLyricLine(section)}>＋ 歌詞行</button>
        </article>;
      })}
      {sortedSections.length === 0 && <div className="plain-empty"><p>セクションがありません。</p><button onClick={() => void addSection("自由セクション")}>セクションを追加</button></div>}
    </section>
  );
}
