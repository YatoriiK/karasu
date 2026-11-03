import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useScrollElement } from "../../app/scroll";

export function VirtualList<T>({
  items,
  estimate,
  render,
  getKey,
  onEnd,
  overscan = 10,
}: {
  items: T[];
  estimate: (item: T) => number;
  render: (item: T, index: number) => ReactNode;
  getKey: (item: T, index: number) => string;
  onEnd?: () => void;
  overscan?: number;
}) {
  const scroller = useScrollElement();
  const listRef = useRef<HTMLDivElement>(null);
  const [margin, setMargin] = useState(0);

  useLayoutEffect(() => {
    const measure = () => {
      const el = listRef.current;
      const sc = scroller.current;
      if (!el || !sc) return;
      setMargin(Math.round(el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop));
    };
    measure();
    const timer = window.setTimeout(measure, 600);
    const ro = new ResizeObserver(measure);
    if (listRef.current?.parentElement) ro.observe(listRef.current.parentElement);
    return () => {
      window.clearTimeout(timer);
      ro.disconnect();
    };
  }, [scroller]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scroller.current,
    estimateSize: (i) => estimate(items[i]),
    overscan,
    scrollMargin: margin,
    getItemKey: (i) => getKey(items[i], i),
  });
  const rows = virtualizer.getVirtualItems();
  const last = rows.length ? rows[rows.length - 1].index : -1;

  useEffect(() => {
    if (onEnd && last >= 0 && last >= items.length - 20) onEnd();
  }, [last, items.length, onEnd]);

  return (
    <div ref={listRef} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
      {rows.map((row) => (
        <div
          key={row.key}
          data-index={row.index}
          ref={virtualizer.measureElement}
          className="absolute left-0 top-0 w-full"
          style={{ transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)` }}
        >
          {render(items[row.index], row.index)}
        </div>
      ))}
    </div>
  );
}
