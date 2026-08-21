export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function handle<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(body?.error ?? `Request failed (${res.status})`, res.status);
  }
  return body as T;
}

export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  return handle<T>(res);
}

export async function apiSend<T>(url: string, method: "POST" | "PATCH" | "DELETE", data?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
  return handle<T>(res);
}
