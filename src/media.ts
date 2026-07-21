export async function compressImage(file: File, maxDimension = 2048): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("画像を読み込めませんでした。")); img.src = url;
    });
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    if (scale === 1 && file.size < 4_000_000) return file;
    const canvas = document.createElement("canvas"); canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
    canvas.getContext("2d", { alpha: false })?.drawImage(image, 0, 0, canvas.width, canvas.height);
    const mime = file.type === "image/png" && file.size < 5_000_000 ? "image/png" : "image/jpeg";
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("画像の縮小に失敗しました。")), mime, 0.9));
  } finally { URL.revokeObjectURL(url); }
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

export async function getAudioDuration(blob: Blob): Promise<number | undefined> {
  if (typeof Audio === "undefined") return undefined;
  const url = URL.createObjectURL(blob);
  try {
    const audio = new Audio(); audio.preload = "metadata"; audio.src = url;
    return await new Promise<number | undefined>((resolve) => {
      const done = (value?: number) => { audio.removeAttribute("src"); resolve(value && Number.isFinite(value) ? Math.round(value) : undefined); };
      audio.onloadedmetadata = () => done(audio.duration);
      audio.onerror = () => done();
      setTimeout(() => done(), 6000);
    });
  } finally { URL.revokeObjectURL(url); }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
