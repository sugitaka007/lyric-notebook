import { useCallback, useEffect, useRef, useState } from "react";
import { db, now, uid } from "../../db";
import { downloadBlob } from "../../media";
import type { AspectRatio, SketchRecord, Stroke } from "../../types";
import type { TabProps } from "../SongEditor";
import { BlobImage } from "../ui";

export function SketchTab({ song, workspace, setWorkspace, notify }: TabProps) {
  const [selectedId, setSelectedId] = useState<string | undefined>(workspace.sketches[0]?.id);
  const selected = workspace.sketches.find((x) => x.id === selectedId) ?? workspace.sketches[0];
  async function addSketch() {
    const sketch: SketchRecord = { id: uid(), songId: song.id, name: `スケッチ ${workspace.sketches.length + 1}`, aspect: "16:9", strokes: [], createdAt: now(), updatedAt: now() };
    await db.sketches.add(sketch); setWorkspace((data) => ({ ...data, sketches: [...data.sketches, sketch] })); setSelectedId(sketch.id);
  }
  function update(next: SketchRecord) { setWorkspace((data) => ({ ...data, sketches: data.sketches.map((x) => x.id === next.id ? next : x) })); }
  async function remove(sketch: SketchRecord) { if (!window.confirm("このスケッチを削除しますか？")) return; await db.sketches.delete(sketch.id); setWorkspace((data) => ({ ...data, sketches: data.sketches.filter((x) => x.id !== sketch.id) })); setSelectedId(undefined); }
  return <section className="tab-page sketch-page"><div className="tab-heading"><h1>スケッチ</h1><button className="primary compact" onClick={addSketch}>＋ 新規</button></div>
    <div className="sketch-picker">{workspace.sketches.map((sketch) => <button className={sketch.id === selected?.id ? "active" : ""} key={sketch.id} onClick={() => setSelectedId(sketch.id)}><BlobImage blob={sketch.previewBlob} alt="" /><span>{sketch.name}</span></button>)}</div>
    {selected ? <CanvasEditor key={selected.id} record={selected} onUpdate={update} onDelete={() => remove(selected)} notify={notify} /> : <div className="plain-empty"><p>スケッチはありません。</p><button onClick={addSketch}>スケッチを作成</button></div>}
  </section>;
}

function CanvasEditor({ record, onUpdate, onDelete, notify }: { record: SketchRecord; onUpdate(next: SketchRecord): void; onDelete(): void; notify(message: string): void }) {
  const [draft, setDraft] = useState(record); const [redo, setRedo] = useState<Stroke[]>([]); const [tool, setTool] = useState<"pen" | "eraser">("pen"); const [color, setColor] = useState("#382f35"); const [width, setWidth] = useState(4); const [drawing, setDrawing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null); const currentStroke = useRef(-1); const underlayImage = useRef<HTMLImageElement | undefined>(undefined);
  const ratio = draft.aspect === "16:9" ? 16 / 9 : draft.aspect === "9:16" ? 9 / 16 : 1;

  const redraw = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return; const rect = canvas.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const widthPx = Math.max(1, Math.round(rect.width * dpr)); const heightPx = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== widthPx || canvas.height !== heightPx) { canvas.width = widthPx; canvas.height = heightPx; }
    const ctx = canvas.getContext("2d"); if (!ctx) return; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height); ctx.fillStyle = "#fffdf9"; ctx.fillRect(0, 0, rect.width, rect.height);
    if (underlayImage.current) { ctx.globalAlpha = 0.45; const img = underlayImage.current; const scale = Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight); const w = img.naturalWidth * scale; const h = img.naturalHeight * scale; ctx.drawImage(img, (rect.width - w) / 2, (rect.height - h) / 2, w, h); ctx.globalAlpha = 1; }
    for (const stroke of draft.strokes) { if (stroke.points.length < 1) continue; ctx.save(); ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over"; ctx.strokeStyle = stroke.color; ctx.lineWidth = stroke.width; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.beginPath(); stroke.points.forEach((point, index) => { const x = point.x * rect.width; const y = point.y * rect.height; if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }); if (stroke.points.length === 1) ctx.lineTo(stroke.points[0].x * rect.width + .1, stroke.points[0].y * rect.height + .1); ctx.stroke(); ctx.restore(); }
  }, [draft.strokes]);

  useEffect(() => { if (!draft.underlayBlob) { underlayImage.current = undefined; redraw(); return; } const url = URL.createObjectURL(draft.underlayBlob); const image = new Image(); image.onload = () => { underlayImage.current = image; redraw(); }; image.src = url; return () => URL.revokeObjectURL(url); }, [draft.underlayBlob, redraw]);
  useEffect(() => { redraw(); const observer = new ResizeObserver(redraw); if (canvasRef.current) observer.observe(canvasRef.current); return () => observer.disconnect(); }, [redraw, ratio]);

  function pointFromEvent(event: React.PointerEvent<HTMLCanvasElement>) { const rect = event.currentTarget.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)) }; }
  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); const stroke: Stroke = { tool, color, width, points: [pointFromEvent(event)] }; currentStroke.current = draft.strokes.length; setDraft((item) => ({ ...item, strokes: [...item.strokes, stroke] })); setRedo([]); setDrawing(true); }
  function pointerMove(event: React.PointerEvent<HTMLCanvasElement>) { if (!drawing) return; event.preventDefault(); const point = pointFromEvent(event); setDraft((item) => ({ ...item, strokes: item.strokes.map((stroke, index) => index === currentStroke.current ? { ...stroke, points: [...stroke.points, point] } : stroke) })); }
  function pointerUp(event: React.PointerEvent<HTMLCanvasElement>) { event.preventDefault(); setDrawing(false); }
  function undo() { setDraft((item) => { const last = item.strokes.at(-1); if (last) setRedo((items) => [...items, last]); return { ...item, strokes: item.strokes.slice(0, -1) }; }); }
  function redoStroke() { const stroke = redo.at(-1); if (!stroke) return; setDraft((item) => ({ ...item, strokes: [...item.strokes, stroke] })); setRedo((items) => items.slice(0, -1)); }
  async function save(download = false) { const canvas = canvasRef.current; if (!canvas) return; const previewBlob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNGを作成できませんでした。")), "image/png")); const next = { ...draft, previewBlob, updatedAt: now() }; try { await db.sketches.put(next); setDraft(next); onUpdate(next); if (download) downloadBlob(previewBlob, `${draft.name || "スケッチ"}.png`); notify(download ? "PNGを書き出しました。" : "スケッチを保存しました。"); } catch (error) { notify(error instanceof Error ? error.message : "スケッチを保存できませんでした。"); } }
  async function setUnderlay(file?: File) { if (!file) return; const next = { ...draft, underlayBlob: file, updatedAt: now() }; setDraft(next); await db.sketches.put(next); onUpdate(next); }
  function patch(values: Partial<SketchRecord>) { const next = { ...draft, ...values, updatedAt: now() }; setDraft(next); void db.sketches.put(next).then(() => onUpdate(next)).catch((error) => notify(error instanceof Error ? error.message : "保存できませんでした。")); }

  return <article className="canvas-editor"><div className="sketch-name-row"><input value={draft.name} onChange={(e) => patch({ name: e.target.value })} aria-label="スケッチ名" /><button className="danger-text" onClick={onDelete}>削除</button></div><div className="canvas-toolbar"><div className="tool-pair"><button className={tool === "pen" ? "active" : ""} onClick={() => setTool("pen")}>ペン</button><button className={tool === "eraser" ? "active" : ""} onClick={() => setTool("eraser")}>消しゴム</button></div><label className="color-control"><input type="color" value={color} onChange={(e) => setColor(e.target.value)} /><span>色</span></label><label className="width-control"><span>太さ</span><input type="range" min="1" max="28" value={width} onChange={(e) => setWidth(Number(e.target.value))} /></label><button onClick={undo} disabled={!draft.strokes.length}>元に戻す</button><button onClick={redoStroke} disabled={!redo.length}>やり直す</button><button onClick={() => { if (window.confirm("描いた線をすべて消しますか？")) setDraft((item) => ({ ...item, strokes: [] })); }}>全消去</button></div><div className="aspect-row"><div className="segmented small">{(["16:9", "9:16", "1:1"] as AspectRatio[]).map((aspect) => <button key={aspect} className={draft.aspect === aspect ? "active" : ""} onClick={() => patch({ aspect })}>{aspect}</button>)}</div><label className="small-file"><input type="file" accept="image/*" onChange={(e) => setUnderlay(e.target.files?.[0])} />{draft.underlayBlob ? "下敷きを変更" : "画像を下敷き"}</label></div><div className="canvas-wrap" style={{ aspectRatio: ratio }}><canvas ref={canvasRef} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} /></div><div className="canvas-actions"><button onClick={() => save(false)}>保存</button><button className="primary" onClick={() => save(true)}>PNGを書き出す</button></div></article>;
}
