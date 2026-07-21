import { useEffect, useRef, useState } from "react";
import { db, markSongUsed, moveOrdered, now, uid } from "../../db";
import type { Idea, LyricLine, LyricSection, MediaAsset } from "../../types";
import type { TabProps } from "../SongEditor";

const sectionPresets = ["イントロ", "Aメロ", "Bメロ", "サビ", "2番", "ブリッジ", "アウトロ", "自由セクション"];

const newLine = (songId: string, sectionId: string, order: number, source?: LyricLine): LyricLine => {
  const stamp = now();
  return { id: uid(), songId, sectionId, text: source?.text ?? "", status: source?.status ?? "仮採用", alternate: source?.alternate ?? "", rhymes: source?.rhymes ?? "", ideaIds: [...(source?.ideaIds ?? [])], note: source?.note ?? "", order, createdAt: stamp, updatedAt: stamp };
};

export function LyricsTab({ song, workspace, setWorkspace, queueSave, notify }: TabProps) {
  const [focusLineId, setFocusLineId] = useState<string>();
  const [singing, setSinging] = useState(false);
  const adjustmentCursor = useRef(-1);
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

  async function duplicateLine(section: LyricSection, line: LyricLine) {
    const current = sectionLines(section.id); const index = current.findIndex((item) => item.id === line.id);
    const shifted = current.map((item, itemIndex) => itemIndex > index ? { ...item, order: item.order + 1 } : item);
    const copy = newLine(song.id, section.id, index + 1, line); const next = [...shifted, copy].sort((a, b) => a.order - b.order);
    const updatedSection = sectionWithBody(section.id, next) ?? section;
    await db.transaction("rw", [db.lyricLines, db.sections], async () => { await db.lyricLines.bulkPut([...shifted, copy]); await db.sections.put(updatedSection); });
    setWorkspace((data) => ({ ...data, lines: [...data.lines.filter((item) => item.sectionId !== section.id), ...next], sections: data.sections.map((item) => item.id === section.id ? updatedSection : item) }));
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

  async function duplicateSection(section: LyricSection) {
    const index = sortedSections.findIndex((item) => item.id === section.id);
    const shifted = sortedSections.map((item, itemIndex) => itemIndex > index ? { ...item, order: item.order + 1 } : item);
    const copy: LyricSection = { ...section, id: uid(), name: `${section.name}（コピー）`, order: index + 1 };
    const copiedLines = sectionLines(section.id).map((line, order) => newLine(song.id, copy.id, order, line));
    await db.transaction("rw", [db.sections, db.lyricLines], async () => { await db.sections.bulkPut([...shifted, copy]); await db.lyricLines.bulkAdd(copiedLines); });
    setWorkspace((data) => ({ ...data, sections: [...shifted, copy], lines: [...data.lines, ...copiedLines] }));
  }

  async function deleteSection(section: LyricSection) {
    if (!window.confirm(`「${section.name}」を削除しますか？`)) return;
    await db.transaction("rw", [db.sections, db.lyricLines], async () => { await db.sections.delete(section.id); await db.lyricLines.where("sectionId").equals(section.id).delete(); });
    const remaining = sortedSections.filter((item) => item.id !== section.id).map((item, order) => ({ ...item, order }));
    await db.sections.bulkPut(remaining);
    setWorkspace((data) => ({ ...data, sections: remaining, lines: data.lines.filter((line) => line.sectionId !== section.id) }));
  }

  function toggleIdea(line: LyricLine, idea: Idea) {
    const ids = line.ideaIds ?? [];
    patchLine(line, { ideaIds: ids.includes(idea.id) ? ids.filter((id) => id !== idea.id) : [...ids, idea.id] });
  }

  function focusNextAdjustment() {
    const lines = workspace.lines.filter((line) => line.status === "要修正").sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    if (!lines.length) { notify("要調整の行はありません。"); return; }
    adjustmentCursor.current = (adjustmentCursor.current + 1) % lines.length; setFocusLineId(lines[adjustmentCursor.current].id);
  }

  const singingLines = sortedSections.flatMap((section) => sectionLines(section.id).map((line) => ({ line, sectionName: section.name })));

  return (
    <section className="tab-page lyrics-page"><div className="tab-heading"><h1>歌詞</h1><div className="lyrics-heading-actions"><button disabled={!singingLines.length} onClick={() => setSinging(true)}>歌唱確認</button><select aria-label="セクションを追加" value="" onChange={(event) => { void addSection(event.target.value); event.target.value = ""; }}><option value="">＋ セクション</option>{sectionPresets.map((name) => <option key={name}>{name}</option>)}</select></div></div>
      {workspace.lines.some((line) => line.status === "要修正") && <button className="next-adjustment" onClick={focusNextAdjustment}>次の要調整行へ</button>}
      {sortedSections.map((section, sectionIndex) => {
        const lines = sectionLines(section.id);
        return <article className="lyric-section simple-section" key={section.id}>
          <header><input aria-label="セクション名" value={section.name} onChange={(event) => patchSection(section, { name: event.target.value })} /><details className="section-menu"><summary aria-label="セクション操作">•••</summary><div><button disabled={sectionIndex === 0} onClick={() => void moveSection(sectionIndex, -1)}>上へ</button><button disabled={sectionIndex === sortedSections.length - 1} onClick={() => void moveSection(sectionIndex, 1)}>下へ</button><button onClick={() => void duplicateSection(section)}>複製</button><button className="danger-text" onClick={() => void deleteSection(section)}>削除</button></div></details></header>
          <div className="lyric-line-list">{lines.map((line, lineIndex) => {
            const selectedIdeas = workspace.ideas.filter((idea) => (line.ideaIds ?? []).includes(idea.id));
            return <div className={`lyric-line-editor ${line.status === "要修正" ? "needs-adjustment" : ""}`} key={line.id}>
              <span className="lyric-line-number">{lineIndex + 1}</span>
              <input id={`line-${line.id}`} className="lyric-line-input" aria-label={`${section.name} ${lineIndex + 1}行目`} value={line.text} onChange={(event) => patchLine(line, { text: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void addLyricLine(section, lineIndex + 1); } }} />
              {line.status === "要修正" && <span className="adjustment-label">要調整</span>}<details className="lyric-line-details"><summary>別案・韻・アイデア{selectedIdeas.length ? ` ${selectedIdeas.length}` : ""}</summary><div>
                <label>別の言い回し<textarea rows={2} value={line.alternate} onChange={(event) => patchLine(line, { alternate: event.target.value })} /></label>
                <label>韻・響き<textarea rows={2} value={line.rhymes ?? ""} onChange={(event) => patchLine(line, { rhymes: event.target.value })} /></label>
                <fieldset><legend>参照するアイデア</legend>{workspace.ideas.length > 0 ? <div className="lyric-idea-list">{[...workspace.ideas].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((idea) => <label key={idea.id}><input type="checkbox" checked={(line.ideaIds ?? []).includes(idea.id)} onChange={() => toggleIdea(line, idea)} /><span>{idea.text}</span></label>)}</div> : <p>アイデアはありません。</p>}</fieldset>
                <label className="switch-row"><span>要調整</span><input type="checkbox" checked={line.status === "要修正"} onChange={(event) => patchLine(line, { status: event.target.checked ? "要修正" : "仮採用" })} /></label><label>メモ<textarea rows={2} value={line.note} onChange={(event) => patchLine(line, { note: event.target.value })} /></label>
              </div></details>
              {selectedIdeas.length > 0 && <div className="selected-lyric-ideas">{selectedIdeas.map((idea) => <span key={idea.id}>{idea.text}</span>)}</div>}
              <div className="lyric-line-actions"><button disabled={lineIndex === 0} onClick={() => void moveLine(section, lineIndex, -1)}>上へ</button><button disabled={lineIndex === lines.length - 1} onClick={() => void moveLine(section, lineIndex, 1)}>下へ</button><button onClick={() => void duplicateLine(section, line)}>複製</button><button className="danger-text" onClick={() => void deleteLine(section, line)}>削除</button></div>
            </div>;
          })}</div>
          <button className="add-line" onClick={() => void addLyricLine(section)}>＋ 歌詞行</button>
        </article>;
      })}
      {sortedSections.length === 0 && <div className="plain-empty"><p>セクションがありません。</p><button onClick={() => void addSection("自由セクション")}>セクションを追加</button></div>}
      {singing && <SingingMode songId={song.id} items={singingLines} setWorkspace={setWorkspace} patchLine={patchLine} onClose={() => setSinging(false)} notify={notify} />}
    </section>
  );
}

function SingingMode({ songId, items, setWorkspace, patchLine, onClose, notify }: { songId: string; items: Array<{ line: LyricLine; sectionName: string }>; setWorkspace: TabProps["setWorkspace"]; patchLine(line: LyricLine, patch: Partial<LyricLine>): void; onClose(): void; notify(message: string): void }) {
  const [index, setIndex] = useState(0); const [speed, setSpeed] = useState<"stop" | "slow" | "normal" | "fast">("stop"); const [showDetails, setShowDetails] = useState(false);
  const [recording, setRecording] = useState(false); const [seconds, setSeconds] = useState(0); const recorder = useRef<MediaRecorder | undefined>(undefined); const chunks = useRef<Blob[]>([]); const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined); const elapsed = useRef(0);
  const current = items[Math.min(index, Math.max(0, items.length - 1))];
  useEffect(() => { document.getElementById(`sing-line-${index}`)?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [index]);
  useEffect(() => {
    if (speed === "stop") return;
    const delay = speed === "slow" ? 5200 : speed === "fast" ? 2500 : 3800;
    const id = setInterval(() => setIndex((value) => Math.min(items.length - 1, value + 1)), delay); return () => clearInterval(id);
  }, [items.length, speed]);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); recorder.current?.stream.getTracks().forEach((track) => track.stop()); }, []);

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { notify("この環境では録音できません。"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); const mime = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type)); const next = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunks.current = []; next.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
      next.onstop = async () => { const type = next.mimeType || chunks.current[0]?.type || "audio/webm"; const blob = new Blob(chunks.current, { type }); const stamp = now(); const asset: MediaAsset = { id: uid(), songId, kind: "audio", origin: "recording", name: `歌唱確認 ${new Date(stamp).toLocaleString("ja-JP")}`, note: "", mimeType: type, blob, size: blob.size, durationSeconds: elapsed.current, links: [], createdAt: stamp, updatedAt: stamp }; try { await db.media.add(asset); await markSongUsed(songId); setWorkspace((data) => ({ ...data, media: [asset, ...data.media] })); notify("歌唱確認の録音を音声へ保存しました。"); } catch { notify("録音を保存できませんでした。"); } finally { stream.getTracks().forEach((track) => track.stop()); } };
      recorder.current = next; next.start(1000); elapsed.current = 0; setSeconds(0); setRecording(true); timer.current = setInterval(() => { elapsed.current += 1; setSeconds(elapsed.current); }, 1000);
    } catch { notify("録音を開始できませんでした。"); }
  }
  function stopRecording() { recorder.current?.stop(); setRecording(false); if (timer.current) clearInterval(timer.current); }
  function close() { if (recording) stopRecording(); onClose(); }

  return <div className="singing-mode" role="dialog" aria-modal="true"><header><button onClick={close}>終了</button><b>歌唱確認</b><button className={recording ? "recording" : ""} onClick={recording ? stopRecording : startRecording}>{recording ? `停止 ${seconds}秒` : "録音"}</button></header><div className="singing-options"><label>自動スクロール<select value={speed} onChange={(event) => setSpeed(event.target.value as typeof speed)}><option value="stop">停止</option><option value="slow">遅い</option><option value="normal">標準</option><option value="fast">速い</option></select></label><label className="switch-row"><span>別案・韻</span><input type="checkbox" checked={showDetails} onChange={(event) => setShowDetails(event.target.checked)} /></label></div><div className="singing-lyrics" onClick={() => setIndex((value) => Math.min(items.length - 1, value + 1))}>{items.map((item, itemIndex) => <article id={`sing-line-${itemIndex}`} key={item.line.id} className={`${itemIndex === index ? "current" : ""} ${item.line.status === "要修正" ? "needs-adjustment" : ""}`} onClick={(event) => { event.stopPropagation(); setIndex(itemIndex); }}><small>{itemIndex === 0 || items[itemIndex - 1]?.sectionName !== item.sectionName ? item.sectionName : ""}</small><p>{item.line.text || "（空の行）"}</p>{showDetails && <div><span>別案：{item.line.alternate || "なし"}</span><span>韻：{item.line.rhymes || "なし"}</span></div>}</article>)}</div><footer><button disabled={index === 0} onClick={() => setIndex((value) => Math.max(0, value - 1))}>一つ前</button><button className={current?.line.status === "要修正" ? "active" : ""} onClick={() => current && patchLine(current.line, { status: current.line.status === "要修正" ? "仮採用" : "要修正" })}>{current?.line.status === "要修正" ? "要調整を解除" : "要調整"}</button><button disabled={index === items.length - 1} onClick={() => setIndex((value) => Math.min(items.length - 1, value + 1))}>次へ</button></footer></div>;
}
