/**
 * IOM Kobo reader (GET only). Follows the API's `next` link until every page is read.
 * Runs inside the Windows app (Tauri http plugin); a plain browser is blocked by CORS.
 */
import { buildFirstUrl, safeNextUrl, mergeSubmissions, IomRow } from '../utils/iomRecords.ts';

export interface IomFetchResult {
  rows: IomRow[];
  submissions: number;
  total: number;
  skippedDuplicates: number;
  error?: string;
}

function tauriFetch(): ((input: any, init?: any) => Promise<any>) | null {
  if (typeof window === 'undefined') return null;
  const win = window as any;
  return win.__TAURI_INTERNALS__ && win.__TAURI__?.http?.fetch ? win.__TAURI__.http.fetch : null;
}

export async function fetchIomRecords(
  cfg: { server: string; uid: string; token: string },
  from: string,
  to: string,
  onProgress?: (loaded: number, total: number) => void,
): Promise<IomFetchResult> {
  const out: IomFetchResult = { rows: [], submissions: 0, total: 0, skippedDuplicates: 0 };
  const f = tauriFetch();
  if (!f) {
    out.error = 'Not running inside the Windows app, so Kobo cannot be reached (browser CORS). Open the installed Windows app.';
    return out;
  }
  let url: string | null = buildFirstUrl(cfg.server, cfg.uid, from, to);
  const visited = new Set<string>();
  try {
    while (url && !visited.has(url)) {
      visited.add(url);
      const res = await f(url, { method: 'GET', headers: cfg.token.trim() ? { Authorization: `Token ${cfg.token.trim()}`, Accept: 'application/json' } : { Accept: 'application/json' } });
      if (res.status === 401 || res.status === 403) { out.error = `IOM Kobo refused access (HTTP ${res.status}). The data is not public: add an API token under Connection.`; return out; }
      if (res.status !== 200) { out.error = `IOM Kobo returned HTTP ${res.status}.`; return out; }
      const json = await res.json();
      const results: Array<Record<string, any>> = Array.isArray(json?.results) ? json.results : [];
      out.total = Number(json?.count) || out.total;
      const merged = mergeSubmissions(out.rows, results);
      out.rows = merged.rows;
      out.submissions += merged.added;
      out.skippedDuplicates += merged.skipped;
      onProgress?.(out.submissions, out.total);
      url = safeNextUrl(json?.next);
    }
  } catch (e: any) {
    out.error = `Could not reach IOM Kobo: ${e?.message || 'network error'}`;
  }
  return out;
}
