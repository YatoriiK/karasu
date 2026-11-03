import { useState } from "react";
import { motion } from "motion/react";
import { Check, Cpu, FolderOpen, Loader2, RotateCw } from "lucide-react";
import { Button } from "../components/ui/Button";
import { cn } from "../components/ui/cn";
import { gigabytes, pickFolder, setEngineHome, type EngineInfo, type InstallProgress } from "../lib/engine";

const STEPS = ["Getting the installer", "Downloading Python", "Installing PyTorch", "Installing Karasu's engine", "Downloading the audio model"];

function Card({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, duration: 0.45 }}
      className="mt-8 w-[min(560px,calc(100vw-32px))] rounded-2xl bg-bg-2/80 p-6 text-left hairline"
    >
      {children}
    </motion.div>
  );
}

export function ChooseHome({ info, onInstall }: { info: EngineInfo; onInstall: (info: EngineInfo) => void }) {
  const [path, setPath] = useState(info.home ?? info.default_home);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [free, setFree] = useState(info.free_bytes);
  const short = free != null && free < info.needs_bytes;

  const change = async () => {
    try {
      const picked = await pickFolder(path);
      if (picked) {
        setPath(/^[a-z]:[\\/]?$/i.test(picked) ? `${picked.slice(0, 2)}\\Karasu` : picked);
        setFree(null);
        setError(null);
      }
    } catch (e) {
      setError(String(e));
    }
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await setEngineHome(path);
      setFree(next.free_bytes);
      if (next.free_bytes != null && next.free_bytes < next.needs_bytes) {
        setError(`That drive has ${gigabytes(next.free_bytes)} free. Karasu needs about ${gigabytes(next.needs_bytes)}. Pick a folder on another drive.`);
        return;
      }
      onInstall(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h2 className="text-lg font-semibold tracking-[-0.01em] text-fg-0">Set up Karasu's engine</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-fg-2">
        Karasu listens to music with an audio model that runs on your PC. This one-time setup downloads Python, PyTorch and the model, about{" "}
        {gigabytes(info.needs_bytes)} in total, into one folder. Nothing else on your system changes, and deleting the folder removes it all.
      </p>
      <div className="mt-5 text-2xs font-semibold uppercase tracking-[0.14em] text-fg-3">Folder</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <div className="flex h-10 min-w-0 flex-1 basis-[260px] items-center rounded-xl bg-bg-1 px-3.5 hairline" data-engine-home>
          <span className="selectable truncate font-mono text-[13px] text-fg-0" title={path}>
            {path}
          </span>
        </div>
        <Button size="sm" variant="secondary" icon={<FolderOpen size={14} />} onClick={() => void change()} disabled={busy}>
          Change…
        </Button>
      </div>
      <div className="mt-3 space-y-1.5 text-[13px] text-fg-2">
        <div className={cn(short && "text-bad")}>
          {free != null ? `${gigabytes(free)} free on that drive` : "Free space is checked when you start"}
        </div>
        <div className="flex items-center gap-1.5">
          <Cpu size={13} className="shrink-0 text-fg-3" />
          {info.gpu ? "NVIDIA graphics card found. Karasu will use it." : "No NVIDIA card found. Karasu runs on the processor, so the first scan is slower."}
        </div>
      </div>
      {error && <p className="selectable mt-3 whitespace-pre-wrap text-[12.5px] text-bad">{error}</p>}
      <div className="mt-6 flex justify-end">
        <Button variant="primary" onClick={() => void start()} disabled={busy} icon={busy ? <Loader2 size={15} className="animate-spin" /> : undefined}>
          Install engine
        </Button>
      </div>
    </Card>
  );
}

export function Installing({ progress, error, info, onRetry }: { progress: InstallProgress | null; error: string | null; info: EngineInfo | null; onRetry: () => void }) {
  const current = progress?.step ?? 0;
  return (
    <Card>
      <h2 className="text-lg font-semibold tracking-[-0.01em] text-fg-0">{error ? "Setup stopped" : "Setting up Karasu's engine"}</h2>
      <p className="mt-1.5 text-sm text-fg-2">
        {error ? "Nothing is lost. Fix the problem below, or just try again." : "This takes a few minutes, longer on a slow connection. Leave Karasu open."}
      </p>
      <ol className="mt-5 space-y-2.5" data-install-step={current}>
        {STEPS.map((label, i) => {
          const n = i + 1;
          const done = n < current || (!error && progress?.stage === "done");
          const active = n === current && !done;
          return (
            <li key={label} className={cn("flex items-center gap-3 text-[13.5px]", done ? "text-fg-2" : active ? "text-fg-0" : "text-fg-3")}>
              <span
                className={cn(
                  "grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold",
                  done ? "bg-good/15 text-good" : active ? (error ? "bg-bad/15 text-bad" : "bg-fg-0 text-bg-0") : "bg-fg-0/[0.06]",
                )}
              >
                {done ? <Check size={13} /> : active && !error ? <Loader2 size={13} className="animate-spin" /> : n}
              </span>
              {active && progress?.label ? progress.label : label}
            </li>
          );
        })}
      </ol>
      {!error && progress?.detail && (
        <div className="mt-4 truncate rounded-md bg-bg-1 px-3 py-2 font-mono text-[11.5px] text-fg-2 hairline" title={progress.detail}>
          {progress.detail}
        </div>
      )}
      {error && (
        <>
          <pre className="selectable mt-4 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-bg-1 p-3 font-mono text-[11.5px] leading-relaxed text-fg-1 hairline">
            {error}
          </pre>
          {info?.log && <p className="mt-2 text-[12px] text-fg-3">Full log: {info.log}\install.log</p>}
          <div className="mt-5 flex justify-end">
            <Button variant="primary" icon={<RotateCw size={14} />} onClick={onRetry}>
              Try again
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
