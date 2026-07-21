import { useMemo, useRef, useState } from "react";
import { buildGptPrompt, copyToClipboard, GPT_REQUEST_OPTIONS, type AppSettings, type GptRequestId } from "../settings";

export interface CopyPhrase { id: string; text: string; }

export function GptCopySheet({ phrases, initialIds, settings, onClose, notify }: {
  phrases: CopyPhrase[];
  initialIds: string[];
  settings: AppSettings;
  onClose(): void;
  notify(message: string): void;
}) {
  const available = phrases.filter((item) => item.text.trim());
  const phrase = available.find((item) => initialIds.includes(item.id)) ?? available[0];
  const [requests, setRequests] = useState<GptRequestId[]>(settings.gptDefaultRequests);
  const [manualCopy, setManualCopy] = useState(false);
  const previewRef = useRef<HTMLTextAreaElement>(null);
  const prompt = useMemo(() => buildGptPrompt(phrase ? [phrase.text] : [], requests, settings.gptSuggestionCount), [phrase, requests, settings.gptSuggestionCount]);

  function toggleRequest(id: GptRequestId) {
    setRequests((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function copy() {
    if (!phrase || !requests.length) return;
    if (await copyToClipboard(prompt)) { notify("GPT用の文章をコピーしました"); onClose(); return; }
    setManualCopy(true);
    requestAnimationFrame(() => { previewRef.current?.focus(); previewRef.current?.select(); });
    notify("コピーできませんでした。文章を長押ししてコピーしてください。");
  }

  return <div className="sheet-backdrop" role="presentation"><section className="copy-sheet" role="dialog" aria-modal="true" aria-labelledby="gpt-copy-title">
    <div className="sheet-handle" aria-hidden="true" />
    <div className="modal-title"><h2 id="gpt-copy-title">GPTへの依頼を作成</h2><button onClick={onClose} aria-label="閉じる">×</button></div>
    {phrase && <div className="copy-source"><span>対象のメモ</span><p>{phrase.text}</p></div>}
    <fieldset><legend>依頼内容</legend><div className="check-list compact">{GPT_REQUEST_OPTIONS.map((item) => <label key={item.id}><input type="checkbox" checked={requests.includes(item.id)} onChange={() => toggleRequest(item.id)} /><span>{item.label}</span></label>)}</div></fieldset>
    {(settings.gptConfirmBeforeCopy || manualCopy) && <label className="prompt-preview"><span>完成した文章</span><textarea ref={previewRef} readOnly value={prompt} rows={9} /></label>}
    <button className="primary full" disabled={!phrase || !requests.length} onClick={() => void copy()}>全文をコピー</button>
  </section></div>;
}
