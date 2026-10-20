import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { unsealData } from "iron-session";
import { prisma } from "@/lib/prismaClient";
import { logger } from "@/lib/logger";
import { sessionOptions, type SessionData } from "@/lib/session";
import { getRequestContext } from "@/lib/requestContext";
import { ApplicationError } from "@/lib/errors";

/**
 * Idempotency-Key (docs/data-integrity.md): a repeated request is answered,
 * not processed again.
 *
 * The browser (src/lib/api-client.ts) sends a random `Idempotency-Key` with
 * every POST / PUT / PATCH / DELETE, and the same key again when it retries
 * that same request (a dropped connection, or the user clicking again after
 * "Can't reach the server"). Here, per signed-in user + method + path + key:
 *
 * - first time: the request runs; a 2xx reply is stored for 24 hours.
 * - again, finished: the stored reply is returned (header
 *   `Idempotent-Replayed: true`) - the action is NOT done twice.
 * - again, still running: 409 REQUEST_IN_PROGRESS (the browser waits and asks again).
 * - again with a different body: 422 IDEMPOTENCY_KEY_REUSED.
 * - a failed request (4xx / 5xx) isn't stored: nothing was saved, so it may
 *   run again with the same key (e.g. after confirming the password).
 *
 * The key is also marked `committed` INSIDE the database transaction of the
 * change itself (updateDb() calls RequestContext.inTransaction). So if the
 * server stops after saving but before storing its reply, a retry learns the
 * change happened (409 REQUEST_ALREADY_PROCESSED) instead of running again.
 *
 * Not used for /api/auth/* (sign-in, sign-out, password: they set cookies a
 * stored reply can't repeat) or /api/system/* (scheduler calls). Until the
 * idempotency_keys migration is applied, requests simply run as before.
 */

const STATE_CHANGING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
/** A request still "running" after this long has died without saving (its change never committed): it may run again. */
const STALE_IN_PROGRESS_MS = 2 * 60 * 1000;
const KEEP_HOURS = 24;
/** Replies larger than this are stored without their body (replayed as a plain success). */
const MAX_STORED_BODY = 1024 * 1024;
export const IDEMPOTENCY_HEADER = "idempotency-key";
/** On every API reply while the feature is on, so the browser knows retrying is safe. */
export const IDEMPOTENCY_SUPPORTED_HEADER = "x-idempotency";

export type StoredKey = {
  requestHash: string;
  status: "IN_PROGRESS" | "COMPLETED";
  committed: boolean;
  responseStatus: number | null;
  responseBody: string | null;
};

export interface IdempotencyStore {
  isInstalled(): Promise<boolean>;
  /** Inserts a new IN_PROGRESS key; false when the id already exists. */
  claim(id: string, userId: string, method: string, path: string, requestHash: string): Promise<boolean>;
  get(id: string): Promise<StoredKey | null>;
  /** Re-claims a dead IN_PROGRESS key (older than `olderThanMs`, never committed); false if it's alive or someone else has it. */
  takeOver(id: string, olderThanMs: number): Promise<boolean>;
  /** Inside the change's own transaction. */
  markCommitted(id: string, tx: unknown): Promise<void>;
  complete(id: string, status: number, body: string | null): Promise<void>;
  /** Forgets a key whose request saved nothing (so it may run again); false when its change was committed. */
  release(id: string): Promise<boolean>;
  purgeOlderThan(ageMs: number): Promise<void>;
}

interface RawClient {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

let installed: boolean | null = null;
let installedCheckedAt = 0;
let warnedMissing = false;

export const prismaIdempotencyStore: IdempotencyStore = {
  async isInstalled() {
    if (installed === true) return true;
    if (installed === false && Date.now() - installedCheckedAt < 60_000) return false;
    installedCheckedAt = Date.now();
    try {
      const rows = await prisma.$queryRaw<{ ok: boolean }[]>`SELECT to_regclass('idempotency_keys') IS NOT NULL AS ok`;
      installed = rows[0]?.ok === true;
    } catch {
      installed = false;
    }
    if (!installed && !warnedMissing) {
      warnedMissing = true;
      logger.warn({ event: "idempotency.not_installed" }, "idempotency_keys table is missing - apply prisma/migrations/20261020120000_idempotency_keys (docs/data-integrity.md). Until then repeated requests are processed again.");
    }
    return installed;
  },
  async claim(id, userId, method, path, requestHash) {
    const n = await prisma.$executeRaw`
      INSERT INTO idempotency_keys (id, user_id, method, path, request_hash, status, committed, created_at)
      VALUES (${id}, ${userId}, ${method}, ${path}, ${requestHash}, 'IN_PROGRESS', false, now())
      ON CONFLICT (id) DO NOTHING`;
    return n === 1;
  },
  async get(id) {
    const rows = await prisma.$queryRaw<{ request_hash: string; status: string; committed: boolean; response_status: number | null; response_body: string | null }[]>`
      SELECT request_hash, status, committed, response_status, response_body FROM idempotency_keys WHERE id = ${id}`;
    const r = rows[0];
    if (!r) return null;
    return { requestHash: r.request_hash, status: r.status === "COMPLETED" ? "COMPLETED" : "IN_PROGRESS", committed: r.committed, responseStatus: r.response_status, responseBody: r.response_body };
  },
  // Ages are compared in the database (its own now()), never against a
  // date sent from here - so the server's and database's time zones can't
  // make a live request look dead.
  async takeOver(id, olderThanMs) {
    const n = await prisma.$executeRaw`
      UPDATE idempotency_keys SET created_at = now()
      WHERE id = ${id} AND status = 'IN_PROGRESS' AND committed = false
        AND created_at < now() - make_interval(secs => ${olderThanMs / 1000})`;
    return n === 1;
  },
  async markCommitted(id, tx) {
    await (tx as RawClient).$executeRaw`UPDATE idempotency_keys SET committed = true WHERE id = ${id}`;
  },
  async complete(id, status, body) {
    await prisma.$executeRaw`
      UPDATE idempotency_keys SET status = 'COMPLETED', response_status = ${status}, response_body = ${body}, completed_at = now() WHERE id = ${id}`;
  },
  async release(id) {
    const n = await prisma.$executeRaw`DELETE FROM idempotency_keys WHERE id = ${id} AND status = 'IN_PROGRESS' AND committed = false`;
    return n === 1;
  },
  async purgeOlderThan(ageMs) {
    await prisma.$executeRaw`DELETE FROM idempotency_keys WHERE created_at < now() - make_interval(secs => ${ageMs / 1000})`;
  },
};

/** Which signed-in user sent this request (from the sealed session cookie), or null. */
async function requestUserId(request: Request): Promise<string | null> {
  const cookie = request.headers.get("cookie") ?? "";
  const name = sessionOptions.cookieName;
  const part = cookie.split(/;\s*/).find((c) => c.startsWith(`${name}=`));
  if (!part) return null;
  try {
    const session = await unsealData<SessionData>(decodeURIComponent(part.slice(name.length + 1)), { password: sessionOptions.password });
    return session.isLoggedIn && session.userId ? session.userId : null;
  } catch {
    return null;
  }
}

function errorReply(code: "REQUEST_IN_PROGRESS" | "REQUEST_ALREADY_PROCESSED" | "IDEMPOTENCY_KEY_REUSED"): Response {
  const err = new ApplicationError(code);
  return NextResponse.json(
    { success: false, error: { code, message: err.message, details: null }, requestId: getRequestContext()?.requestId ?? null },
    { status: err.status, headers: { [IDEMPOTENCY_SUPPORTED_HEADER]: "on", ...(code === "REQUEST_IN_PROGRESS" ? { "Retry-After": "2" } : {}) } }
  );
}

let lastPurge = 0;

/**
 * Runs `handle` at most once per Idempotency-Key (see the top of this file).
 * Requests without a key, GETs, sign-in / scheduler routes and anything
 * before the migration go straight through.
 */
export async function withIdempotency(request: Request, handle: () => Promise<Response>, store: IdempotencyStore = prismaIdempotencyStore): Promise<Response> {
  const key = request.headers.get(IDEMPOTENCY_HEADER)?.trim();
  const path = new URL(request.url).pathname;
  if (!key || !STATE_CHANGING.has(request.method) || path.startsWith("/api/auth/") || path.startsWith("/api/system/")) return handle();
  if (!KEY_PATTERN.test(key)) return handle();

  let id: string;
  let userId: string | null;
  try {
    if (!(await store.isInstalled())) return handle();
    userId = await requestUserId(request);
    if (!userId) return handle();
    const bodyHash = createHash("sha256").update(Buffer.from(await request.clone().arrayBuffer())).digest("hex");
    id = createHash("sha256").update(`${userId}\n${request.method}\n${path}\n${key}`).digest("hex");

    if (!(await store.claim(id, userId, request.method, path, bodyHash))) {
      const existing = await store.get(id);
      if (!existing) {
        // Removed between the two calls (the request before failed): try once more.
        if (!(await store.claim(id, userId, request.method, path, bodyHash))) return errorReply("REQUEST_IN_PROGRESS");
      } else if (existing.requestHash !== bodyHash) {
        return errorReply("IDEMPOTENCY_KEY_REUSED");
      } else if (existing.status === "COMPLETED") {
        logger.info({ event: "idempotency.replayed", path }, "Repeated request answered with its stored reply");
        return new NextResponse(existing.responseBody ?? JSON.stringify({ success: true, replayed: true }), {
          status: existing.responseStatus ?? 200,
          headers: { "content-type": "application/json", "Idempotent-Replayed": "true", [IDEMPOTENCY_SUPPORTED_HEADER]: "on" },
        });
      } else if (existing.committed) {
        // Saved, but the server stopped before storing its reply.
        return errorReply("REQUEST_ALREADY_PROCESSED");
      } else if (!(await store.takeOver(id, STALE_IN_PROGRESS_MS))) {
        // Still running (or another retry just took it over).
        return errorReply("REQUEST_IN_PROGRESS");
      }
    }
    if (Date.now() - lastPurge > 10 * 60 * 1000) {
      lastPurge = Date.now();
      void store.purgeOlderThan(KEEP_HOURS * 3600 * 1000).catch(() => {});
    }
  } catch (err) {
    // The key store itself failed: run the request as without a key rather than refusing it.
    logger.warn({ err, event: "idempotency.store_failed" }, "Idempotency key store unavailable - request processed without it");
    return handle();
  }

  // Any change this request commits marks the key, in the same transaction.
  const ctx = getRequestContext();
  if (ctx) ctx.inTransaction = (tx) => store.markCommitted(id, tx);

  let response: Response;
  try {
    response = await handle();
  } catch (err) {
    // Saved nothing: forget the key. (If a change did commit, the key stays
    // and a retry gets REQUEST_ALREADY_PROCESSED.)
    await store.release(id).catch(() => false);
    throw err;
  }
  try {
    const ok = response.status >= 200 && response.status < 300;
    // A refused request saved nothing, so it may run again with this key -
    // unless it did commit a change before answering: then its reply is kept.
    if (ok || !(await store.release(id))) {
      const text = await response.clone().text();
      await store.complete(id, response.status, text.length <= MAX_STORED_BODY ? text : null);
    }
  } catch (err) {
    logger.warn({ err, event: "idempotency.store_failed" }, "Could not record the reply for an idempotency key");
  }
  try {
    response.headers.set(IDEMPOTENCY_SUPPORTED_HEADER, "on");
  } catch {
    // Immutable headers (a redirect): the browser just won't auto-retry.
  }
  return response;
}
