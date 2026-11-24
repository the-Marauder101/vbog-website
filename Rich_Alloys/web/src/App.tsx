import { useEffect, useState, type FormEvent } from "react";
import { configured, go, LangCtx, MeCtx, q, rpc, sb, toLogin, useRoute, useT, type Lang, type Me } from "./lib";
import { onUploaded, online, pause, resume, useUploads } from "./uploads";
import { Btn, Err, Toaster, toast } from "./ui";
import Home from "./screens/Home";
import Lots from "./screens/Lots";
import Deal from "./screens/Deal";
import Lot from "./screens/Lot";
import Payables from "./screens/Payables";
import Tally from "./screens/Tally";
import Stock from "./screens/Stock";
import Admin from "./screens/Admin";
import Supplier from "./screens/Supplier";
import Docs from "./screens/Docs";

export default function App() {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem("lang") === "hi" ? "hi" : "en"));
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const route = useRoute();
  const queue = useUploads();
  const [, setNet] = useState(0);
  useEffect(() => {
    const f = () => setNet((n) => n + 1);
    window.addEventListener("online", f); window.addEventListener("offline", f);
    return () => { window.removeEventListener("online", f); window.removeEventListener("offline", f); };
  }, []);

  useEffect(() => { localStorage.setItem("lang", lang); document.documentElement.lang = lang; }, [lang]);
  useEffect(() => onUploaded(() => toast(["File uploaded", "फ़ाइल अपलोड हो गई"])), []);
  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setUserId(data.session?.user.id ?? null));
    const { data } = sb.auth.onAuthStateChange((_e, s) => setUserId(s?.user.id ?? null));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (!userId) { setMe(userId === null ? null : undefined); pause(); return; }
    resume(userId);   // files left waiting on this phone by this person go up now
    (async () => {
      const p = await q<{ id: string; full_name: string; role: string } | null>(sb.from("profiles").select("id, full_name, role").eq("id", userId).eq("active", true).maybeSingle());
      if (!p) { setMe(null); return; }
      const actions = await rpc<string[]>("my_actions");
      setMe({ ...p, actions: new Set(actions ?? []) });
    })().catch(() => setMe(null));
  }, [userId]);

  const T = (en: string, hi: string) => (lang === "hi" ? hi : en);
  const nav = me ? [
    { id: "", label: T("Home", "होम"), icon: "⌂", show: true },
    { id: "lots", label: T("Lots", "लॉट"), icon: "▤", show: true },
    { id: "payables", label: T("Payables", "देनदारी"), icon: "₹", show: me.actions.has("money_view") },
    { id: "tally", label: T("Tally", "टैली"), icon: "✓", show: me.actions.has("tally_factory") || me.actions.has("tally_office") || me.actions.has("admin") },
    { id: "stock", label: T("Stock", "स्टॉक"), icon: "◫", show: me.actions.has("production_edit") || me.actions.has("stock_edit") || me.actions.has("admin") },
    { id: "docs", label: T("Docs", "दस्तावेज़"), icon: "▣", show: me.actions.has("money_view") || me.actions.has("supplier_onboard") || me.actions.has("doc_approve") },
    { id: "admin", label: T("Admin", "एडमिन"), icon: "⚙", show: me.actions.has("admin") },
  ].filter((n) => n.show) : [];
  const [r0, r1, r2] = route;
  const allowed = (id: string) => nav.some((n) => n.id === id);

  let page: JSX.Element;
  if (!me) page = <></>;
  else if (r0 === "lots") page = <Lots openNew={r1 === "new"} />;
  else if (r0 === "deal" && r1) page = <Deal id={r1} openArrival={r2 === "arrive"} key={r1} />;
  else if (r0 === "lot" && r1) page = <Lot id={r1} tab={r2} key={r1} />;
  else if (r0 === "supplier" && r1) page = <Supplier id={r1} key={r1} />;
  else if ((r0 === "payables" || r0 === "cash" || r0 === "money") && allowed("payables")) page = <Payables tab={r0 === "cash" ? "topay" : r1} />;
  else if (r0 === "tally" && allowed("tally")) page = <Tally tab={r1} />;
  else if (r0 === "docs" && allowed("docs")) page = <Docs tab={r1} />;
  else if (r0 === "stock" && allowed("stock")) page = <Stock openProduction={r1 === "production"} />;
  else if (r0 === "admin" && allowed("admin")) page = <Admin tab={r1} />;
  else page = <Home />;

  return (
    <LangCtx.Provider value={lang}>
      <div className="shell">
        <header className="top">
          <a className="brand" href="#/">Rich Alloys<span> · {T("Purchase desk", "खरीद डेस्क")}</span></a>
          {me && <nav className="topnav">{nav.map((n) => <a key={n.id} href={`#/${n.id}`} className={(r0 ?? "") === n.id ? "on" : ""}>{n.label}</a>)}</nav>}
          <div className="top-actions">
            {allowed("admin") && <a className="link gear" href="#/admin" aria-label={T("Admin", "एडमिन")} title={T("Admin", "एडमिन")}>⚙</a>}
            <button type="button" className="link" onClick={() => setLang(lang === "en" ? "hi" : "en")}>{lang === "en" ? "हिंदी" : "English"}</button>
            {userId && <button type="button" className="link" onClick={() => { sb.auth.signOut(); go(""); }}>{T("Sign out", "साइन आउट")}</button>}
          </div>
        </header>
        {queue.length > 0 && (
          <div className={`pending-bar ${queue.some((x) => x.state === "failed") ? "bad" : ""}`} role="status">
            <strong>{T("Not uploaded yet", "अभी अपलोड नहीं हुईं")}: {queue.length}.</strong>{" "}
            {queue.some((x) => x.state === "failed") ? T("Some files were refused. Open the deal to see why.", "कुछ फ़ाइलें अस्वीकार हुईं। कारण देखने के लिए सौदा खोलें।")
              : online() ? T("Uploading now. Keep this page open.", "अपलोड हो रहा है। यह पेज खुला रखें।")
              : T("No network. Files are saved on this phone and will upload by themselves.", "नेटवर्क नहीं है। फ़ाइलें फ़ोन में सेव हैं, नेटवर्क आते ही अपने आप अपलोड होंगी।")}
          </div>
        )}
        <main>
          {!configured ? <p className="notice">Supabase keys are missing. Put the project URL and anon key in config.js.</p>
            : userId === undefined || (userId && me === undefined) ? <p className="muted pad">{T("Loading…", "लोड हो रहा है…")}</p>
            : !userId ? <Login />
            : me === null ? <p className="notice">{T("Your login works, but you have not been given a role yet. Ask the admin to add you.", "आपका लॉगिन सही है, पर अभी आपको कोई भूमिका नहीं दी गई है। एडमिन से कहें।")}</p>
            : me ? <MeCtx.Provider value={me}>{page}</MeCtx.Provider> : null}
        </main>
        {me && (
          <nav className="bottomnav" aria-label={T("Main", "मुख्य")}>
            {nav.filter((n) => n.id !== "admin").map((n) => <a key={n.id} href={`#/${n.id}`} className={(r0 ?? "") === n.id ? "on" : ""}><span aria-hidden="true">{n.icon}</span>{n.label}</a>)}
          </nav>
        )}
        <Toaster />
      </div>
    </LangCtx.Provider>
  );
}

function Login() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    const { error } = await sb.auth.signInWithPassword({ email: toLogin(email), password });
    if (error) setError(error.message);
    setBusy(false);
  }
  return (
    <form className="card login" onSubmit={submit}>
      <h1>{t("Sign in", "साइन इन")}</h1>
      <label className="field"><span className="label">{t("Email or login ID", "ईमेल या लॉगिन ID")}</span><input type="text" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label className="field"><span className="label">{t("Password", "पासवर्ड")}</span><input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      <Err error={error} />
      <Btn kind="primary" className="block" type="submit" disabled={busy}>{busy ? t("Signing in…", "साइन इन हो रहा है…") : t("Sign in", "साइन इन")}</Btn>
    </form>
  );
}
