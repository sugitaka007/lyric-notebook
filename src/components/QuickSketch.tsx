import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

type Point = { x: number; y: number };
type Stroke = { tool: "pen" | "eraser"; color: string; width: number; points: Point[] };

export function QuickSketch({ initialColor, initialWidth, onClose, onAdd }: {
  initialColor: string; initialWidth: number; onClose(): void; onAdd(file: File): void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokesRef = useRef<Stroke[]>([]); const active = useRef<Stroke | undefined>(undefined);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [color, setColor] = useState(initialColor); const [width, setWidth] = useState(initialWidth);

  const redraw = useCallback(() => {
    const element = canvas.current; if (!element) return;
    const rect = element.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const pixelWidth = Math.max(1, Math.round(rect.width * dpr)); const pixelHeight = Math.max(1, Math.round(rect.height * dpr));
    if (element.width !== pixelWidth || element.height !== pixelHeight) { element.width = pixelWidth; element.height = pixelHeight; }
    const context = element.getContext("2d"); if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0); context.fillStyle = "#fff"; context.fillRect(0, 0, rect.width, rect.height);
    for (const stroke of [...strokesRef.current, ...(active.current ? [active.current] : [])]) {
      if (stroke.points.length < 1) continue;
      context.beginPath(); context.lineCap = "round"; context.lineJoin = "round";
      context.strokeStyle = stroke.tool === "eraser" ? "#fff" : stroke.color; context.lineWidth = stroke.width;
      const first = stroke.points[0]; context.moveTo(first.x * rect.width, first.y * rect.height);
      for (const point of stroke.points.slice(1)) context.lineTo(point.x * rect.width, point.y * rect.height);
      if (stroke.points.length === 1) context.lineTo(first.x * rect.width + 0.01, first.y * rect.height + 0.01);
      context.stroke();
    }
  }, []);

  useEffect(() => { strokesRef.current = strokes; redraw(); }, [redraw, strokes]);
  useEffect(() => { const observer = new ResizeObserver(redraw); if (canvas.current) observer.observe(canvas.current); return () => observer.disconnect(); }, [redraw]);

  function point(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  }
  function down(event: ReactPointerEvent<HTMLCanvasElement>) { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); active.current = { tool, color, width, points: [point(event)] }; redraw(); }
  function move(event: ReactPointerEvent<HTMLCanvasElement>) { if (!active.current) return; event.preventDefault(); active.current.points.push(point(event)); redraw(); }
  function up(event: ReactPointerEvent<HTMLCanvasElement>) { if (!active.current) return; event.preventDefault(); const next = [...strokesRef.current, active.current]; active.current = undefined; strokesRef.current = next; setStrokes(next); }

  function add() {
    redraw(); const element = canvas.current; if (!element) return;
    element.toBlob((blob) => { if (!blob) return; onAdd(new File([blob], `スケッチ-${Date.now()}.png`, { type: "image/png" })); }, "image/png");
  }

  return <div className="modal-backdrop quick-sketch-backdrop" role="dialog" aria-modal="true" aria-label="クイックスケッチ">
    <div className="modal quick-sketch-modal">
      <div className="modal-title"><h2>スケッチ</h2><button type="button" onClick={onClose} aria-label="閉じる">×</button></div>
      <div className="quick-sketch-tools">
        <button type="button" className={tool === "pen" ? "active" : ""} onClick={() => setTool("pen")}>ペン</button>
        <button type="button" className={tool === "eraser" ? "active" : ""} onClick={() => setTool("eraser")}>消しゴム</button>
        <label aria-label="線の色"><input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
        <label className="quick-sketch-width"><span>太さ</span><input type="range" min="1" max="28" value={width} onChange={(event) => setWidth(Number(event.target.value))} /></label>
      </div>
      <canvas className="quick-sketch-canvas" ref={canvas} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      <div className="quick-sketch-actions"><button type="button" disabled={!strokes.length} onClick={() => setStrokes((current) => current.slice(0, -1))}>元に戻す</button><button type="button" disabled={!strokes.length} onClick={() => setStrokes([])}>全消去</button><button type="button" className="primary" disabled={!strokes.length} onClick={add}>追加</button></div>
    </div>
  </div>;
}
