import { useEffect, useState } from "react";

export function BlobImage({ blob, alt = "" }: { blob?: Blob; alt?: string }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); if (!(blob instanceof Blob) || !blob.size) { setUrl(""); return; } const next = URL.createObjectURL(blob); setUrl(next); return () => URL.revokeObjectURL(next); }, [blob]);
  return url && !failed ? <img src={url} alt={alt} onError={() => setFailed(true)} /> : <div className="image-placeholder">プレビューなし</div>;
}

export function BlobAudio({ blob, label = "音声" }: { blob?: Blob; label?: string }) {
  const [url, setUrl] = useState("");
  useEffect(() => { if (!(blob instanceof Blob) || !blob.size) { setUrl(""); return; } const next = URL.createObjectURL(blob); setUrl(next); return () => URL.revokeObjectURL(next); }, [blob]);
  return url ? <audio aria-label={label} controls preload="metadata" src={url} /> : <p>音声データがありません。</p>;
}

export function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <label className={`field ${wide ? "wide" : ""}`}><span>{label}</span>{children}</label>;
}
