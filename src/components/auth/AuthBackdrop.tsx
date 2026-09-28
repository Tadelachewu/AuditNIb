import type { ReactNode } from "react";

/**
 * Full-screen backdrop for the sign-in / password pages, drawn from the NIB
 * logo itself (public/Nib_International_Bank.png): the logo's brown upper
 * half and gold lower half, split by the same rounded zigzag with a light
 * ribbon between them - just blown up to fill the screen, with a large
 * faint circle echoing the logo's round outline.
 *
 * Pure inline SVG (no image request, crisp at any size), `slice`d so the
 * curve always spans the viewport - on a narrow phone it crops to the
 * central valley/peak rather than squashing. The palette is the fixed
 * brand colors on purpose (like --brand-*), so it looks the same in light
 * and dark mode; the content panel on top is what adapts.
 */
export function AuthBackdrop({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#fbf8f2] px-4 py-10">
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          <linearGradient id="auth-brown" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#6f3d18" />
            <stop offset="1" stopColor="#8a4d21" />
          </linearGradient>
          <linearGradient id="auth-gold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#feb914" />
            <stop offset="1" stopColor="#f5a800" />
          </linearGradient>
        </defs>

        {/* Brown: everything above the zigzag. Each corner of the zigzag is
            rounded with a quadratic curve, like the logo's soft vertices. */}
        <path
          fill="url(#auth-brown)"
          d="M -20 -20 H 1460 V 250 L 1010 640 Q 950 700 885 650 L 430 330 Q 360 275 300 340 L -20 660 Z"
        />

        {/* Gold: everything below the same zigzag, shifted down - the gap
            between the two is the light ribbon. */}
        <path
          fill="url(#auth-gold)"
          d="M -20 760 L 300 440 Q 360 375 430 430 L 885 750 Q 950 800 1010 740 L 1460 350 V 920 H -20 Z"
        />

        {/* Soft sheen on each half, following the curve, for depth. */}
        <path
          fill="none"
          stroke="#ffffff"
          strokeOpacity="0.08"
          strokeWidth="60"
          strokeLinejoin="round"
          d="M -20 580 L 300 280 Q 360 225 430 275 L 885 590 Q 950 640 1010 585 L 1460 180"
        />
        <path
          fill="none"
          stroke="#ffffff"
          strokeOpacity="0.14"
          strokeWidth="40"
          strokeLinejoin="round"
          d="M -20 830 L 300 510 Q 360 450 430 500 L 885 820 Q 950 870 1010 810 L 1460 420"
        />

        {/* The logo's circular outline, echoed large and faint. */}
        <circle cx="720" cy="450" r="520" fill="none" stroke="#ffffff" strokeOpacity="0.12" strokeWidth="2" />
        <circle cx="720" cy="450" r="600" fill="none" stroke="#ffffff" strokeOpacity="0.06" strokeWidth="2" />
      </svg>

      <div className="relative z-10 w-full max-w-sm">{children}</div>
    </div>
  );
}

/** The white panel the auth pages' content sits on, above the backdrop. */
export const AUTH_PANEL_CLASS = "rounded-2xl bg-white/95 p-7 shadow-2xl ring-1 ring-black/5 backdrop-blur-sm";
