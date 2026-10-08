import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../api";
import { buildSearchIndex, parseEntry, search, type OpsEntry, type SearchHit } from "../opsMemory";

export interface OpsFile {
  path: string;
  content: string;
}

export interface OpsData {
  files: OpsFile[];
  entries: OpsEntry[];
  /** Files under vms/ or projects/ that could not be parsed, with the reason. */
  invalid: { path: string; reason: string }[];
}

/** Pure: turn raw files into entries and invalid-file reports. */
export function buildOpsData(files: OpsFile[]): OpsData {
  const entries: OpsEntry[] = [];
  const invalid: OpsData["invalid"] = [];
  for (const f of files) {
    if (!/^(vms|projects)\/[^/]+\.md$/.test(f.path)) continue;
    try {
      entries.push(parseEntry(f.path, f.content));
    } catch (e) {
      invalid.push({ path: f.path, reason: (e as Error).message });
    }
  }
  return { files, entries, invalid };
}

export const RELOAD_DEBOUNCE_MS = 300;

/**
 * Loads every Ops Memory file, keeps them fresh when files change on disk, and exposes search.
 * `externalChange` becomes true when something other than Mochi edited a file and stays true until
 * `clearExternalChange` is called.
 */
export function useOpsMemory(enabled: boolean) {
  const [data, setData] = useState<OpsData>({ files: [], entries: [], invalid: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [externalChange, setExternalChange] = useState(false);
  const [changedPaths, setChangedPaths] = useState<string[]>([]);
  const mounted = useRef(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const infos = await api.listOpsFiles();
      const files = await Promise.all(
        infos.map(async (i) => ({ path: i.path, content: await api.readOpsFile(i.path).catch(() => "") })),
      );
      if (!mounted.current) return;
      setData(buildOpsData(files));
      setError(null);
    } catch (e) {
      if (mounted.current) setError(String(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    // Deferred so the loading state is not set synchronously inside the effect.
    if (enabled) void Promise.resolve().then(reload);
  }, [enabled, reload]);

  // Reload (debounced) when files are changed by something else.
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    api
      .onOpsChanged((paths) => {
        setExternalChange(true);
        setChangedPaths((prev) => Array.from(new Set([...prev, ...paths])));
        clearTimeout(timer);
        timer = setTimeout(() => void reload(), RELOAD_DEBOUNCE_MS);
      })
      .then((f) => {
        if (cancelled) f();
        else unlisten = f;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      unlisten?.();
    };
  }, [enabled, reload]);

  const index = useMemo(() => buildSearchIndex(data.files), [data.files]);
  const runSearch = useCallback((q: string): SearchHit[] => search(index, data.files, q), [index, data.files]);

  const clearExternalChange = useCallback(() => {
    setExternalChange(false);
    setChangedPaths([]);
  }, []);

  return { ...data, loading, error, externalChange, changedPaths, clearExternalChange, reload, runSearch };
}
