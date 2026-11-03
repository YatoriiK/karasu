import { useEffect } from "react";
import { useDesk } from "../desk/store";
import { bindDeskLooks, useLook } from "./look";

export function useDeskLooks() {
  const ready = useDesk((s) => s.ready);
  const activeId = useDesk((s) => s.activeId);
  const deskLook = useDesk((s) => s.layouts.find((l) => l.id === s.activeId)?.data.look ?? null);
  useEffect(() => {
    bindDeskLooks((id, look) => useDesk.getState().setDeskLook(id, look));
    return () => bindDeskLooks(null);
  }, []);
  useEffect(() => {
    if (ready) useLook.getState().show(deskLook ? activeId : null, deskLook);
  }, [ready, activeId, deskLook]);
}

export function useDeskLookState() {
  const layout = useDesk((s) => s.layouts.find((l) => l.id === s.activeId));
  return { layout, own: !!layout?.data.look };
}

export function giveOwnLook(id: number) {
  const desk = useDesk.getState();
  const layout = desk.layouts.find((l) => l.id === id);
  if (!layout || layout.data.look) return;
  const shared = useLook.getState().shared;
  const look = layout.data.wallpaper ? { ...shared, wallpaper: layout.data.wallpaper } : shared;
  desk.setDeskLook(id, look, null);
  if (desk.activeId === id) useLook.getState().show(id, look);
}

export function dropOwnLook(id: number) {
  const desk = useDesk.getState();
  desk.setDeskLook(id, null);
  if (desk.activeId === id) useLook.getState().show(null, null);
}

export function shareDeskLook() {
  useLook.getState().share();
}
