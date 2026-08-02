const HEADERS = ["origin", "referer"];

function allowedHosts(): string[] {
  const hosts = ["localhost", "127.0.0.1"];
  const site = process.env.RENDER_MERCHANT_URL ?? "";
  const vercel = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "";
  for (const raw of [site, vercel]) {
    if (!raw) continue;
    try {
      hosts.push(new URL(raw).hostname);
    } catch {
      continue;
    }
  }
  return hosts;
}

export function fromOurPage(req: Request): boolean {
  if (process.env.NODE_ENV !== "production") return true;

  const hosts = allowedHosts();
  for (const header of HEADERS) {
    const value = req.headers.get(header);
    if (!value) continue;
    try {
      const host = new URL(value).hostname;
      if (hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) return true;
    } catch {
      continue;
    }
  }
  return false;
}

export const OFF_PAGE_CODE = "NOT_FROM_THE_APP";

export const OFF_PAGE_MESSAGE =
  "This endpoint spends money, either a charge against a signed mandate or a paid model call, and it only answers requests that come from the banditd page itself. The request that reached it carried no origin from this site. Nothing was spent. The run state is public by design and the statistics are reproducible without any key, so nothing here is hidden: what is refused is an anonymous caller reaching the spending path directly.";
