/**
 * Tiny fetch wrapper. Sends JSON, parses JSON, throws on non-2xx with
 * a useful error message. Cookies (session) included automatically.
 */
export interface ApiUser {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "EMPLOYEE";
  active?: boolean;
  createdAt?: string;
}

export class ApiError extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
    ...init,
  });
  const raw = await res.text().catch(() => "");
  let json: any = null;
  try { json = raw ? JSON.parse(raw) : null; } catch { /* keep null */ }
  if (!res.ok) {
    const msg = json?.error || `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, msg);
  }
  return json as T;
}

export const api = {
  get:  <T>(path: string)            => request<T>(path),
  post: <T>(path: string, body: any) => request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch:<T>(path: string, body: any) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  del:  <T>(path: string)            => request<T>(path, { method: "DELETE" }),
};
