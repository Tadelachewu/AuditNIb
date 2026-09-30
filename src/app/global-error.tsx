"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/clientMonitoring";

// Last-resort boundary: replaces the ROOT layout when the layout itself (or
// something above every segment boundary) fails. It renders its own
// <html>/<body> and gets none of the app's CSS, so it is styled inline and
// follows the OS colour scheme. Never shows the error's message.
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    reportClientError(error, "global");
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", colorScheme: "light dark" }}>
        <title>Something went wrong | NIB Control360</title>
        <main style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div style={{ maxWidth: 380, textAlign: "center", border: "1px solid #cbd5e1", borderRadius: 8, padding: 24 }}>
            <p style={{ fontWeight: 600, margin: 0 }}>Something went wrong</p>
            <p style={{ marginTop: 8, fontSize: 14, opacity: 0.8 }}>
              The application hit an unexpected error. Please try again. If it keeps happening, contact support.
            </p>
            {error.digest && <p style={{ marginTop: 8, fontSize: 12, fontFamily: "monospace", opacity: 0.7 }}>Reference: {error.digest}</p>}
            <button
              type="button"
              onClick={() => retry()}
              style={{ marginTop: 16, padding: "6px 14px", borderRadius: 6, border: "1px solid #d49a0c", background: "#feb914", color: "#1f1300", fontWeight: 500, cursor: "pointer" }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
