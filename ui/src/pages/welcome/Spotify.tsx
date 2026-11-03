import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../lib/api";
import { openExternal } from "../../lib/tauri";
import type { SetupState } from "../../lib/types";
import { checkSpotify } from "../../hooks/useSpotifyBackground";
import { Button } from "../../components/ui/Button";
import { B, CopyField, Item, JobProgress, Nav, OpenButton, Steps, StepTitle } from "./ui";

const DASHBOARD = "https://developer.spotify.com/dashboard";
const CLIENT_ID = /^[0-9a-f]{32}$/;

function ClientIdForm({ initial, onSaved }: { initial: string; onSaved: () => void }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const clean = value.replace(/\s+/g, "").toLowerCase();
  const valid = CLIENT_ID.test(clean);

  const save = async () => {
    if (!valid) {
      setError("A Client ID is 32 letters and numbers. Copy it from your app's page in the dashboard.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      qc.setQueryData(["setup"], await api.setClientId(clean));
      qc.invalidateQueries({ queryKey: ["spotify-status"] });
      qc.invalidateQueries({ queryKey: ["health"] });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="pt-1"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="flex flex-wrap gap-2">
        <div className="flex h-11 min-w-0 flex-1 basis-[260px] items-center gap-2 rounded-xl bg-bg-2 px-3.5 hairline focus-within:shadow-[inset_0_0_0_1px_var(--accent)]">
          <input
            aria-label="Client ID"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            placeholder="Paste your Client ID"
            spellCheck={false}
            autoComplete="off"
            className="h-full min-w-0 flex-1 bg-transparent font-mono text-[13.5px] text-fg-0 outline-none placeholder:font-sans placeholder:text-fg-3"
          />
          {valid && <Check size={15} className="shrink-0 text-good" />}
        </div>
        <Button type="submit" variant="primary" disabled={busy || !clean} icon={busy ? <Loader2 size={15} className="animate-spin" /> : undefined}>
          Save and continue
        </Button>
      </div>
      {error && <p className="mt-2 text-[12.5px] text-bad">{error}</p>}
    </form>
  );
}

export function KeyStep({ setup, onNext, onBack }: { setup: SetupState; onNext: () => void; onBack: () => void }) {
  return (
    <div>
      <StepTitle
        kicker="Spotify · step 1 of 3"
        title="Make your Spotify key"
        lead="Spotify only lets apps like Karasu in through a developer app that belongs to you. It's free, takes about two minutes, and you only do it once."
      />
      <Steps>
        <Item n={1} title="Open Spotify's developer dashboard">
          <p>Log in with your Premium account. If Spotify asks, accept the developer terms.</p>
          <OpenButton href={DASHBOARD}>Open the dashboard</OpenButton>
        </Item>
        <Item n={2} title={<>Press <B>Create app</B> and fill in the form</>}>
          <div className="grid gap-3">
            <CopyField label="App name" value="Karasu" />
            <CopyField label="App description" value="My Karasu app" note="Anything works here." />
            <CopyField
              label="Redirect URI"
              value={setup.redirect_uri}
              strong
              note={<>Paste it exactly, then press <B>Add</B>. A single wrong character stops the sign-in.</>}
            />
          </div>
          <p>
            Under “Which API/SDKs are you planning to use?”, tick <B>Web API</B>. Tick the terms box, then press <B>Save</B>.
          </p>
        </Item>
        <Item n={3} title={<>Copy your <B>Client ID</B> here</>}>
          <p>It's on your new app's page: 32 letters and numbers.</p>
          <ClientIdForm initial={setup.client_id} onSaved={onNext} />
        </Item>
      </Steps>
      <p className="mt-5 text-[12.5px] leading-relaxed text-fg-3">
        Karasu never sees your Spotify password. The Client ID isn't a secret; it only tells Spotify which app is asking.
      </p>
      <Nav
        back={onBack}
        next={
          setup.spotify.configured && (
            <Button variant="ghost" onClick={onNext}>
              Skip, my key is saved <ArrowRight size={15} />
            </Button>
          )
        }
      />
    </div>
  );
}

function explain(error: string) {
  if (/timed out/i.test(error)) return "Spotify didn't answer within 5 minutes. Press Connect to try again.";
  if (/access_denied/i.test(error)) return "You pressed Cancel on Spotify's page. Press Connect to try again.";
  return error;
}

export function ConnectStep({ setup, onNext, onBack }: { setup: SetupState; onNext: () => void; onBack: () => void }) {
  const qc = useQueryClient();
  const asked = useRef(false);
  const [starting, setStarting] = useState(false);
  const { data: status, refetch } = useQuery({
    queryKey: ["spotify-status"],
    queryFn: api.spotifyStatus,
    refetchInterval: (query) => (query.state.data?.login_running ? 1500 : false),
  });
  const connected = !!status?.logged_in;
  const waiting = starting || !!status?.login_running;
  const user = status?.user ?? setup.spotify.user;

  useEffect(() => {
    if (!connected) return;
    void checkSpotify();
    qc.invalidateQueries({ queryKey: ["setup"] });
    qc.invalidateQueries({ queryKey: ["health"] });
  }, [connected, qc]);

  useEffect(() => {
    if (!connected || setup.synced || asked.current) return;
    asked.current = true;
    api
      .setupSync()
      .then(() => qc.invalidateQueries({ queryKey: ["setup"] }))
      .catch((e) => toast("Couldn't start reading your library", { description: (e as Error).message }));
  }, [connected, setup.synced, qc]);

  const connect = async () => {
    setStarting(true);
    try {
      await api.spotifyLogin();
    } catch (e) {
      toast("Couldn't start the Spotify sign-in", { description: (e as Error).message });
    } finally {
      setStarting(false);
      void refetch();
    }
  };

  return (
    <div>
      <StepTitle
        kicker="Spotify · step 2 of 3"
        title="Connect your account"
        lead="Karasu opens Spotify's sign-in page in your browser. Sign in, press Agree, then come back here."
      />
      <div className="mt-8 rounded-2xl bg-bg-2/70 p-6 hairline">
        {!setup.spotify.configured ? (
          <p className="text-[14px] text-fg-2">Save your Client ID first, then come back to this step.</p>
        ) : connected ? (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-4" data-connected>
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-good/20 text-good">
                <Check size={18} />
              </span>
              <div>
                <div className="text-[15px] font-semibold text-fg-0">Connected{user?.name ? ` as ${user.name}` : ""}</div>
                <div className="text-[13px] text-fg-2">Karasu is reading your liked songs, playlists and top artists.</div>
              </div>
            </div>
            {user?.product && user.product !== "premium" && (
              <p className="rounded-lg bg-bad/10 px-3 py-2 text-[13px] text-fg-1">
                Spotify says this account isn't Premium. Full songs and some library features need Premium; previews still work.
              </p>
            )}
            <JobProgress job={setup.job} note="You can keep going. This finishes in the background." />
          </motion.div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" size="lg" onClick={connect} disabled={waiting}>
                {waiting ? <Loader2 size={16} className="animate-spin" /> : null}
                {waiting ? "Waiting for Spotify…" : "Connect Spotify"}
              </Button>
              {status?.login_running && status.login_url && (
                <button onClick={() => openExternal(status.login_url!)} className="text-[13px] text-fg-2 underline-offset-4 hover:text-fg-0 hover:underline">
                  Browser didn't open? Open the sign-in page
                </button>
              )}
            </div>
            {status?.login_running && <p className="text-[13.5px] text-fg-2">Finish signing in in your browser. This page updates on its own.</p>}
            {status?.login_error && !status.login_running && (
              <p className="rounded-lg bg-bad/10 px-3 py-2 text-[13px] text-fg-1" data-login-error>
                {explain(status.login_error)}
              </p>
            )}
            <div className="border-t border-line pt-4 text-[13px] leading-relaxed text-fg-2">
              <div className="font-medium text-fg-1">If Spotify shows an error</div>
              <ul className="mt-1.5 list-disc space-y-1 pl-5">
                <li>
                  <B>Invalid redirect URI</B>: open your app's settings in the dashboard and make sure the Redirect URI is exactly{" "}
                  <code className="selectable font-mono text-fg-1">{setup.redirect_uri}</code>, then save and press Connect again.
                </li>
                <li>
                  Anything about <B>Premium</B> or a user that isn't registered: sign in with the same Premium account you made the app with.
                </li>
              </ul>
            </div>
          </div>
        )}
      </div>
      <Nav
        back={onBack}
        next={
          <Button variant={connected ? "primary" : "ghost"} onClick={onNext} disabled={!connected}>
            Continue <ArrowRight size={15} />
          </Button>
        }
      />
    </div>
  );
}
