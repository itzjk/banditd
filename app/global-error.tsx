"use client";

const STORAGE_KEY = "banditd_state";

const css = `
  :root { color-scheme: light dark; --bg:#f7f7f6; --fg:#0b0c0d; --mut:#55595f; --sub:#83888f; --card:#ffffff; --line:#e4e4e1; --line2:#cdcdc9; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#08090a; --fg:#f1f3f4; --mut:#9ba1a8; --sub:#6c737a; --card:#0f1113; --line:#1e2226; --line2:#2d3338; }
  }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font-family: ui-sans-serif, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  .wrap { min-height:100dvh; display:flex; align-items:center; justify-content:center; padding:1.25rem; }
  .card { width:100%; max-width:34rem; background:var(--card); border:1px solid var(--line); border-radius:0.875rem; padding:1.25rem; }
  .eyebrow { margin:0; font-family: ui-monospace, monospace; font-size:0.6875rem; letter-spacing:0.14em; text-transform:uppercase; color:var(--sub); }
  h1 { margin:0.75rem 0 0; font-size:1.25rem; line-height:1.25; letter-spacing:-0.02em; }
  p.body { margin:0.75rem 0 0; font-size:0.875rem; line-height:1.6; color:var(--mut); }
  .row { display:flex; flex-direction:column; gap:0.5rem; margin-top:1.25rem; }
  button { width:100%; padding:0.75rem 1rem; font:inherit; font-size:0.875rem; font-weight:600; border-radius:0.5rem; cursor:pointer; }
  .primary { background:var(--fg); color:var(--bg); border:none; }
  .ghost { background:transparent; color:var(--mut); border:1px solid var(--line2); }
  .ref { margin:1rem 0 0; font-family: ui-monospace, monospace; font-size:0.75rem; color:var(--sub); word-break:break-all; }
  @media (min-width: 640px) {
    .row { flex-direction:row; }
    button { width:auto; }
    h1 { font-size:1.5rem; }
    .card { padding:1.5rem; }
  }
`;

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const startClean = () => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      window.location.href = "/";
      return;
    }
    window.location.href = "/";
  };

  return (
    <html lang="en">
      <body>
        <style dangerouslySetInnerHTML={{ __html: css }} />
        <div className="wrap">
          <div className="card">
            <p className="eyebrow">Something went wrong</p>
            <h1>banditd could not render this page</h1>
            <p className="body">
              Nothing was charged and no mandate was touched. Try again first. If it keeps failing,
              the run saved in this browser is damaged, and clearing it starts a fresh run from the
              home page.
            </p>
            <div className="row">
              <button type="button" className="primary" onClick={reset}>
                Try again
              </button>
              <button type="button" className="ghost" onClick={startClean}>
                Clear the saved run and restart
              </button>
            </div>
            {error.digest ? <p className="ref">Reference {error.digest}</p> : null}
          </div>
        </div>
      </body>
    </html>
  );
}
