import { createContext, useContext, type RefObject } from "react";

export const ScrollContext = createContext<RefObject<HTMLDivElement | null>>({ current: null });

export const useScrollElement = () => useContext(ScrollContext);
