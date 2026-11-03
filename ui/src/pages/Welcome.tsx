import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import type { SetupPath, SetupState } from "../lib/types";
import { useScrollElement } from "../app/scroll";
import { Button } from "../components/ui/Button";
import { ErrorState, Logo, Skeleton } from "../components/ui/states";
import { cn } from "../components/ui/cn";
import { ArtistsStep } from "./welcome/Artists";
import { HistoryStep } from "./welcome/History";
import { ConnectStep, KeyStep } from "./welcome/Spotify";

type Step = "choose" | "key" | "connect" | "artists" | "history";

const STEPS: Step[] = ["choose", "key", "connect", "artists", "history"];

const RAILS: Record<"premium" | "free", [Step, string][]> = {
  premium: [
    ["key", "Your Spotify key"],
    ["connect", "Connect"],
    ["history", "Full history"],
  ],
  free: [
    ["artists", "Artists you love"],
    ["history", "Full history"],
  ],
};

function Rail({ path, step }: { path: "premium" | "free"; step: Step }) {
  const rail = RAILS[path];
  const at = rail.findIndex(([s]) => s === step);
  return (
    <ol className="flex flex-wrap items-center gap-x-3 gap-y-2" aria-label="Setup steps">
      {rail.map(([s, label], i) => (
        <li key={s} className="flex items-center gap-3">
          {i > 0 && <span className="h-px w-6 bg-fg-0/20" />}
          <span className={cn("flex items-center gap-2 text-[12.5px]", i === at ? "text-fg-0" : i < at ? "text-fg-2" : "text-fg-3")}>
            <span
              className={cn(
                "grid h-5 w-5 place-items-center rounded-full font-mono text-[10.5px] font-semibold",
                i < at ? "bg-good/20 text-good" : i === at ? "bg-fg-0 text-bg-0" : "bg-bg-3 text-fg-2",
              )}
            >
              {i < at ? <Check size={11} /> : i + 1}
            </span>
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Choice({ title, body, meta, onClick, testid }: { title: string; body: string; meta: string; onClick: () => void; testid: string }) {
  return (
    <motion.button
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.99 }}
      transition={{ type: "spring", stiffness: 500, damping: 32 }}
      onClick={onClick}
      data-choice={testid}
      className="group flex flex-col rounded-2xl bg-bg-2/70 p-6 text-left hairline transition-colors hover:bg-bg-3/70"
    >
      <span className="text-[17px] font-semibold tracking-[-0.01em] text-fg-0">{title}</span>
      <span className="mt-2 flex-1 text-[14px] leading-relaxed text-fg-2">{body}</span>
      <span className="mt-5 flex items-center justify-between font-mono text-[11.5px] uppercase tracking-[0.12em] text-fg-3">
        {meta}
        <ArrowRight size={16} className="text-fg-2 transition-transform group-hover:translate-x-1" />
      </span>
    </motion.button>
  );
}

function ChooseStep({ setup, go, skip }: { setup: SetupState; go: (step: Step, path?: SetupPath) => void; skip: () => void }) {
  const connected = setup.spotify.logged_in;
  return (
    <div>
      <div className="flex items-center gap-4">
        <Logo size={52} />
        <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-fg-3">Set up · ようこそ</div>
      </div>
      <h1 className="mt-6 text-[34px] font-bold leading-tight tracking-[-0.03em] md:text-[40px]">Welcome to Karasu</h1>
      <p className="mt-3 max-w-[600px] text-[15px] leading-relaxed text-fg-2">
        Karasu finds music you'll love and haven't heard yet. First, tell it how you listen.
      </p>
      {connected && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-good/10 p-4 hairline" data-already>
          <span className="text-[14px] text-fg-1">
            Spotify is already connected{setup.spotify.user?.name ? ` as ${setup.spotify.user.name}` : ""}.
          </span>
          <Button size="sm" variant="secondary" onClick={() => go("history", "premium")}>
            Get your full history
          </Button>
        </div>
      )}
      <div className="mt-8 grid gap-3 md:grid-cols-2">
        <Choice
          testid="premium"
          title="I have Spotify Premium"
          body="Connect your account. Karasu reads your liked songs, playlists and top artists in seconds, and plays full songs in your Spotify app."
          meta="About 3 minutes"
          onClick={() => go("key", "premium")}
        />
        <Choice
          testid="free"
          title="No Premium, or I'd rather not connect"
          body="Pick a few artists you love. Karasu learns your taste from there and plays 30-second previews right here."
          meta="About a minute"
          onClick={() => go("artists", "free")}
        />
      </div>
      <button onClick={skip} className="mt-6 text-[13px] text-fg-3 underline-offset-4 hover:text-fg-1 hover:underline" data-skip>
        Skip for now. You can open this guide again from Settings.
      </button>
    </div>
  );
}

export function WelcomePage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const scroller = useScrollElement();
  const { data: setup, error, refetch } = useQuery({ queryKey: ["setup"], queryFn: api.setup });
  const raw = params.get("step") as Step | null;
  const step: Step = raw && STEPS.includes(raw) ? raw : "choose";
  const chosen = params.get("path");
  const path: "premium" | "free" =
    step === "artists" ? "free" : step === "key" || step === "connect" ? "premium" : chosen === "free" || chosen === "premium" ? chosen : setup?.path === "free" ? "free" : "premium";

  const go = (next: Step, nextPath?: SetupPath) => {
    setParams({ step: next, path: nextPath ?? path });
    scroller.current?.scrollTo({ top: 0 });
  };

  const close = async (body: { path?: SetupPath; history_requested?: boolean }, message: string) => {
    try {
      qc.setQueryData(["setup"], await api.finishSetup(body));
    } catch (e) {
      toast("Couldn't save that", { description: (e as Error).message });
      return;
    }
    qc.invalidateQueries({ queryKey: ["home"] });
    navigate("/");
    toast(message);
  };

  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  if (!setup) {
    return (
      <div className="mx-auto max-w-[760px] pt-6">
        <Skeleton className="h-12 w-12 rounded-md" />
        <Skeleton className="mt-6 h-10 w-80" />
        <div className="mt-8 grid gap-3 md:grid-cols-2">
          <Skeleton className="h-44 rounded-2xl" />
          <Skeleton className="h-44 rounded-2xl" />
        </div>
      </div>
    );
  }

  const kicker = path === "free" ? "Your taste · step 2 of 2" : "Spotify · step 3 of 3";

  return (
    <div className="mx-auto max-w-[760px] pt-2 md:pt-6" data-welcome={step}>
      {step !== "choose" && (
        <div className="mb-8">
          <Rail path={path} step={step} />
        </div>
      )}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        >
          {step === "choose" && <ChooseStep setup={setup} go={go} skip={() => close({ path: "skip" }, "You can set things up any time from Settings")} />}
          {step === "key" && <KeyStep setup={setup} onBack={() => go("choose")} onNext={() => go("connect")} />}
          {step === "connect" && <ConnectStep setup={setup} onBack={() => go("key")} onNext={() => go("history")} />}
          {step === "artists" && <ArtistsStep setup={setup} onBack={() => go("choose")} onNext={() => go("history")} />}
          {step === "history" && (
            <HistoryStep
              setup={setup}
              kicker={kicker}
              onBack={() => go(path === "free" ? "artists" : "connect")}
              onFinish={(requested) => close({ path, history_requested: requested }, "Karasu is ready")}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
