"use client";

import { create } from "zustand";
import type { DashboardNotification, GeneratedArticle, GoldPriceSnapshot, Portal } from "./types";

const NOTIFICATION_TTL = 15_000;

interface DashboardState {
  portal: Portal;
  jenisKonten: string;
  sourceName: string;
  selectedSources: string[];
  activeTab: string;
  snapshots: GoldPriceSnapshot[];
  article: GeneratedArticle | null;
  notifications: DashboardNotification[];
  setActiveTab: (activeTab: string) => void;
  setPortal: (portal: Portal) => void;
  setJenisKonten: (jenisKonten: string) => void;
  setSourceName: (sourceName: string) => void;
  setSelectedSources: (selectedSources: string[]) => void;
  setSnapshots: (snapshots: GoldPriceSnapshot[]) => void;
  setArticle: (article: GeneratedArticle | null) => void;
  pushNotifications: (notifications: DashboardNotification[]) => void;
  dismissNotification: (id: string) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  portal: "Investor Daily",
  jenisKonten: "Harga Emas Dunia",
  sourceName: "Semua Source",
  selectedSources: [],
  activeTab: "Overview",
  snapshots: [],
  article: null,
  notifications: [
    {
      id: "preflight-ok",
      kind: "success",
      title: "Pre-flight valid",
      message: "Source otomatis utama valid. Source manual sementara sudah dicatat di dokumentasi proses.",
      createdAt: Date.now()
    }
  ],
  setActiveTab: (activeTab) => set({ activeTab }),
  setPortal: (portal) =>
    set(() => ({
      portal,
      jenisKonten: portal === "Beritasatu" ? "Harga Emas" : "Harga Emas Dunia",
      sourceName: "Semua Source",
      selectedSources: [],
      snapshots: [],
      article: null
    })),
  setJenisKonten: (jenisKonten) => set({ jenisKonten, sourceName: "Semua Source", selectedSources: [], snapshots: [], article: null }),
  setSourceName: (sourceName) => set({ sourceName, selectedSources: sourceName === "Semua Source" ? [] : [sourceName], snapshots: [], article: null }),
  setSelectedSources: (selectedSources) => set({ selectedSources, sourceName: selectedSources.length === 1 ? selectedSources[0] : "Semua Source", snapshots: [], article: null }),
  setSnapshots: (snapshots) => set({ snapshots }),
  setArticle: (article) => set({ article }),
  pushNotifications: (notifications) =>
    set((state) => {
      const now = Date.now();
      const liveNotifications = state.notifications.filter((notification) => now - (notification.createdAt ?? now) < NOTIFICATION_TTL);
      const incoming = notifications
        .map((notification) => ({ ...notification, createdAt: notification.createdAt ?? now }))
        .filter((notification) => {
          const signature = `${notification.kind}|${notification.title}|${notification.message}`;
          return !liveNotifications.some((existing) => `${existing.kind}|${existing.title}|${existing.message}` === signature);
        });

      return {
        notifications: [...incoming, ...liveNotifications].slice(0, 6)
      };
    }),
  dismissNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((notification) => notification.id !== id)
    }))
}));
