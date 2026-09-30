import type { Metadata } from "next";
import {
  Geist,
  Geist_Mono,
  Inter,
  Roboto,
  Open_Sans,
  Lato,
  Poppins,
  Montserrat,
  Nunito,
  Source_Sans_3,
  Noto_Sans,
  Work_Sans,
  IBM_Plex_Sans,
  Noto_Sans_Ethiopic,
} from "next/font/google";
import "./globals.css";
import { AppToaster } from "@/components/ui/AppToaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// The alternative faces an admin can pick under Settings > Typography
// (src/lib/typography.ts). preload: false keeps them off the critical
// path - each @font-face is declared up-front, but a browser only fetches
// a face's files once a rule actually uses it, so an install left on the
// Geist default never downloads any of these.
const inter = Inter({ variable: "--font-inter", subsets: ["latin"], preload: false });
const roboto = Roboto({ variable: "--font-roboto", subsets: ["latin"], preload: false });
const openSans = Open_Sans({ variable: "--font-open-sans", subsets: ["latin"], preload: false });
// Lato and Poppins aren't variable fonts, so their weights are listed
// explicitly - the ones the app's font-normal/medium/semibold/bold use
// (Lato has no 500/600; the browser picks its nearest 400/700).
const lato = Lato({ variable: "--font-lato", subsets: ["latin"], weight: ["400", "700"], preload: false });
const poppins = Poppins({ variable: "--font-poppins", subsets: ["latin"], weight: ["400", "500", "600", "700"], preload: false });
const montserrat = Montserrat({ variable: "--font-montserrat", subsets: ["latin"], preload: false });
const nunito = Nunito({ variable: "--font-nunito", subsets: ["latin"], preload: false });
const sourceSans3 = Source_Sans_3({ variable: "--font-source-sans-3", subsets: ["latin"], preload: false });
const notoSans = Noto_Sans({ variable: "--font-noto-sans", subsets: ["latin"], preload: false });
const workSans = Work_Sans({ variable: "--font-work-sans", subsets: ["latin"], preload: false });
const ibmPlexSans = IBM_Plex_Sans({ variable: "--font-ibm-plex-sans", subsets: ["latin"], preload: false });
const notoSansEthiopic = Noto_Sans_Ethiopic({
  variable: "--font-noto-sans-ethiopic",
  subsets: ["ethiopic", "latin"],
  preload: false,
});
const optionalFontVariables = [
  inter,
  roboto,
  openSans,
  lato,
  poppins,
  montserrat,
  nunito,
  sourceSans3,
  notoSans,
  workSans,
  ibmPlexSans,
  notoSansEthiopic,
].map((f) => f.variable).join(" ");

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
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${optionalFontVariables} h-full antialiased`}
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
