import { useState, type FormEvent } from "react";
import { api } from "./api";
import type { Key } from "./i18n";

export default function Login({ t }: { t: (k: Key) => string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try { await api.signIn(email.trim(), password); }
    catch (err) { setError((err as Error).message); }
    setBusy(false);
  }

  return (
    <form className="card login" onSubmit={submit}>
      <h1>{t("signIn")}</h1>
      {api.demo && <p className="muted">{t("demoLogin")}</p>}
      <label>{t("loginLabel")}
        <input type="text" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>{t("password")}
        <input type="password" autoComplete="current-password" required value={password}
               onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="btn primary" disabled={busy}>{busy ? t("loading") : t("signIn")}</button>
    </form>
  );
}
