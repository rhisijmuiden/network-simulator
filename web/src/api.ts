export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly body: Record<string, unknown>,
  ) {
    super(code);
  }
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? (init.body === undefined ? "GET" : "POST"),
    headers: init.body === undefined ? {} : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: "same-origin",
  });
  const text = await res.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) throw new ApiError(res.status, String(data.error ?? `http.${res.status}`), data);
  return data as T;
}

export type Role = "admin" | "instructor" | "student";

export type User = {
  id: number;
  username: string;
  displayName: string;
  email: string;
  role: Role;
  language: "en" | "nl";
  mustChangePassword: boolean;
};

export type SystemInfo = {
  version: string;
  commit: string;
  branch: string;
  builtAt: string;
  channel: "production" | "test";
  schemaVersion: number;
  node: string;
  uptimeSeconds: number;
};
