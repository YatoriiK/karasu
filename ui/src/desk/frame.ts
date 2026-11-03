import { createContext, useContext } from "react";

export const FrameContext = createContext({ titled: false });

export const useFrame = () => useContext(FrameContext);
