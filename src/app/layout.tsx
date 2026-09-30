import type { Metadata } from "next";
import { Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppToaster } from "@/components/ui/AppToaster";

// The app's text font is Verdana (a system font - nothing to download; see
// globals.css). Geist Mono is kept for monospaced text (reference numbers,
// codes).
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Nib InternationalBank",
  description: "Internal Control Findings Management System",
  icons: {
    icon: "/Nib_International_Bank.png",
  },
};

// Reads the theme choice ThemeToggle.tsx writes to localStorage and stamps
// it on <html> before first paint - blocking, inline, and as small as
// possible, since anything async here would show the wrong theme for a
// frame first (the exact flash this exists to prevent). "system" (or
// nothing stored yet) intentionally sets no attribute at all: leaving
// prefers-color-scheme in globals.css as the only thing deciding is what
// makes system mode track a live OS change with no JS involved.
// Also restores the collapsed sidebar (Sidebar.tsx) the same way, so it
// never flashes open before collapsing.
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}if(localStorage.getItem("sidebar")==="collapsed"){document.documentElement.setAttribute("data-sidebar","collapsed")}}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistMono.variable} h-full antialiased`}
      // The init script above sets data-theme on this element before React
      // hydrates it, which would otherwise be flagged as a server/client
      // mismatch - suppressHydrationWarning is the documented escape hatch
      // for exactly this "an inline script intentionally patches this one
      // attribute pre-hydration" case, and only applies to this element's
      // own attributes, not its children.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <AppToaster />
      </body>
    </html>
  );
}
