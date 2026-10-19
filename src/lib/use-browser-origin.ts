"use client";
import { useSyncExternalStore } from "react";
const subscribe = () => () => {};
const client = () => window.location.origin;
const server = () => "";
export function useBrowserOrigin() { return useSyncExternalStore(subscribe, client, server); }
