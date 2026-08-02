const KEY = "banditd_autorun";

export function armAutorun() {
  try {
    window.sessionStorage.setItem(KEY, "1");
  } catch {
    return;
  }
}

export function claimAutorun(): boolean {
  try {
    if (window.sessionStorage.getItem(KEY) !== "1") return false;
    window.sessionStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}
