import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "./api";

/** Loads JSON from the API; reload() fetches again. Optional polling interval in ms. */
export function useApi<T>(path: string | null, pollMs?: number) {
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<unknown>();
  const [loading, setLoading] = useState(Boolean(path));
  const alive = useRef(true);

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      const d = await api<T>(path);
      if (alive.current) {
        setData(d);
        setError(undefined);
      }
    } catch (err) {
      if (alive.current) setError(err);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    alive.current = true;
    void reload();
    if (!pollMs) return () => void (alive.current = false);
    const t = setInterval(() => void reload(), pollMs);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [reload, pollMs]);

  return { data, error, loading, reload, setData };
}

/** Turns an API error into a translated, readable message. */
export function useErrorText() {
  const { t } = useTranslation();
  return useCallback(
    (err: unknown): string => {
      if (!err) return "";
      if (err instanceof ApiError) {
        const code = err.code.split(":")[0]!;
        const key = `errors.${code}`;
        const detail = typeof err.body.detail === "string" ? err.body.detail : "";
        const text = t(key, { defaultValue: "" }) || t("errors.generic", { code: err.code });
        return detail ? `${text} (${detail})` : text;
      }
      if (err instanceof Error) return t(`errors.${err.message}`, { defaultValue: err.message });
      return String(err);
    },
    [t],
  );
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

export function useDateFormat() {
  const { i18n } = useTranslation();
  return useCallback(
    (d: string | Date | null | undefined) =>
      d ? new Intl.DateTimeFormat(i18n.language === "nl" ? "nl-NL" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(d)) : "—",
    [i18n.language],
  );
}
