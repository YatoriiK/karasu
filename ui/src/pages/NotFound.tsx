import { Link } from "react-router";
import { Disc3 } from "lucide-react";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/states";

export function NotFound() {
  return (
    <EmptyState
      icon={<Disc3 size={22} />}
      title="This page skipped"
      body="It doesn't exist — or it moved."
      action={
        <Link to="/">
          <Button variant="secondary">Back home</Button>
        </Link>
      }
    />
  );
}
