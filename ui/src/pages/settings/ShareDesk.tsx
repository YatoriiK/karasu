import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Download, Loader2, Plus, Upload } from "lucide-react";
import { toast } from "sonner";
import { api, type DeskPreview } from "../../lib/api";
import { useActiveLayout, useDesk } from "../../desk/store";
import { useLook } from "../../theme/look";
import { Button } from "../../components/ui/Button";
import { Toggle } from "../../components/ui/controls";
import { Row } from "./ui";

function size(bytes: number) {
  if (bytes > 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function save(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

export function ShareDesk() {
  const layout = useActiveLayout();
  const navigate = useNavigate();
  const file = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [reading, setReading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [found, setFound] = useState<DeskPreview | null>(null);
  const [useCss, setUseCss] = useState(false);

  const exportDesk = async () => {
    if (!layout) return;
    setExporting(true);
    try {
      const { blob, name } = await api.exportDesk(layout.id, useLook.getState().look);
      save(blob, name);
      toast(`Saved ${name}`, { description: "Send the file to a friend. In Karasu they press Import desk." });
    } catch (e) {
      toast("Couldn't export this desk", { description: (e as Error).message });
    } finally {
      setExporting(false);
    }
  };

  const read = async (picked: File | undefined) => {
    if (!picked) return;
    setReading(true);
    setFound(null);
    try {
      setFound(await api.previewDesk(picked));
      setUseCss(false);
    } catch (e) {
      toast("Couldn't open that desk", { description: (e as Error).message });
    } finally {
      setReading(false);
    }
  };

  const add = async () => {
    if (!found) return;
    setAdding(true);
    try {
      const made = await api.importDesk(found.token, useCss);
      await useDesk.getState().load();
      setFound(null);
      toast(`Added the desk “${made.name}”`, { action: { label: "Open it", onClick: () => navigate("/") } });
    } catch (e) {
      toast("Couldn't add that desk", { description: (e as Error).message });
    } finally {
      setAdding(false);
    }
  };

  return (
    <div data-share-desk>
      <Row
        label="Desk files"
        hint="Everything in one file: the look, every widget and sticker, and the pictures, GIFs and videos they use. Imports arrive as a new desk."
      >
        <Button
          size="sm"
          variant="secondary"
          disabled={!layout || exporting}
          icon={exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          onClick={() => void exportDesk()}
        >
          Export {layout ? `“${layout.name}”` : "desk"}
        </Button>
        <Button size="sm" variant="ghost" disabled={reading} icon={reading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} onClick={() => file.current?.click()}>
          Import desk
        </Button>
        <input
          ref={file}
          type="file"
          accept=".karasu,application/zip"
          hidden
          onChange={(e) => {
            const picked = e.target.files?.[0];
            e.target.value = "";
            void read(picked);
          }}
        />
      </Row>
      {found && (
        <div className="px-5 pb-4">
          <div className="rounded-xl bg-bg-1 p-3.5 hairline" data-desk-preview>
            <div className="text-[14px] font-medium text-fg-0">{found.name}</div>
            <div className="mt-0.5 text-[12.5px] text-fg-2">
              {found.widgets} {found.widgets === 1 ? "widget" : "widgets"} · {found.pictures} {found.pictures === 1 ? "picture" : "pictures"} · {size(found.bytes)}
            </div>
            {found.css && (
              <div className="mt-3 flex items-center justify-between gap-4">
                <div className="text-[12.5px] leading-relaxed text-fg-2">
                  It comes with custom CSS, which can change anything on screen. Only turn this on if you trust whoever sent it.
                </div>
                <Toggle checked={useCss} onChange={setUseCss} label="Use its custom CSS" />
              </div>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setFound(null)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" disabled={adding} icon={adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} onClick={() => void add()}>
                Add desk
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
