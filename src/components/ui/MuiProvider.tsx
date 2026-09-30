"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import { ThemeProvider, createTheme } from "@mui/material/styles";

/**
 * MUI setup for the app's data tables (Material React Table, see
 * AdminTable.tsx):
 *  - AppRouterCacheProvider: collects Emotion styles during server
 *    rendering so tables don't flash unstyled / mismatch on hydration.
 *    `enableCssLayer` puts MUI's CSS in its own cascade layer, so the app's
 *    Tailwind styles keep priority wherever the two meet.
 *  - A theme in the app's own look: brand gold as the primary colour,
 *    brand brown as the secondary, the app's font and text size
 *    (fontFamily/fontSize inherit from <body>, see globals.css),
 *    and light/dark following the app's own theme toggle - data-theme on
 *    <html>, or the OS setting when it's "system" - not MUI's own switch.
 */

type Mode = "light" | "dark";

function currentMode(): Mode {
  if (typeof document === "undefined") return "light";
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit === "dark" || explicit === "light") return explicit;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function useAppColorMode(): Mode {
  const [mode, setMode] = useState<Mode>("light");
  useEffect(() => {
    const update = () => setMode(currentMode());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    media?.addEventListener("change", update);
    return () => {
      observer.disconnect();
      media?.removeEventListener("change", update);
    };
  }, []);
  return mode;
}

export function MuiProvider({ children }: { children: ReactNode }) {
  const mode = useAppColorMode();
  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode,
          primary: { main: "#feb914", dark: "#d89d11", contrastText: "#171717" },
          secondary: { main: mode === "dark" ? "#e2b27a" : "#8a4d21" },
          background: mode === "dark" ? { default: "#0f172a", paper: "#1b2540" } : { default: "#f1f5f9", paper: "#ffffff" },
          text: mode === "dark" ? { primary: "#f8fafc", secondary: "#cbd5e1" } : { primary: "#0f172a", secondary: "#475569" },
          divider: mode === "dark" ? "#334155" : "#e2e8f0",
        },
        typography: { fontFamily: "inherit" },
        shape: { borderRadius: 6 },
      }),
    [mode]
  );
  return (
    <AppRouterCacheProvider options={{ enableCssLayer: true }}>
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    </AppRouterCacheProvider>
  );
}
