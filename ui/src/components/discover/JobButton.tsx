import { useEffect, useState } from "react";
import { Shovel } from "lucide-react";
import { toast } from "sonner";
import { useJob } from "../../lib/events";
import { Button } from "../ui/Button";

export function JobButton({
  label,
  start,
  onDone,
  disabled,
}: {
  label: string;
  start: () => Promise<{ job: string }>;
  onDone: () => void;
  disabled?: boolean;
}) {
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useJob(jobId);
  useEffect(() => {
    if (!job?.finished) return;
    if (job.status === "done") {
      const added = (job.result as { added?: number } | undefined)?.added;
      toast(added ? `Found ${added} new songs to consider` : "Dug deeper — refreshed your results");
      onDone();
    } else if (job.status === "error") {
      toast("Digging failed", { description: job.error });
    }
    setJobId(null);
  }, [job?.finished]);
  const running = !!jobId;
  const pct = job?.total ? Math.round(((job.done ?? 0) / job.total) * 100) : null;
  return (
    <Button
      variant="secondary"
      icon={<Shovel size={16} className={running ? "animate-bounce" : undefined} />}
      disabled={disabled || running}
      onClick={async () => {
        try {
          const res = await start();
          setJobId(res.job);
        } catch (e) {
          toast("Couldn't dig deeper", { description: (e as Error).message });
        }
      }}
    >
      {running ? `${job?.stage ?? "Digging"}${pct != null ? ` · ${pct}%` : "…"}` : label}
    </Button>
  );
}
