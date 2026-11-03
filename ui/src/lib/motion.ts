import type { Transition, Variants } from "motion/react";

export const EASE = [0.16, 1, 0.3, 1] as const;
export const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const;

export const DUR = { fast: 0.12, base: 0.2, slow: 0.32, slower: 0.48 } as const;

export const SPRING = {
  snappy: { type: "spring", stiffness: 520, damping: 38, mass: 0.8 } as Transition,
  soft: { type: "spring", stiffness: 260, damping: 30, mass: 1 } as Transition,
  pop: { type: "spring", stiffness: 700, damping: 22, mass: 0.6 } as Transition,
};

export const ease = (duration: number = DUR.slow): Transition => ({ duration, ease: EASE });

export const page: Variants = {
  initial: { opacity: 0, y: 10, filter: "blur(4px)" },
  enter: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: DUR.slower, ease: EASE } },
  exit: { opacity: 0, y: -6, filter: "blur(2px)", transition: { duration: DUR.base, ease: EASE_IN_OUT } },
};

export const listParent: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.03, delayChildren: 0.04 } },
};

export const listItem: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: DUR.slow, ease: EASE } },
};

export const STAGGER_CAP = 12;
