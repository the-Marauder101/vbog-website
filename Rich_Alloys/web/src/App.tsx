import { useEffect, useState } from "react";
import { api } from "./api";
import { tr, type Key, type Lang } from "./i18n";
import type { Deal, Profile, Role } from "./types";
import Login from "./Login";
import Deals from "./Deals";
import DealDocs from "./DealDocs";

const roles: Role[] = ["gate", "factory", "factory_accounts", "ho_accounts", "owner", "deal_desk", "vbog_admin"];

export default function App() {
  const [lang, setLang] = useState<Lang>(() => (localStorage.getItem("lang") === "hi" ? "hi" : "en"));
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [deal, setDeal] = useState<Deal | null>(null);
  const t = tr(lang);

  useEffect(() => { localStorage.setItem("lang", lang); document.documentElement.lang = lang; }, [lang]);
  useEffect(() => { api.currentUser().then(setUserId); return api.onAuthChange(setUserId); }, []);
  useEffect(() => {
    if (!userId) { setProfile(undefined); setDeal(null); return; }
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
                {roles.map((r) => <option key={r} value={r}>{t(`role_${r}` as Key)}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
      <main>
        {!userId ? <Login t={t} />
          : profile === undefined ? <p className="muted">{t("loading")}</p>
          : profile === null ? <p className="notice">{t("noProfile")}</p>
          : deal ? <DealDocs t={t} lang={lang} deal={deal} profile={profile} onBack={() => setDeal(null)} />
          : <Deals t={t} onOpen={setDeal} />}
      </main>
    </div>
  );
}
