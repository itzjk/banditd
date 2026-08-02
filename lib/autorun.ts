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

const ASK_KEY = "banditd_ask";

export function armQuestion(text: string) {
  try {
    window.sessionStorage.setItem(ASK_KEY, text);
  } catch {
    return;
  }
}

export function claimQuestion(): string | null {
  try {
    const text = window.sessionStorage.getItem(ASK_KEY);
    if (!text) return null;
    window.sessionStorage.removeItem(ASK_KEY);
    return text;
  } catch {
    return null;
  }
}
