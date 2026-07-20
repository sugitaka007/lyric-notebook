import { useCallback, useEffect, useRef, useState } from "react";
import { db, now, uid } from "../../db";
import { downloadBlob } from "../../media";
import { buildSketchPrompt, copyToClipboard, SKETCH_PROMPT_OPTIONS, type ExportBackground } from "../../settings";
import { shouldUndoTwoFingerTap } from "../../sketch-gesture";
import type { AspectRatio, Point, SketchArrowElement, SketchPromptFields, SketchRecord, SketchTextElement, SketchTextSize, Stroke } from "../../types";
import type { TabProps } from "../SongEditor";
import { BlobImage } from "../ui";

type Tool = "select" | "pen" | "eraser" | "text" | "arrow";
type Selection = { type: "text" | "arrow"; id: string };
type ArrowMoveMode = "move" | "start" | "end";
type CanvasSnapshot = { strokes: Stroke[]; texts: SketchTextElement[]; arrows: SketchArrowElement[] };
type ActiveOperation = { before: CanvasSnapshot; kind: "stroke" | "arrow" | "text-move" | "arrow-move"; id?: string; index?: number; last?: Point; mode?: ArrowMoveMode };

const ratioFor = (aspect: AspectRatio) => aspect === "16:9" ? 16 / 9 : aspect === "9:16" ? 9 / 16 : 1;
const textScale = (size: SketchTextSize) => size === "small" ? .04 : size === "large" ? .085 : .06;
const snapshotOf = (record: SketchRecord): CanvasSnapshot => ({ strokes: structuredClone(record.strokes ?? []), texts: structuredClone(record.texts ?? []), arrows: structuredClone(record.arrows ?? []) });
const withSnapshot = (record: SketchRecord, snapshot: CanvasSnapshot): SketchRecord => ({ ...record, strokes: snapshot.strokes, texts: snapshot.texts, arrows: snapshot.arrows });
const normalizedSketch = (record: SketchRecord): SketchRecord => ({ ...record, aspect: record.aspect ?? "16:9", strokes: record.strokes ?? [], texts: record.texts ?? [], arrows: record.arrows ?? [], guideVisible: record.guideVisible ?? true, guideInExport: record.guideInExport ?? false, backgroundColor: record.backgroundColor ?? "#fffdf9", promptFields: record.promptFields ?? {} });

function drawArrow(ctx: CanvasRenderingContext2D, arrow: SketchArrowElement, width: number, height: number) {
  const x1 = arrow.start.x * width; const y1 = arrow.start.y * height; const x2 = arrow.end.x * width; const y2 = arrow.end.y * height;
  const angle = Math.atan2(y2 - y1, x2 - x1); const head = Math.max(12, arrow.width * 4);
  ctx.save(); ctx.strokeStyle = arrow.color; ctx.fillStyle = arrow.color; ctx.lineWidth = arrow.width; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - head * Math.cos(angle - Math.PI / 6), y2 - head * Math.sin(angle - Math.PI / 6)); ctx.lineTo(x2 - head * Math.cos(angle + Math.PI / 6), y2 - head * Math.sin(angle + Math.PI / 6)); ctx.closePath(); ctx.fill(); ctx.restore();
}

function renderSketch(ctx: CanvasRenderingContext2D, record: SketchRecord, width: number, height: number, underlay?: HTMLImageElement, options: { guide: boolean; background: ExportBackground | "current"; selection?: Selection } = { guide: false, background: "current" }) {
  ctx.clearRect(0, 0, width, height);
  const background = options.background === "white" ? "#ffffff" : record.backgroundColor ?? "#fffdf9";
  if (options.background !== "transparent") { ctx.fillStyle = background; ctx.fillRect(0, 0, width, height); }
  if (underlay) { ctx.save(); ctx.globalAlpha = .45; const scale = Math.min(width / underlay.naturalWidth, height / underlay.naturalHeight); const w = underlay.naturalWidth * scale; const h = underlay.naturalHeight * scale; ctx.drawImage(underlay, (width - w) / 2, (height - h) / 2, w, h); ctx.restore(); }
  for (const stroke of record.strokes ?? []) {
    if (!stroke.points.length) continue; ctx.save();
    if (stroke.tool === "eraser" && options.background === "transparent") ctx.globalCompositeOperation = "destination-out";
    ctx.strokeStyle = stroke.tool === "eraser" ? background : stroke.color; ctx.lineWidth = stroke.width; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.beginPath();
    stroke.points.forEach((point, index) => { const x = point.x * width; const y = point.y * height; if (!index) ctx.moveTo(x, y); else ctx.lineTo(x, y); });
    if (stroke.points.length === 1) ctx.lineTo(stroke.points[0].x * width + .1, stroke.points[0].y * height + .1); ctx.stroke(); ctx.restore();
  }
  for (const arrow of record.arrows ?? []) drawArrow(ctx, arrow, width, height);
  for (const item of record.texts ?? []) { ctx.save(); const px = Math.max(14, width * textScale(item.size)); ctx.font = `600 ${px}px sans-serif`; ctx.fillStyle = item.color; ctx.textBaseline = "top"; ctx.fillText(item.text, item.position.x * width, item.position.y * height); ctx.restore(); }
  if (options.guide) { ctx.save(); ctx.strokeStyle = "rgba(90,90,90,.58)"; ctx.lineWidth = 1; ctx.setLineDash([7, 6]); for (const x of [1 / 3, 2 / 3]) { ctx.beginPath(); ctx.moveTo(width * x, 0); ctx.lineTo(width * x, height); ctx.stroke(); } for (const y of [1 / 3, 2 / 3]) { ctx.beginPath(); ctx.moveTo(0, height * y); ctx.lineTo(width, height * y); ctx.stroke(); } ctx.restore(); }
  if (options.selection) { const text = options.selection.type === "text" ? record.texts?.find((item) => item.id === options.selection!.id) : undefined; const arrow = options.selection.type === "arrow" ? record.arrows?.find((item) => item.id === options.selection!.id) : undefined; ctx.save(); ctx.strokeStyle = "#007aff"; ctx.fillStyle = "#007aff"; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); if (text) { const x = text.position.x * width; const y = text.position.y * height; ctx.strokeRect(x - 5, y - 5, Math.max(50, text.text.length * width * textScale(text.size)), width * textScale(text.size) + 12); } if (arrow) { for (const point of [arrow.start, arrow.end]) { ctx.beginPath(); ctx.arc(point.x * width, point.y * height, 7, 0, Math.PI * 2); ctx.fill(); } } ctx.restore(); }
}

async function imageFromBlob(blob?: Blob) {
  if (!(blob instanceof Blob) || !blob.size) return undefined;
  const url = URL.createObjectURL(blob); const image = new Image();
  try { await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("画像を読み込めませんでした。")); image.src = url; }); return image; }
  finally { URL.revokeObjectURL(url); }
}

async function makeSketchPng(record: SketchRecord, underlay: HTMLImageElement | undefined, background: ExportBackground, guide: boolean) {
  const width = 1600; const height = Math.round(width / ratioFor(record.aspect)); const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; const ctx = canvas.getContext("2d"); if (!ctx) throw new Error("PNGを作成できませんでした。");
  renderSketch(ctx, record, width, height, underlay, { background, guide });
  return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNGを作成できませんでした。")), "image/png"));
}

export function SketchTab({ song, workspace, setWorkspace, settings, notify }: TabProps) {
  const [selectedId, setSelectedId] = useState<string | undefined>(workspace.sketches[0]?.id);
  const selected = workspace.sketches.find((item) => item.id === selectedId) ?? workspace.sketches[0];

  useEffect(() => {
    const invalid = workspace.sketches.filter((item) => !(item.previewBlob instanceof Blob) || !item.previewBlob.size);
    for (const item of invalid) void (async () => {
      try { const normalized = normalizedSketch(item); const underlay = await imageFromBlob(normalized.underlayBlob); const previewBlob = await makeSketchPng(normalized, underlay, "current", false); const next = { ...normalized, previewBlob }; await db.sketches.put(next); setWorkspace((data) => ({ ...data, sketches: data.sketches.map((sketch) => sketch.id === next.id ? next : sketch) })); }
      catch { /* ベクターデータは編集画面で引き続き利用できる */ }
    })();
  }, [setWorkspace, workspace.sketches]);

  async function addSketch() {
    const sketch: SketchRecord = { id: uid(), songId: song.id, name: `スケッチ ${workspace.sketches.length + 1}`, aspect: settings.sketchDefaultAspect, strokes: [], texts: [], arrows: [], guideVisible: settings.sketchGuideDefault, guideInExport: false, backgroundColor: "#fffdf9", promptFields: {}, createdAt: now(), updatedAt: now() };
    await db.sketches.add(sketch); setWorkspace((data) => ({ ...data, sketches: [...data.sketches, sketch] })); setSelectedId(sketch.id);
  }
  function update(next: SketchRecord) { setWorkspace((data) => ({ ...data, sketches: data.sketches.map((item) => item.id === next.id ? next : item) })); }
  async function remove(sketch: SketchRecord) { if (!window.confirm("このスケッチを削除しますか？")) return; await db.sketches.delete(sketch.id); setWorkspace((data) => ({ ...data, sketches: data.sketches.filter((item) => item.id !== sketch.id) })); setSelectedId(undefined); }

  return <section className="tab-page sketch-page"><div className="tab-heading"><h1>スケッチ</h1><button className="primary compact" onClick={() => void addSketch()}>＋ 新規</button></div>
    <div className="sketch-picker">{workspace.sketches.map((sketch) => <button className={sketch.id === selected?.id ? "active" : ""} key={sketch.id} onClick={() => setSelectedId(sketch.id)}><BlobImage blob={sketch.previewBlob} alt="" /><span>{sketch.name}</span></button>)}</div>
    {selected ? <CanvasEditor key={selected.id} record={selected} settings={settings} onUpdate={update} onDelete={() => void remove(selected)} notify={notify} /> : <div className="plain-empty"><p>スケッチはありません。</p><button onClick={() => void addSketch()}>スケッチを作成</button></div>}
  </section>;
}

function CanvasEditor({ record, settings, onUpdate, onDelete, notify }: { record: SketchRecord; settings: TabProps["settings"]; onUpdate(next: SketchRecord): void; onDelete(): void; notify(message: string): void }) {
  const [draftState, setDraftState] = useState(() => normalizedSketch(record));
  const draftRef = useRef(draftState); const [undoStack, setUndoStack] = useState<CanvasSnapshot[]>([]); const [redoStack, setRedoStack] = useState<CanvasSnapshot[]>([]);
  const [tool, setTool] = useState<Tool>("pen"); const [color, setColor] = useState(settings.sketchPenColor); const [width, setWidth] = useState(settings.sketchPenWidth); const [selection, setSelection] = useState<Selection>(); const [arrowMode, setArrowMode] = useState<ArrowMoveMode>("move");
  const [textDialog, setTextDialog] = useState<Point>(); const [newText, setNewText] = useState(""); const [newTextSize, setNewTextSize] = useState<SketchTextSize>(settings.sketchTextSize); const [manualPrompt, setManualPrompt] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null); const underlayImage = useRef<HTMLImageElement | undefined>(undefined); const pointers = useRef(new Map<number, { start: Point; last: Point }>()); const activeOperation = useRef<ActiveOperation | undefined>(undefined); const twoFinger = useRef({ active: false, start: 0, moved: false, undone: false });
  const promptRef = useRef<HTMLTextAreaElement>(null); const draft = draftState; const ratio = ratioFor(draft.aspect);

  function updateDraft(next: SketchRecord | ((current: SketchRecord) => SketchRecord)) { const value = typeof next === "function" ? next(draftRef.current) : next; draftRef.current = value; setDraftState(value); }
  async function persist(next = draftRef.current) { const value = { ...next, updatedAt: now() }; draftRef.current = value; setDraftState(value); await db.sketches.put(value); onUpdate(value); }
  function commit(before: CanvasSnapshot) { setUndoStack((items) => [...items.slice(-39), before]); setRedoStack([]); void persist(); }

  const redraw = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return; const rect = canvas.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 3); const pixelWidth = Math.max(1, Math.round(rect.width * dpr)); const pixelHeight = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; } const ctx = canvas.getContext("2d"); if (!ctx) return; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); renderSketch(ctx, draftRef.current, rect.width, rect.height, underlayImage.current, { guide: Boolean(draftRef.current.guideVisible), background: "current", selection });
  }, [selection]);

  useEffect(() => { draftRef.current = draft; redraw(); }, [draft, redraw]);
  useEffect(() => { let cancelled = false; void imageFromBlob(draft.underlayBlob).then((image) => { if (!cancelled) { underlayImage.current = image; redraw(); } }).catch(() => notify("下敷き画像を読み込めませんでした。")); return () => { cancelled = true; }; }, [draft.underlayBlob, notify, redraw]);
  useEffect(() => { const observer = new ResizeObserver(redraw); if (canvasRef.current) observer.observe(canvasRef.current); return () => observer.disconnect(); }, [redraw, ratio]);

  function pointFromEvent(event: React.PointerEvent<HTMLCanvasElement>) { const rect = event.currentTarget.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)) }; }
  function distanceToSegment(point: Point, start: Point, end: Point) { const dx = end.x - start.x; const dy = end.y - start.y; const length = dx * dx + dy * dy || 1; const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length)); return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy)); }
  function findSelection(point: Point): Selection | undefined { const text = [...(draftRef.current.texts ?? [])].reverse().find((item) => Math.abs(point.x - item.position.x) < .17 && Math.abs(point.y - item.position.y) < .08); if (text) return { type: "text", id: text.id }; const arrow = [...(draftRef.current.arrows ?? [])].reverse().find((item) => distanceToSegment(point, item.start, item.end) < .045); return arrow ? { type: "arrow", id: arrow.id } : undefined; }

  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); const point = pointFromEvent(event); pointers.current.set(event.pointerId, { start: point, last: point });
    if (pointers.current.size === 2) { const operation = activeOperation.current; if (operation) updateDraft((current) => withSnapshot(current, operation.before)); activeOperation.current = undefined; twoFinger.current = { active: true, start: Date.now(), moved: false, undone: false }; return; }
    if (pointers.current.size > 1 || twoFinger.current.active) return;
    const before = snapshotOf(draftRef.current);
    if (tool === "pen" || tool === "eraser") { const stroke: Stroke = { tool, color, width, points: [point] }; const index = draftRef.current.strokes.length; updateDraft((current) => ({ ...current, strokes: [...current.strokes, stroke] })); activeOperation.current = { before, kind: "stroke", index }; }
    else if (tool === "arrow") { const id = uid(); const arrow: SketchArrowElement = { id, start: point, end: point, color, width }; updateDraft((current) => ({ ...current, arrows: [...(current.arrows ?? []), arrow] })); setSelection({ type: "arrow", id }); activeOperation.current = { before, kind: "arrow", id }; }
    else if (tool === "select") { const found = findSelection(point); setSelection(found); if (found?.type === "text") activeOperation.current = { before, kind: "text-move", id: found.id, last: point }; if (found?.type === "arrow") activeOperation.current = { before, kind: "arrow-move", id: found.id, last: point, mode: arrowMode }; }
  }

  function pointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const point = pointFromEvent(event); const pointer = pointers.current.get(event.pointerId); if (!pointer) return; if (Math.hypot(point.x - pointer.start.x, point.y - pointer.start.y) > .025) twoFinger.current.moved = true; pointer.last = point;
    if (twoFinger.current.active || pointers.current.size > 1) return; const operation = activeOperation.current; if (!operation) return; event.preventDefault();
    if (operation.kind === "stroke") updateDraft((current) => ({ ...current, strokes: current.strokes.map((stroke, index) => index === operation.index ? { ...stroke, points: [...stroke.points, point] } : stroke) }));
    if (operation.kind === "arrow") updateDraft((current) => ({ ...current, arrows: (current.arrows ?? []).map((arrow) => arrow.id === operation.id ? { ...arrow, end: point } : arrow) }));
    if (operation.kind === "text-move" && operation.last) { const dx = point.x - operation.last.x; const dy = point.y - operation.last.y; operation.last = point; updateDraft((current) => ({ ...current, texts: (current.texts ?? []).map((item) => item.id === operation.id ? { ...item, position: { x: Math.min(1, Math.max(0, item.position.x + dx)), y: Math.min(1, Math.max(0, item.position.y + dy)) } } : item) })); }
    if (operation.kind === "arrow-move" && operation.last) { const dx = point.x - operation.last.x; const dy = point.y - operation.last.y; operation.last = point; updateDraft((current) => ({ ...current, arrows: (current.arrows ?? []).map((arrow) => { if (arrow.id !== operation.id) return arrow; if (operation.mode === "start") return { ...arrow, start: point }; if (operation.mode === "end") return { ...arrow, end: point }; return { ...arrow, start: { x: Math.min(1, Math.max(0, arrow.start.x + dx)), y: Math.min(1, Math.max(0, arrow.start.y + dy)) }, end: { x: Math.min(1, Math.max(0, arrow.end.x + dx)), y: Math.min(1, Math.max(0, arrow.end.y + dy)) } }; }) })); }
  }

  function pointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    event.preventDefault(); const pointer = pointers.current.get(event.pointerId); pointers.current.delete(event.pointerId);
    if (twoFinger.current.active) { if (!pointers.current.size) { const shouldUndo = shouldUndoTwoFingerTap(twoFinger.current, Date.now()); twoFinger.current.undone = true; twoFinger.current.active = false; if (shouldUndo) undo(); } return; }
    const operation = activeOperation.current; activeOperation.current = undefined; if (operation) commit(operation.before);
    else if (tool === "text" && pointer && Math.hypot(pointer.last.x - pointer.start.x, pointer.last.y - pointer.start.y) < .025) { setNewText(""); setNewTextSize(settings.sketchTextSize); setTextDialog(pointer.start); }
  }

  function undo() { setUndoStack((items) => { const previous = items.at(-1); if (!previous) return items; setRedoStack((redo) => [...redo.slice(-39), snapshotOf(draftRef.current)]); const next = withSnapshot(draftRef.current, previous); updateDraft(next); void persist(next); return items.slice(0, -1); }); }
  function redo() { setRedoStack((items) => { const nextSnapshot = items.at(-1); if (!nextSnapshot) return items; setUndoStack((undoItems) => [...undoItems.slice(-39), snapshotOf(draftRef.current)]); const next = withSnapshot(draftRef.current, nextSnapshot); updateDraft(next); void persist(next); return items.slice(0, -1); }); }
  function clearAll() { if (!window.confirm("線、文字、矢印をすべて消しますか？")) return; const before = snapshotOf(draftRef.current); const next = { ...draftRef.current, strokes: [], texts: [], arrows: [] }; updateDraft(next); setSelection(undefined); commit(before); }
  function addText() { if (!textDialog || !newText.trim()) return; const before = snapshotOf(draftRef.current); const item: SketchTextElement = { id: uid(), text: newText.trim(), position: textDialog, color, size: newTextSize }; const next = { ...draftRef.current, texts: [...(draftRef.current.texts ?? []), item] }; updateDraft(next); setSelection({ type: "text", id: item.id }); setTextDialog(undefined); setTool("select"); commit(before); }
  function patchSelectedText(patch: Partial<SketchTextElement>, withHistory = true) { if (selection?.type !== "text") return; const before = snapshotOf(draftRef.current); const next = { ...draftRef.current, texts: (draftRef.current.texts ?? []).map((item) => item.id === selection.id ? { ...item, ...patch } : item) }; updateDraft(next); if (withHistory) commit(before); else void persist(next); }
  function patchSelectedArrow(patch: Partial<SketchArrowElement>) { if (selection?.type !== "arrow") return; const before = snapshotOf(draftRef.current); const next = { ...draftRef.current, arrows: (draftRef.current.arrows ?? []).map((item) => item.id === selection.id ? { ...item, ...patch } : item) }; updateDraft(next); commit(before); }
  function deleteSelected() { if (!selection) return; const before = snapshotOf(draftRef.current); const next = selection.type === "text" ? { ...draftRef.current, texts: (draftRef.current.texts ?? []).filter((item) => item.id !== selection.id) } : { ...draftRef.current, arrows: (draftRef.current.arrows ?? []).filter((item) => item.id !== selection.id) }; updateDraft(next); setSelection(undefined); commit(before); }

  async function setUnderlay(file?: File) { if (!file) return; const next = { ...draftRef.current, underlayBlob: file, updatedAt: now() }; updateDraft(next); try { await persist(next); } catch { notify("下敷き画像を保存できませんでした。"); } }
  function patchRecord(patch: Partial<SketchRecord>) { const next = { ...draftRef.current, ...patch, updatedAt: now() }; updateDraft(next); void persist(next).catch(() => notify("スケッチを保存できませんでした。")); }
  async function save(exportImage = false) { try { const blob = await makeSketchPng(draftRef.current, underlayImage.current, exportImage ? settings.sketchExportBackground : "current", Boolean(draftRef.current.guideInExport)); const next = { ...draftRef.current, previewBlob: blob, updatedAt: now() }; await db.sketches.put(next); updateDraft(next); onUpdate(next); if (exportImage) { const file = new File([blob], `${draftRef.current.name || "スケッチ"}.png`, { type: "image/png" }); const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean }; if (navigator.share && nav.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: draftRef.current.name }); } catch (error) { if (!(error instanceof DOMException && error.name === "AbortError")) downloadBlob(blob, file.name); } } else downloadBlob(blob, file.name); } notify(exportImage ? "スケッチ画像を用意しました。" : "スケッチを保存しました。"); } catch (error) { notify(error instanceof Error ? error.message : "スケッチを保存できませんでした。"); } }
  async function copyPrompt() { const prompt = buildSketchPrompt(draftRef.current.promptFields); if (await copyToClipboard(prompt)) { notify("画像生成用の命令文をコピーしました"); return; } setManualPrompt(true); requestAnimationFrame(() => { promptRef.current?.focus(); promptRef.current?.select(); }); notify("コピーできませんでした。文章を長押ししてコピーしてください。"); }
  const selectedText = selection?.type === "text" ? draft.texts?.find((item) => item.id === selection.id) : undefined; const selectedArrow = selection?.type === "arrow" ? draft.arrows?.find((item) => item.id === selection.id) : undefined;

  return <article className="canvas-editor"><div className="sketch-name-row"><input value={draft.name} onChange={(event) => patchRecord({ name: event.target.value })} aria-label="スケッチ名" /><div className="canvas-icon-toolbar"><button onClick={undo} disabled={!undoStack.length} aria-label="一つ戻す" title="一つ戻す">↶</button><button onClick={redo} disabled={!redoStack.length} aria-label="やり直す" title="やり直す">↷</button><button onClick={clearAll} aria-label="全消去" title="全消去">🗑</button><button onClick={() => void save(false)} aria-label="保存" title="保存">↓</button></div></div>
    <div className="canvas-tools" aria-label="描画ツール"><button className={tool === "select" ? "active" : ""} onClick={() => setTool("select")} aria-label="要素を選択して移動">◎<span>選択</span></button><button className={tool === "pen" ? "active" : ""} onClick={() => setTool("pen")} aria-label="ペン">✎<span>ペン</span></button><button className={tool === "eraser" ? "active" : ""} onClick={() => setTool("eraser")} aria-label="消しゴム">▱<span>消去</span></button><button className={tool === "text" ? "active" : ""} onClick={() => setTool("text")} aria-label="文字を追加">T<span>文字</span></button><button className={tool === "arrow" ? "active" : ""} onClick={() => setTool("arrow")} aria-label="矢印を追加">→<span>矢印</span></button></div>
    <div className="drawing-options"><label><span>色</span><input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label><label><span>太さ</span><input type="range" min="1" max="28" value={width} onChange={(event) => setWidth(Number(event.target.value))} /></label><label><span>背景</span><input type="color" value={draft.backgroundColor} onChange={(event) => patchRecord({ backgroundColor: event.target.value })} /></label></div>
    <div className="aspect-row"><div className="segmented small">{(["16:9", "9:16", "1:1"] as AspectRatio[]).map((aspect) => <button key={aspect} className={draft.aspect === aspect ? "active" : ""} onClick={() => patchRecord({ aspect })}>{aspect}</button>)}</div><label className="small-file"><input type="file" accept="image/*" onChange={(event) => void setUnderlay(event.target.files?.[0])} />{draft.underlayBlob ? "下敷きを変更" : "画像を下敷き"}</label></div>
    <div className="guide-row"><label className="switch-row"><span>三分割ガイド</span><input type="checkbox" checked={Boolean(draft.guideVisible)} onChange={(event) => patchRecord({ guideVisible: event.target.checked })} /></label><label className="switch-row"><span>保存画像に含める</span><input type="checkbox" checked={Boolean(draft.guideInExport)} onChange={(event) => patchRecord({ guideInExport: event.target.checked })} /></label></div>
    <div className="canvas-wrap" style={{ aspectRatio: ratio }}><canvas ref={canvasRef} aria-label="スケッチキャンバス" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} /></div>
    {selectedText && <div className="element-editor"><strong>文字</strong><input aria-label="選択した文字" value={selectedText.text} onChange={(event) => patchSelectedText({ text: event.target.value }, false)} /><select aria-label="文字サイズ" value={selectedText.size} onChange={(event) => patchSelectedText({ size: event.target.value as SketchTextSize })}><option value="small">小</option><option value="medium">中</option><option value="large">大</option></select><input aria-label="文字色" type="color" value={selectedText.color} onChange={(event) => patchSelectedText({ color: event.target.value })} /><button className="danger-text" onClick={deleteSelected}>削除</button></div>}
    {selectedArrow && <div className="element-editor"><strong>矢印</strong><div className="segmented small"><button className={arrowMode === "move" ? "active" : ""} onClick={() => setArrowMode("move")}>移動</button><button className={arrowMode === "start" ? "active" : ""} onClick={() => setArrowMode("start")}>始点</button><button className={arrowMode === "end" ? "active" : ""} onClick={() => setArrowMode("end")}>終点</button></div><input aria-label="矢印の色" type="color" value={selectedArrow.color} onChange={(event) => patchSelectedArrow({ color: event.target.value })} /><input aria-label="矢印の太さ" type="range" min="1" max="28" value={selectedArrow.width} onChange={(event) => patchSelectedArrow({ width: Number(event.target.value) })} /><button className="danger-text" onClick={deleteSelected}>削除</button></div>}
    <details className="sketch-prompt-fields"><summary>画像の条件</summary><div>{SKETCH_PROMPT_OPTIONS.map((item) => <label key={item.key}><span>{item.label}</span><textarea rows={2} value={draft.promptFields?.[item.key] ?? ""} onChange={(event) => patchRecord({ promptFields: { ...(draftRef.current.promptFields ?? {}), [item.key]: event.target.value } as SketchPromptFields })} /></label>)}</div></details>
    <div className="canvas-actions"><button className="primary" onClick={() => void save(true)}>画像として保存</button><button onClick={() => void copyPrompt()}>画像生成用の命令文をコピー</button></div>
    {manualPrompt && <label className="prompt-preview"><span>手動でコピー</span><textarea ref={promptRef} readOnly rows={9} value={buildSketchPrompt(draft.promptFields)} /></label>}
    <button className="danger-text sketch-delete" onClick={onDelete}>このスケッチを削除</button>
    {textDialog && <div className="modal-backdrop text-entry-backdrop"><div className="modal text-entry"><div className="modal-title"><h2>文字を追加</h2><button aria-label="閉じる" onClick={() => setTextDialog(undefined)}>×</button></div><input autoFocus aria-label="追加する文字" value={newText} onChange={(event) => setNewText(event.target.value)} /><label>サイズ<select value={newTextSize} onChange={(event) => setNewTextSize(event.target.value as SketchTextSize)}><option value="small">小</option><option value="medium">中</option><option value="large">大</option></select></label><label className="setting-color">色<input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label><button className="primary full" disabled={!newText.trim()} onClick={addText}>追加</button></div></div>}
  </article>;
}
