import { useEffect, useState } from "react";
import { api } from "./api";
import { tr, type Key, type Lang } from "./i18n";
import { canManageStaff, ROLES, type Deal, type Profile, type Role } from "./types";
import Login from "./Login";
import Deals from "./Deals";
import DealDocs from "./DealDocs";
import Staff from "./Staff";

export default function App() {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem("lang") === "hi" ? "hi" : "en"));
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [deal, setDeal] = useState<Deal | null>(null);
  const [view, setView] = useState<"deals" | "staff">("deals");
  const t = tr(lang);

  useEffect(() => { localStorage.setItem("lang", lang); document.documentElement.lang = lang; }, [lang]);
  useEffect(() => { api.currentUser().then(setUserId); return api.onAuthChange(setUserId); }, []);
  useEffect(() => {
    if (!userId) { setProfile(undefined); setDeal(null); setView("deals"); return; }
    api.profile(userId).then(setProfile).catch(() => setProfile(null));
  }, [userId]);

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
      {profile && canManageStaff(profile.role) && (
        <nav className="tabs" aria-label="Sections">
          {(["deals", "staff"] as const).map((v) => (
            <button key={v} aria-current={view === v ? "page" : undefined}
                    onClick={() => { setView(v); setDeal(null); }}>{t(v)}</button>
          ))}
        </nav>
      )}
      <main>
        {!userId ? <Login t={t} />
          : profile === undefined ? <p className="muted">{t("loading")}</p>
          : profile === null ? <p className="notice">{t("noProfile")}</p>
          : view === "staff" && canManageStaff(profile.role) ? <Staff t={t} me={profile} />
          : deal ? <DealDocs t={t} lang={lang} deal={deal} profile={profile} onBack={() => setDeal(null)} />
          : <Deals t={t} onOpen={setDeal} />}
      </main>
    </div>
  );
}
