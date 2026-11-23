// Admin > Staff: add a login, change a role, reset a password, switch a login off or on.
// Logins live in Supabase Auth; only the staff-admin edge function (service key) can touch them.
// Passwords are never readable anywhere; a new or reset password is shown once, to share straight away.
import { useState } from "react";
import { isLoginId, sb, showLogin, toLogin, useLoad, useMe, useT, type Row } from "../lib";
import { Btn, Chip, Empty, Err, Field, Loading, Select, TextIn, toast } from "../ui";

const ROLES: [string, string, string][] = [
  ["gate", "Gate", "गेट"], ["factory", "Factory", "फैक्ट्री"], ["factory_accounts", "Factory accounts", "फैक्ट्री अकाउंट्स"],
  ["ho_accounts", "Head office accounts", "हेड ऑफिस अकाउंट्स"], ["deal_desk", "Deal desk", "सौदा डेस्क"],
  ["owner", "Owner", "मालिक"], ["vbog_admin", "V-BOG admin", "V-BOG एडमिन"],
];

async function call(body: Row): Promise<Row> {
  const { data, error } = await sb.functions.invoke("staff-admin", { body });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const msg = ctx && typeof ctx.json === "function" ? (await ctx.json().catch(() => null))?.error : null;
    throw new Error(msg || error.message);
  }
  return data as Row;
}

// Readable temporary password: no 0/o, 1/l/i, so it survives being read out on the phone.
function newPassword() {
  const letters = "abcdefghjkmnpqrstuvwxyz", digits = "23456789";
  const r = crypto.getRandomValues(new Uint32Array(8));
  return [0, 1, 2, 3].map((i) => letters[r[i] % letters.length]).join("") + "-" + [4, 5, 6, 7].map((i) => digits[r[i] % digits.length]).join("");
}
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });

type Shared = { created: boolean; name: string; login: string; password: string };

export default function Staff() {
  const t = useT(); const me = useMe();
  const { data, error, reload } = useLoad(async () => (await call({ action: "list" })).staff as Row[], []);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [shared, setShared] = useState<Shared | null>(null);
  const roleName = (r: string) => { const x = ROLES.find((y) => y[0] === r); return x ? t(x[1], x[2]) : r; };

  async function run(body: Row) {
    setBusy(true); setErr("");
    try { await call(body); reload(); toast(); return true; } catch (e) { setErr((e as Error).message); return false; } finally { setBusy(false); }
  }

  if (!data) return error ? <><Err error={error} /><Btn onClick={reload}>{t("Try again", "फिर से कोशिश करें")}</Btn></> : <Loading />;
  return (
    <>
      <p className="muted small">{t("Active logins", "चालू लॉगिन")}: {data.filter((s) => s.active).length} · {t("Passwords cannot be seen by anyone. Reset a lost one.", "पासवर्ड कोई नहीं देख सकता। खो जाए तो रीसेट करें।")}</p>
      {shared && <ShareCard s={shared} onDone={() => setShared(null)} />}
      <Err error={err} />
      {adding ? (
        <AddForm busy={busy} onCancel={() => { setAdding(false); setErr(""); }} onSubmit={async (f) => {
          if (await run({ action: "create", ...f })) { setAdding(false); setShared({ created: true, name: f.full_name, login: showLogin(f.email), password: f.password }); }
        }} />
      ) : !shared && <Btn kind="primary" className="block" onClick={() => { setAdding(true); setOpen(null); setErr(""); }}>+ {t("Add staff", "स्टाफ जोड़ें")}</Btn>}
      {!data.length && <Empty>{t("No staff yet.", "अभी कोई स्टाफ नहीं।")}</Empty>}
      <ul className="rows gap-top">
        {data.map((s) => {
          const isOpen = open === s.id; const self = s.id === me.id;
          return (
            <li key={s.id} className={s.active ? "edge-ok" : "edge-bad"}>
              <button type="button" className="row" aria-expanded={isOpen} onClick={() => { setOpen(isOpen ? null : s.id); setErr(""); }}>
                <span className="row-main">
                  <strong>{s.full_name}</strong>
                  <span className="muted small login-id">{showLogin(s.email)}{self && ` · ${t("This is you", "यह आप हैं")}`}</span>
                  <span className="muted small">{s.last_sign_in_at ? `${t("Last sign-in", "आखिरी लॉगिन")}: ${when(s.last_sign_in_at)}` : t("Never signed in", "अभी तक लॉगिन नहीं किया")}</span>
                  <span className="chips"><Chip tone="info">{roleName(s.role)}</Chip>{!s.active && <Chip tone="bad">{t("Switched off", "बंद")}</Chip>}</span>
                </span>
                <span className="chev" aria-hidden="true">{isOpen ? "⌃" : "›"}</span>
              </button>
              {isOpen && <Manage s={s} self={self} busy={busy} roleName={roleName}
                onRole={(role) => run({ action: "update", id: s.id, role })}
                onReset={async () => {
                  const password = newPassword();
                  if (await run({ action: "reset_password", id: s.id, password })) { setOpen(null); setShared({ created: false, name: s.full_name, login: showLogin(s.email), password }); }
                }}
                onActive={(active) => run({ action: "set_active", id: s.id, active })} />}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function AddForm({ busy, onSubmit, onCancel }: { busy: boolean; onSubmit: (f: { full_name: string; email: string; role: string; password: string }) => void; onCancel: () => void }) {
  const t = useT();
  const [name, setName] = useState(""); const [login, setLogin] = useState(""); const [role, setRole] = useState("factory");
  const [password, setPassword] = useState(newPassword); const [bad, setBad] = useState("");
  return (
    <div className="card stack gap-top">
      <h2>{t("Add staff", "स्टाफ जोड़ें")}</h2>
      <Field label={t("Full name", "पूरा नाम")}><TextIn value={name} onValue={setName} autoComplete="off" /></Field>
      <Field label={t("Email or login ID", "ईमेल या लॉगिन ID")} hint={t("No email? Type a short ID such as sanjay", "ईमेल नहीं है? छोटा ID लिखें, जैसे sanjay")}>
        <TextIn value={login} onValue={(v) => { setLogin(v); setBad(""); }} inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" />
      </Field>
      <Err error={bad} />
      <Field label={t("Role", "भूमिका")}><Select value={role} onChange={setRole} options={ROLES.map(([v, en, hi]) => ({ value: v, label: t(en, hi) }))} /></Field>
      <Field label={t("Temporary password", "अस्थायी पासवर्ड")} hint={t("At least 8 characters. Shown only once, so share it now.", "कम से कम 8 अक्षर। सिर्फ एक बार दिखेगा, अभी भेज दें।")}>
        <span className="inline"><TextIn value={password} onValue={setPassword} className="mono" autoComplete="new-password" spellCheck={false} />
          <Btn onClick={() => setPassword(newPassword())}>{t("New", "नया")}</Btn></span>
      </Field>
      <div className="actions">
        <Btn kind="primary" disabled={busy || !name.trim() || password.length < 8} onClick={() => {
          const l = login.trim();
          if (!(l.includes("@") || isLoginId(l))) { setBad(t("Use an email, or an ID of letters and numbers (2 to 31 characters).", "ईमेल लिखें, या अक्षर और अंकों वाला ID (2 से 31 अक्षर)।")); return; }
          onSubmit({ full_name: name.trim(), email: toLogin(l), role, password });
        }}>{busy ? t("Saving…", "सेव हो रहा है…") : t("Create login", "लॉगिन बनाएँ")}</Btn>
        <Btn onClick={onCancel} disabled={busy}>{t("Cancel", "रद्द करें")}</Btn>
      </div>
    </div>
  );
}

function Manage({ s, self, busy, roleName, onRole, onReset, onActive }: {
  s: Row; self: boolean; busy: boolean; roleName: (r: string) => string;
  onRole: (r: string) => void; onReset: () => void; onActive: (a: boolean) => void;
}) {
  const t = useT();
  const [role, setRole] = useState<string>(s.role);
  const [confirmOff, setConfirmOff] = useState(false);
  return (
    <div className="detail stack">
      {!self && s.active && (
        <Field label={t("Role", "भूमिका")}>
          <span className="inline"><Select value={role} onChange={setRole} options={ROLES.map(([v]) => ({ value: v, label: roleName(v) }))} />
            <Btn kind="primary" disabled={busy || role === s.role} onClick={() => onRole(role)}>{t("Save role", "भूमिका सेव करें")}</Btn></span>
        </Field>
      )}
      <div className="actions">
        {s.active && <Btn disabled={busy} onClick={onReset}>{t("Reset password", "पासवर्ड रीसेट करें")}</Btn>}
        {!self && s.active && !confirmOff && <Btn kind="danger" disabled={busy} onClick={() => setConfirmOff(true)}>{t("Switch off login", "लॉगिन बंद करें")}</Btn>}
        {!s.active && <Btn kind="primary" disabled={busy} onClick={() => onActive(true)}>{t("Switch login back on", "लॉगिन फिर से चालू करें")}</Btn>}
      </div>
      {confirmOff && (
        <div className="confirm">
          <p>{t("They will be signed out and see nothing. Switch off?", "वे बाहर हो जाएँगे और कुछ नहीं देख पाएँगे। बंद करें?")}</p>
          <div className="actions">
            <Btn kind="danger" disabled={busy} onClick={() => { setConfirmOff(false); onActive(false); }}>{t("Yes, switch off", "हाँ, बंद करें")}</Btn>
            <Btn onClick={() => setConfirmOff(false)}>{t("Cancel", "रद्द करें")}</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

function ShareCard({ s, onDone }: { s: Shared; onDone: () => void }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const link = window.location.href.split("#")[0];
  const message = `Rich Alloys portal\n${link}\n${t("Login", "लॉगिन")}: ${s.login}\n${t("Password", "पासवर्ड")}: ${s.password}`;
  return (
    <div className="card share" role="status">
      <p><strong>{s.created ? t("Login created for", "लॉगिन बन गया:") : t("New password set for", "नया पासवर्ड सेट हुआ:")} {s.name}</strong></p>
      <dl className="kv">
        <div><dt>{t("Login", "लॉगिन")}</dt><dd className="mono">{s.login}</dd></div>
        <div><dt>{t("Password", "पासवर्ड")}</dt><dd className="mono big">{s.password}</dd></div>
      </dl>
      <p className="small">{t("Send these to the person now. The password cannot be seen again; if it is lost, reset it.", "ये जानकारी अभी भेज दें। पासवर्ड दोबारा नहीं दिखेगा; खो जाए तो रीसेट करें।")}</p>
      <div className="actions">
        <a className="btn primary" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener">{t("Send on WhatsApp", "WhatsApp पर भेजें")}</a>
        <Btn onClick={() => navigator.clipboard?.writeText(message).then(() => setCopied(true))}>{copied ? t("Copied", "कॉपी हो गया") : t("Copy", "कॉपी करें")}</Btn>
        <Btn onClick={onDone}>{t("Done", "हो गया")}</Btn>
      </div>
    </div>
  );
}
