import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import type { SetupState } from "../../lib/types";
import { useJob } from "../../lib/events";
import { Button } from "../../components/ui/Button";
import { cn } from "../../components/ui/cn";
import { B, Item, Nav, OpenButton, Steps, StepTitle } from "./ui";

const PRIVACY = "https://www.spotify.com/account/privacy/";

export function HistoryStep({
  setup,
  kicker,
  onBack,
  onFinish,
}: {
  setup: SetupState;
  kicker: string;
  onBack?: () => void;
  onFinish: (requested: boolean) => Promise<void>;
}) {
  const [requested, setRequested] = useState(setup.history_requested);
  const [busy, setBusy] = useState(false);
  const live = useJob(setup.job?.id);
  const job = live ?? setup.job;
  const working = job && (job.status === "running" || job.status === "queued");

  return (
    <div>
      <StepTitle
        kicker={kicker}
        title="Get your full listening history"
        lead="Spotify only shares your last 50 plays with apps. Ask Spotify for a copy of everything you've ever played. It's free, it's your data, and it makes your stats and recommendations much sharper."
      />
      <Steps>
        <Item n={1} title="Open your Spotify privacy page">
          <p>Sign in if Spotify asks.</p>
          <OpenButton href={PRIVACY}>Open spotify.com/account/privacy</OpenButton>
        </Item>
        <Item n={2} title={<>Tick <B>Extended streaming history</B></>}>
          <p>
            Scroll down to <B>Download your data</B>. Tick <B>Extended streaming history</B>; the other boxes are optional.
          </p>
        </Item>
        <Item n={3} title="Request it and confirm the email">
          <p>Press the request button. Spotify emails you to confirm; open that email and confirm, or the request won't start.</p>
        </Item>
        <Item n={4} title="Import it when it arrives">
          <p>
            Spotify can take up to 30 days. When the email with your data arrives, download the ZIP and import it on the <B>Stats</B> page. No need to unzip it.
          </p>
        </Item>
      </Steps>

      <button
        onClick={() => setRequested((v) => !v)}
        aria-pressed={requested}
        className={cn(
          "mt-5 flex w-full items-center gap-3 rounded-2xl p-4 text-left hairline transition-colors",
          requested ? "bg-good/10" : "bg-bg-2/70 hover:bg-bg-3/70",
        )}
        data-requested={requested}
      >
        <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-md", requested ? "bg-good text-bg-0" : "bg-bg-4")}>
          {requested && <Check size={15} />}
        </span>
        <span className="text-[14px] font-medium text-fg-0">I've requested it</span>
        <span className="ml-auto text-[12.5px] text-fg-3">{requested ? "Nice. Karasu will be ready for it." : "You can also do this later."}</span>
      </button>

      {working && (
        <p className="mt-4 flex items-center gap-2 text-[13px] text-fg-2">
          <Loader2 size={14} className="animate-spin" />
          Still getting your music ready in the background{job?.stage ? `: ${job.stage.toLowerCase()}` : ""}.
        </p>
      )}

      <Nav
        back={onBack}
        next={
          <Button
            variant="primary"
            size="lg"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onFinish(requested);
              } finally {
                setBusy(false);
              }
            }}
          >
            Finish
          </Button>
        }
      />
    </div>
  );
}
