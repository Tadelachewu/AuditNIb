import { toast } from "sonner";
import { NOTIFY_DURATION, type NotifyType } from "@/lib/notify/config";
import { notifications, type Notice } from "@/lib/notify/catalog";
import { presentError, type ErrorPresentation } from "@/lib/notify/presentError";
import { ApiError } from "@/lib/api-client";

export { notifications } from "@/lib/notify/catalog";
export type { Notice } from "@/lib/notify/catalog";
export { presentError } from "@/lib/notify/presentError";

/**
 * The application's notification API - the ONLY code that talks to the
 * toast library (Sonner; importing "sonner" elsewhere is a lint error), so
 * the library can be swapped without touching components.
 *
 *   notify.success(notifications.branch.deleted)
 *   notify.fromError(err, notifications.branch.deleteFailed)
 *   await notify.promise(save(), { loading: "Saving finding...", success: notifications.finding.updated, error: notifications.finding.saveFailed })
 *
 * Client Components only (Server Components / Route Handlers return
 * results and error codes; the client decides what to show).
 *
 * De-duplication: every notification's id is its catalog code, so the same
 * notification raised again (double click, two failing paths, a retry
 * storm) updates the one already on screen instead of stacking copies.
 * Durations, position and styling come from src/lib/notify/config.ts only.
 */
interface ShowOptions {
  /** Extra supporting line under the message (e.g. "3 findings removed"). */
  description?: string;
  /** Override the de-duplication key (defaults to the notice code). */
  id?: string;
}

function show(type: NotifyType, notice: Notice, opts: ShowOptions = {}): string {
  const id = opts.id ?? notice.code;
  const common = { id, description: opts.description, duration: NOTIFY_DURATION[type] };
  switch (type) {
    case "success":
      toast.success(notice.message, common);
      break;
    case "error":
      toast.error(notice.message, common);
      break;
    case "warning":
      toast.warning(notice.message, common);
      break;
    case "info":
      toast.info(notice.message, common);
      break;
    case "loading":
      toast.loading(notice.message, common);
      break;
  }
  return id;
}

/** A loading message for notify.loading / notify.promise ("Saving finding..."). */
const loadingNotice = (text: string, code = `LOADING_${text}`): Notice => ({ code, message: text });

export const notify = {
  success: (notice: Notice, opts?: ShowOptions) => show("success", notice, opts),
  error: (notice: Notice, opts?: ShowOptions) => show("error", notice, opts),
  warning: (notice: Notice, opts?: ShowOptions) => show("warning", notice, opts),
  info: (notice: Notice, opts?: ShowOptions) => show("info", notice, opts),
  /** Shows a persistent loading notification; resolve it with success/error using the returned id. */
  loading: (text: string, opts?: ShowOptions) => show("loading", loadingNotice(text), opts),
  dismiss: (id?: string) => toast.dismiss(id),

  /**
   * Loading -> success | error as ONE notification that changes in place.
   * Resolves with the operation's result; on failure the error is shown
   * (mapped by fromError) and re-thrown so the caller can still react.
   */
  async promise<T>(operation: Promise<T>, msgs: { loading: string; success: Notice; error: Notice }): Promise<T> {
    const id = `op_${msgs.success.code}`;
    show("loading", loadingNotice(msgs.loading, id), { id });
    try {
      const result = await operation;
      show("success", msgs.success, { id });
      return result;
    } catch (err) {
      notify.fromError(err, msgs.error, { id });
      throw err;
    }
  },

  /**
   * Presents a failed operation by its error code (see presentError()):
   * field errors -> one "correct the highlighted fields" warning (the caller
   * shows the per-field messages it gets back); auth -> sign-in; permission
   * / not found / business / system -> an error notification with safe text
   * (+ support reference for system errors). Returns the presentation so
   * callers can also render inline UI.
   */
  /**
   * Sign-in failure. A 401 here means wrong credentials, not an expired
   * session, so the generic auth handling (redirect) must not apply: the
   * server's safe message ("Invalid username or password", "account
   * deactivated", rate limit...) is shown; system errors get the generic text.
   */
  loginError(err: unknown): void {
    const p = presentError(err, notifications.auth.loginFailed);
    const safe = err instanceof ApiError && err.status > 0 && err.status < 500 ? err.message : p.message;
    show("error", { code: notifications.auth.loginFailed.code, message: safe }, { description: p.kind === "system" && p.reference ? `Reference: ${p.reference}` : undefined });
  },

  /**
   * For forms: presents the error the standard way (fromError) and returns
   * the text to show inline next to the form - only for field errors
   * (VALIDATION_ERROR with field details), otherwise null, since every other
   * failure is already shown as a notification.
   */
  formError(err: unknown, failure?: Notice): string | null {
    const p = notify.fromError(err, failure);
    return p.kind === "field" ? Object.values(p.fieldErrors).flat().join(" ") || p.message : null;
  },

  fromError(err: unknown, failure?: Notice, opts: { id?: string } = {}): ErrorPresentation {
    const p = presentError(err, failure);
    switch (p.kind) {
      case "field":
        show("warning", notifications.generic.fixFields, { id: opts.id });
        break;
      case "auth":
        show("info", notifications.auth.sessionExpired, { id: opts.id });
        if (typeof window !== "undefined") {
          // Through /api/auth/session-ended, which clears the stale cookie
          // first (going straight to /login could loop - see that route). A
          // full page load on purpose: no client state of the old session survives.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.setTimeout(() => window.location.assign("/api/auth/session-ended"), 1200);
        }
        break;
      case "permission":
        show("error", notifications.generic.noPermission, { id: opts.id });
        break;
      case "notFound":
        show("warning", { code: "NOT_FOUND", message: p.message }, { id: opts.id });
        break;
      case "business":
        show("error", { code: p.code, message: p.message }, { id: opts.id });
        break;
      case "system":
        show("error", { code: failure?.code ?? p.code, message: p.message }, { id: opts.id, description: p.reference ? `Reference: ${p.reference}` : undefined });
        break;
    }
    return p;
  },
};
