import { useState } from "react";
import { Copy, Loader2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { copyText } from "../../lib/clipboard";
import { useLook } from "../../theme/look";
import { codeToLook, lookToCode, mergeShared, type SharedLook } from "../../theme/shareCode";
import { Button } from "../../components/ui/Button";
import { Toggle } from "../../components/ui/controls";
import { Row } from "./ui";

export function ShareLook() {
  const [code, setCode] = useState("");
  const [found, setFound] = useState<SharedLook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [useCss, setUseCss] = useState(false);

  const copy = async () => {
    const text = await lookToCode(useLook.getState().look);
    if (await copyText(text)) toast("Look code copied", { description: "Paste it anywhere. Your pictures stay on your PC, only the settings are in the code." });
    else toast("Couldn't reach the clipboard");
  };

  const read = async (text: string) => {
    setCode(text);
    setFound(null);
    setError(null);
    if (!text.trim()) return;
    setBusy(true);
    try {
      setFound(await codeToLook(text));
      setUseCss(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!found) return;
    const store = useLook.getState();
    const before = store.look;
    store.replace(mergeShared(before, found, useCss));
    setCode("");
    setFound(null);
    toast("Look applied", { action: { label: "Undo", onClick: () => useLook.getState().replace(before) } });
  };

  return (
    <div data-share-look>
      <Row label="Share this look" hint="Copies a code with your colors, fonts, effects, weather and cursor style. Friends paste it below.">
        <Button size="sm" variant="secondary" icon={<Copy size={14} />} onClick={() => void copy()}>
          Copy code
        </Button>
      </Row>
      <div className="px-5 pb-4">
        <div className="text-[14px] font-medium text-fg-0">Use a look code</div>
        <div className="mt-0.5 text-[13px] leading-relaxed text-fg-2">Your own wallpaper, cursor pictures and button skins stay as they are.</div>
        <div className="mt-2.5 flex h-10 items-center rounded-xl bg-bg-1 px-3.5 hairline focus-within:shadow-[inset_0_0_0_1px_var(--accent)]">
          <input
            value={code}
            onChange={(e) => void read(e.target.value)}
            placeholder="Paste a KARASU-… code"
            spellCheck={false}
            autoComplete="off"
            aria-label="Look code"
            className="h-full min-w-0 flex-1 bg-transparent font-mono text-[12.5px] text-fg-0 outline-none placeholder:font-sans placeholder:text-fg-3"
          />
          {busy && <Loader2 size={14} className="shrink-0 animate-spin text-fg-3" />}
        </div>
        {error && <p className="mt-2 text-[12.5px] text-bad">{error}</p>}
        {found && (
          <div className="mt-3 rounded-xl bg-bg-1 p-3.5 hairline" data-share-preview>
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex gap-1" aria-hidden>
                {[found.look.paper, found.look.surface, found.look.ink, found.look.accent].map((c, i) => (
                  <i key={i} className="block h-5 w-5 rounded-full hairline" style={{ background: c }} />
                ))}
              </span>
              {found.summary.map((s) => (
                <span key={s} className="rounded-pill bg-bg-3 px-2.5 py-0.5 text-[12px] text-fg-1">
                  {s}
                </span>
              ))}
            </div>
            {found.css.trim() && (
              <div className="mt-3 flex items-center justify-between gap-4">
                <div className="text-[12.5px] leading-relaxed text-fg-2">
                  It comes with custom CSS, which can change anything on screen. Only turn this on if you trust whoever sent it.
                </div>
                <Toggle checked={useCss} onChange={setUseCss} label="Use its custom CSS" />
              </div>
            )}
            <div className="mt-3 flex justify-end">
              <Button size="sm" variant="primary" icon={<Wand2 size={14} />} onClick={apply}>
                Use this look
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
