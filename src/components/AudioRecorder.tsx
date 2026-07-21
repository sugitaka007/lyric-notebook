import { useEffect, useRef, useState } from "react";

type Props = {
  onRecorded(file: File, durationSeconds: number): void | Promise<void>;
  notify(message: string): void;
  resetKey?: number;
  showPreview?: boolean;
};

const supportedMimeType = () => ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type));

export function AudioRecorder({ onRecorded, notify, resetKey, showPreview = true }: Props) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [preview, setPreview] = useState<File>();
  const [previewUrl, setPreviewUrl] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const recorder = useRef<MediaRecorder | undefined>(undefined);
  const stream = useRef<MediaStream | undefined>(undefined);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const animation = useRef<number | undefined>(undefined);
  const audioContext = useRef<AudioContext | undefined>(undefined);
  const analyser = useRef<AnalyserNode | undefined>(undefined);
  const elapsed = useRef(0);

  useEffect(() => {
    if (!preview) { setPreviewUrl(""); return; }
    const url = URL.createObjectURL(preview); setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [preview]);

  useEffect(() => { setPreview(undefined); }, [resetKey]);

  useEffect(() => () => cleanup(), []);

  function cleanup() {
    if (timer.current) clearInterval(timer.current);
    if (animation.current) cancelAnimationFrame(animation.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    void audioContext.current?.close().catch(() => undefined);
    timer.current = undefined; animation.current = undefined; stream.current = undefined;
    audioContext.current = undefined; analyser.current = undefined;
  }

  function drawWaveform() {
    const element = canvas.current; const meter = analyser.current;
    if (!element || !meter) return;
    const rect = element.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const width = Math.max(1, Math.round(rect.width * dpr)); const height = Math.max(1, Math.round(rect.height * dpr));
    if (element.width !== width || element.height !== height) { element.width = width; element.height = height; }
    const context = element.getContext("2d"); if (!context) return;
    const values = new Uint8Array(meter.frequencyBinCount); meter.getByteFrequencyData(values);
    context.clearRect(0, 0, width, height);
    const styles = getComputedStyle(element); const color = styles.getPropertyValue("--accent").trim() || "#c89b23";
    const bars = 32; const gap = Math.max(2 * dpr, width * 0.004); const barWidth = (width - gap * (bars - 1)) / bars;
    context.fillStyle = color;
    for (let index = 0; index < bars; index += 1) {
      const start = Math.floor((index / bars) * values.length); const end = Math.max(start + 1, Math.floor(((index + 1) / bars) * values.length));
      let total = 0; for (let valueIndex = start; valueIndex < end; valueIndex += 1) total += values[valueIndex];
      const level = Math.max(0.06, total / (end - start) / 255); const barHeight = Math.max(2 * dpr, level * height * 0.92);
      context.fillRect(index * (barWidth + gap), (height - barHeight) / 2, barWidth, barHeight);
    }
    animation.current = requestAnimationFrame(drawWaveform);
  }

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { notify("この環境では直接録音できません。音声ファイルを追加してください。"); return; }
    try {
      const nextStream = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.current = nextStream;
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        const context = new AudioContextClass(); audioContext.current = context;
        const nextAnalyser = context.createAnalyser(); nextAnalyser.fftSize = 256; nextAnalyser.smoothingTimeConstant = 0.72;
        context.createMediaStreamSource(nextStream).connect(nextAnalyser); analyser.current = nextAnalyser;
        if (context.state === "suspended") await context.resume();
      }
      const mime = supportedMimeType(); const next = mime ? new MediaRecorder(nextStream, { mimeType: mime }) : new MediaRecorder(nextStream);
      recorder.current = next; chunks.current = []; elapsed.current = 0; setSeconds(0); setPreview(undefined);
      next.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
      next.onstop = () => {
        const type = next.mimeType || chunks.current[0]?.type || "audio/webm"; const extension = type.includes("mp4") ? "m4a" : "webm";
        const file = new File([new Blob(chunks.current, { type })], `録音-${Date.now()}.${extension}`, { type });
        if (showPreview) setPreview(file); void onRecorded(file, elapsed.current); cleanup();
      };
      next.start(250); setRecording(true);
      timer.current = setInterval(() => { elapsed.current += 1; setSeconds(elapsed.current); }, 1000);
      requestAnimationFrame(drawWaveform);
    } catch (error) {
      cleanup();
      notify(error instanceof DOMException && error.name === "NotAllowedError" ? "マイクの使用を許可してください。" : "録音を開始できませんでした。");
    }
  }

  function stop() {
    if (recorder.current?.state === "recording") recorder.current.stop();
    setRecording(false); if (timer.current) clearInterval(timer.current);
  }

  return <div className="audio-recorder">
    {recording && <div className="recording-meter" aria-label="録音中の音量波形"><canvas ref={canvas} /><span>録音中 {seconds}秒</span></div>}
    <button type="button" className={recording ? "record-button recording" : "record-button"} onClick={recording ? stop : start}>{recording ? "録音を停止" : "音声録音"}</button>
    {showPreview && previewUrl && <div className="recording-preview"><span>録音を確認</span><audio controls preload="metadata" src={previewUrl} /></div>}
  </div>;
}
