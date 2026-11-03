import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@fontsource/shippori-mincho/400.css";
import "@fontsource/shippori-mincho/700.css";
import "@fontsource/yuji-syuku/400.css";
import "@fontsource/zen-kaku-gothic-new/400.css";
import "@fontsource/zen-kaku-gothic-new/700.css";
import "@fontsource/dotgothic16/400.css";
import "./styles/index.css";
import { App } from "./app/App";
import { TooltipProvider } from "./components/ui/Tooltip";
import { usePrefs } from "./store/prefs";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

function Root() {
  const motion = usePrefs((s) => s.motion);
  return (
    <MotionConfig reducedMotion={motion === "full" ? "user" : "always"}>
      <div data-motion={motion} className="h-full">
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </div>
    </MotionConfig>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <Root />
      </HashRouter>
    </QueryClientProvider>
  </StrictMode>,
);
