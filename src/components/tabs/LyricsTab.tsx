import { db, moveOrdered, uid } from "../../db";
import type { LyricSection } from "../../types";
import type { TabProps } from "../SongEditor";

const sectionPresets = ["イントロ", "Aメロ", "Bメロ", "サビ", "2番", "ブリッジ", "アウトロ", "自由セクション"];

export function LyricsTab({ song, workspace, setWorkspace, queueSave }: TabProps) {
  const sorted = [...workspace.sections].sort((a, b) => a.order - b.order);

  async function addSection(name: string) {
    if (!name) return;
    const section: LyricSection = { id: uid(), songId: song.id, name, body: "", order: sorted.length };
    await db.sections.add(section);
    setWorkspace((data) => ({ ...data, sections: [...data.sections, section] }));
    window.setTimeout(() => document.getElementById(`section-${section.id}`)?.focus(), 0);
  }

  function patchSection(section: LyricSection, patch: Partial<LyricSection>) {
    const updated = { ...section, ...patch };
    setWorkspace((data) => ({ ...data, sections: data.sections.map((item) => item.id === updated.id ? updated : item) }));
    queueSave(db.sections, updated);
  }

  async function moveSection(index: number, delta: number) {
    const updated = await moveOrdered(db.sections, sorted, index, index + delta);
    setWorkspace((data) => ({ ...data, sections: updated }));
  }

  async function duplicateSection(section: LyricSection) {
    const index = sorted.findIndex((item) => item.id === section.id);
    const shifted = sorted.map((item, itemIndex) => itemIndex > index ? { ...item, order: item.order + 1 } : item);
    const copy: LyricSection = { ...section, id: uid(), name: `${section.name}（コピー）`, order: index + 1 };
    await db.sections.bulkPut([...shifted, copy]);
    setWorkspace((data) => ({ ...data, sections: [...shifted, copy] }));
  }

  async function deleteSection(section: LyricSection) {
    if (!window.confirm(`「${section.name}」を削除しますか？`)) return;
    await db.transaction("rw", [db.sections, db.lyricLines], async () => { await db.sections.delete(section.id); await db.lyricLines.where("sectionId").equals(section.id).delete(); });
    const remaining = sorted.filter((item) => item.id !== section.id).map((item, order) => ({ ...item, order }));
    await db.sections.bulkPut(remaining);
    setWorkspace((data) => ({ ...data, sections: remaining, lines: data.lines.filter((line) => line.sectionId !== section.id) }));
  }

  return (
    <section className="tab-page lyrics-page"><div className="tab-heading"><h1>歌詞</h1><select aria-label="セクションを追加" value="" onChange={(event) => { void addSection(event.target.value); event.target.value = ""; }}><option value="">＋ セクション</option>{sectionPresets.map((name) => <option key={name}>{name}</option>)}</select></div>
      {sorted.map((section, index) => <article className="lyric-section simple-section" key={section.id}><header><input aria-label="セクション名" value={section.name} onChange={(event) => patchSection(section, { name: event.target.value })} /><details className="section-menu"><summary aria-label="セクション操作">•••</summary><div><button disabled={index === 0} onClick={() => void moveSection(index, -1)}>上へ</button><button disabled={index === sorted.length - 1} onClick={() => void moveSection(index, 1)}>下へ</button><button onClick={() => void duplicateSection(section)}>複製</button><button className="danger-text" onClick={() => void deleteSection(section)}>削除</button></div></details></header><textarea rows={3} id={`section-${section.id}`} className="section-body" aria-label={`${section.name}の歌詞`} value={section.body ?? ""} onChange={(event) => patchSection(section, { body: event.target.value })} placeholder="" /></article>)}
      {sorted.length === 0 && <div className="plain-empty"><p>セクションがありません。</p><button onClick={() => void addSection("自由セクション")}>セクションを追加</button></div>}
    </section>
  );
}
