export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
    body: string,
  ) {
    super(`HTTP ${status} (${new URL(url).host}): ${body.slice(0, 200)}`);
  }
}

export function userAgent(): string {
  const contact = process.env.MB_CONTACT?.trim();
  return `MusicDiggingApp/0.1${contact ? ` ( ${contact} )` : ""}`;
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "User-Agent": userAgent(),
      Accept: "application/json",
      ...init.headers,
    },
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!res.ok) throw new HttpError(res.status, url, await res.text());
  return (await res.json()) as T;
}
