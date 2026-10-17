"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

const MOBILE_QUERY = "(max-width: 640px)";

function subscribeMobile(callback: () => void) {
  const media = window.matchMedia(MOBILE_QUERY);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

function getMobileSnapshot() {
  return window.matchMedia(MOBILE_QUERY).matches;
}

export function useSidebarState(pathname: string) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpenAtPath, setMobileOpenAtPath] = useState<string | null>(null);
  const isMobile = useSyncExternalStore(subscribeMobile, getMobileSnapshot, () => false);
  const mobileOpen = isMobile && mobileOpenAtPath === pathname;

  useEffect(() => {
    if (!mobileOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileOpenAtPath(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [mobileOpen]);

  const toggle = () => {
    if (isMobile) {
      setMobileOpenAtPath(mobileOpen ? null : pathname);
      return;
    }
    setCollapsed((current) => !current);
  };

  return {
    isCompact: isMobile ? !mobileOpen : collapsed,
    isMobile,
    mobileOpen,
    expanded: isMobile ? mobileOpen : !collapsed,
    toggle,
    closeMobile: () => setMobileOpenAtPath(null),
  };
}
