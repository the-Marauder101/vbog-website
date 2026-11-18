import { useEffect, useState } from "react";
import { api } from "./api";
import { tr, type Key, type Lang } from "./i18n";
import { ROLES, type Deal, type Profile, type Role } from "./types";
import Login from "./Login";
import Deals from "./Deals";
import DealPage, { type DealTab } from "./DealPage";
import NewDeal from "./NewDeal";
import Payables from "./Payables";
import Tally from "./Tally";
import Admin from "./Admin";
import { online, pause, resume, useUploads } from "./uploads";

type View = "deals" | "payables" | "tally" | "admin";
const VIEWS: [View, Key][] = [["deals", "deals"], ["payables", "payables"], ["tally", "tally"], ["admin", "admin"]];

export default function App() {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem("lang") === "hi" ? "hi" : "en"));
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [deal, setDeal] = useState<{ deal: Deal; tab?: DealTab } | null>(null);
  const [view, setView] = useState<View>("deals");
  const [creating, setCreating] = useState(false);
  const t = tr(lang);
  const queue = useUploads();
  const [, setNet] = useState(0);
  useEffect(() => {
    const f = () => setNet((n) => n + 1);
    window.addEventListener("online", f); window.addEventListener("offline", f);
    return () => { window.removeEventListener("online", f); window.removeEventListener("offline", f); };
  }, []);

  useEffect(() => { localStorage.setItem("lang", lang); document.documentElement.lang = lang; }, [lang]);
  useEffect(() => { api.currentUser().then(setUserId); return api.onAuthChange(setUserId); }, []);
  useEffect(() => {
    if (!userId) { setProfile(undefined); setDeal(null); setView("deals"); setCreating(false); pause(); return; }
    api.profile(userId).then(setProfile).catch(() => setProfile(null));
    resume(userId);
  }, [userId]);

  // Open a deal by id (from Payables or after creating one): fetch its list row for the header.
  function openDeal(id: string, tab?: DealTab) {
    api.deals().then(({ deals }) => { const d = deals.find((x) => x.id === id); if (d) setDeal({ deal: d, tab }); });
  }

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">Rich Alloys<span> · Palghar</span></div>
        <div className="top-actions">
          <button className="link" onClick={() => setLang(lang === "en" ? "hi" : "en")}>
            {lang === "en" ? "हिंदी" : "English"}
          </button>
          {userId && <button className="link" onClick={() => api.signOut()}>{t("signOut")}</button>}
        </div>
      </header>
      {api.demo && (
        <div className="demo">
          <span>{t("demoBanner")}</span>
          {profile && (
            <label>{t("demoRole")}{" "}
              <select value={profile.role} onChange={(e) => {
                const role = e.target.value as Role;
                api.setDemoRole?.(role); setProfile({ ...profile, role });
              }}>
                {ROLES.map((r) => <option key={r} value={r}>{t(`role_${r}` as Key)}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
      {profile && !api.demo && (
        <nav className="tabs main-tabs" aria-label={t("sections")}>
          {VIEWS.map(([v, label]) => (
            <button key={v} aria-current={view === v && !deal && !creating ? "page" : undefined}
                    onClick={() => { setView(v); setDeal(null); setCreating(false); }}>{t(label)}</button>
          ))}
        </nav>
      )}
      {queue.length > 0 && (
        <div className={`pending-bar ${queue.some((q) => q.state === "failed") ? "bad" : ""}`} role="status">
          <strong>{t("pendingCount")}: {queue.length}.</strong>{" "}
          {queue.some((q) => q.state === "failed") ? t("pendingFailed") : online() ? t("pendingOnline") : t("pendingOffline")}
        </div>
      )}
      <main>
        {!userId ? <Login t={t} />
          : profile === undefined ? <p className="muted">{t("loading")}</p>
          : profile === null ? <p className="notice">{t("noProfile")}</p>
          : deal ? <DealPage key={deal.deal.id} t={t} lang={lang} deal={deal.deal} tab={deal.tab} profile={profile} onBack={() => setDeal(null)} />
          : creating ? <NewDeal t={t} lang={lang} userId={profile.id} onCancel={() => setCreating(false)}
                         onCreated={(id) => { setCreating(false); openDeal(id, "weights"); }} />
          : view === "payables" ? <Payables t={t} onOpenDeal={(id) => openDeal(id, "pay")} />
          : view === "tally" ? <Tally t={t} />
          : view === "admin" ? <Admin t={t} me={profile} />
          : <Deals t={t} onOpen={(d) => setDeal({ deal: d })} onNew={api.demo ? undefined : () => setCreating(true)} />}
      </main>
    </div>
  );
}
