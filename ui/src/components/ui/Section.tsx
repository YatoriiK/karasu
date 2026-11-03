import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "react-router";
import { cn } from "./cn";
import { IconButton } from "./Button";
import { EASE } from "../../lib/motion";

export function Section({
  title,
  eyebrow,
  subtitle,
  action,
  href,
  children,
  className,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  href?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.55, ease: EASE }}
      className={cn("mb-11", className)}
    >
      <div className="mb-4 flex items-end justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && (
            <div className="mb-1 text-2xs font-semibold uppercase tracking-[0.14em] text-fg-3">{eyebrow}</div>
          )}
          <h2 className="truncate font-display text-[23px] font-bold tracking-[-0.01em] text-fg-0">{title}</h2>
          {subtitle && <p className="mt-0.5 truncate text-sm text-fg-2">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          {href && (
            <Link
              to={href}
              className="rounded-md px-2 py-1 text-[13px] font-semibold text-fg-2 transition-colors hover:text-fg-0"
            >
              Show all
            </Link>
          )}
        </div>
      </div>
      {children}
    </motion.section>
  );
}

export function Carousel({ children, gap = 16 }: { children: ReactNode; gap?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });

  const update = () => {
    const el = ref.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 8 });
  };

  useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const page = (dir: 1 | -1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.85, behavior: "smooth" });
  };

  return (
    <div className="group/carousel relative -mx-2">
      <div
        ref={ref}
        onScroll={update}
        className="no-scrollbar flex snap-x snap-mandatory scroll-px-2 overflow-x-auto px-2 pb-2 scroll-smooth"
        style={{
          gap,
          maskImage: `linear-gradient(90deg, ${edges.start ? "#000" : "transparent"} 0, #000 40px, #000 calc(100% - 40px), ${edges.end ? "#000" : "transparent"} 100%)`,
        }}
      >
        {children}
      </div>
      <div className="pointer-events-none absolute -top-14 right-2 flex gap-1 opacity-0 transition-opacity duration-300 group-hover/carousel:opacity-100">
        <IconButton
          label="Back"
          size="sm"
          round
          variant="secondary"
          className={cn("pointer-events-auto", edges.start && "opacity-30")}
          onClick={() => page(-1)}
        >
          <ChevronLeft size={16} />
        </IconButton>
        <IconButton
          label="Forward"
          size="sm"
          round
          variant="secondary"
          className={cn("pointer-events-auto", edges.end && "opacity-30")}
          onClick={() => page(1)}
        >
          <ChevronRight size={16} />
        </IconButton>
      </div>
    </div>
  );
}
