import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "./api";
import type { Key } from "./i18n";
import { isLoginId, ROLES, showLogin, toLogin, type Profile, type Role, type StaffMember } from "./types";

// Readable temporary password: no 0/o, 1/l/i, so it survives being read out on the phone.
function newPassword() {
  const letters = "abcdefghjkmnpqrstuvwxyz", digits = "23456789";
  const r = crypto.getRandomValues(new Uint32Array(8));
  const pick = (set: string, n: number) => set[n % set.length];
  return [0, 1, 2, 3].map((i) => pick(letters, r[i])).join("") + "-" + [4, 5, 6, 7].map((i) => pick(digits, r[i])).join("");
}

const when = (iso: string) => new Date(iso).toLocaleString("en-IN", {
  day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true,
});

type Shared = { kind: "created" | "resetDone"; name: string; login: string; password: string };

export default function Staff({ t, me }: { t: (k: Key) => string; me: Profile }) {
  const [list, setList] = useState<StaffMember[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shared, setShared] = useState<Shared | null>(null);

  const load = useCallback(() => {
    setLoadError("");
    return api.staff().then(setList).catch((e: Error) => setLoadError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function run(work: () => Promise<void>) {
    setBusy(true); setError("");
    try { await work(); await load(); return true; }
    catch (e) { setError((e as Error).message); return false; }
    finally { setBusy(false); }
  }

  if (loadError) return (
    <>
      <h1>{t("staff")}</h1>
      <p className="error" role="alert">{loadError}</p>
      <button className="btn" onClick={load}>{t("retry")}</button>
    </>
  );
  if (!list) return <p className="muted">{t("loading")}</p>;

  const activeCount = list.filter((s) => s.active).length;

  return (
    <>
      <h1>{t("staff")}</h1>
      <p className="muted">{t("staffCount")}: {activeCount}</p>

      {shared && <ShareCard t={t} s={shared} onDone={() => setShared(null)} />}
      {error && <p className="error" role="alert">{error}</p>}

      {adding ? (
        <AddForm t={t} busy={busy} onCancel={() => { setAdding(false); setError(""); }}
          onSubmit={async (f) => {
            const done = await run(() => api.staffAction({ action: "create", ...f }));
            if (done) { setAdding(false); setShared({ kind: "created", name: f.full_name, login: showLogin(f.email), password: f.password }); }
          }} />
      ) : !shared && (
        <button className="btn primary wide" onClick={() => { setAdding(true); setOpen(null); setError(""); }}>+ {t("addStaff")}</button>
      )}

      {list.length === 0 && !adding && <p className="muted">{t("noStaff")}</p>}
      <ul className="rows staff-list">
        {list.map((s) => {
          const isOpen = open === s.id;
          const self = s.id === me.id;
          return (
            <li key={s.id} className={s.active ? "state-approved" : "state-rejected"}>
              <button className="row" aria-expanded={isOpen} onClick={() => { setOpen(isOpen ? null : s.id); setError(""); }}>
                <span className="row-main">
                  <strong>{s.full_name}</strong>
                  <span className="muted small login-id">{showLogin(s.email)}{self && ` · ${t("you")}`}</span>
                  <span className="muted small">
                    {s.last_sign_in_at ? `${t("lastSignIn")}: ${when(s.last_sign_in_at)}` : t("never")}
                  </span>
                  <span className="chips">
                    <span className="chip role">{t(`role_${s.role}` as Key)}</span>
                    {!s.active && <span className="chip rejected">{t("inactive")}</span>}
                  </span>
                </span>
                <span className="chev" aria-hidden="true">{isOpen ? "⌃" : "›"}</span>
              </button>
              {isOpen && (
                <Manage t={t} s={s} self={self} busy={busy}
                  onRole={(role) => run(() => api.staffAction({ action: "update", id: s.id, role }))}
                  onReset={async () => {
                    const password = newPassword();
                    const done = await run(() => api.staffAction({ action: "reset_password", id: s.id, password }));
                    if (done) { setOpen(null); setShared({ kind: "resetDone", name: s.full_name, login: showLogin(s.email), password }); }
                  }}
                  onActive={(active) => run(() => api.staffAction({ action: "set_active", id: s.id, active }))} />
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function AddForm({ t, busy, onSubmit, onCancel }: {
  t: (k: Key) => string; busy: boolean;
  onSubmit: (f: { full_name: string; email: string; role: Role; password: string }) => void; onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [login, setLogin] = useState("");
  const [role, setRole] = useState<Role>("factory");
  const [password, setPassword] = useState(newPassword);
  const [bad, setBad] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    const l = login.trim();
    if (!(l.includes("@") || isLoginId(l))) { setBad(t("badLogin")); return; }
    setBad("");
    onSubmit({ full_name: name.trim(), email: toLogin(l), role, password });
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h2>{t("addStaff")}</h2>
      <label>{t("fullName")}
        <input required autoFocus value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      </label>
      <label>{t("loginLabel")}
        <input required value={login} onChange={(e) => { setLogin(e.target.value); setBad(""); }} inputMode="email"
               autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" aria-describedby="login-hint" />
        <span id="login-hint" className="muted small hint">{t("loginHint")}</span>
      </label>
      {bad && <p className="error" role="alert">{bad}</p>}
      <label>{t("role")}
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {ROLES.map((r) => <option key={r} value={r}>{t(`role_${r}` as Key)}</option>)}
        </select>
      </label>
      <label>{t("tempPassword")}
        <span className="inline">
          <input required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
                 className="mono" autoComplete="new-password" spellCheck={false} aria-describedby="pw-hint" />
          <button type="button" className="btn" onClick={() => setPassword(newPassword())}>{t("newPassword")}</button>
        </span>
        <span id="pw-hint" className="muted small hint">{t("passwordHint")}</span>
      </label>
      <div className="actions">
        <button className="btn primary" disabled={busy}>{busy ? t("saving") : t("create")}</button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>{t("cancel")}</button>
      </div>
    </form>
  );
}

function Manage({ t, s, self, busy, onRole, onReset, onActive }: {
  t: (k: Key) => string; s: StaffMember; self: boolean; busy: boolean;
  onRole: (r: Role) => void; onReset: () => void; onActive: (a: boolean) => void;
}) {
  const [role, setRole] = useState<Role>(s.role);
  const [confirmOff, setConfirmOff] = useState(false);
  return (
    <div className="detail manage">
      {!self && (
        <label>{t("role")}
          <span className="inline">
            <select value={role} onChange={(e) => setRole(e.target.value as Role)} disabled={!s.active}>
              {ROLES.map((r) => <option key={r} value={r}>{t(`role_${r}` as Key)}</option>)}
            </select>
            <button className="btn primary" disabled={busy || role === s.role} onClick={() => onRole(role)}>{t("saveRole")}</button>
          </span>
        </label>
      )}
      <div className="actions">
        {s.active && <button className="btn" disabled={busy} onClick={onReset}>{t("resetPassword")}</button>}
        {!self && s.active && !confirmOff &&
          <button className="btn danger" disabled={busy} onClick={() => setConfirmOff(true)}>{t("switchOff")}</button>}
        {!s.active && <button className="btn primary" disabled={busy} onClick={() => onActive(true)}>{t("switchOn")}</button>}
      </div>
      {confirmOff && (
        <div className="confirm">
          <p>{t("confirmOff")}</p>
          <div className="actions">
            <button className="btn danger" disabled={busy} onClick={() => { setConfirmOff(false); onActive(false); }}>{t("yesOff")}</button>
            <button className="btn" onClick={() => setConfirmOff(false)}>{t("cancel")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ShareCard({ t, s, onDone }: { t: (k: Key) => string; s: Shared; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const link = window.location.href.split("#")[0];
  const message = `Rich Alloys portal\n${link}\n${t("login")}: ${s.login}\n${t("password")}: ${s.password}`;
  return (
    <div className="card share" role="status">
      <p><strong>{t(s.kind)} {s.name}</strong></p>
      <dl>
        <dt>{t("login")}</dt><dd className="mono">{s.login}</dd>
        <dt>{t("password")}</dt><dd className="mono big">{s.password}</dd>
      </dl>
      <p className="small">{t("shareOnce")}</p>
      <div className="actions">
        <a className="btn primary" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener">{t("whatsapp")}</a>
        <button className="btn" onClick={() => navigator.clipboard?.writeText(message).then(() => setCopied(true))}>
          {copied ? t("copied") : t("copy")}
        </button>
        <button className="btn" onClick={onDone}>{t("done")}</button>
      </div>
    </div>
  );
}
