/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║         GYM NOUVEL ÉLAN — SaaS Production Ready v2.1            ║
 * ║  React + Vite + Google Apps Script + Google Sheets              ║
 * ║                                                                  ║
 * ║  v2.1 :                                                          ║
 * ║  • Mots de passe simples stockés en localStorage                ║
 * ║  • Modifiables par le CEO depuis l'app (vue Paramètres)         ║
 * ║  • Fallback offline via localStorage                             ║
 * ║  • Retry automatique sur erreurs réseau                         ║
 * ║  • Dashboard avec graphiques revenus (mini sparklines SVG)      ║
 * ║  • Responsive mobile complet                                     ║
 * ║  • Confirmation modale avant actions critiques                  ║
 * ║  • Recherche avancée multi-critères clients                     ║
 * ║  • Historique complet par client                                 ║
 * ║  • Optimisation renders (memo, callback, useMemo)               ║
 * ║  • Gestion erreurs réseau avec messages utilisateur             ║
 * ║  • Export CSV enrichi                                            ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import {
  useState, useEffect, useMemo, useCallback,
  useRef, memo, createContext, useContext,
} from "react";
// Importer Html5Qrcode pour le scanner QR
import { Html5Qrcode } from "html5-qrcode";

// ═══════════════════════════════════════════════════════════════════
// 1. CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

const CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycbw2X-CBg8RKbKFaJVNWHBa_Y6hTZYpThUt_C6M7YRpNhRxrKBavWU3aDxe_dtJ-U28h/exec",
  API_URL_ARTS: "https://script.google.com/macros/s/AKfycbzrxM5V9GC4AhOyjnS9KARyKmrsdJ6F3zN0vlSEnSKzpSx8u5_zasWuyAKHbVFyNjZ03g/exec",
  APP_NAME: "Gym Nouvel Élan",
  VERSION: "2.1.0",
  PASSWORDS_KEY: "gym_passwords",
  REFRESH_INTERVAL: 120_000,
  SESSION_TTL: 8 * 60 * 60 * 1000,
  MAX_RETRY: 3,
  RETRY_DELAY: 1500,
  CACHE_KEY: "gym_cache_v2",
  SESSION_KEY: "gym_session_v2",
};

// Mots de passe par défaut — modifiables depuis l'app (vue Paramètres, admin uniquement)
const DEFAULT_PASSWORDS = {
  admin: "Bavon1986",
  staff: "20GYM26",
};

// Métadonnées des comptes (rôle, nom affiché) — ne jamais stocker le mot de passe ici
const USER_META = {
  admin: { role: "admin", displayName: "Administrateur" },
  staff: { role: "staff", displayName: "Staff" },
};

// ─── Gestionnaire de mots de passe (localStorage) ──────────────────
const pwdManager = {
  /** Lit les mots de passe depuis localStorage, fallback sur les defaults */
  load() {
    try {
      const raw = localStorage.getItem(CONFIG.PASSWORDS_KEY);
      if (!raw) return { ...DEFAULT_PASSWORDS };
      const stored = JSON.parse(raw);
      // S'assurer que les deux clés existent
      return {
        admin: stored.admin || DEFAULT_PASSWORDS.admin,
        staff: stored.staff || DEFAULT_PASSWORDS.staff,
      };
    } catch {
      return { ...DEFAULT_PASSWORDS };
    }
  },
  /** Sauvegarde les mots de passe en localStorage */
  save(passwords) {
    try {
      localStorage.setItem(CONFIG.PASSWORDS_KEY, JSON.stringify({
        admin: passwords.admin,
        staff: passwords.staff,
      }));
    } catch {}
  },
  /** Remet les mots de passe par défaut */
  reset() {
    try {
      localStorage.removeItem(CONFIG.PASSWORDS_KEY);
    } catch {}
    return { ...DEFAULT_PASSWORDS };
  },
};

// Permissions par rôle
const PERMISSIONS = {
  admin: ["delete_client", "delete_abo", "view_caisse", "filter_dates", "export", "manage_sessions", "view_stats"],
  staff: ["view_caisse", "export", "manage_sessions"],
};

const can = (role, permission) => PERMISSIONS[role]?.includes(permission) ?? false;

// ═══════════════════════════════════════════════════════════════════
// 2. DONNÉES MÉTIER
// ═══════════════════════════════════════════════════════════════════

// Fonctions pour obtenir les prix dynamiques
function getSubscriptionPrices(config) {
  const c = config || {};
  return {
    mensuel:   { label: "Mensuel Illimité",  price: Number(c.subscription_mensuel) || 115000, duration: 30, maxSessions: null },
    seances16: { label: "16 Séances / Mois", price: Number(c.subscription_seances16) || 80500, duration: 30, maxSessions: 16 },
    seances12: { label: "12 Séances / Mois", price: Number(c.subscription_seances12) || 57500, duration: 30, maxSessions: 12 },
  };
}

function getSessionRates(config) {
  const c = config || {};
  return {
    no_coach_1h:     { label: "Sans coach — 1h",    price: Number(c.session_no_coach_1h) || 4500,  durationMinutes: 60 },
    no_coach_2h:     { label: "Sans coach — 2h",    price: Number(c.session_no_coach_2h) || 7500, durationMinutes: 120 },
    with_coach_1h:   { label: "Avec coach — 1h",    price: Number(c.session_with_coach_1h) || 6500, durationMinutes: 60 },
    with_coach_1h30: { label: "Avec coach — 1h30",  price: Number(c.session_with_coach_1h30) || 8000, durationMinutes: 90 },
    with_coach_2h:   { label: "Avec coach — 2h",    price: Number(c.session_with_coach_2h) || 10000, durationMinutes: 120 },
  };
}

// Variables pour stocker les prix en mémoire (mise à jour par la config)
let currentSubTypes = getSubscriptionPrices();
let currentSessionRates = getSessionRates();

// Fonction pour mettre à jour les prix
function updatePrices(config) {
  currentSubTypes = getSubscriptionPrices(config);
  currentSessionRates = getSessionRates(config);
}

// Pour la compatibilité avec le code existant, on garde les constantes
// mais elles seront écrasées par les prix dynamiques
const SUB_TYPES = currentSubTypes;
const SESSION_RATES = currentSessionRates;

const OBJECTIFS = ["Perte de poids", "Prise de masse", "Entretien / Santé", "Cardio", "Préparation sportive"];
const COLORS = ["#4ade80", "#60a5fa", "#f472b6", "#fb923c", "#a78bfa", "#34d399", "#fbbf24", "#e879f9"];

// ═══════════════════════════════════════════════════════════════════
// 2-B. HOOK CONFIGURATION (backend)
// ═══════════════════════════════════════════════════════════════════

// Clé localStorage pour le cache de configuration
const CONFIG_CACHE_KEY = "gym_app_config";

const defaultConfig = {
  gymName: "Gym Nouvel Élan",
  adminPassword: "Bavon1986",
  staffPassword: "20GYM26",
  subscription_mensuel: "115000",
  subscription_seances16: "80500",
  subscription_seances12: "57500",
  session_no_coach_1h: "4500",
  session_no_coach_2h: "7500",
  session_with_coach_1h: "6500",
  session_with_coach_1h30: "8000",
  session_with_coach_2h: "10000",
};

function useAppConfig(showToast) {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);

  // Charger la configuration depuis le backend
  const loadConfig = useCallback(async (silent = false) => {
    if (!silent) setSyncing(true);
    setError(null);
    
    try {
      const res = await apiGetConfig();
      
      // Si la réponse est un tableau (format attendu)
      const configData = Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : res);
      
      if (configData && typeof configData === 'object') {
        // Fusionner avec les valeurs par défaut
        const merged = { ...defaultConfig };
        Object.keys(configData).forEach(key => {
          if (key in merged) {
            merged[key] = String(configData[key]);
          }
        });
        setConfig(merged);
        // Mettre à jour les prix dans les constantes globales
        updatePrices(merged);
        // Sauvegarder en cache
        try {
          localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: merged }));
        } catch {}
        setLoading(false);
        if (!silent) showToast("Configuration chargée", "Données synchronisées", "success");
        return merged;
      } else {
        throw new Error("Format de données invalide");
      }
    } catch (err) {
      // Fallback sur localStorage ou défaut
      try {
        const cached = localStorage.getItem(CONFIG_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.data) {
            setConfig(parsed.data);
            setLoading(false);
            if (!silent) showToast("Mode hors ligne", "Configuration depuis le cache", "warning");
            return parsed.data;
          }
        }
      } catch {}
      
      // Fallback sur les valeurs par défaut
      setConfig({ ...defaultConfig });
      setLoading(false);
      if (!silent) showToast("Configuration par défaut", "Impossible de charger la config", "error");
      return { ...defaultConfig };
    } finally {
      if (!silent) setSyncing(false);
    }
  }, [showToast]);

  // Mettre à jour la configuration dans le backend
  const updateConfig = useCallback(async (updates) => {
    setSyncing(true);
    try {
      const current = config || defaultConfig;
      const updated = { ...current, ...updates };
      
      const result = await apiUpdateConfig(updates);
      if (result?.success) {
        setConfig(updated);
        // Mettre à jour le cache
        try {
          localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: updated }));
        } catch {}
        showToast("Configuration mise à jour", "Synchronisation réussie", "success");
        return true;
      } else {
        throw new Error(result?.error || "Erreur inconnue");
      }
    } catch (err) {
      showToast("Erreur", "Impossible de synchroniser les modifications", "error");
      return false;
    } finally {
      setSyncing(false);
    }
  }, [config, showToast]);

  // Chargement initial
  useEffect(() => {
    loadConfig(true);
  }, []);

  return { config, loading, syncing, error, loadConfig, updateConfig };
}

// ═══════════════════════════════════════════════════════════════════
// 3. SESSION
// ═══════════════════════════════════════════════════════════════════
function saveSession(user) {
  const session = { ...user, expiresAt: Date.now() + CONFIG.SESSION_TTL };
  try { sessionStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify(session)); } catch {}
}

function loadSession() {
  try {
    const raw = sessionStorage.getItem(CONFIG.SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (Date.now() > session.expiresAt) {
      sessionStorage.removeItem(CONFIG.SESSION_KEY);
      return null;
    }
    return session;
  } catch { return null; }
}

function clearSession() {
  try { sessionStorage.removeItem(CONFIG.SESSION_KEY); } catch {}
}

// ═══════════════════════════════════════════════════════════════════
// 4. API + CACHE + RETRY
// ═══════════════════════════════════════════════════════════════════

/** Pause utilitaire */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Fetch avec retry exponentiel */
async function fetchWithRetry(url, options = {}, retries = CONFIG.MAX_RETRY) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { ...options, redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i === retries - 1) throw err;
      await sleep(CONFIG.RETRY_DELAY * (i + 1));
    }
  }
}

// Après
const apiGet = (sheet) =>
  fetchWithRetry(`${CONFIG.API_URL}?sheet=${sheet}&t=${Date.now()}`);

const apiPost = (action, data = {}) =>
  fetchWithRetry(CONFIG.API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ action, ...data }),
  });

// ─── API pour les arts martiaux (nouvelle URL) ──────────────────
const apiGetArts = (sheet) =>
  fetchWithRetry(`${CONFIG.API_URL_ARTS}?sheet=${sheet}&t=${Date.now()}`);

const apiPostArts = (action, data = {}) =>
  fetchWithRetry(CONFIG.API_URL_ARTS, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ action, ...data }),
  });

// ─── API pour la configuration ──────────────────────────────────
const apiGetConfig = () =>
  fetchWithRetry(`${CONFIG.API_URL_ARTS}?sheet=config&t=${Date.now()}`);

const apiUpdateConfig = (data) =>
  apiPostArts("updateConfig", { data });

/** Persistance locale (offline fallback) */
const cache = {
  save(data) {
    try { localStorage.setItem(CONFIG.CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch {}
  },
  load() {
    try {
      const raw = localStorage.getItem(CONFIG.CACHE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  },
  clear() {
    try { localStorage.removeItem(CONFIG.CACHE_KEY); } catch {}
  },
};

// ═══════════════════════════════════════════════════════════════════
// 5. UTILS
// ═══════════════════════════════════════════════════════════════════

const fmtGNF = (n) =>
  new Intl.NumberFormat("fr-GN", { style: "currency", currency: "CDF", minimumFractionDigits: 0 })
    .format(Number(n) || 0);

const fmtDate = (d) => {
  if (!d) return "—";
  try { return new Intl.DateTimeFormat("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(d)); }
  catch { return "—"; }
};

const fmtTime = (d) => {
  if (!d) return "";
  try { return new Date(d).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }); }
  catch { return ""; }
};

const todayISO = () => new Date().toISOString().split("T")[0];
const genId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const sameDay = (a, b) => {
  try { return new Date(a).toDateString() === new Date(b).toDateString(); }
  catch { return false; }
};
const sameMonth = (a, b) => {
  try {
    const d1 = new Date(a), d2 = new Date(b);
    return d1.getMonth() === d2.getMonth() && d1.getFullYear() === d2.getFullYear();
  } catch { return false; }
};
const addDays = (date, n) => { const d = new Date(date); d.setDate(d.getDate() + n); return d; };
const diffDays = (a, b) => Math.ceil((new Date(a) - new Date(b)) / 86_400_000);

/** Calcule les 7 derniers jours pour les sparklines */
function last7Days() {
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(new Date(), -(6 - i));
    return d.toISOString().split("T")[0];
  });
}

// ═══════════════════════════════════════════════════════════════════
// 6. NORMALISATION DONNÉES
// ═══════════════════════════════════════════════════════════════════

const normalizeClient = (r) => ({
  id: String(r.id || genId()),
  nom: String(r.nom || ""),
  telephone: String(r.telephone || ""),
  objectif: String(r.objectif || ""),
  statut: String(r.statut || "actif"),
  date_inscription: r.date_inscription ? String(r.date_inscription) : todayISO(),
});

const normalizeAbonnement = (r) => ({
  id: String(r.id || genId()),
  client_id: String(r.client_id || ""),
  type: String(r.type || "mensuel"),
  debut: r.debut ? String(r.debut) : todayISO(),
  fin: r.fin ? String(r.fin) : "",
  seances_restantes: Number(r.seances_restantes ?? 0),
  statut: String(r.statut || "actif"),
});

const normalizeCaisse = (r) => ({
  id: String(r.id || genId()),
  date: r.date ? String(r.date) : new Date().toISOString(),
  description: String(r.description || ""),
  montant: Number(r.montant || 0),
});

// ═══════════════════════════════════════════════════════════════════
// 7. LOGIQUE MÉTIER
// ═══════════════════════════════════════════════════════════════════

const getSubStatus = (fin, now) => {
  if (!fin) return "expired";
  const d = diffDays(new Date(fin), now);
  if (d < 0) return "expired";
  if (d <= 3) return "expiring";
  return "active";
};

const getClientSubStatus = (clientId, abonnements, now) => {
  const list = abonnements
    .filter(a => a.client_id === String(clientId))
    .sort((a, b) => new Date(b.fin) - new Date(a.fin));
  if (!list.length) return "none";
  return getSubStatus(list[0].fin, now);
};

// ═══════════════════════════════════════════════════════════════════
// 8. CONTEXTES
// ═══════════════════════════════════════════════════════════════════

const AuthContext = createContext(null);
const ToastContext = createContext(null);
const SettingsContext = createContext(null);

const useAuth = () => useContext(AuthContext);
const useToast = () => useContext(ToastContext);
const useSettingsCtx = () => useContext(SettingsContext);

// ═══════════════════════════════════════════════════════════════════
// 9. DESIGN SYSTEM — TOKENS + STYLES
// ═══════════════════════════════════════════════════════════════════

const T = {
  // Couleurs
  bg:        "var(--bg)",
  surface:   "var(--surface)",
  surface2:  "var(--surface2)",
  surface3:  "var(--surface3)",
  border:    "var(--border)",
  border2:   "var(--border2)",
  text:      "var(--text)",
  textMid:   "var(--text-mid)",
  textDim:   "var(--text-dim)",
  textFaint: "var(--text-faint)",
  green:     "#4ade80",
  greenDark: "#0d2d1a",
  greenBd:   "#1a4d2a",
  blue:      "#60a5fa",
  blueDark:  "#0d1a2d",
  blueBd:    "#1a2d4d",
  purple:    "#a78bfa",
  orange:    "#fb923c",
  orangeDark:"#2d1500",
  red:       "#f87171",
  redDark:   "#2d0d0d",
  redBd:     "#4d1a1a",
  pink:      "#f472b6",
  yellow:    "#fbbf24",
  whatsapp:  "#25D366",
};

const S = {
  // ── Layout
  app: { display: "flex", minHeight: "100vh", background: T.bg, color: T.text, fontFamily: "'DM Sans','Segoe UI',sans-serif" },

  // ── Sidebar desktop
  sidebar: {
    width: 230, flexShrink: 0, background: T.surface, borderRight: `1px solid ${T.border}`,
    display: "flex", flexDirection: "column", position: "sticky", top: 0, height: "100vh",
    transition: "transform 0.25s ease",
  },
  logo: { padding: "24px 18px 20px", borderBottom: `1px solid ${T.border}` },
  logoSub: { fontSize: 9, letterSpacing: "0.2em", color: T.textDim, textTransform: "uppercase", marginBottom: 5 },
  logoMain: { fontSize: 18, fontWeight: 900, color: T.text, lineHeight: 1.2 },
  logoAccent: { color: T.green },
  logoVersion: { fontSize: 9, color: T.textFaint, marginTop: 4 },
  nav: { flex: 1, padding: "12px 10px", display: "flex", flexDirection: "column", gap: 2, overflowY: "auto" },
  navGroup: { fontSize: 9, color: T.textDim, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", padding: "10px 10px 4px" },
  navItem: (a) => ({
    display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", borderRadius: 9,
    cursor: "pointer", fontSize: 13, fontWeight: a ? 600 : 400, transition: "all 0.1s",
    background: a ? T.surface3 : "transparent", color: a ? T.green : T.textMid,
    border: a ? `1px solid ${T.border2}` : "1px solid transparent",
  }),
  navIcon: { width: 16, textAlign: "center", flexShrink: 0, fontSize: 14 },
  navBadge: { marginLeft: "auto", background: T.redDark, color: T.red, border: `1px solid ${T.redBd}`, borderRadius: 10, fontSize: 9, fontWeight: 800, padding: "1px 6px" },
  sidebarFoot: { padding: "12px 10px 14px", borderTop: `1px solid ${T.border}`, display: "flex", flexDirection: "column", gap: 6 },

  // ── Top bar mobile
  topMobileBar: {
    display: "none",
    "@media(max-width:768px)": { display: "flex" },
  },

  // ── Main
  // ── Top Bar (fixe)
  topBar: {
    position: "fixed", top: 0, left: 0, right: 0, height: 56,
    background: "rgba(9, 9, 9, 0.92)", backdropFilter: "blur(12px)",
    borderBottom: `1px solid ${T.border}`,
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "0 16px", zIndex: 99,
  },
  main: { flex: 1, overflowY: "auto", minWidth: 0, paddingTop: "56px" },
  mainInner: { padding: "28px 32px", maxWidth: 1400 },

  // ── Page header
  pageHeader: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 },
  pageTitle: { fontSize: 22, fontWeight: 800, color: T.text, letterSpacing: "-0.03em", margin: 0 },
  pageSubtitle: { fontSize: 12, color: T.textDim, marginTop: 3 },

  // ── KPI
  kpiGrid: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 24 },
  kpiCard: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: "18px 18px 14px", position: "relative", overflow: "hidden", cursor: "default" },
  kpiBar: (c) => ({
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    background: `linear-gradient(90deg, ${c}00, ${c}, ${c}00)`,
    opacity: 0.85,
    borderRadius: "0 0 2px 2px",
  }),
  kpiLabel: { fontSize: 10, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8, fontWeight: 600 },
  kpiValue: { fontSize: 24, fontWeight: 900, color: T.text, letterSpacing: "-0.04em", lineHeight: 1 },
  kpiSub: { fontSize: 10, color: T.textFaint, marginTop: 5 },
  kpiDelta: (pos) => ({ fontSize: 10, fontWeight: 700, color: pos ? T.green : T.red, marginTop: 3 }),

  // ── Cards
  card: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, overflow: "hidden" },
  cardHead: { padding: "14px 18px", borderBottom: `1px solid ${T.surface3}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 },
  cardTitle: { fontSize: 11, fontWeight: 700, color: T.textMid, textTransform: "uppercase", letterSpacing: "0.1em" },

  // ── Grid layouts
  grid2: { display: "grid", gridTemplateColumns: "1fr 340px", gap: 16 },
  grid3: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 },

  // ── Table
  table: { width: "100%", borderCollapse: "collapse" },
  th: { padding: "10px 14px", textAlign: "left", fontSize: 10, color: "#383838", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.12em", borderBottom: `1px solid ${T.surface3}`, whiteSpace: "nowrap" },
  td: { padding: "12px 14px", fontSize: 13, borderBottom: `1px solid #141414`, verticalAlign: "middle" },

  // ── Boutons
  btn: (v = "ghost") => {
    const m = {
      ghost:   { bg: T.surface3, bd: T.border2, c: "#999" },
      primary: { bg: T.greenDark, bd: T.greenBd, c: T.green },
      danger:  { bg: T.redDark, bd: T.redBd, c: T.red },
      wa:      { bg: "#0d2d18", bd: "#1a4532", c: T.whatsapp },
      orange:  { bg: T.orangeDark, bd: "#4d2500", c: T.orange },
      blue:    { bg: T.blueDark, bd: T.blueBd, c: T.blue },
      purple:  { bg: "#1a0d2d", bd: "#2d1a4d", c: T.purple },
    };
    const x = m[v] || m.ghost;
    return { display: "inline-flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, background: x.bg, border: `1px solid ${x.bd}`, color: x.c, fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "opacity 0.1s", letterSpacing: "0.02em", whiteSpace: "nowrap" };
  },
  iconBtn: (v = "ghost") => {
    const m = { ghost: { bg: T.surface3, bd: "#222", c: T.textDim }, danger: { bg: T.redDark, bd: T.redBd, c: T.red }, info: { bg: T.blueDark, bd: T.blueBd, c: T.blue }, wa: { bg: "#0d2d18", bd: "#1a4532", c: T.whatsapp }, orange: { bg: T.orangeDark, bd: "#4d2500", c: T.orange } };
    const x = m[v] || m.ghost;
    return { width: 30, height: 30, borderRadius: 8, background: x.bg, border: `1px solid ${x.bd}`, color: x.c, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0, fontSize: 13, transition: "opacity 0.1s" };
  },
  btnSmall: (v = "dark") => {
    const m = { green: { bg: T.greenDark, bd: T.greenBd, c: T.green }, blue: { bg: T.blueDark, bd: T.blueBd, c: T.blue }, dark: { bg: T.surface2, bd: T.border2, c: T.textDim }, red: { bg: T.redDark, bd: T.redBd, c: T.red } };
    const x = m[v] || m.dark;
    return { width: "100%", padding: "8px 11px", border: `1px solid ${x.bd}`, borderRadius: 8, background: x.bg, color: x.c, fontSize: 11, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 7, letterSpacing: "0.03em" };
  },

  // ── Badges
  badge: (t) => {
    const m = { active: { bg: "#0d2d1a", c: T.green, bd: T.greenBd }, expiring: { bg: T.orangeDark, c: T.orange, bd: "#4d2e00" }, expired: { bg: T.redDark, c: T.red, bd: T.redBd }, none: { bg: T.surface3, c: T.textDim, bd: T.border2 } };
    const s = m[t] || m.none;
    return { display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: 20, background: s.bg, color: s.c, border: `1px solid ${s.bd}`, fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", whiteSpace: "nowrap" };
  },
  pill: (c) => ({ display: "inline-flex", padding: "2px 9px", borderRadius: 20, background: c + "18", color: c, border: `1px solid ${c}33`, fontSize: 10, fontWeight: 700, whiteSpace: "nowrap" }),
  roleBadge: (role) => ({
    display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 9px", borderRadius: 20,
    background: role === "admin" ? "#2d1a00" : T.blueDark,
    color: role === "admin" ? T.yellow : T.blue,
    border: `1px solid ${role === "admin" ? "#4d3000" : T.blueBd}`,
    fontSize: 10, fontWeight: 700,
  }),

  // ── Formulaires
  fg: { marginBottom: 14 },
  label: { fontSize: 10, color: T.textDim, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", display: "block", marginBottom: 5 },
  input: { width: "100%", background: T.surface2, border: `1px solid ${T.border2}`, borderRadius: 8, padding: "9px 13px", color: T.text, fontSize: 13, outline: "none", boxSizing: "border-box", transition: "border-color 0.15s" },
  searchBar: { width: "100%", background: T.surface2, border: `1px solid ${T.border2}`, borderRadius: 10, padding: "10px 14px 10px 38px", color: T.text, fontSize: 13, outline: "none", boxSizing: "border-box" },

  // ── Modal
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.82)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 },
  modalBox: { background: T.surface, border: `1px solid #252525`, borderRadius: 16, width: "100%", maxWidth: 440, maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 32px 80px rgba(0,0,0,0.7)" },
  modalHead: { padding: "16px 18px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 },
  modalTitle: { fontSize: 15, fontWeight: 700, color: T.text },
  modalBody: { padding: "18px", overflowY: "auto", flex: 1 },
  modalFoot: { padding: "14px 18px", borderTop: `1px solid ${T.border}`, display: "flex", gap: 8, justifyContent: "flex-end", flexShrink: 0 },

  // ── Progress bar
  progress: { width: "100%", height: 4, background: T.surface3, borderRadius: 2, overflow: "hidden" },
  progressFill: (pct, full) => ({ height: "100%", borderRadius: 2, width: `${Math.min(Math.max(pct, 0), 100)}%`, background: full ? T.red : T.green, transition: "width 0.4s" }),

  // ── Misc
  avatar: (c) => ({ width: 34, height: 34, borderRadius: "50%", background: c + "1f", border: `1.5px solid ${c}44`, color: c, fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, letterSpacing: "0.02em" }),
  emptyState: { padding: "52px 24px", textAlign: "center", color: T.textFaint, fontSize: 13 },
  alertRow: { display: "flex", alignItems: "center", gap: 10, padding: "11px 18px", borderBottom: `1px solid #131313` },
  txRow: { display: "flex", alignItems: "center", gap: 10, padding: "10px 18px", borderBottom: `1px solid #131313` },
  divider: { borderTop: `1px solid ${T.border}`, margin: "12px 0" },
  spinner: { width: 36, height: 36, borderRadius: "50%", border: `3px solid ${T.border}`, borderTopColor: T.green, animation: "spin 0.7s linear infinite" },
  offlineBanner: { background: "#2d1500", border: `1px solid #4d2e00`, borderRadius: 10, padding: "10px 16px", marginBottom: 16, fontSize: 12, color: T.orange, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 },

  // ── Subcard (abonnements)
  subCard: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, overflow: "hidden", transition: "border-color 0.15s" },
  subCardHead: { padding: "14px 16px", borderBottom: `1px solid ${T.surface3}`, display: "flex", alignItems: "center", justifyContent: "space-between" },
  subCardBody: { padding: "14px 16px" },
  subCardFoot: { padding: "11px 16px", borderTop: `1px solid ${T.surface3}`, background: "#0d0d0d", display: "flex", alignItems: "center", justifyContent: "space-between" },

  // ── Timer séances
  timerBig: (u) => ({ fontSize: 40, fontWeight: 900, letterSpacing: "-0.05em", color: u ? T.red : T.green, fontVariantNumeric: "tabular-nums", lineHeight: 1 }),
  fPill: (a) => ({ padding: "5px 13px", borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: "pointer", border: `1px solid ${a ? T.green : T.border2}`, background: a ? T.greenDark : T.surface, color: a ? T.green : T.textDim, transition: "all 0.1s" }),

  // ── Toast
  toast: { position: "fixed", bottom: 20, right: 20, zIndex: 3000, background: T.surface, border: `1px solid ${T.border2}`, borderRadius: 12, padding: "12px 16px", fontSize: 13, color: T.text, boxShadow: "0 20px 60px rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-start", gap: 10, maxWidth: 320, minWidth: 260, pointerEvents: "none" },

  // ── Login
  loginWrap: { minHeight: "100vh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 },
  loginBox: { background: T.surface, border: `1px solid ${T.border2}`, borderRadius: 20, padding: "36px 32px", width: "100%", maxWidth: 380, boxShadow: "0 40px 100px rgba(0,0,0,0.6)" },

  // ── Confirm modal
  confirmBox: { background: T.surface, border: `1px solid ${T.redBd}`, borderRadius: 16, width: "100%", maxWidth: 360, padding: "24px 24px 20px", boxShadow: "0 32px 80px rgba(0,0,0,0.7)" },
};

// ═══════════════════════════════════════════════════════════════════
// 10. COMPOSANTS ATOMIQUES
// ═══════════════════════════════════════════════════════════════════

const Avatar = memo(({ name, idx = 0 }) => {
  const init = (name || "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  return <div style={S.avatar(COLORS[idx % COLORS.length])}>{init}</div>;
});

const StatusBadge = memo(({ status }) => {
  const map = { active: "● Actif", expiring: "⚠ Bientôt", expired: "✕ Expiré", none: "– Sans abo." };
  return <span style={S.badge(status)}>{map[status] || map.none}</span>;
});

const WaBtn = memo(({ phone, message, icon }) => {
  const url = `https://wa.me/${(phone || "").replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;
  
  // Icône SVG WhatsApp officiel
  const WhatsappIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ verticalAlign: "middle" }}>
      <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946C.06 5.348 5.397.01 12.008.01c3.202.001 6.212 1.246 8.477 3.514 2.266 2.268 3.507 5.28 3.505 8.484-.004 6.657-5.34 11.997-11.953 11.997-2.005-.001-3.973-.502-5.713-1.457L0 24zm6.59-4.846c1.6.95 3.488 1.451 5.414 1.452 5.334 0 9.68-4.341 9.683-9.671a9.58 9.58 0 0 0-2.835-6.843A9.593 9.593 0 0 0 12.004 1.34C6.673 1.34 2.327 5.68 2.324 11.01c-.001 1.93.504 3.811 1.464 5.421l-.991 3.618 3.715-.973zm11.332-6.52c-.312-.156-1.847-.91-2.128-1.012-.282-.101-.487-.156-.692.156-.204.311-.79.997-.968 1.201-.178.205-.355.228-.667.072-.311-.156-1.317-.485-2.51-1.549-.928-.827-1.554-1.85-1.736-2.162-.182-.311-.02-.48.136-.635.14-.139.312-.363.468-.545.156-.182.208-.312.312-.52.104-.207.052-.389-.026-.545-.078-.156-.692-1.666-.947-2.28-.25-.599-.503-.518-.692-.527-.179-.008-.385-.01-.591-.01-.206 0-.543.078-.827.39-.283.311-1.08 1.054-1.08 2.57 0 1.517 1.102 2.984 1.256 3.193.154.208 2.169 3.312 5.255 4.643.734.316 1.307.504 1.753.646.737.234 1.407.201 1.937.12.59-.09 1.847-.756 2.109-1.451.262-.695.262-1.288.185-1.411-.078-.124-.283-.195-.595-.351z"/>
    </svg>
  );

  return (
    <a href={url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }} onClick={e => e.stopPropagation()}>
      {icon
        ? <div style={S.iconBtn("wa")}>{WhatsappIcon}</div>
        : <button style={{ ...S.btn("wa"), gap: 8 }}>{WhatsappIcon} Relancer</button>
      }
    </a>
  );
});

function Modal({ open, onClose, title, children, footer, maxWidth = 440, closeOnOverlay = true }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
  style={S.overlay}
  onClick={e => {
    if (closeOnOverlay && e.target === e.currentTarget) {
      onClose();
    }
  }}
>
      <div style={{ ...S.modalBox, maxWidth }}>
        <div style={S.modalHead}>
          <span style={S.modalTitle}>{title}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.textDim, fontSize: 22, cursor: "pointer", lineHeight: 1, padding: "0 2px" }}>×</button>
        </div>
        <div style={S.modalBody}>{children}</div>
        {footer && <div style={S.modalFoot}>{footer}</div>}
      </div>
    </div>
  );
}

function ConfirmModal({ open, onClose, onConfirm, title, message, danger = true }) {
  if (!open) return null;
  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={S.confirmBox}>
        <div style={{ fontSize: 28, marginBottom: 10 }}>{danger ? "⚠️" : "❓"}</div>
        <div style={{ fontWeight: 800, fontSize: 15, color: T.text, marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 13, color: T.textDim, lineHeight: 1.55, marginBottom: 20 }}>{message}</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={{ ...S.btn("ghost"), flex: 1, justifyContent: "center" }} onClick={onClose}>Annuler</button>
          <button style={{ ...S.btn(danger ? "danger" : "primary"), flex: 1, justifyContent: "center" }} onClick={() => { onConfirm(); onClose(); }}>
            {danger ? "Confirmer la suppression" : "Confirmer"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MODAL QR CODE ──────────────────────────────────────────────────
function QRCodeModal({ open, onClose, abonnement, client }) {
  const showToast = useToast();

  if (!open || !abonnement || !client) return null;

  const qrData = JSON.stringify({
    id: abonnement.id,
    ts: Date.now()
  });
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrData)}`;
  const cfg = SUB_TYPES[abonnement.type];

  const messageWA = `Bonjour ${client.nom.split(" ")[0]},

✅ Votre abonnement a bien été créé.

🏋️ Formule : ${cfg?.label || abonnement.type}
📅 Début : ${fmtDate(abonnement.debut)}
📅 Fin : ${fmtDate(abonnement.fin)}
🎯 Séances incluses : ${cfg?.maxSessions ? cfg.maxSessions : "♾️ Illimité"}

📱 Voici votre QR code de pointage :
${qrUrl}

Scannez ce code à l'entrée pour pointer vos séances.

Merci pour votre confiance.
Gym Nouvel Élan 💪`;

  const waUrl = `https://wa.me/${(client.telephone || "").replace(/\D/g, "")}?text=${encodeURIComponent(messageWA)}`;

  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ ...S.modalBox, maxWidth: 480 }}>
        <div style={S.modalHead}>
          <span style={S.modalTitle}>📱 QR Code - {client.nom}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: T.textDim, fontSize: 22, cursor: "pointer", lineHeight: 1, padding: "0 2px" }}>×</button>
        </div>
        <div style={S.modalBody}>
          {/* Infos abonnement */}
          <div style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 14px", marginBottom: 16, lineHeight: 1.6, fontSize: 12 }}>
            <div><strong>👤 Client :</strong> {client.nom}</div>
            <div><strong>🏋️ Formule :</strong> {cfg?.label || abonnement.type}</div>
            <div><strong>📅 Début :</strong> {fmtDate(abonnement.debut)}</div>
            <div><strong>📅 Fin :</strong> {fmtDate(abonnement.fin)}</div>
            <div><strong>🎯 Séances :</strong> {cfg?.maxSessions ? `${cfg.maxSessions} séances` : "♾️ Illimité"}</div>
          </div>

          {/* QR Code */}
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <img
              src={qrUrl}
              alt="QR Code"
              style={{ width: 200, height: 200, borderRadius: 12, border: `2px solid ${T.border}`, background: "white" }}
            />
            <div style={{ fontSize: 9, color: T.textFaint, marginTop: 6 }}>
              {qrData}
            </div>
          </div>

          {/* Bouton WhatsApp */}
          {client.telephone ? (
            <a
              href={waUrl}
              target="_blank"
              rel="noreferrer"
              style={{ textDecoration: "none", display: "block" }}
            >
              <button style={{ ...S.btn("wa"), width: "100%", justifyContent: "center", padding: "11px", fontSize: 13 }}>
                💬 Envoyer le QR code sur WhatsApp
              </button>
            </a>
          ) : (
            <div style={{ background: T.redDark, border: `1px solid ${T.redBd}`, borderRadius: 8, padding: "10px 14px", fontSize: 12, color: T.red, textAlign: "center" }}>
              ⚠ Aucun numéro de téléphone enregistré pour ce client
            </div>
          )}

          <button
            style={{ ...S.btn("ghost"), width: "100%", justifyContent: "center", marginTop: 8 }}
            onClick={onClose}
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MODAL SCANNER QR CODE ─────────────────────────────────────────
function QRScannerModal({ open, onClose, abonnements, clients, onCheckIn, onStartSeance }) {
  const showToast = useToast();
  const [scanning, setScanning] = useState(false);
  const [scannedAbo, setScannedAbo] = useState(null);
  const [scannedClient, setScannedClient] = useState(null);
  const [seanceLancee, setSeanceLancee] = useState(false);
  const [pointageModal, setPointageModal] = useState(false);
  const [pointageData, setPointageData] = useState(null);
  const scannerRef = useRef(null);
  const videoRef = useRef(null);

  // Réinitialiser quand la modale s'ouvre
  useEffect(() => {
    if (open) {
      setScannedAbo(null);
      setScannedClient(null);
      setSeanceLancee(false);
      startScanner();
    } else {
      stopScanner();
    }
    return () => stopScanner();
  }, [open]);

  const startScanner = async () => {
    if (!open) return;
    try {
      setScanning(true);
      
      // Créer un conteneur pour la caméra
      const container = document.getElementById("qr-reader-container");
      if (!container) return;

      // Nettoyer le conteneur
      container.innerHTML = "";

      const html5QrCode = new Html5Qrcode("qr-reader-container");
      scannerRef.current = html5QrCode;

      const config = {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0,
      };

      await html5QrCode.start(
        { facingMode: "environment" },
        config,
        onScanSuccess,
        onScanError
      );
    } catch (err) {
      console.error("Erreur scanner:", err);
      showToast("Erreur", "Impossible d'accéder à la caméra", "error");
      setScanning(false);
    }
  };

  const stopScanner = async () => {
    try {
      if (scannerRef.current) {
        await scannerRef.current.stop();
        scannerRef.current.clear();
        scannerRef.current = null;
      }
    } catch (err) {
      // Ignorer les erreurs de stop
    }
    setScanning(false);
  };

  const onScanSuccess = (decodedText) => {
    try {
      // Extraire l'ID du QR code
      let aboId = null;
      try {
        const data = JSON.parse(decodedText);
        aboId = data.id;
      } catch {
        // Si ce n'est pas du JSON, essayer de prendre le texte directement
        aboId = decodedText;
      }

      if (!aboId) {
        showToast("Erreur", "QR code invalide", "error");
        return;
      }

      // Trouver l'abonnement correspondant
      const abo = abonnements.find(a => a.id === aboId);
      if (!abo) {
        showToast("Erreur", "Abonnement non trouvé", "error");
        return;
      }

      // Trouver le client
      const client = clients.find(c => c.id === abo.client_id);
      if (!client) {
        showToast("Erreur", "Client non trouvé", "error");
        return;
      }

      // Vérifier que l'abonnement est actif
      const status = getSubStatus(abo.fin, new Date());
      if (status === "expired") {
        showToast("Abonnement expiré", "Cet abonnement est expiré", "error");
        // On affiche quand même la carte
      }

      setScannedAbo(abo);
      setScannedClient(client);
      setSeanceLancee(false);
      
      // Arrêter le scanner
      stopScanner();
      showToast("QR code scanné", `Client: ${client.nom}`, "success");
    } catch (err) {
      console.error("Erreur scan:", err);
      showToast("Erreur", "QR code invalide", "error");
    }
  };

  const onScanError = (err) => {
    // Ignorer les erreurs de scan (appelées en continu)
  };

  const handlePointer = async () => {
  if (!scannedAbo) return;
  const success = await onCheckIn(scannedAbo.id);
  if (success) {
    const client = clients.find(c => c.id === scannedAbo.client_id);
    setPointageData({
      client,
      abonnement: {
        ...scannedAbo,
        seances_restantes: Math.max(0, scannedAbo.seances_restantes - 1)
      }
    });
    setPointageModal(true);
  }
};

  const handleLancerSeance = () => {
    if (!scannedClient) return;
    // Appeler la fonction onStartSeance
    onStartSeance({
      isMember: true,
      client_id: scannedClient.id,
      nom: scannedClient.nom,
      rateKey: "membre",
    });
    setSeanceLancee(true);
    showToast("Séance lancée", `${scannedClient.nom} a démarré sa séance`, "success");
  };

  // Calcul du statut
  const status = scannedAbo ? getSubStatus(scannedAbo.fin, new Date()) : "none";
  const cfg = scannedAbo ? SUB_TYPES[scannedAbo.type] : null;
  const seancesMax = cfg?.maxSessions;
  const seancesUtilisees = seancesMax ? seancesMax - (scannedAbo?.seances_restantes || 0) : 0;
  const pct = seancesMax ? (seancesUtilisees / seancesMax) * 100 : 100;
  const full = seancesMax && (scannedAbo?.seances_restantes || 0) <= 0;
  const idx = scannedClient ? clients.indexOf(scannedClient) : 0;

  return (
    <Modal open={open} onClose={() => { stopScanner(); onClose(); }} title="📷 Scanner QR Code" maxWidth={520}>
      <div>
        {/* Zone du scanner */}
        {!scannedAbo ? (
          <div>
            <div style={{ fontSize: 12, color: T.textDim, marginBottom: 12, textAlign: "center" }}>
              Placez le QR code du client devant la caméra
            </div>
            <div
              id="qr-reader-container"
              style={{
                width: "100%",
                maxWidth: 350,
                margin: "0 auto",
                background: "#0a0a0a",
                borderRadius: 12,
                overflow: "hidden",
                border: `2px solid ${T.border}`,
                aspectRatio: "1/1",
              }}
            />
            {scanning && (
              <div style={{ fontSize: 10, color: T.textDim, textAlign: "center", marginTop: 8 }}>
                🔍 Caméra active...
              </div>
            )}
            <button
              style={{ ...S.btn("ghost"), width: "100%", justifyContent: "center", marginTop: 12 }}
              onClick={() => { stopScanner(); onClose(); }}
            >
              Annuler
            </button>
          </div>
        ) : (
          /* Carte d'abonnement scannée */
          <div>
            {/* En-tête avec avatar et infos client */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <Avatar name={scannedClient?.nom} idx={idx} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {scannedClient?.nom}
                </div>
                <div style={{ fontSize: 11, color: T.textDim }}>
                  {scannedClient?.telephone || "Pas de tél."}
                </div>
              </div>
              <StatusBadge status={status} />
            </div>

            {/* Détails de l'abonnement */}
            {cfg && (
              <div style={{ background: T.surface2, borderRadius: 10, padding: "12px 14px", border: `1px solid ${T.border}`, marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: T.textDim, marginBottom: 4 }}>
                  <span>Formule</span>
                  <span style={{ color: T.text, fontWeight: 700 }}>{cfg.label}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: T.textDim, marginBottom: 4 }}>
                  <span>Début</span>
                  <span style={{ color: T.text }}>{fmtDate(scannedAbo.debut)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: T.textDim, marginBottom: seancesMax ? 10 : 0 }}>
                  <span>Fin</span>
                  <span style={{ color: status === "expired" ? T.red : T.text, fontWeight: 700 }}>{fmtDate(scannedAbo.fin)}</span>
                </div>
                {seancesMax && (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: T.textDim, marginBottom: 4 }}>
                      <span>Séances restantes</span>
                      <span style={{ fontWeight: 700, color: full ? T.red : T.green }}>
                        {scannedAbo.seances_restantes} / {seancesMax}
                      </span>
                    </div>
                    <div style={S.progress}>
                      <div style={S.progressFill(pct, full)} />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: 8 }}>
              {/* Bouton Lancer la séance */}
              <button
                style={{
                  ...S.btn(seanceLancee ? "ghost" : "orange"),
                  flex: 1,
                  justifyContent: "center",
                  padding: "10px",
                  opacity: seanceLancee ? 0.6 : 1,
                }}
                onClick={handleLancerSeance}
                disabled={seanceLancee || status === "expired"}
              >
                {seanceLancee ? "✓ Séance lancée" : "▶ Lancer"}
              </button>

              {/* Bouton Pointer (si l'abonnement a des séances) */}
              {seancesMax && status !== "expired" && !full && (
                <button
                  style={{ ...S.btn("primary"), flex: 1, justifyContent: "center", padding: "10px" }}
                  onClick={handlePointer}
                >
                  ✓ Pointer
                </button>
              )}
              {status === "expired" && (
                <button style={{ ...S.btn("danger"), flex: 1, justifyContent: "center", padding: "10px" }} disabled>
                  ⚠ Expiré
                </button>
              )}
              {full && status !== "expired" && (
                <button style={{ ...S.btn("danger"), flex: 1, justifyContent: "center", padding: "10px" }} disabled>
                  ⚠ Quota atteint
                </button>
              )}
            </div>

            {/* Bouton retour / fermeture */}
            <button
              style={{ ...S.btn("ghost"), width: "100%", justifyContent: "center", marginTop: 10 }}
              onClick={() => { stopScanner(); onClose(); }}
            >
              Fermer
            </button>
          </div>
        )}
      </div>

      {/* Modal de pointage (identique à celle de AbonnementsView) */}
      <Modal
        open={pointageModal}
        onClose={() => setPointageModal(false)}
        title="Pointage effectué avec succès"
        closeOnOverlay={false}
      >
        {pointageData && (
          <>
            <div
              style={{
                background: T.surface2,
                border: `1px solid ${T.border}`,
                borderRadius: 10,
                padding: 14,
                marginBottom: 18,
                lineHeight: 1.7,
                fontSize: 13
              }}
            >
              <div><strong>👤 Client :</strong> {pointageData.client?.nom}</div>
              <div><strong>🏋️ Formule :</strong> {SUB_TYPES[pointageData.abonnement.type]?.label}</div>
              <div><strong>📅 Début :</strong> {fmtDate(pointageData.abonnement.debut)}</div>
              <div><strong>📅 Fin :</strong> {fmtDate(pointageData.abonnement.fin)}</div>
              <div>
                <strong>🎯 Séances restantes :</strong>{" "}
                {pointageData.abonnement.seances_restantes}
              </div>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: 10
              }}
            >
              <button
                style={S.btn("ghost")}
                onClick={() => {
                  setPointageModal(false);
                  onClose();
                }}
              >
                Annuler
              </button>

              <button
                style={S.btn("wa")}
                onClick={() => {
                  if (!pointageData?.client?.telephone) {
                    showToast(
                      "Téléphone manquant",
                      "Ce client ne possède pas de numéro WhatsApp.",
                      "error"
                    );
                    return;
                  }

                  const message = `Bonjour ${pointageData.client.nom},

✅ Votre séance a bien été enregistrée.

🏋️ Formule : ${SUB_TYPES[pointageData.abonnement.type]?.label}

📅 Début : ${fmtDate(pointageData.abonnement.debut)}
📅 Fin : ${fmtDate(pointageData.abonnement.fin)}

🎯 Séances restantes : ${pointageData.abonnement.seances_restantes}

Merci pour votre confiance.
Gym Nouvel Élan 💪`;

                  const url = `https://wa.me/${pointageData.client.telephone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;

                  window.open(url, "_blank");

                  setPointageModal(false);
                  onClose();
                }}
              >
                💬 Envoyer la confirmation
              </button>
            </div>
          </>
        )}
      </Modal>
    </Modal>
  );
}

function Field({ label, hint, children }) {
  return (
    <div style={S.fg}>
      {label && <label style={S.label}>{label}{hint && <span style={{ color: T.textFaint, fontWeight: 400, marginLeft: 5, fontSize: 9 }}>{hint}</span>}</label>}
      {children}
    </div>
  );
}

const Inp = ({ label, hint, ...p }) => (
  <Field label={label} hint={hint}><input style={S.input} {...p} /></Field>
);

const Sel = ({ label, hint, children, ...p }) => (
  <Field label={label} hint={hint}><select style={{ ...S.input, appearance: "none" }} {...p}>{children}</select></Field>
);

function ToastManager({ toasts }) {
  if (!toasts.length) return null;
  const colors = { success: T.green, error: T.red, info: T.blue, warning: T.orange };
  const icons = { success: "✓", error: "✕", info: "ℹ", warning: "⚠" };
  return (
    <div style={{ position: "fixed", bottom: 20, right: 20, zIndex: 3000, display: "flex", flexDirection: "column", gap: 8 }}>
      {toasts.map(t => (
        <div key={t.id} style={{ ...S.toast, borderLeft: `3px solid ${colors[t.type]}` }}>
          <span style={{ color: colors[t.type], fontWeight: 900, fontSize: 14, flexShrink: 0, marginTop: 1 }}>{icons[t.type]}</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{t.title}</div>
            {t.msg && <div style={{ color: T.textDim, fontSize: 11, marginTop: 2 }}>{t.msg}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Sparkline SVG simple ──────────────────────────────────────────
function Sparkline({ values = [], color = T.green, height = 36, width = 100 }) {
  if (!values.length || values.every(v => v === 0)) {
    return <svg width={width} height={height}><line x1="0" y1={height - 2} x2={width} y2={height - 2} style={{ stroke: T.border }} strokeWidth="1" /></svg>;
  }
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => {
    const x = (i / Math.max(values.length - 1, 1)) * width;
    const y = height - 4 - (v / max) * (height - 8);
    return `${x},${y}`;
  });
  const poly = pts.join(" ");
  const area = `M0,${height} L${pts.join(" L")} L${width},${height} Z`;
  return (
    <svg width={width} height={height} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={`sg-${color.replace("#","")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#sg-${color.replace("#","")})`} />
      <polyline points={poly} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Barre de recherche ────────────────────────────────────────────
function SearchBar({ value, onChange, placeholder = "Rechercher..." }) {
  return (
    <div style={{ position: "relative", marginBottom: 16 }}>
      <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: T.textDim, fontSize: 14, pointerEvents: "none" }}>🔍</span>
      <input style={S.searchBar} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 11. ÉCRAN DE LOGIN
// ═══════════════════════════════════════════════════════════════════

function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleLogin = () => {
    const u = username.toLowerCase().trim();
    if (!u || !password) { setError("Identifiant et mot de passe requis."); return; }
    const meta = USER_META[u];
    if (!meta) { setError("Identifiant inconnu. Utilisez 'admin' ou 'staff'."); return; }
    
    // Charger la configuration depuis le cache ou le backend
    let storedPasswords = pwdManager.load();
    
    // Vérifier si on a une configuration du backend plus récente
    try {
      const cached = localStorage.getItem("gym_app_config");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.data) {
          // Mettre à jour les mots de passe depuis la config backend
          if (parsed.data.adminPassword) {
            storedPasswords.admin = parsed.data.adminPassword;
          }
          if (parsed.data.staffPassword) {
            storedPasswords.staff = parsed.data.staffPassword;
          }
        }
      }
    } catch (e) {}
    
    if (password !== storedPasswords[u]) { setError("Mot de passe incorrect."); return; }
    const session = { username: u, role: meta.role, displayName: meta.displayName };
    saveSession(session);
    onLogin(session);
  };

  return (
    <div style={S.loginWrap}>
      <div style={S.loginBox}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 9, letterSpacing: "0.2em", color: T.textDim, textTransform: "uppercase", marginBottom: 6 }}>Gym Management</div>
          <div style={{ fontSize: 26, fontWeight: 900, color: T.text, lineHeight: 1.1 }}>
            NOUVEL <span style={{ color: T.green }}>ÉLAN</span>
          </div>
          <div style={{ fontSize: 11, color: T.textDim, marginTop: 8 }}>Plateforme de gestion · v{CONFIG.VERSION}</div>
        </div>

        {/* Formulaire */}
        <div style={{ marginBottom: 14 }}>
          <label style={S.label}>Identifiant</label>
          <input
            style={S.input}
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="admin ou staff"
            autoComplete="username"
            onKeyDown={e => e.key === "Enter" && handleLogin()}
          />
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={S.label}>Mot de passe</label>
          <input
            style={S.input}
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            onKeyDown={e => e.key === "Enter" && handleLogin()}
          />
        </div>

        {error && (
          <div style={{ background: T.redDark, border: `1px solid ${T.redBd}`, borderRadius: 8, padding: "9px 12px", fontSize: 12, color: T.red, marginBottom: 14 }}>
            ⚠ {error}
          </div>
        )}

        <button
          style={{ ...S.btn("primary"), width: "100%", justifyContent: "center", padding: "11px", fontSize: 13 }}
          onClick={handleLogin}
        >
          Se connecter
        </button>

        <div style={{ marginTop: 20, padding: "12px 14px", background: T.surface2, borderRadius: 8, border: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 10, color: T.textDim, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 7 }}>Identifiants</div>
          <div style={{ fontSize: 11, color: T.textDim, lineHeight: 1.7 }}>
            <strong style={{ color: T.yellow }}>admin</strong> <span style={S.pill(T.yellow)}>Accès total + Paramètres</span><br />
            <strong style={{ color: T.blue }}>staff</strong> <span style={S.pill(T.blue)}>Accès limité</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 12. HOOK DONNÉES
// ═══════════════════════════════════════════════════════════════════

function useGymData(showToast) {
  const [clients, setClients] = useState([]);
  const [abonnements, setAbonnements] = useState([]);
  const [caisse, setCaisse] = useState([]);
  const [seancesActives, setSeancesActives] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [lastSync, setLastSync] = useState(null);

  // Charge depuis cache local en premier (instantané)
  useEffect(() => {
    const cached = cache.load();
    if (cached?.data) {
      const { clients: c, abonnements: a, caisse: ca } = cached.data;
      if (c) setClients(c);
      if (a) setAbonnements(a);
      if (ca) setCaisse(ca);
      setLoading(false); // Affiche immédiatement, sync en arrière-plan
    }
  }, []);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setSyncing(true);
    try {
const [resC, resA, resCa, resS] = await Promise.all([
        apiGet("clients"),
        apiGet("abonnements"),
        apiGet("caisse"),
        apiGet("seances"), // Ajout de la récupération des séances
      ]);

      const extract = (res) => Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);

      const newClients = extract(resC).map(normalizeClient);
      const newAbos = extract(resA).map(normalizeAbonnement);
      const newCaisse = extract(resCa).map(normalizeCaisse);

// Extraction et filtrage des séances pour ne garder que celles "en_cours"
      const newSeances = extract(resS)
        .filter(s => s.statut === "en_cours")
        .map(s => {
          // Sécurisation stricte des types de données
          const isMembre = String(s.type).toLowerCase() === "membre" || s.isMember === true || s.isMember === "true";
          // Si c'est un membre c'est 120 min max, sinon c'est la durée définie (souvent 60)
          const dureeParDefaut = isMembre ? 120 : 60; 

          return {
            ...s,
            id: String(s.id),
            price: Number(s.price) || 0,
            durationMinutes: Number(s.durationMinutes) || dureeParDefaut,
            isMember: isMembre,
            debut: s.debut
          };
        });
      
      setClients(newClients);
      setAbonnements(newAbos);
      setCaisse(newCaisse);
      setSeancesActives(newSeances); // Recharge les chronomètres actifs
      
      setOffline(false);
      setLastSync(new Date());

      // Mise à jour du cache avec toutes les données incluant les séances
      cache.save({ 
        clients: newClients, 
        abonnements: newAbos, 
        caisse: newCaisse, 
        seances: newSeances 
      });

      if (!silent) setLoading(false);
    } catch (err) {
      setOffline(true);
      if (!silent) setLoading(false);
      showToast("Hors ligne", "Les données locales sont affichées", "warning");
    } finally {
      setSyncing(false);
    }
  }, [showToast, setClients, setAbonnements, setCaisse, setSeancesActives]);

  useEffect(() => {
    loadData();
    const interval = setInterval(() => loadData(true), CONFIG.REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [loadData]);

  return {
    clients, setClients,
    abonnements, setAbonnements,
    caisse, setCaisse,
    seancesActives, setSeancesActives,
    loading, syncing, offline, lastSync,
    loadData,
  };
}
// ═══════════════════════════════════════════════════════════════════
// 13. HOOK TOAST
// ═══════════════════════════════════════════════════════════════════

function useToastManager() {
  const [toasts, setToasts] = useState([]);

  const showToast = useCallback((title, msg = "", type = "info") => {
    const id = genId();
    setToasts(p => [...p.slice(-2), { id, title, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4500);
  }, []);

  return { toasts, showToast };
}
// ═══════════════════════════════════════════════════════════════════
// 13-B. HOOK DONNÉES ARTS MARTIAUX (API Google Sheets)
// ═══════════════════════════════════════════════════════════════════

function useArtsMartiauxData(showToast) {
  const [eleves, setEleves] = useState([]);
  const [paiements, setPaiements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // Chargement des données
  const loadData = useCallback(async () => {
    setSyncing(true);
    try {
      const [resEleves, resPaiements] = await Promise.all([
        apiGetArts("inscriptions_arts"),
        apiGetArts("paiements_arts"),
      ]);

      const extract = (res) => Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
      
      const newEleves = extract(resEleves).map(r => ({
        id: String(r.id || genId()),
        nom: String(r.nom || ""),
        telephone: String(r.telephone || ""),
        adresse: String(r.adresse || ""),
        age: String(r.age || ""),
        sexe: String(r.sexe || ""),
        discipline: String(r.discipline || ""),
        date_inscription: r.date_inscription ? String(r.date_inscription) : todayISO(),
        created_at: r.created_at || new Date().toISOString(),
      }));

      const newPaiements = extract(resPaiements).map(r => ({
        id: String(r.id || genId()),
        eleve_id: String(r.eleve_id || ""),
        mois: Number(r.mois || 0),
        annee: Number(r.annee || new Date().getFullYear()),
        date_paiement: r.date_paiement ? String(r.date_paiement) : new Date().toISOString(),
        montant: Number(r.montant || 0),
        observation: String(r.observation || ""),
        created_at: r.created_at || new Date().toISOString(),
      }));

      setEleves(newEleves);
      setPaiements(newPaiements);
      setLoading(false);
    } catch (err) {
      showToast("Erreur", "Impossible de charger les données arts martiaux", "error");
      setLoading(false);
    } finally {
      setSyncing(false);
    }
  }, [showToast]);

  // Chargement initial
  useEffect(() => {
    loadData();
  }, [loadData]);

  const addEleve = useCallback(async (form) => {
    const tempId = genId();
    const newEleve = {
      id: tempId,
      nom: form.nom,
      telephone: form.telephone,
      adresse: form.adresse || "",
      age: form.age,
      sexe: form.sexe,
      discipline: form.discipline,
      date_inscription: form.date_inscription || todayISO(),
    };
    
    setEleves(prev => [newEleve, ...prev]);
    showToast("Inscription en cours...", "Synchronisation avec le serveur", "info");
    
    try {
      const res = await apiPostArts("addInscriptionArts", newEleve);
      if (res?.id) {
        setEleves(prev => prev.map(e => e.id === tempId ? { ...e, id: String(res.id) } : e));
        showToast("Inscription réussie", `${form.nom} ajouté(e)`, "success");
        return res;
      }
    } catch (err) {
      showToast("Erreur", "Échec de la synchronisation", "error");
      throw err;
    }
  }, [showToast]);

  const addPaiement = useCallback(async (data) => {
    const tempId = genId();
    const newPaiement = {
      id: tempId,
      eleve_id: data.eleve_id,
      mois: data.mois,
      annee: data.annee || new Date().getFullYear(),
      date_paiement: data.date_paiement || new Date().toISOString(),
      montant: data.montant,
      observation: data.observation || "",
    };
    
    setPaiements(prev => [newPaiement, ...prev]);
    showToast("Paiement enregistré", `Montant: ${fmtGNF(data.montant)}`, "success");
    
    try {
      const res = await apiPostArts("addPaiementArts", newPaiement);
      if (res?.id) {
        setPaiements(prev => prev.map(p => p.id === tempId ? { ...p, id: String(res.id) } : p));
      }
      return res;
    } catch (err) {
      showToast("Erreur", "Échec de l'enregistrement du paiement", "error");
      throw err;
    }
  }, [showToast]);

  const deleteEleve = useCallback(async (id) => {
    setEleves(prev => prev.filter(e => e.id !== id));
    setPaiements(prev => prev.filter(p => p.eleve_id !== id));
    showToast("Suppression", "Élève supprimé", "info");
    try {
      await apiPostArts("deleteInscriptionArts", { id });
    } catch (err) {
      showToast("Erreur", "Échec de la suppression", "error");
    }
  }, [showToast]);

  const getPaiementsByEleve = useCallback((eleveId) => {
    return paiements.filter(p => p.eleve_id === eleveId);
  }, [paiements]);

  const getTotalPaiements = useCallback(() => {
    return paiements.reduce((sum, p) => sum + (p.montant || 0), 0);
  }, [paiements]);

  const getPaiementsDuMois = useCallback((mois, annee) => {
    const now = new Date();
    const m = mois !== undefined ? mois : now.getMonth();
    const a = annee !== undefined ? annee : now.getFullYear();
    return paiements.filter(p => p.mois === m && p.annee === a);
  }, [paiements]);

  const getMontantDuMois = useCallback((mois, annee) => {
    return getPaiementsDuMois(mois, annee).reduce((sum, p) => sum + (p.montant || 0), 0);
  }, [getPaiementsDuMois]);

  return {
    eleves,
    paiements,
    loading,
    syncing,
    loadData,
    addEleve,
    addPaiement,
    deleteEleve,
    getPaiementsByEleve,
    getTotalPaiements,
    getPaiementsDuMois,
    getMontantDuMois,
  };
}

// ═══════════════════════════════════════════════════════════════════
// 14. VUE DASHBOARD
// ═══════════════════════════════════════════════════════════════════

const DashboardView = memo(({ clients, abonnements, caisse, seancesActives, now, offline }) => {
  const { role } = useAuth();

  // KPIs
  const stats = useMemo(() => {
    const revJour = caisse.filter(t => sameDay(t.date, now)).reduce((s, t) => s + t.montant, 0);
    const revMois = caisse.filter(t => sameMonth(t.date, now)).reduce((s, t) => s + t.montant, 0);

    // Mois précédent
    const prevMonth = new Date(now);
    prevMonth.setMonth(prevMonth.getMonth() - 1);
    const revMoisPrev = caisse.filter(t => sameMonth(t.date, prevMonth)).reduce((s, t) => s + t.montant, 0);
    const deltaMois = revMoisPrev > 0 ? ((revMois - revMoisPrev) / revMoisPrev * 100).toFixed(1) : null;

    const actifs = clients.filter(c => ["active", "expiring"].includes(getClientSubStatus(c.id, abonnements, now))).length;
    const totalClients = clients.length;

    // Alertes
    const alertes = abonnements
      .filter(a => ["expiring", "expired"].includes(getSubStatus(a.fin, now)))
      .length;

    // Sparkline 7 jours
    const days = last7Days();
    const spark = days.map(d => caisse.filter(t => t.date.startsWith(d)).reduce((s, t) => s + t.montant, 0));

    return { revJour, revMois, revMoisPrev, deltaMois, actifs, totalClients, alertes, spark };
  }, [clients, abonnements, caisse, now]);

  const alerts = useMemo(() =>
    abonnements
      .filter(a => ["expiring", "expired"].includes(getSubStatus(a.fin, now)))
      .map(a => ({ ...a, client: clients.find(c => c.id === a.client_id) }))
      .filter(x => x.client)
      .sort((a, b) => new Date(a.fin) - new Date(b.fin))
      .slice(0, 8),
    [abonnements, clients, now]
  );

  const recent = useMemo(() =>
    [...caisse].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 8),
    [caisse]
  );

  return (
    <div>
      {offline && <div style={S.offlineBanner}>⚠ Hors ligne — données locales affichées. Vérifiez votre connexion.</div>}

      {/* KPIs */}
            <div className="kpi-grid" style={S.kpiGrid}>
        <div className="kpi-card" style={S.kpiCard}>
          <div style={S.kpiBar(T.green)} />
          <div style={S.kpiLabel}>Revenus aujourd'hui</div>
          <div style={S.kpiValue}>{fmtGNF(stats.revJour)}</div>
          <div style={S.kpiSub}>encaissé ce jour</div>
        </div>
        <div className="kpi-card" style={S.kpiCard}>
          <div style={S.kpiBar(T.blue)} />
          <div style={S.kpiLabel}>Revenus du mois</div>
          <div style={S.kpiValue}>{fmtGNF(stats.revMois)}</div>
          {stats.deltaMois !== null && (
            <div style={S.kpiDelta(Number(stats.deltaMois) >= 0)}>
              {Number(stats.deltaMois) >= 0 ? "▲" : "▼"} {Math.abs(stats.deltaMois)}% vs mois préc.
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <Sparkline values={stats.spark} color={T.blue} width={110} height={30} />
          </div>
        </div>
        <div className="kpi-card" style={S.kpiCard}>
          <div style={S.kpiBar(T.purple)} />
          <div style={S.kpiLabel}>Membres actifs</div>
          <div style={S.kpiValue}>{stats.actifs}</div>
          <div style={S.kpiSub}>sur {stats.totalClients} inscrits</div>
        </div>
        <div className="kpi-card" style={S.kpiCard}>
          <div style={S.kpiBar(T.orange)} />
          <div style={S.kpiLabel}>Séances en cours</div>
          <div style={S.kpiValue}>{seancesActives.length}</div>
          {stats.alertes > 0 && (
            <div style={S.kpiDelta(false)}>⚠ {stats.alertes} abo. à renouveler</div>
          )}
        </div>
      </div>

      <div style={S.grid2}>
        {/* Alertes */}
        <div style={S.card}>
          <div style={S.cardHead}>
            <span style={S.cardTitle}>⚠ Abonnements — alertes</span>
            <span style={{ fontSize: 10, color: T.textDim }}>{alerts.length} alerte(s)</span>
          </div>
          {alerts.length === 0
            ? <div style={S.emptyState}>✓ Aucune alerte. Tout est à jour.</div>
            : alerts.map(a => (
              <div key={a.id} style={S.alertRow}>
                <Avatar name={a.client.nom} idx={clients.indexOf(a.client)} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.client.nom}</div>
                  <div style={{ fontSize: 10, color: T.textDim }}>Fin : {fmtDate(a.fin)} · {SUB_TYPES[a.type]?.label || a.type}</div>
                </div>
                <StatusBadge status={getSubStatus(a.fin, now)} />
                <WaBtn phone={a.client.telephone} message={`Bonjour ${a.client.nom.split(" ")[0]}, votre abonnement ${getSubStatus(a.fin, now) === "expired" ? "est expiré" : "expire bientôt"}. Venez renouveler au Gym Nouvel Élan 💪`} icon />
              </div>
            ))
          }
        </div>

        {/* Activité récente */}
        <div style={S.card}>
          <div style={S.cardHead}><span style={S.cardTitle}>Activité récente</span></div>
          {recent.length === 0
            ? <div style={S.emptyState}>Aucune transaction</div>
            : recent.map(t => (
              <div key={t.id} style={S.txRow}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, color: T.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.description}</div>
                  <div style={{ fontSize: 10, color: T.textDim, marginTop: 1 }}>{fmtDate(t.date)} {fmtTime(t.date)}</div>
                </div>
                <span style={{ color: T.green, fontWeight: 800, fontSize: 12, whiteSpace: "nowrap" }}>+{fmtGNF(t.montant)}</span>
              </div>
            ))
          }
        </div>
      </div>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════
// 15. VUE CLIENTS
// ═══════════════════════════════════════════════════════════════════

const ClientsView = memo(({ clients, abonnements, caisse, now, syncing, onAdd, onDelete }) => {
  const { role } = useAuth();
  const showToast = useToast();

  const [search, setSearch] = useState("");
  const [filterStatut, setFilterStatut] = useState("all");
  const [filterObjectif, setFilterObjectif] = useState("all");
  const [sortBy, setSortBy] = useState("nom");
  const [modalAdd, setModalAdd] = useState(false);
  const [fiche, setFiche] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [form, setForm] = useState({ nom: "", telephone: "", objectif: "", statut: "actif" });
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    let res = clients.filter(c => {
      const matchSearch = c.nom.toLowerCase().includes(search.toLowerCase()) ||
                          c.telephone.includes(search) ||
                          c.objectif.toLowerCase().includes(search.toLowerCase());
      const matchStatut = filterStatut === "all" || c.statut === filterStatut;
      const matchObj = filterObjectif === "all" || c.objectif === filterObjectif;
      return matchSearch && matchStatut && matchObj;
    });
    if (sortBy === "nom") res.sort((a, b) => a.nom.localeCompare(b.nom));
    if (sortBy === "date") res.sort((a, b) => new Date(b.date_inscription) - new Date(a.date_inscription));
    if (sortBy === "statut") res.sort((a, b) => {
      const order = { active: 0, expiring: 1, expired: 2, none: 3 };
      return (order[getClientSubStatus(a.id, abonnements, now)] ?? 9) - (order[getClientSubStatus(b.id, abonnements, now)] ?? 9);
    });
    return res;
  }, [clients, abonnements, now, search, filterStatut, filterObjectif, sortBy]);

  const totalDepense = useCallback((c) =>
    caisse.filter(t => t.description.includes(c.nom)).reduce((s, t) => s + t.montant, 0),
    [caisse]
  );

  const handleSave = async () => {
    if (!form.nom.trim()) { showToast("Champ requis", "Le nom est obligatoire", "error"); return; }
    setSaving(true);
    await onAdd(form);
    setForm({ nom: "", telephone: "", objectif: "", statut: "actif" });
    setModalAdd(false);
    setSaving(false);
  };

  const exportCSV = useCallback(() => {
    const rows = filtered.map(c => {
      const sub = getClientSubStatus(c.id, abonnements, now);
      return `"${c.nom}","${c.telephone}","${c.objectif}","${c.statut}","${sub}","${c.date_inscription}","${fmtGNF(totalDepense(c))}"`;
    });
    const csv = ["\uFEFF" + "Nom,Téléphone,Objectif,Statut,Abonnement,Inscription,Total dépensé", ...rows].join("\n");
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })),
      download: `clients_gym_${todayISO()}.csv`,
    });
    a.click();
    showToast("Export réussi", `${filtered.length} clients exportés`, "success");
  }, [filtered, abonnements, now, totalDepense, showToast]);

  return (
    <div>
      <div style={S.pageHeader}>
        <div>
          <h1 style={S.pageTitle}>Clients {syncing && <span style={{ fontSize: 13, color: T.textDim, fontWeight: 400 }}>⟳</span>}</h1>
          <div style={S.pageSubtitle}>{clients.length} inscrits · {filtered.length} affichés</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {can(role, "export") && <button style={S.btn("ghost")} onClick={exportCSV}>↓ Export CSV</button>}
          <button style={S.btn("primary")} onClick={() => setModalAdd(true)}>+ Nouveau client</button>
        </div>
      </div>

      {/* Filtres */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <SearchBar value={search} onChange={setSearch} placeholder="Nom, téléphone, objectif..." />
      </div>
      <div style={{ display: "flex", gap: 7, marginBottom: 16, flexWrap: "wrap" }}>
        {[["all", "Tous"], ["actif", "Actifs"], ["inactif", "Inactifs"]].map(([v, l]) => (
          <span key={v} style={S.fPill(filterStatut === v)} onClick={() => setFilterStatut(v)}>{l}</span>
        ))}
        <span style={{ flex: 1 }} />
        <select style={{ ...S.input, width: "auto", fontSize: 11, padding: "5px 10px" }} value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="nom">Trier : Nom A→Z</option>
          <option value="date">Trier : Plus récents</option>
          <option value="statut">Trier : Statut abo.</option>
        </select>
        <select style={{ ...S.input, width: "auto", fontSize: 11, padding: "5px 10px" }} value={filterObjectif} onChange={e => setFilterObjectif(e.target.value)}>
          <option value="all">Tous objectifs</option>
          {OBJECTIFS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>

      <div style={S.card}>
        <table className="clients-table" style={S.table}>
          <thead>
            <tr>
              {["Client", "Téléphone", "Objectif", "Statut abo.", "Inscription", "Actions"].map((h, i) => (
                <th key={h} style={{ ...S.th, textAlign: i === 5 ? "right" : "left" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((c, idx) => {
              const subStatus = getClientSubStatus(c.id, abonnements, now);
              return (
                <tr key={c.id} style={{ transition: "background 0.08s", cursor: "pointer" }} onClick={() => setFiche(c)}>
                  <td style={S.td}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <Avatar name={c.nom} idx={clients.indexOf(c)} />
                      <div>
                        <div style={{ fontWeight: 700, color: T.text }}>{c.nom}</div>
                        <span style={S.pill(c.statut === "actif" ? T.green : T.textDim)}>{c.statut}</span>
                      </div>
                    </div>
                  </td>
                  <td style={{ ...S.td, color: T.textDim, fontSize: 12 }}>{c.telephone || "—"}</td>
                  <td style={S.td}>{c.objectif ? <span style={S.pill(T.purple)}>{c.objectif}</span> : <span style={{ color: T.textFaint }}>—</span>}</td>
                  <td style={S.td}><StatusBadge status={subStatus} /></td>
                  <td style={{ ...S.td, color: T.textDim, fontSize: 12 }}>{fmtDate(c.date_inscription)}</td>
                  <td style={{ ...S.td, textAlign: "right" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, justifyContent: "flex-end" }}>
                      <div style={S.iconBtn("info")} onClick={() => setFiche(c)} title="Fiche client">👤</div>
                      <WaBtn phone={c.telephone} message={`Bonjour ${c.nom.split(" ")[0]}, ça fait longtemps ! Revenez nous voir au Gym Nouvel Élan 💪`} icon />
                      {can(role, "delete_client") && (
                        <div style={S.iconBtn("danger")} onClick={(e) => { e.stopPropagation(); setConfirmDel(c); }} title="Supprimer">🗑</div>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!filtered.length && <div style={S.emptyState}>Aucun client trouvé pour ces critères</div>}
      </div>

      {/* Fiche client */}
      <Modal open={!!fiche} onClose={() => setFiche(null)} title="Fiche client" maxWidth={480}>
        {fiche && (() => {
          const clientAbos = abonnements.filter(a => a.client_id === fiche.id).sort((a, b) => new Date(b.debut) - new Date(a.debut));
          const subStatus = getClientSubStatus(fiche.id, abonnements, now);
          const idx = clients.findIndex(c => c.id === fiche.id);
          const depense = totalDepense(fiche);
          return (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
                <Avatar name={fiche.nom} idx={idx} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: 17, color: T.text }}>{fiche.nom}</div>
                  <div style={{ fontSize: 11, color: T.textDim, marginTop: 2 }}>
                    {fiche.telephone || "Pas de tél."} · Inscrit le {fmtDate(fiche.date_inscription)}
                  </div>
                </div>
                <StatusBadge status={subStatus} />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginBottom: 20 }}>
                <div style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ fontSize: 10, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5 }}>Objectif</div>
                  <div style={{ fontWeight: 700, color: T.text, fontSize: 13 }}>{fiche.objectif || "Non défini"}</div>
                </div>
                <div style={{ background: T.greenDark, border: `1px solid ${T.greenBd}`, borderRadius: 10, padding: "12px 14px" }}>
                  <div style={{ fontSize: 10, color: "#2d7d4d", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 5 }}>Total dépensé</div>
                  <div style={{ fontWeight: 900, color: T.green, fontSize: 18 }}>{fmtGNF(depense)}</div>
                </div>
              </div>

              <div style={S.divider} />
              <div style={{ fontSize: 10, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10, fontWeight: 700 }}>
                Historique abonnements ({clientAbos.length})
              </div>
              {clientAbos.length === 0
                ? <div style={{ color: T.textFaint, fontSize: 12, fontStyle: "italic" }}>Aucun abonnement enregistré</div>
                : clientAbos.map(a => (
                  <div key={a.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", background: T.surface2, borderRadius: 9, marginBottom: 6, border: `1px solid ${T.border}` }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 12, color: T.text }}>{SUB_TYPES[a.type]?.label || a.type}</div>
                      <div style={{ fontSize: 10, color: T.textDim }}>{fmtDate(a.debut)} → {fmtDate(a.fin)}</div>
                      {SUB_TYPES[a.type]?.maxSessions && (
                        <div style={{ fontSize: 10, color: T.textDim }}>
                          {a.seances_restantes} séance(s) restante(s)
                        </div>
                      )}
                    </div>
                    <StatusBadge status={getSubStatus(a.fin, now)} />
                  </div>
                ))
              }

              <div style={S.divider} />
              <WaBtn
                phone={fiche.telephone}
                message={`Bonjour ${fiche.nom.split(" ")[0]}, nous vous contactons depuis le Gym Nouvel Élan. Comment allez-vous ? 💪`}
              />
            </div>
          );
        })()}
      </Modal>

      {/* Modal nouveau client */}
      <Modal open={modalAdd} onClose={() => setModalAdd(false)} title="Nouveau client">
        <Inp label="Nom complet *" value={form.nom} onChange={e => setForm({ ...form, nom: e.target.value })} placeholder="Ex: Mamadou Diallo" autoFocus />
        <Inp label="Téléphone WhatsApp" value={form.telephone} onChange={e => setForm({ ...form, telephone: e.target.value })} placeholder="+224 620 000 000" type="tel" />
        <Sel label="Objectif fitness" value={form.objectif} onChange={e => setForm({ ...form, objectif: e.target.value })}>
          <option value="">Sélectionner...</option>
          {OBJECTIFS.map(o => <option key={o} value={o}>{o}</option>)}
        </Sel>
        <Sel label="Statut initial" value={form.statut} onChange={e => setForm({ ...form, statut: e.target.value })}>
          <option value="actif">Actif</option>
          <option value="inactif">Inactif</option>
        </Sel>
        <button
          style={{ ...S.btn("primary"), width: "100%", justifyContent: "center", padding: "11px", marginTop: 4, opacity: saving ? 0.6 : 1 }}
          onClick={handleSave} disabled={saving}
        >
          {saving ? "Enregistrement..." : "Créer le client"}
        </button>
      </Modal>

      {/* Confirmation suppression */}
      <ConfirmModal
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        onConfirm={() => onDelete(confirmDel.id)}
        title="Supprimer ce client ?"
        message={`Vous allez supprimer définitivement "${confirmDel?.nom}" ainsi que tous ses abonnements. Cette action est irréversible.`}
      />
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════
// 16. VUE ABONNEMENTS
// ═══════════════════════════════════════════════════════════════════

const AbonnementsView = memo(({ abonnements, clients, now, syncing, onAdd, onDelete, onCheckIn }) => {
  const { role } = useAuth();
  const showToast = useToast();

  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [modalAdd, setModalAdd] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);
  const [form, setForm] = useState({ client_id: "", type: "", debut: todayISO() });
const [saving, setSaving] = useState(false);

const [pointageModal, setPointageModal] = useState(false);
const [pointageData, setPointageData] = useState(null);
const [qrModalData, setQrModalData] = useState(null);
const [qrModalOpen, setQrModalOpen] = useState(false);

// --- CE QUE VOUS VENEZ DE COLLER ICI ---
const [clientSearch, setClientSearch] = useState("");
const clientsFiltres = useMemo(() => {
    if (!clientSearch) return clients;
    const low = clientSearch.toLowerCase();
    return clients.filter(c => 
      c.nom.toLowerCase().includes(low) || 
      (c.telephone && c.telephone.includes(low))
    );
  }, [clients, clientSearch]);
  // ----------------------------------------
  const cfg = form.type ? SUB_TYPES[form.type] : null;
  const finPreview = form.debut && cfg ? fmtDate(addDays(new Date(form.debut), cfg.duration - 1)) : "—";

  const filtered = useMemo(() => {
    let res = abonnements.filter(a => {
      const client = clients.find(c => c.id === a.client_id);
      const matchSearch = !search || (client && client.nom.toLowerCase().includes(search.toLowerCase()));
      const matchType = filter === "all" || a.type === filter;
      return matchSearch && matchType;
    });
    return res.sort((a, b) => new Date(b.fin) - new Date(a.fin));
  }, [abonnements, clients, filter, search]);

  const handleSave = async () => {
    if (!form.client_id || !form.type || !form.debut) {
      showToast("Champs requis", "Veuillez remplir tous les champs", "error");
      return;
    }
    setSaving(true);
    const result = await onAdd(form.client_id, form.type, new Date(form.debut));
    setForm({ client_id: "", type: "", debut: todayISO() });
    setModalAdd(false);
    setSaving(false);
    
    // Si l'ajout a réussi et qu'on a un ID, ouvrir la modale QR code
    if (result?.aboId) {
      const client = clients.find(c => c.id === form.client_id);
      const abonnement = {
        id: result.aboId,
        client_id: form.client_id,
        type: form.type,
        debut: result.debut || form.debut,
        fin: result.fin || "",
        seances_restantes: result.seances_restantes || 0,
        statut: "actif",
      };
      setQrModalData({ abonnement, client });
      setQrModalOpen(true);
    }
  };
  const handleCheckIn = async (abonnement) => {
  const success = await onCheckIn(abonnement.id);

  if (!success) return;

  const client = clients.find(c => c.id === abonnement.client_id);

  setPointageData({
    client,
    abonnement: {
      ...abonnement,
      seances_restantes: Math.max(0, abonnement.seances_restantes - 1)
    }
  });

  setPointageModal(true);
};
  return (
    <div>
      <div style={S.pageHeader}>
        <div>
          <h1 style={S.pageTitle}>Abonnements {syncing && <span style={{ fontSize: 13, color: T.textDim, fontWeight: 400 }}>⟳</span>}</h1>
          <div style={S.pageSubtitle}>{abonnements.length} abonnements · {filtered.length} affichés</div>
        </div>
        <button style={S.btn("primary")} onClick={() => setModalAdd(true)}>+ Nouvel abonnement</button>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <SearchBar value={search} onChange={setSearch} placeholder="Rechercher un membre..." />
        </div>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          {[["all", "Tous"], ...Object.entries(SUB_TYPES).map(([k, v]) => [k, v.label])].map(([key, label]) => (
            <span key={key} style={S.fPill(filter === key)} onClick={() => setFilter(key)}>{label}</span>
          ))}
        </div>
      </div>

      <div className="grid3 subs-grid" style={S.grid3}>
        {filtered.map(a => {
const client = clients.find(c => c.id === a.client_id) || { nom: "Client Inconnu", telephone: "" };
      const cfg = SUB_TYPES[a.type];
          if (!cfg) return null;
          const status = getSubStatus(a.fin, now);
          const seancesMax = cfg.maxSessions;
          const seancesUtilisees = seancesMax ? seancesMax - a.seances_restantes : 0;
          const pct = seancesMax ? (seancesUtilisees / seancesMax) * 100 : 100;
          const full = seancesMax && a.seances_restantes <= 0;
          const idx = clients.indexOf(client);

          return (
            <div
  key={a.id}
  className="sub-card"
  style={{ ...S.subCard, borderColor: status === "expired" ? T.redBd : status === "expiring" ? "#4d2e00" : T.border }}
>
              <div style={S.subCardHead}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0, flex: 1 }}>
                  <Avatar name={client.nom} idx={idx} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{client.nom}</div>
                    <span style={S.pill(T.blue)}>{cfg.label}</span>
                  </div>
                </div>
                <StatusBadge status={status} />
              </div>

              <div style={S.subCardBody}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: T.textDim, marginBottom: 6 }}>
                  <span>Début</span><span style={{ color: T.textMid }}>{fmtDate(a.debut)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: T.textDim, marginBottom: seancesMax ? 14 : 0 }}>
                  <span>Fin</span><span style={{ color: T.text, fontWeight: 700 }}>{fmtDate(a.fin)}</span>
                </div>
                {seancesMax && (
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: T.textDim, marginBottom: 5 }}>
                      <span>Séances restantes</span>
                      <span style={{ fontWeight: 700, color: full ? T.red : T.green }}>{a.seances_restantes} / {seancesMax}</span>
                    </div>
                    <div style={S.progress}><div style={S.progressFill(pct, full)} /></div>
                  </div>
                )}
              </div>

              <div style={S.subCardFoot}>
                <WaBtn phone={client.telephone} message={`Bonjour ${client.nom.split(" ")[0]}, votre abonnement expire le ${fmtDate(a.fin)}. Pensez à renouveler au Gym Nouvel Élan !`} icon />
                <div style={{ display: "flex", gap: 5 }}>
                  {seancesMax && status !== "expired" && !full && (
                    <button
  style={S.btn("ghost")}
  onClick={() => handleCheckIn(a)}
>
  ✓ Pointer
</button>
                  )}
                  {status === "expired" && (
                    <button style={S.btn("primary")} onClick={() => setModalAdd(true)}>↻ Renouveler</button>
                  )}
                  {can(role, "delete_abo") && (
                    <div style={S.iconBtn("danger")} onClick={() => setConfirmDel(a)}>🗑</div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {!filtered.length && <div style={{ ...S.emptyState, ...S.card }}>Aucun abonnement pour ces critères</div>}

{/* Modal nouveau */}
      <Modal open={modalAdd} onClose={() => { setModalAdd(false); setClientSearch(""); }} title="Créer un abonnement">
        
        <div style={{ marginBottom: 12 }}>
          <SearchBar value={clientSearch} onChange={setClientSearch} placeholder="Rechercher par nom ou numéro..." />
        </div>

        <Sel label="Client *" value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })}>
          <option value="">Sélectionner un client...</option>
          {clientsFiltres.map(c => <option key={c.id} value={c.id}>{c.nom} {c.telephone ? `(${c.telephone})` : ""}</option>)}
        </Sel>
       <Sel label="Formule *" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
          <option value="">Sélectionner une formule...</option>
          {Object.entries(SUB_TYPES).map(([k, v]) => (
            <option key={k} value={k}>{v.label} — {fmtGNF(v.price)}</option>
          ))}
        </Sel>
        <Inp label="Date de début *" type="date" value={form.debut} onChange={e => setForm({ ...form, debut: e.target.value })} />
        {form.debut && form.type && (
          <div style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 13px", marginBottom: 14, fontSize: 12, color: T.textDim }}>
            📅 Fin prévue : <strong style={{ color: T.text }}>{finPreview}</strong>
            {cfg?.maxSessions && <span style={{ marginLeft: 10, color: T.textDim }}>· {cfg.maxSessions} séances incluses</span>}
            <div style={{ marginTop: 4, color: T.green, fontWeight: 700 }}>💰 {fmtGNF(cfg?.price || 0)}</div>
          </div>
        )}
        <button
          style={{ ...S.btn("primary"), width: "100%", justifyContent: "center", padding: 11, opacity: saving ? 0.6 : 1 }}
          onClick={handleSave} disabled={saving}
        >
          {saving ? "Enregistrement..." : "Valider et encaisser"}
        </button>
      </Modal>

      <ConfirmModal
        open={!!confirmDel}
        onClose={() => setConfirmDel(null)}
        onConfirm={() => onDelete(confirmDel.id)}
        title="Supprimer cet abonnement ?"
        message={`Supprimer l'abonnement "${SUB_TYPES[confirmDel?.type]?.label}" ? Cette action est irréversible.`}
      />
      <Modal
  open={pointageModal}
  onClose={() => setPointageModal(false)}
  title="Pointage effectué avec succès"
  closeOnOverlay={false}
>
  {pointageData && (
    <>
      <div
        style={{
          background: T.surface2,
          border: `1px solid ${T.border}`,
          borderRadius: 10,
          padding: 14,
          marginBottom: 18,
          lineHeight: 1.7,
          fontSize: 13
        }}
      >
        <div><strong>👤 Client :</strong> {pointageData.client?.nom}</div>
        <div><strong>🏋️ Formule :</strong> {SUB_TYPES[pointageData.abonnement.type]?.label}</div>
        <div><strong>📅 Début :</strong> {fmtDate(pointageData.abonnement.debut)}</div>
        <div><strong>📅 Fin :</strong> {fmtDate(pointageData.abonnement.fin)}</div>
        <div>
          <strong>🎯 Séances restantes :</strong>{" "}
          {pointageData.abonnement.seances_restantes}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 10
        }}
      >
        <button
          style={S.btn("ghost")}
          onClick={() => setPointageModal(false)}
        >
          Annuler
        </button>

        <button
  style={S.btn("wa")}
  onClick={() => {
    if (!pointageData?.client?.telephone) {
      showToast(
        "Téléphone manquant",
        "Ce client ne possède pas de numéro WhatsApp.",
        "error"
      );
      return;
    }

    const message = `Bonjour ${pointageData.client.nom},

✅ Votre séance a bien été enregistrée.

🏋️ Formule : ${SUB_TYPES[pointageData.abonnement.type]?.label}

📅 Début : ${fmtDate(pointageData.abonnement.debut)}
📅 Fin : ${fmtDate(pointageData.abonnement.fin)}

🎯 Séances restantes : ${pointageData.abonnement.seances_restantes}

Merci pour votre confiance.
Gym Nouvel Élan 💪`;

    const url = `https://wa.me/${pointageData.client.telephone.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`;

    window.open(url, "_blank");

    setPointageModal(false);
  }}
>
  💬 Envoyer la confirmation
</button>
      </div>
    </>
  )}
      </Modal>

      {/* Modal QR Code */}
      <QRCodeModal
        open={qrModalOpen}
        onClose={() => { setQrModalOpen(false); setQrModalData(null); }}
        abonnement={qrModalData?.abonnement}
        client={qrModalData?.client}
      />
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════
// 17. VUE SÉANCES DIRECTES
// ═══════════════════════════════════════════════════════════════════

const SeancesView = memo(({ seancesActives, clients, onStart, onEnd, abonnements, onCheckIn }) => {
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ isMember: false, client_id: "", nom_visiteur: "", rateKey: "" });
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  
  // TICK CHAQUE SECONDE POUR LE DIRECT
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

const handleStart = () => {
  // Validation pour le membre
  if (form.isMember && !form.client_id) {
    showToast("Sélection requise", "Veuillez choisir un membre", "error");
    return;
  }
  // Validation pour le visiteur
  if (!form.isMember && !form.rateKey) {
    showToast("Sélection requise", "Veuillez choisir un tarif", "error");
    return;
  }
  const client = form.isMember ? clients.find(c => c.id === form.client_id) : null;
  onStart({
    isMember: form.isMember,
    client_id: form.isMember ? form.client_id : null,
    nom: client ? client.nom : form.nom_visiteur || "Visiteur",
    rateKey: form.rateKey,
  });
  setForm({ isMember: false, client_id: "", nom_visiteur: "", rateKey: "" });
  setModal(false);
};
  
  const selectedRate = SESSION_RATES[form.rateKey];

  return (
    <div>
     <div style={S.pageHeader}>
  <div>
    <h1 style={S.pageTitle}>Séances directes</h1>
    <div style={S.pageSubtitle}>{seancesActives.length} séance(s) active(s)</div>
  </div>
  <div style={{ display: "flex", gap: 8 }}>
    <button style={S.btn("blue")} onClick={() => setQrScannerOpen(true)}>📷 Scanner</button>
    <button style={S.btn("orange")} onClick={() => setModal(true)}>▶ Démarrer une séance</button>
  </div>
</div>

      {!seancesActives.length ? (
        <div style={{ ...S.card, padding: "60px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⏱</div>
          <div style={{ fontWeight: 700, color: T.textMid, fontSize: 15 }}>Aucune séance active</div>
        </div>
      ) : (
        <div className="grid3 subs-grid" style={S.grid3}>
          {seancesActives.map(s => {
            // CALCUL EN DIRECT HYPER SÉCURISÉ
            const debutMs = typeof s.debut === "string" ? new Date(s.debut).getTime() : s.debut;
            const durationMs = (Number(s.durationMinutes) || 60) * 60 * 1000;
            const diffMs = (debutMs + durationMs) - Date.now();
            
            const totalSec = Math.max(0, Math.floor(diffMs / 1000));
            const over = totalSec <= 0;
            const urgent = totalSec <= 300 && totalSec > 0;

            const hh = Math.floor(totalSec / 3600).toString().padStart(2, "0");
            const mm = Math.floor((totalSec % 3600) / 60).toString().padStart(2, "0");
            const ss = (totalSec % 60).toString().padStart(2, "0");

            return (
              <div key={s.id} style={{ ...S.subCard, borderColor: over ? T.redBd : urgent ? T.orange : T.border }}>
                <div style={{ padding: "14px 16px", borderBottom: `1px solid ${T.surface3}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 700, color: T.text, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.nom}</div>
                    <span style={S.pill(s.isMember ? T.purple : T.orange)}>
                      {s.isMember ? "Membre" : "Visiteur"} · {s.price > 0 ? fmtGNF(s.price) : "Gratuit"}
                    </span>
                  </div>
                  {/* ON PASSE LA SÉANCE COMPLÈTE À ONEND */}
                  <button style={S.btn("ghost")} onClick={() => onEnd(s.id, s)}>Terminer</button>
                </div>

                <div style={{ padding: "20px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <div style={{ fontSize: 32, fontWeight: 800, fontFamily: "monospace", color: over ? T.red : urgent ? T.orange : "#4ade80", letterSpacing: "-1px" }}>
                    {over ? "FINI" : `${hh}:${mm}:${ss}`}
                  </div>
                  <div style={{ fontSize: 10, color: over ? T.red : urgent ? T.orange : T.textDim, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>
                    {over ? "Temps écoulé !" : urgent ? "⚠ Bientôt terminé" : "Restant"}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

<Modal open={modal} onClose={() => setModal(false)} title="Démarrer une séance">
  <div style={{ display: "flex", gap: 7, marginBottom: 18 }}>
    {["Visiteur direct", "Membre abonné"].map((label, i) => (
      <span key={label} style={{ ...S.fPill(form.isMember === (i === 1)), flex: 1, justifyContent: "center", display: "flex" }}
        onClick={() => setForm({ ...form, isMember: i === 1, client_id: "", rateKey: "" })}>
        {label}
      </span>
    ))}
  </div>

  {form.isMember ? (
    <>
      <Sel label="Membre" value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })}>
        <option value="">Sélectionner un membre...</option>
        {clients.map(c => (
          <option key={c.id} value={c.id}>
            {c.nom} {c.seances_restantes ? `(${c.seances_restantes} restantes)` : ""}
          </option>
        ))}
      </Sel>
      
      {/* Message d'erreur si aucun membre n'est sélectionné */}
      {form.isMember && !form.client_id && (
        <div style={{ marginTop: -8, marginBottom: 12, fontSize: 11, color: T.red }}>
          ⚠ Veuillez sélectionner un membre
        </div>
      )}
      
      {/* Affichage informatif si un membre est sélectionné */}
      {form.client_id && (
        <div style={{ background: T.surface2, padding: 12, borderRadius: 8, marginBottom: 15, border: `1px solid ${T.border}` }}>
          {(() => {
            const c = clients.find(x => x.id === form.client_id);
            const reste = Number(c?.seances_restantes) || 0;
            return (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13, color: T.textDim }}>Crédit actuel :</span>
                <span style={{ fontWeight: 800, color: reste > 0 ? T.green : T.red, fontSize: 16 }}>
                  {reste} séance{reste > 1 ? "s" : ""}
                </span>
              </div>
            );
          })()}
        </div>
      )}
    </>
  ) : (
    <>
      <Inp label="Nom du visiteur" value={form.nom_visiteur} onChange={e => setForm({ ...form, nom_visiteur: e.target.value })} placeholder="Ex: Jean Martin" />
      <Sel label="Tarif" value={form.rateKey} onChange={e => setForm({ ...form, rateKey: e.target.value })}>
        <option value="">Sélectionner un tarif...</option>
        {Object.entries(SESSION_RATES).map(([k, v]) => (
          <option key={k} value={k}>{v.label} — {fmtGNF(v.price)}</option>
        ))}
      </Sel>
      {selectedRate && (
        <div style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 13px", marginBottom: 14, fontSize: 12, color: T.textDim }}>
          ⏱ Durée : <strong style={{ color: T.text }}>{selectedRate.durationMinutes} min</strong>
          <span style={{ marginLeft: 12, color: T.green, fontWeight: 700 }}>💰 {fmtGNF(selectedRate.price)}</span>
        </div>
      )}
    </>
  )}
  <button
    style={{ ...S.btn("orange"), width: "100%", justifyContent: "center", padding: 11 }}
    onClick={handleStart}
    disabled={
      (form.isMember && !form.client_id) ||   // Membre non sélectionné
      (!form.isMember && !form.rateKey)       // Visiteur sans tarif
    }
  >
    ▶ Lancer le chronomètre
  </button>
</Modal>

      {/* Modal Scanner QR Code */}
      <QRScannerModal
        open={qrScannerOpen}
        onClose={() => setQrScannerOpen(false)}
        abonnements={abonnements}
        clients={clients}
        onCheckIn={onCheckIn}
        onStartSeance={onStart}
      />
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════
// 18. VUE CAISSE
// ═══════════════════════════════════════════════════════════════════

const CaisseView = memo(({ caisse, now, syncing }) => {
  const { role } = useAuth();
  const showToast = useToast();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");

  const isAdmin = role === "admin";

  const filtered = useMemo(() => {
    let res = [...caisse];
    if (isAdmin && from) res = res.filter(t => new Date(t.date) >= new Date(from));
    if (isAdmin && to) { const d = new Date(to); d.setHours(23, 59, 59, 999); res = res.filter(t => new Date(t.date) <= d); }
    if (search) res = res.filter(t => t.description.toLowerCase().includes(search.toLowerCase()));
    return res.sort((a, b) => new Date(b.date) - new Date(a.date));
  }, [caisse, from, to, search, isAdmin]);

  const stats = useMemo(() => ({
    revJour: caisse.filter(t => sameDay(t.date, now)).reduce((s, t) => s + t.montant, 0),
    revMois: caisse.filter(t => sameMonth(t.date, now)).reduce((s, t) => s + t.montant, 0),
    totalFiltre: filtered.reduce((s, t) => s + t.montant, 0),
    countFiltre: filtered.length,
  }), [caisse, filtered, now]);

  const exportCSV = () => {
    const rows = filtered.map(t => `"${fmtDate(t.date)} ${fmtTime(t.date)}","${t.description}","${t.montant}"`);
    const csv = ["\uFEFF" + "Date,Description,Montant (GNF)", ...rows].join("\n");
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })),
      download: `caisse_gym_${todayISO()}.csv`,
    });
    a.click();
    showToast("Export réussi", `${filtered.length} transactions`, "success");
  };

  return (
    <div>
      <div style={S.pageHeader}>
        <div>
          <h1 style={S.pageTitle}>Caisse / Registre {syncing && <span style={{ fontSize: 13, color: T.textDim, fontWeight: 400 }}>⟳</span>}</h1>
          <div style={S.pageSubtitle}>{caisse.length} transactions enregistrées</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {can(role, "export") && <button style={S.btn("ghost")} onClick={exportCSV}>↓ Export CSV</button>}
          {isAdmin && <span style={S.roleBadge("admin")}>🔓 Admin</span>}
        </div>
      </div>

      {/* KPIs caisse */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 22 }}>
        {[
          { label: "Encaissé aujourd'hui", value: fmtGNF(stats.revJour), accent: T.green, color: T.green },
          { label: "Encaissé ce mois", value: fmtGNF(stats.revMois), accent: T.blue, color: T.text },
          { label: `Période sélectionnée (${stats.countFiltre} tx)`, value: fmtGNF(stats.totalFiltre), accent: T.purple, color: T.purple },
        ].map(({ label, value, accent, color }) => (
          <div key={label} style={{ ...S.kpiCard }}>
            <div style={S.kpiBar(accent)} />
            <div style={S.kpiLabel}>{label}</div>
            <div style={{ ...S.kpiValue, color }}>{value}</div>
          </div>
        ))}
      </div>

      <div style={S.card}>
        <div style={S.cardHead}>
          <span style={S.cardTitle}>Historique transactions</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <input
              placeholder="Filtrer..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ ...S.input, width: 140, padding: "5px 10px", fontSize: 11 }}
            />
            {isAdmin && (
              <>
                <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ ...S.input, width: "auto", padding: "5px 10px", fontSize: 11 }} />
                <span style={{ color: T.textDim, fontSize: 11 }}>→</span>
                <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ ...S.input, width: "auto", padding: "5px 10px", fontSize: 11 }} />
              </>
            )}
          </div>
        </div>

        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Date & Heure</th>
              <th style={S.th}>Description</th>
              <th style={{ ...S.th, textAlign: "right" }}>Montant</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0
              ? <tr><td colSpan={3}><div style={S.emptyState}>Aucune transaction</div></td></tr>
              : filtered.map(t => (
                <tr key={t.id}>
                  <td style={{ ...S.td, color: T.textDim, whiteSpace: "nowrap", fontSize: 11 }}>
                    {fmtDate(t.date)} {fmtTime(t.date)}
                  </td>
                  <td style={{ ...S.td, fontWeight: 600, maxWidth: 320 }}>{t.description}</td>
                  <td style={{ ...S.td, textAlign: "right", color: T.green, fontWeight: 800, whiteSpace: "nowrap" }}>
                    +{fmtGNF(t.montant)}
                  </td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════
// 19-A. VUE PARAMÈTRES (admin uniquement)
// ═══════════════════════════════════════════════════════════════════

function ParametresView() {
  const { role } = useAuth();
  const showToast = useToast();

  // Étape 1 : vérification mot de passe admin avant d'accéder
  const [verified, setVerified] = useState(false);
  const [verifyInput, setVerifyInput] = useState("");
  const [verifyError, setVerifyError] = useState("");

  // Formulaire de modification
  const [newAdmin, setNewAdmin] = useState("");
  const [newStaff, setNewStaff] = useState("");
  const [showAdmin, setShowAdmin] = useState(false);
  const [showStaff, setShowStaff] = useState(false);

  // Seul l'admin peut accéder
  if (role !== "admin") {
    return (
      <div>
        <h1 style={S.pageTitle}>Paramètres</h1>
        <div style={{ ...S.card, padding: "40px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
          <div style={{ fontWeight: 700, color: T.textMid }}>Accès réservé à l'administrateur</div>
        </div>
      </div>
    );
  }

  // ── Étape 1 : vérification ────────────────────────────────────────
  if (!verified) {
    const handleVerify = () => {
      const passwords = pwdManager.load();
      if (verifyInput === passwords.admin) {
        setVerified(true);
        setVerifyError("");
      } else {
        setVerifyError("Mot de passe incorrect.");
      }
    };
    return (
      <div>
        <h1 style={S.pageTitle}>Paramètres</h1>
        <div style={{ ...S.card, maxWidth: 400 }}>
          <div style={S.cardHead}>
            <span style={S.cardTitle}>🔐 Vérification requise</span>
          </div>
          <div style={{ padding: "20px 18px" }}>
            <div style={{ fontSize: 13, color: T.textDim, marginBottom: 16, lineHeight: 1.55 }}>
              Confirmez votre identité avant d'accéder aux paramètres avancés.
            </div>
            <Field label="Mot de passe Admin">
              <input
                style={S.input}
                type="password"
                placeholder="••••••••"
                value={verifyInput}
                onChange={e => setVerifyInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleVerify()}
                autoFocus
              />
            </Field>
            {verifyError && (
              <div style={{ background: T.redDark, border: `1px solid ${T.redBd}`, borderRadius: 7, padding: "8px 12px", fontSize: 12, color: T.red, marginBottom: 12 }}>
                ⚠ {verifyError}
              </div>
            )}
            <button
              style={{ ...S.btn("primary"), width: "100%", justifyContent: "center", padding: 10 }}
              onClick={handleVerify}
            >
              Confirmer
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Étape 2 : interface de modification ───────────────────────────
  const handleSave = () => {
    if (!newAdmin && !newStaff) {
      showToast("Aucune modification", "Renseignez au moins un mot de passe", "warning");
      return;
    }
    if (newAdmin && newAdmin.length < 4) {
      showToast("Trop court", "Le mot de passe admin doit faire au moins 4 caractères", "error");
      return;
    }
    if (newStaff && newStaff.length < 4) {
      showToast("Trop court", "Le mot de passe staff doit faire au moins 4 caractères", "error");
      return;
    }
    if (!window.confirm("Confirmer la mise à jour des mots de passe ?")) return;
    const current = pwdManager.load();
    const updated = {
      admin: newAdmin.trim() || current.admin,
      staff: newStaff.trim() || current.staff,
    };
    pwdManager.save(updated);
    showToast("✓ Mots de passe mis à jour", "Les modifications sont effectives immédiatement", "success");
    setNewAdmin("");
    setNewStaff("");
  };

  const handleReset = () => {
    if (!window.confirm("Réinitialiser les mots de passe par défaut ?\n\nAdmin → Bavon1986\nStaff → 20GYM26")) return;
    pwdManager.reset();
    showToast("Mots de passe réinitialisés", "Admin: Bavon1986 · Staff: 20GYM26", "info");
    setNewAdmin("");
    setNewStaff("");
  };

  const current = pwdManager.load();

  return (
    <div>
      <div style={S.pageHeader}>
        <div>
          <h1 style={S.pageTitle}>Paramètres</h1>
          <div style={S.pageSubtitle}>Gestion des accès · Admin uniquement</div>
        </div>
      </div>

      {/* Info comptes actuels */}
      <div style={{ ...S.card, marginBottom: 16, maxWidth: 520 }}>
        <div style={S.cardHead}>
          <span style={S.cardTitle}>👤 Comptes actifs</span>
        </div>
        <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
          {[
            { label: "Admin (CEO)", key: "admin", color: T.yellow },
            { label: "Staff",       key: "staff", color: T.blue  },
          ].map(({ label, key, color }) => (
            <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", background: T.surface2, borderRadius: 9, border: `1px solid ${T.border}` }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13, color: T.text }}>{label}</div>
                <div style={{ fontSize: 11, color: T.textDim, marginTop: 2 }}>Identifiant : <strong style={{ color }}>{key}</strong></div>
              </div>
              <span style={S.pill(color)}>Actif</span>
            </div>
          ))}
        </div>
      </div>

      {/* Formulaire modification */}
      <div style={{ ...S.card, maxWidth: 520 }}>
        <div style={S.cardHead}>
          <span style={S.cardTitle}>🔑 Modifier les mots de passe</span>
        </div>
        <div style={{ padding: "18px" }}>
          <div style={{ fontSize: 12, color: T.textDim, marginBottom: 18, lineHeight: 1.55, background: T.surface2, borderRadius: 8, padding: "10px 13px", border: `1px solid ${T.border}` }}>
            ℹ Laissez un champ vide pour ne pas modifier ce mot de passe. Minimum 4 caractères.
          </div>

          {/* Admin */}
          <Field label="Nouveau mot de passe Admin">
            <div style={{ position: "relative" }}>
              <input
                style={S.input}
                type={showAdmin ? "text" : "password"}
                placeholder="Laisser vide = pas de changement"
                value={newAdmin}
                onChange={e => setNewAdmin(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowAdmin(v => !v)}
                style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: T.textDim, cursor: "pointer", fontSize: 14, padding: 0 }}
              >
                {showAdmin ? "🙈" : "👁"}
              </button>
            </div>
          </Field>

          {/* Staff */}
          <Field label="Nouveau mot de passe Staff">
            <div style={{ position: "relative" }}>
              <input
                style={S.input}
                type={showStaff ? "text" : "password"}
                placeholder="Laisser vide = pas de changement"
                value={newStaff}
                onChange={e => setNewStaff(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowStaff(v => !v)}
                style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: T.textDim, cursor: "pointer", fontSize: 14, padding: 0 }}
              >
                {showStaff ? "🙈" : "👁"}
              </button>
            </div>
          </Field>

          <div style={{ display: "flex", gap: 9, marginTop: 4 }}>
            <button
              style={{ ...S.btn("primary"), flex: 1, justifyContent: "center", padding: "10px" }}
              onClick={handleSave}
            >
              💾 Enregistrer
            </button>
            <button
              style={{ ...S.btn("danger"), justifyContent: "center", padding: "10px 16px" }}
              onClick={handleReset}
              title="Remettre les mots de passe par défaut"
            >
              ↺ Réinitialiser
            </button>
          </div>

          {/* Info valeurs après reset */}
          <div style={{ marginTop: 14, fontSize: 11, color: T.textFaint, lineHeight: 1.6 }}>
            Valeurs par défaut après réinitialisation :<br />
            <strong style={{ color: T.textDim }}>Admin</strong> → Bavon1986 &nbsp;·&nbsp; <strong style={{ color: T.textDim }}>Staff</strong> → 20GYM26
          </div>
        </div>
      </div>
    </div>
  );
}
// ═══════════════════════════════════════════════════════════════════
// 19. VUE ARTS MARTIAUX
// ═══════════════════════════════════════════════════════════════════

function ArtsMartiauxView() {
  const { role } = useAuth();
  const showToast = useToast();
  const [modal, setModal] = useState(null); // "inscription" | "liste" | "paiements" | "statistiques" | "fiche"

  // Hook avec API
  const {
    eleves,
    paiements,
    loading,
    syncing,
    loadData,
    addEleve,
    addPaiement,
    deleteEleve,
    getPaiementsByEleve,
    getTotalPaiements,
    getPaiementsDuMois,
    getMontantDuMois,
  } = useArtsMartiauxData(showToast);
  // États du formulaire d'inscription
  const [form, setForm] = useState({
    nom: "",
    telephone: "",
    adresse: "",
    age: "",
    sexe: "",
    discipline: "",
    date_inscription: todayISO(),
  });
  const [saving, setSaving] = useState(false);
  const [searchList, setSearchList] = useState("");
  const [selectedEleve, setSelectedEleve] = useState(null);
  // États pour les paiements
  const [selectedEleveId, setSelectedEleveId] = useState("");
  const [montantPaiement, setMontantPaiement] = useState("");
  const [observationPaiement, setObservationPaiement] = useState("");
  const [paiementSaving, setPaiementSaving] = useState(false);

  // Gestion de l'inscription
  const handleInscription = async () => {
    // Validation des champs obligatoires
    if (!form.nom.trim()) {
      showToast("Champ requis", "Le nom est obligatoire", "error");
      return;
    }
    if (!form.discipline) {
      showToast("Champ requis", "Veuillez sélectionner une discipline", "error");
      return;
    }

    setSaving(true);
    try {
      await addEleve(form);
      // Réinitialiser le formulaire
      setForm({
        nom: "",
        telephone: "",
        adresse: "",
        age: "",
        sexe: "",
        discipline: "",
        date_inscription: todayISO(),
      });
      setModal(null);
    } catch (err) {
      // L'erreur est déjà gérée dans le hook
    } finally {
      setSaving(false);
    }
  };

  const CARDS = [
    { id: "inscription", label: "Nouvelle inscription", icon: "🥋", color: T.green },
    { id: "liste", label: "Liste des élèves", icon: "👥", color: T.blue },
    { id: "paiements", label: "Paiements du mois", icon: "💰", color: T.orange },
    { id: "statistiques", label: "Statistiques", icon: "📈", color: T.purple },
  ];

  const handleCardClick = (id) => {
    if (id === "inscription" && role === "staff") {
      // Le staff peut inscrire
      setModal("inscription");
    } else if (id === "inscription" && role === "admin") {
      setModal("inscription");
    } else if (id === "liste") {
      setModal("liste");
    } else if (id === "paiements") {
      setSelectedEleveId("");
      setMontantPaiement("");
      setObservationPaiement("");
      setModal("paiements");
    } else if (id === "statistiques" && role === "admin") {
      setModal("statistiques");
    } else {
      showToast("Accès limité", "Cette fonctionnalité est réservée à l'administrateur", "warning");
    }
  };

  return (
    <div>
      <div style={S.pageHeader}>
        <div>
          <h1 style={S.pageTitle}>Arts Martiaux</h1>
          <div style={S.pageSubtitle}>Gestion des inscriptions et paiements</div>
        </div>
        <span style={S.roleBadge(role)}>{role === "admin" ? "🔓 Admin" : "👤 Staff"}</span>
      </div>

<div
  className="dashboard-grid arts-dashboard-grid"
  style={{
    marginBottom: 24,
    justifyContent: "center"
  }}
>
        {CARDS.map((card) => {
          const isDisabled = card.id === "statistiques" && role !== "admin";
          return (
            <div
              key={card.id}
style={{
    ...S.card,
    width: "100%",
                padding: "28px 18px",
                textAlign: "center",
                cursor: isDisabled ? "not-allowed" : "pointer",
                opacity: isDisabled ? 0.4 : 1,
                transition: "all 0.2s ease",
                borderColor: isDisabled ? T.border : T.border2,
                boxShadow: isDisabled ? "none" : "0 2px 8px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.02)",
                transform: "translateY(0)",
                "@media(max-width:768px)": {
                  padding: "18px 12px",
                }
              }}
              onMouseEnter={(e) => {
                if (!isDisabled) {
                  e.currentTarget.style.borderColor = card.color;
                  e.currentTarget.style.boxShadow = `0 4px 20px rgba(0,0,0,0.5), 0 0 0 2px ${card.color}44`;
                  e.currentTarget.style.transform = "translateY(-2px)";
                }
              }}
              onMouseLeave={(e) => {
                if (!isDisabled) {
                  e.currentTarget.style.borderColor = T.border2;
                  e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.02)";
                  e.currentTarget.style.transform = "translateY(0)";
                }
              }}
              onClick={() => !isDisabled && handleCardClick(card.id)}
            >
              <div style={{ fontSize: 40, marginBottom: 10 }}>{card.icon}</div>
              <div style={{ fontWeight: 700, fontSize: 14, color: T.text }}>{card.label}</div>
              {isDisabled && (
                <div style={{ fontSize: 10, color: T.textDim, marginTop: 6 }}>🔒 Admin uniquement</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Contenu contextuel selon la modal ouverte */}
      <Modal
        open={!!modal}
        onClose={() => setModal(null)}
        title={
          modal === "inscription" ? "🥋 Nouvelle inscription" :
          modal === "liste" ? "👥 Liste des élèves" :
          modal === "paiements" ? "💰 Paiements du mois" :
          modal === "statistiques" ? "📈 Statistiques" :
          modal === "fiche" ? "👤 Fiche élève" : ""
        }
        maxWidth={modal === "liste" ? 600 : modal === "fiche" ? 480 : 440}
      >
        {modal === "inscription" && (
          <div style={{ padding: "4px 0" }}>
            <div style={{ color: T.textDim, fontSize: 13, marginBottom: 16 }}>
              Formulaire d'inscription aux arts martiaux
            </div>
            <Inp 
              label="Nom complet *" 
              placeholder="Ex: Mamadou Diallo" 
              value={form.nom}
              onChange={e => setForm({ ...form, nom: e.target.value })}
            />
            <Inp 
              label="Téléphone" 
              placeholder="+224 620 000 000" 
              type="tel"
              value={form.telephone}
              onChange={e => setForm({ ...form, telephone: e.target.value })}
            />
            <Inp 
              label="Adresse domicile" 
              placeholder="Ex: Quartier, Commune, Ville" 
              value={form.adresse}
              onChange={e => setForm({ ...form, adresse: e.target.value })}
            />
            <Inp 
              label="Âge" 
              placeholder="Ex: 25" 
              type="number"
              value={form.age}
              onChange={e => setForm({ ...form, age: e.target.value })}
            />
            <Sel 
              label="Sexe"
              value={form.sexe}
              onChange={e => setForm({ ...form, sexe: e.target.value })}
            >
              <option value="">Sélectionner...</option>
              <option value="M">Masculin</option>
              <option value="F">Féminin</option>
            </Sel>
            <Sel 
              label="Discipline"
              value={form.discipline}
              onChange={e => setForm({ ...form, discipline: e.target.value })}
            >
              <option value="">Sélectionner...</option>
              <option value="Kick-Boxing">Kick-Boxing</option>
              <option value="Boxe">Boxe</option>
              <option value="Lutte">Lutte</option>
              <option value="Judo">Judo</option>
            </Sel>
            <Inp 
              label="Date d'inscription" 
              type="date" 
              value={form.date_inscription}
              onChange={e => setForm({ ...form, date_inscription: e.target.value })}
            />
            <button
              style={{ ...S.btn("primary"), width: "100%", justifyContent: "center", padding: "11px", marginTop: 8 }}
              onClick={handleInscription}
              disabled={saving}
            >
              {saving ? "Enregistrement..." : "Enregistrer l'inscription"}
            </button>
          </div>
        )}

        {modal === "liste" && (
  <div>

{(() => {
const now = new Date();
const moisActuel = now.getMonth() + 1;
const anneeActuelle = now.getFullYear();

              const filteredEleves = eleves.filter(e => 
                e.nom.toLowerCase().includes(searchList.toLowerCase()) ||
                e.telephone.includes(searchList) ||
                e.discipline.toLowerCase().includes(searchList.toLowerCase())
              );

              const getPaiementMois = (eleveId) => {
                return paiements.find(p => 
                  p.eleve_id === eleveId && 
                  p.mois === moisActuel && 
                  p.annee === anneeActuelle
                );
              };

              return (
                <>
                  <SearchBar 
                    value={searchList} 
                    onChange={setSearchList} 
                    placeholder="Rechercher par nom, téléphone ou discipline..." 
                  />

                  {loading ? (
                    <div style={{ textAlign: "center", padding: "20px 0", color: T.textDim }}>
                      Chargement des élèves...
                    </div>
                  ) : filteredEleves.length === 0 ? (
                    <div style={{ color: T.textDim, fontSize: 12, textAlign: "center", padding: "20px 0" }}>
                      {eleves.length === 0 ? (
                        <>
                          Aucun élève inscrit pour le moment.
                          <br />
                          <span style={{ fontSize: 10, color: T.textFaint }}>Cliquez sur "Nouvelle inscription" pour commencer.</span>
                        </>
                      ) : (
                        "Aucun élève ne correspond à votre recherche."
                      )}
                    </div>
                  ) : (
                    <div style={{ maxHeight: 400, overflowY: "auto" }}>
                      {filteredEleves.map((e, idx) => {
                        const paiementsEleve = getPaiementsByEleve(e.id);
                        const totalPaye = paiementsEleve.reduce((sum, p) => sum + (p.montant || 0), 0);
                        const dernierPaiement = paiementsEleve.length > 0 ? paiementsEleve[0] : null;
                        const paiementMois = getPaiementMois(e.id);
                        const estPayeCeMois = !!paiementMois;

                        return (
                          <div 
                            key={e.id} 
                            style={{
                              ...S.alertRow,
                              borderLeft: `3px solid ${estPayeCeMois ? T.green : T.orange}`,
                              cursor: "pointer",
                              background: !estPayeCeMois && role === "admin" ? "rgba(251, 146, 60, 0.05)" : "transparent",
                            }}
                            onClick={() => {
  setSelectedEleve(e);
  setModal("fiche");
}}
                          >
                            <Avatar name={e.nom} idx={idx} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: 700, fontSize: 13, color: T.text }}>
                                {e.nom}
                                {!estPayeCeMois && role === "admin" && (
                                  <span style={{ fontSize: 9, color: T.orange, marginLeft: 8 }}>
                                    ⚠ Non payé ce mois
                                  </span>
                                )}
                              </div>
                              <div style={{ fontSize: 10, color: T.textDim }}>
                                {e.discipline} · {e.age || "?"} ans · {e.telephone || "Pas de tél."}
                                {e.adresse && <span style={{ marginLeft: 6 }}>· 📍 {e.adresse}</span>}
                              </div>
                              <div style={{ fontSize: 9, color: totalPaye > 0 ? T.green : T.orange, marginTop: 2 }}>
                                {totalPaye > 0 ? `Total payé : ${fmtGNF(totalPaye)}` : "Aucun paiement"}
                                {dernierPaiement && ` · Dernier : ${fmtDate(dernierPaiement.date_paiement)}`}
                              </div>
                            </div>
<div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
  {role === "admin" && (
    <span
      style={{
        ...S.pill(estPayeCeMois ? T.green : T.orange),
        fontSize: 8,
        padding: "2px 8px",
      }}
    >
      {estPayeCeMois ? "✓ Payé" : "⏳ En attente"}
    </span>
  )}

  <div
    style={S.iconBtn("info")}
onClick={(ev) => {
  ev.stopPropagation();
  setSelectedEleve(e);
}}
    title="Voir la fiche"
  >
    👤
  </div>

  {role === "admin" && (
    <div
      style={S.iconBtn("danger")}
      title="Supprimer l'élève"
      onClick={async (ev) => {
        ev.stopPropagation();

        const ok = window.confirm(
          `Supprimer définitivement ${e.nom} ?\n\nCette action supprimera également tous ses paiements.`
        );

        if (!ok) return;

        try {
          await deleteEleve(e.id);
          showToast(
            "Élève supprimé",
            `${e.nom} a été supprimé avec succès.`,
            "success"
          );
        } catch (err) {
          showToast(
            "Erreur",
            "Impossible de supprimer cet élève.",
            "error"
          );
        }
      }}
    >
      🗑️
    </div>
  )}
</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
        )}
        

        {modal === "paiements" && (
          <div>
            {(() => {
              const now = new Date();
              const moisActuel = now.getMonth() + 1;
              const anneeActuelle = now.getFullYear();

              const handlePaiement = async () => {
                if (!selectedEleveId) {
                  showToast("Sélection requise", "Veuillez choisir un élève", "error");
                  return;
                }
                if (!montantPaiement || parseFloat(montantPaiement) <= 0) {
                  showToast("Montant invalide", "Veuillez saisir un montant valide", "error");
                  return;
                }

                setPaiementSaving(true);
                try {
                  await addPaiement({
                    eleve_id: selectedEleveId,
                    mois: moisActuel,
                    annee: anneeActuelle,
                    date_paiement: new Date().toISOString().split("T")[0],
                    montant: parseFloat(montantPaiement),
                    observation: observationPaiement || `Paiement ${new Date(anneeActuelle, moisActuel - 1).toLocaleString("fr-FR", { month: "long" })} ${anneeActuelle}`,
                  });
                  setSelectedEleveId("");
                  setMontantPaiement("");
                  setObservationPaiement("");
                  setModal(null);
                  showToast("Paiement enregistré", "Le paiement a été synchronisé", "success");
                } catch (err) {
                  // L'erreur est déjà gérée dans le hook
                } finally {
                  setPaiementSaving(false);
                }
              };

              const eleveSelectionne = eleves.find(e => e.id === selectedEleveId);
              const paiementExistant = eleveSelectionne ? paiements.find(p => 
                p.eleve_id === eleveSelectionne.id && 
                p.mois === moisActuel && 
                p.annee === anneeActuelle
              ) : null;

              return (
                <div>
                  <div style={{ color: T.textDim, fontSize: 13, marginBottom: 12 }}>
                    Enregistrer un paiement pour le mois de <strong style={{ color: T.text }}>
                      {new Date(anneeActuelle, moisActuel - 1).toLocaleString("fr-FR", { month: "long" })} {anneeActuelle}
                    </strong>
                  </div>

                  <Sel 
                    label="Élève *"
                    value={selectedEleveId}
                    onChange={e => setSelectedEleveId(e.target.value)}
                  >
                    <option value="">Sélectionner un élève...</option>
                    {eleves.map(e => {
                      const dejaPaye = paiements.some(p => 
                        p.eleve_id === e.id && 
                        p.mois === moisActuel && 
                        p.annee === anneeActuelle
                      );
                      return (
                        <option key={e.id} value={e.id}>
                          {e.nom} - {e.discipline}
                          {dejaPaye && " ✅ Payé"}
                        </option>
                      );
                    })}
                  </Sel>

                  {selectedEleveId && eleveSelectionne && (
                    <>
                      <div style={{ 
                        background: paiementExistant ? T.greenDark : T.surface2, 
                        border: `1px solid ${paiementExistant ? T.greenBd : T.border}`,
                        borderRadius: 8, 
                        padding: "10px 13px", 
                        marginBottom: 12,
                        fontSize: 12,
                        color: paiementExistant ? T.green : T.textDim
                      }}>
                        {paiementExistant ? (
                          <span>✅ Ce mois est déjà payé pour <strong style={{ color: T.text }}>{eleveSelectionne.nom}</strong></span>
                        ) : (
                          <span>💳 Paiement à enregistrer pour <strong style={{ color: T.text }}>{eleveSelectionne.nom}</strong></span>
                        )}
                      </div>

                      <Inp 
                        label="Montant *"
                        type="number"
                        placeholder="Ex: 50000"
                        value={montantPaiement}
                        onChange={e => setMontantPaiement(e.target.value)}
                        disabled={!!paiementExistant}
                      />

                      <Inp 
                        label="Observation (optionnel)"
                        placeholder="Ex: Paiement janvier"
                        value={observationPaiement}
                        onChange={e => setObservationPaiement(e.target.value)}
                        disabled={!!paiementExistant}
                      />

                      <button
                        style={{ 
                          ...S.btn("primary"), 
                          width: "100%", 
                          justifyContent: "center", 
                          padding: "11px", 
                          marginTop: 8,
                          opacity: paiementExistant || paiementSaving ? 0.6 : 1,
                          cursor: paiementExistant || paiementSaving ? "not-allowed" : "pointer",
                        }}
                        onClick={handlePaiement}
                        disabled={!!paiementExistant || paiementSaving || !selectedEleveId || !montantPaiement}
                      >
                        {paiementExistant ? "✓ Déjà payé ce mois" : paiementSaving ? "Enregistrement..." : "💾 Enregistrer le paiement"}
                      </button>
                    </>
                  )}

                  {eleves.length === 0 && (
                    <div style={{ color: T.textDim, fontSize: 12, textAlign: "center", padding: "20px 0" }}>
                      Aucun élève inscrit.
                      <br />
                      <span style={{ fontSize: 10, color: T.textFaint }}>Cliquez sur "Nouvelle inscription" pour commencer.</span>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {modal === "statistiques" && role === "admin" && (
          <div>
            {(() => {
              const now = new Date();
              const moisActuel = now.getMonth() + 1;
              const anneeActuelle = now.getFullYear();

              // Statistiques globales
              const totalEleves = eleves.length;
              const totalPaiements = paiements.length;
              const totalEncaisse = getTotalPaiements();
              
              // Statistiques du mois
              const paiementsMois = getPaiementsDuMois(moisActuel, anneeActuelle);
              const totalMois = getMontantDuMois(moisActuel, anneeActuelle);
              const elevesPayesMois = new Set(paiementsMois.map(p => p.eleve_id)).size;

              // Répartition par discipline
              const disciplineStats = {};
              eleves.forEach(e => {
                disciplineStats[e.discipline] = (disciplineStats[e.discipline] || 0) + 1;
              });

              // Derniers paiements (5 derniers)
              const derniersPaiements = [...paiements]
                .sort((a, b) => new Date(b.date_paiement) - new Date(a.date_paiement))
                .slice(0, 5);

              return (
                <div>
                  {/* KPIs principaux */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
                    <div style={{ background: T.surface2, padding: "14px", borderRadius: 10, border: `1px solid ${T.border}` }}>
                      <div style={{ fontSize: 9, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>
                        Élèves inscrits
                      </div>
                      <div style={{ fontSize: 22, fontWeight: 900, color: T.text }}>{totalEleves}</div>
                    </div>
                    <div style={{ background: T.surface2, padding: "14px", borderRadius: 10, border: `1px solid ${T.border}` }}>
                      <div style={{ fontSize: 9, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>
                        Total encaissé
                      </div>
                      <div style={{ fontSize: 22, fontWeight: 900, color: T.green }}>{fmtGNF(totalEncaisse)}</div>
                    </div>
                    <div style={{ background: T.surface2, padding: "14px", borderRadius: 10, border: `1px solid ${T.border}` }}>
                      <div style={{ fontSize: 9, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>
                        Paiements total
                      </div>
                      <div style={{ fontSize: 22, fontWeight: 900, color: T.blue }}>{totalPaiements}</div>
                    </div>
                  </div>

                  {/* Statistiques du mois */}
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 10, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10, fontWeight: 700 }}>
                      Mois en cours - {new Date(anneeActuelle, moisActuel - 1).toLocaleString("fr-FR", { month: "long" })} {anneeActuelle}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                      <div style={{ background: T.greenDark, border: `1px solid ${T.greenBd}`, borderRadius: 10, padding: "12px 14px" }}>
                        <div style={{ fontSize: 8, color: "#2d7d4d", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>
                          Encaissé
                        </div>
                        <div style={{ fontWeight: 900, color: T.green, fontSize: 18 }}>{fmtGNF(totalMois)}</div>
                      </div>
                      <div style={{ background: T.blueDark, border: `1px solid ${T.blueBd}`, borderRadius: 10, padding: "12px 14px" }}>
                        <div style={{ fontSize: 8, color: "#2d4d7d", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>
                          Paiements
                        </div>
                        <div style={{ fontWeight: 900, color: T.blue, fontSize: 18 }}>{paiementsMois.length}</div>
                      </div>
                      <div style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 14px" }}>
                        <div style={{ fontSize: 8, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>
                          Élèves payés
                        </div>
                        <div style={{ fontWeight: 900, color: T.text, fontSize: 18 }}>{elevesPayesMois} / {totalEleves}</div>
                      </div>
                    </div>
                  </div>

                  {/* Répartition par discipline */}
                  {Object.keys(disciplineStats).length > 0 && (
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 10, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8, fontWeight: 700 }}>
                        Répartition par discipline
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {Object.entries(disciplineStats).map(([discipline, count], idx) => {
                          const colors = ["#4ade80", "#60a5fa", "#f472b6", "#fb923c", "#a78bfa", "#34d399"];
                          const color = colors[idx % colors.length];
                          return (
                            <span 
                              key={discipline}
                              style={{
                                ...S.pill(color),
                                padding: "4px 12px",
                                fontSize: 11,
                                background: color + "18",
                                border: `1px solid ${color}44`,
                              }}
                            >
                              {discipline} : {count} {count > 1 ? "élèves" : "élève"}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Derniers paiements */}
                  {derniersPaiements.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8, fontWeight: 700 }}>
                        Derniers paiements
                      </div>
                      <div style={{ maxHeight: 150, overflowY: "auto" }}>
                        {derniersPaiements.map(p => {
                          const eleve = eleves.find(e => e.id === p.eleve_id);
                          return (
                            <div 
                              key={p.id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "6px 10px",
                                background: T.surface2,
                                borderRadius: 6,
                                marginBottom: 3,
                                border: `1px solid ${T.border}`,
                                fontSize: 11,
                              }}
                            >
                              <div>
                                <span style={{ fontWeight: 600, color: T.text }}>
                                  {eleve ? eleve.nom : "Élève inconnu"}
                                </span>
                                <span style={{ color: T.textDim, marginLeft: 6 }}>
                                  {new Date(p.annee, p.mois - 1).toLocaleString("fr-FR", { month: "short" })} {p.annee}
                                </span>
                              </div>
                              <span style={{ color: T.green, fontWeight: 700 }}>
                                +{fmtGNF(p.montant)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {totalEleves === 0 && (
                    <div style={{ color: T.textDim, fontSize: 12, textAlign: "center", padding: "20px 0" }}>
                      Aucune donnée disponible pour le moment.
                      <br />
                      <span style={{ fontSize: 10, color: T.textFaint }}>Commencez par ajouter des inscriptions.</span>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {modal === "fiche" && selectedEleve && (
          <div>
            {(() => {
              const now = new Date();
              const moisActuel = now.getMonth() + 1;
              const anneeActuelle = now.getFullYear();
              
              const paiementsEleve = getPaiementsByEleve(selectedEleve.id);
              const totalPaye = paiementsEleve.reduce((sum, p) => sum + (p.montant || 0), 0);
              const paiementMois = paiementsEleve.find(p => 
                p.mois === moisActuel && p.annee === anneeActuelle
              );
              const estPayeCeMois = !!paiementMois;
              const dernierPaiement = paiementsEleve.length > 0 ? paiementsEleve[0] : null;

              return (
                <div>
                  {/* En-tête avec avatar et nom */}
                  <div style={{ 
                    display: "flex", 
                    alignItems: "center", 
                    gap: 14, 
                    marginBottom: 16,
                    paddingBottom: 14,
                    borderBottom: `1px solid ${T.border}`
                  }}>
                    <Avatar name={selectedEleve.nom} idx={0} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 800, fontSize: 17, color: T.text }}>
                        {selectedEleve.nom}
                        {!estPayeCeMois && role === "admin" && (
                          <span style={{ fontSize: 11, color: T.orange, marginLeft: 10 }}>
                            ⚠ Non payé ce mois
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: T.textDim }}>
                        {selectedEleve.discipline} · {selectedEleve.age || "?"} ans · {selectedEleve.telephone || "Pas de tél."}
                        {selectedEleve.adresse && <span style={{ marginLeft: 6 }}>· 📍 {selectedEleve.adresse}</span>}
                      </div>
                      <div style={{ fontSize: 11, color: T.textDim, marginTop: 3 }}>
                        Inscrit le {fmtDate(selectedEleve.date_inscription)}
                      </div>
                    </div>
                    <span style={S.pill(estPayeCeMois ? T.green : T.orange)}>
                      {estPayeCeMois ? "✓ Payé ce mois" : "⏳ En attente"}
                    </span>
                  </div>

                  {/* Statistiques rapides */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
                    <div style={{ background: T.greenDark, border: `1px solid ${T.greenBd}`, borderRadius: 10, padding: "12px 14px" }}>
                      <div style={{ fontSize: 9, color: "#2d7d4d", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>
                        Total payé
                      </div>
                      <div style={{ fontWeight: 900, color: T.green, fontSize: 18 }}>{fmtGNF(totalPaye)}</div>
                    </div>
                    <div style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 10, padding: "12px 14px" }}>
                      <div style={{ fontSize: 9, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 3 }}>
                        Paiements
                      </div>
                      <div style={{ fontWeight: 700, color: T.text, fontSize: 18 }}>{paiementsEleve.length}</div>
                      {dernierPaiement && (
                        <div style={{ fontSize: 10, color: T.textDim, marginTop: 3 }}>
                          Dernier : {fmtDate(dernierPaiement.date_paiement)}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Historique des paiements */}
                  <div style={{ fontSize: 10, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10, fontWeight: 700 }}>
                    Historique des paiements
                  </div>

                  {paiementsEleve.length === 0 ? (
                    <div style={{ color: T.textFaint, fontSize: 12, fontStyle: "italic", textAlign: "center", padding: "16px 0" }}>
                      Aucun paiement enregistré pour cet élève.
                    </div>
                  ) : (
                    <div style={{ maxHeight: 200, overflowY: "auto" }}>
                      {paiementsEleve.map(p => (
                        <div 
                          key={p.id} 
                          style={{ 
                            display: "flex", 
                            alignItems: "center", 
                            justifyContent: "space-between", 
                            padding: "8px 12px", 
                            background: T.surface2, 
                            borderRadius: 8, 
                            marginBottom: 4,
                            border: `1px solid ${T.border}`
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 12, color: T.text }}>
                              {new Date(p.annee, p.mois - 1).toLocaleString("fr-FR", { month: "long" })} {p.annee}
                            </div>
                            <div style={{ fontSize: 10, color: T.textDim }}>
                              {fmtDate(p.date_paiement)} {p.observation ? `· ${p.observation}` : ""}
                            </div>
                          </div>
                          <span style={{ color: T.green, fontWeight: 800, fontSize: 13 }}>
                            {fmtGNF(p.montant)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Actions */}
                  <div style={{ 
                    marginTop: 16, 
                    paddingTop: 14, 
                    borderTop: `1px solid ${T.border}`,
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap"
                  }}>
                    {/* Bouton WhatsApp */}
                    <WaBtn 
                      phone={selectedEleve.telephone} 
                      message={`Bonjour ${selectedEleve.nom.split(" ")[0]}, nous vous contactons depuis le Gym Nouvel Élan - Arts Martiaux. Comment allez-vous ? 💪`} 
                    />

                    {/* Bouton Gérer les paiements (admin uniquement) */}
                    {role === "admin" && (
                      <button 
                        style={{ ...S.btn("primary"), flex: 1 }}
                        onClick={() => {
                          setSelectedEleveId(selectedEleve.id);
                          setModal("paiements");
                        }}
                      >
                        💰 Gérer les paiements
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </Modal>
    </div>
  );
}
// ═══════════════════════════════════════════════════════════════════
// 19. VUE GESTION GLOBALE
// ═══════════════════════════════════════════════════════════════════

function GestionGlobaleView({ gymCaisse, artsPaiements, clients, abonnements, eleves, now }) {
  const { role } = useAuth();
  const showToast = useToast();
  
  const [filterSource, setFilterSource] = useState("all"); // "all" | "gym" | "arts"
  const [period, setPeriod] = useState("today"); // "today" | "week" | "month" | "custom"
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [viewMode, setViewMode] = useState("summary"); // "summary" | "details"

  // Seul l'admin peut accéder
  if (role !== "admin") {
    return (
      <div>
        <h1 style={S.pageTitle}>Gestion globale</h1>
        <div style={{ ...S.card, padding: "40px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
          <div style={{ fontWeight: 700, color: T.textMid }}>Accès réservé à l'administrateur</div>
        </div>
      </div>
    );
  }

  // Normalisation des données de la caisse gym
  const gymTransactions = gymCaisse.map(t => ({
    ...t,
    source: "gym",
    date: t.date,
    montant: t.montant,
    description: t.description,
    id: t.id,
  }));

  // Normalisation des données arts martiaux
  const artsTransactions = artsPaiements.map(p => {
    const eleve = eleves.find(e => e.id === p.eleve_id);
    return {
      ...p,
      source: "arts",
      date: p.date_paiement,
      montant: p.montant,
      description: `${eleve ? eleve.nom : "Élève"} - ${new Date(p.annee, p.mois - 1).toLocaleString("fr-FR", { month: "long" })} ${p.annee}`,
      id: p.id,
    };
  });

  // Fusion des transactions
  const allTransactions = [...gymTransactions, ...artsTransactions];

  // Filtrage par source
  const filteredBySource = allTransactions.filter(t => {
    if (filterSource === "all") return true;
    return t.source === filterSource;
  });

  // Filtrage par période
  const getDateFilter = () => {
    const nowDate = new Date(now);
    const todayStr = nowDate.toISOString().split("T")[0];
    
    switch (period) {
      case "today":
        return { from: todayStr, to: todayStr };
      case "week": {
        const weekStart = new Date(nowDate);
        weekStart.setDate(nowDate.getDate() - 7);
        return { from: weekStart.toISOString().split("T")[0], to: todayStr };
      }
      case "month": {
        const monthStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1);
        return { from: monthStart.toISOString().split("T")[0], to: todayStr };
      }
      case "custom":
        return { from: dateFrom || todayStr, to: dateTo || todayStr };
      default:
        return { from: todayStr, to: todayStr };
    }
  };

  const dateFilter = getDateFilter();

  // Filtrage final
  const filteredTransactions = filteredBySource.filter(t => {
    const tDate = t.date.split("T")[0];
    return tDate >= dateFilter.from && tDate <= dateFilter.to;
  });

  // Statistiques
  const stats = useMemo(() => {
    const totalGym = filteredTransactions.filter(t => t.source === "gym").reduce((sum, t) => sum + t.montant, 0);
    const totalArts = filteredTransactions.filter(t => t.source === "arts").reduce((sum, t) => sum + t.montant, 0);
    const totalAll = totalGym + totalArts;
    const count = filteredTransactions.length;

    // Transactions par jour
    const byDay = {};
    filteredTransactions.forEach(t => {
      const day = t.date.split("T")[0];
      if (!byDay[day]) byDay[day] = { gym: 0, arts: 0, total: 0 };
      byDay[day][t.source] = (byDay[day][t.source] || 0) + t.montant;
      byDay[day].total += t.montant;
    });

    const days = Object.keys(byDay).sort();
    const chartData = days.map(day => ({
      day,
      gym: byDay[day].gym || 0,
      arts: byDay[day].arts || 0,
      total: byDay[day].total || 0,
    }));

    return { totalGym, totalArts, totalAll, count, chartData };
  }, [filteredTransactions]);

  // Dernières transactions (10 dernières)
  const recentTransactions = [...filteredTransactions]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 10);

  const sourceLabels = {
    all: "Toutes les sources",
    gym: "Gym",
    arts: "Arts martiaux",
  };

  const periodLabels = {
    today: "Aujourd'hui",
    week: "7 derniers jours",
    month: "Ce mois",
    custom: "Période personnalisée",
  };

  return (
    <div>
      <div style={S.pageHeader}>
        <div>
          <h1 style={S.pageTitle}>📊 Gestion globale</h1>
          <div style={S.pageSubtitle}>
            Vue consolidée des revenus - {filteredTransactions.length} transactions
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span style={S.roleBadge("admin")}>🔓 Admin</span>
        </div>
      </div>

      {/* Filtres */}
      <div style={{ 
        ...S.card, 
        padding: "16px 18px", 
        marginBottom: 20,
        display: "flex",
        flexWrap: "wrap",
        gap: 12,
        alignItems: "center",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, color: T.textDim, fontWeight: 600 }}>Source :</span>
          {["all", "gym", "arts"].map(src => (
            <span
              key={src}
              style={{
                ...S.fPill(filterSource === src),
                padding: "4px 12px",
                fontSize: 11,
                cursor: "pointer",
              }}
              onClick={() => setFilterSource(src)}
            >
              {sourceLabels[src]}
            </span>
          ))}
        </div>

        <div style={{ width: 1, height: 24, background: T.border }} />

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: T.textDim, fontWeight: 600 }}>Période :</span>
          {["today", "week", "month", "custom"].map(p => (
            <span
              key={p}
              style={{
                ...S.fPill(period === p),
                padding: "4px 12px",
                fontSize: 11,
                cursor: "pointer",
              }}
              onClick={() => setPeriod(p)}
            >
              {periodLabels[p]}
            </span>
          ))}
        </div>

        {period === "custom" && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              style={{ ...S.input, width: "auto", padding: "5px 8px", fontSize: 11 }}
            />
            <span style={{ color: T.textDim, fontSize: 11 }}>→</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              style={{ ...S.input, width: "auto", padding: "5px 8px", fontSize: 11 }}
            />
          </div>
        )}
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 20 }}>
        <div style={{ ...S.kpiCard }}>
          <div style={S.kpiBar(T.green)} />
          <div style={S.kpiLabel}>Total global</div>
          <div style={{ ...S.kpiValue, color: T.green }}>{fmtGNF(stats.totalAll)}</div>
          <div style={S.kpiSub}>{stats.count} transaction(s)</div>
        </div>
        <div style={{ ...S.kpiCard }}>
          <div style={S.kpiBar(T.blue)} />
          <div style={S.kpiLabel}>Gym</div>
          <div style={{ ...S.kpiValue, color: T.blue }}>{fmtGNF(stats.totalGym)}</div>
          <div style={S.kpiSub}>
            {stats.totalAll > 0 ? ((stats.totalGym / stats.totalAll) * 100).toFixed(1) : 0}% du total
          </div>
        </div>
        <div style={{ ...S.kpiCard }}>
          <div style={S.kpiBar(T.orange)} />
          <div style={S.kpiLabel}>Arts martiaux</div>
          <div style={{ ...S.kpiValue, color: T.orange }}>{fmtGNF(stats.totalArts)}</div>
          <div style={S.kpiSub}>
            {stats.totalAll > 0 ? ((stats.totalArts / stats.totalAll) * 100).toFixed(1) : 0}% du total
          </div>
        </div>
        <div style={{ ...S.kpiCard }}>
          <div style={S.kpiBar(T.purple)} />
          <div style={S.kpiLabel}>Moyenne / jour</div>
          <div style={{ ...S.kpiValue, color: T.purple }}>
            {fmtGNF(stats.chartData.length > 0 ? stats.totalAll / stats.chartData.length : 0)}
          </div>
          <div style={S.kpiSub}>sur {stats.chartData.length} jour(s)</div>
        </div>
      </div>

      {/* Graphique */}
      <div style={{ ...S.card, marginBottom: 20 }}>
        <div style={S.cardHead}>
          <span style={S.cardTitle}>📈 Évolution des revenus</span>
          <div style={{ display: "flex", gap: 12, fontSize: 10, color: T.textDim }}>
            <span><span style={{ display: "inline-block", width: 12, height: 12, background: T.blue, borderRadius: 2, marginRight: 4 }} /> Gym</span>
            <span><span style={{ display: "inline-block", width: 12, height: 12, background: T.orange, borderRadius: 2, marginRight: 4 }} /> Arts martiaux</span>
          </div>
        </div>
        <div style={{ padding: "16px 18px", overflowX: "auto" }}>
          {stats.chartData.length === 0 ? (
            <div style={{ textAlign: "center", padding: "30px 0", color: T.textDim }}>
              Aucune donnée pour cette période
            </div>
          ) : (
            <div style={{ minWidth: 400 }}>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 180 }}>
                {stats.chartData.map((day, idx) => {
                  const maxVal = Math.max(...stats.chartData.map(d => d.total), 1);
                  const gymHeight = (day.gym / maxVal) * 140;
                  const artsHeight = (day.arts / maxVal) * 140;
                  const totalHeight = (day.total / maxVal) * 140;

                  return (
                    <div key={idx} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                      <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 150 }}>
                        {day.gym > 0 && (
                          <div 
                            style={{ 
                              width: 16, 
                              height: Math.max(gymHeight, 2), 
                              background: T.blue, 
                              borderRadius: "2px 2px 0 0",
                              opacity: filterSource === "arts" ? 0.3 : 1,
                              transition: "height 0.3s",
                            }}
                            title={`Gym: ${fmtGNF(day.gym)}`}
                          />
                        )}
                        {day.arts > 0 && (
                          <div 
                            style={{ 
                              width: 16, 
                              height: Math.max(artsHeight, 2), 
                              background: T.orange, 
                              borderRadius: "2px 2px 0 0",
                              opacity: filterSource === "gym" ? 0.3 : 1,
                              transition: "height 0.3s",
                            }}
                            title={`Arts: ${fmtGNF(day.arts)}`}
                          />
                        )}
                      </div>
                      <div style={{ fontSize: 8, color: T.textDim, textAlign: "center", maxWidth: 40, overflow: "hidden", textOverflow: "ellipsis" }}>
                        {day.day.split("-").slice(1).join("/")}
                      </div>
                      <div style={{ fontSize: 7, color: T.textFaint, fontWeight: 700 }}>
                        {fmtGNF(day.total)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Dernières transactions */}
      <div style={S.card}>
        <div style={S.cardHead}>
          <span style={S.cardTitle}>📋 Dernières transactions</span>
          <span style={{ fontSize: 10, color: T.textDim }}>{recentTransactions.length} affichées</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ ...S.table, minWidth: 500 }}>
            <thead>
              <tr>
                <th style={S.th}>Date</th>
                <th style={S.th}>Description</th>
                <th style={S.th}>Source</th>
                <th style={{ ...S.th, textAlign: "right" }}>Montant</th>
              </tr>
            </thead>
            <tbody>
              {recentTransactions.length === 0 ? (
                <tr><td colSpan={4}><div style={S.emptyState}>Aucune transaction</div></td></tr>
              ) : (
                recentTransactions.map(t => (
                  <tr key={t.id}>
                    <td style={{ ...S.td, color: T.textDim, whiteSpace: "nowrap", fontSize: 11 }}>
                      {fmtDate(t.date)}
                    </td>
                    <td style={{ ...S.td, fontSize: 12, maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.description}
                    </td>
                    <td style={S.td}>
                      <span style={S.pill(t.source === "gym" ? T.blue : T.orange)}>
                        {t.source === "gym" ? "🏋️ Gym" : "🥋 Arts"}
                      </span>
                    </td>
                    <td style={{ ...S.td, textAlign: "right", color: T.green, fontWeight: 700, whiteSpace: "nowrap" }}>
                      +{fmtGNF(t.montant)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
// ═══════════════════════════════════════════════════════════════════
// 19. SIDEBAR
// ═══════════════════════════════════════════════════════════════════

function Sidebar({ view, setView, alertCount, syncing, offline, lastSync, onRefresh, onLogout, mobileOpen, onCloseMobile }) {
  const { role, displayName } = useAuth();

  const NAV = [
    { id: "dashboard",   label: "Tableau de bord", icon: "◈" },
    { id: "clients",     label: "Clients",          icon: "👥" },
    { id: "abonnements", label: "Abonnements",       icon: "📋" },
    { id: "seances",     label: "Séances directes",  icon: "⏱" },
    { id: "artsMartiaux", label: "Arts Martiaux", icon: "🥋" },
    ...(role === "admin" ? [{ id: "gestionGlobale", label: "Gestion globale", icon: "📊" }] : []),
    ...(can(role, "view_caisse") ? [{ id: "caisse", label: "Caisse", icon: "💰" }] : []),
    ...(role === "admin" ? [{ id: "parametres", label: "Paramètres", icon: "⚙️" }] : []),
  ];

  return (
    <aside style={S.sidebar} className={mobileOpen ? "sidebar-open" : ""}>
      {/* Logo */}
      <div style={S.logo}>
        <div style={S.logoSub}>Gym Management</div>
        <div style={S.logoMain}>NOUVEL <span style={S.logoAccent}>ÉLAN</span></div>
        <div style={S.logoVersion}>v{CONFIG.VERSION}</div>
      </div>

      {/* Nav */}
      <nav style={S.nav}>
        {NAV.map(n => (
          <div key={n.id} style={S.navItem(view === n.id)} onClick={() => setView(n.id)}>
            <span style={S.navIcon}>{n.icon}</span>
            {n.label}
            {n.id === "abonnements" && alertCount > 0 && (
              <span style={S.navBadge}>{alertCount}</span>
            )}
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div style={S.sidebarFoot}>
        {/* Statut connexion */}
        <div style={{ fontSize: 10, color: offline ? T.orange : syncing ? T.blue : T.textFaint, fontWeight: 600, paddingLeft: 3, display: "flex", alignItems: "center", gap: 5 }}>
          <span>{offline ? "⚠" : syncing ? "⟳" : "✓"}</span>
          <span>
            {offline ? "Hors ligne" : syncing ? "Synchronisation..." : lastSync ? `Sync ${new Date(lastSync).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : ""}
          </span>
        </div>

        <button style={S.btnSmall("blue")} onClick={onRefresh} disabled={syncing}>⟳ Rafraîchir</button>

        {/* Utilisateur connecté */}
        <div style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 9, padding: "9px 11px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.text }}>{displayName}</div>
            <span style={S.roleBadge(role)}>{role === "admin" ? "🔓 Admin" : "👤 Staff"}</span>
          </div>
          <button
            style={{ ...S.iconBtn("danger"), width: 26, height: 26 }}
            onClick={onLogout}
            title="Déconnexion"
          >↩</button>
        </div>
      </div>
    </aside>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 20. APP ROOT (version corrigée - hooks avant les retours)
// ═══════════════════════════════════════════════════════════════════

export default function App() {
  // ── 1. TOUS LES USESTATE ──────────────────────────────────────
  const [user, setUser] = useState(() => loadSession());
  const [view, setView] = useState("dashboard");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [now, setNow] = useState(new Date());

  // ── 2. TOUS LES HOOKS (TOUJOURS APPELÉS DANS LE MÊME ORDRE) ──
  const { toasts, showToast } = useToastManager();

  // Timer
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Données Gym
  const {
    clients, setClients,
    abonnements, setAbonnements,
    caisse, setCaisse,
    seancesActives, setSeancesActives,
    loading, syncing, offline, lastSync,
    loadData,
  } = useGymData(showToast);

  // Données Arts Martiaux
  const {
    eleves,
    paiements,
  } = useArtsMartiauxData(showToast);

  // Paramètres (thème, etc.)
  const { settings, updateFlatSetting, resetToDefaults } = useSettings();

  // Configuration depuis le backend
  const { config: appConfig, loading: configLoading, updateConfig } = useAppConfig(showToast);

  // Compteur alertes
  const alertCount = useMemo(() =>
    abonnements.filter(a => ["expiring", "expired"].includes(getSubStatus(a.fin, now))).length,
    [abonnements, now]
  );

  // ── 3. TOUS LES HANDLERS (useCallback) ──────────────────────
  // (Déclarés AVANT les retours conditionnels pour maintenir l'ordre des hooks)

  const handleLogout = () => {
    clearSession();
    setUser(null);
    showToast("Déconnecté", "À bientôt !", "info");
  };

  const handleAddClient = useCallback(async (form) => {
    const tempId = genId();
    const newClient = normalizeClient({ id: tempId, ...form, date_inscription: todayISO() });
    setClients(p => [newClient, ...p]);
    showToast("Client créé", form.nom, "success");
    try {
      const res = await apiPost("addClient", { nom: form.nom, telephone: form.telephone, objectif: form.objectif, statut: form.statut, date_inscription: todayISO() });
      if (res?.id) setClients(p => p.map(c => c.id === tempId ? { ...c, id: String(res.id) } : c));
    } catch { showToast("Sync échouée", "Client sauvegardé localement", "error"); }
  }, [setClients, showToast]);

  const handleDeleteClient = useCallback(async (id) => {
    setClients(p => p.filter(c => c.id !== id));
    setAbonnements(p => p.filter(a => a.client_id !== id));
    showToast("Supprimé", "Client supprimé définitivement", "info");
    try { await apiPost("deleteClient", { id }); } catch {}
  }, [setClients, setAbonnements, showToast]);

  const handleAddAbonnement = useCallback(async (client_id, type, debut) => {
    const client = clients.find(c => c.id === client_id);
    if (!client) return;
    // Utiliser les prix dynamiques
    const subTypes = getSubscriptionPrices(appConfig);
    const cfg = subTypes[type];
    const fin = addDays(debut, cfg.duration - 1);
    const tempAboId = genId();
    const tempTxId = genId();
    const debutISO = debut.toISOString().split("T")[0];
    const finISO = fin.toISOString().split("T")[0];

    setAbonnements(p => [normalizeAbonnement({ id: tempAboId, client_id, type, debut: debutISO, fin: finISO, seances_restantes: cfg.maxSessions || 0, statut: "actif" }), ...p]);
    setCaisse(p => [normalizeCaisse({ id: tempTxId, date: new Date().toISOString(), description: `Abonnement ${cfg.label} — ${client.nom}`, montant: cfg.price }), ...p]);
    showToast("Abonnement créé", `${cfg.label} · ${fmtGNF(cfg.price)}`, "success");

    let result = { aboId: tempAboId, txId: tempTxId, debut: debutISO, fin: finISO, seances_restantes: cfg.maxSessions || 0 };

    try {
      const res = await apiPost("addAbonnement", { client_id, type, debut: debutISO, fin: finISO, seances_restantes: cfg.maxSessions || 0, statut: "actif", montant: cfg.price, description: `Abonnement ${cfg.label} — ${client.nom}` });
      if (res?.aboId) {
        const realId = String(res.aboId);
        setAbonnements(p => p.map(a => a.id === tempAboId ? { ...a, id: realId } : a));
        result = { ...result, aboId: realId };
      }
      if (res?.txId) {
        const realTxId = String(res.txId);
        setCaisse(p => p.map(t => t.id === tempTxId ? { ...t, id: realTxId } : t));
        result = { ...result, txId: realTxId };
      }
    } catch { 
      showToast("Sync échouée", "Données sauvegardées localement", "error");
    }
    
    return result;
  }, [clients, setAbonnements, setCaisse, showToast]);

  const handleDeleteAbonnement = useCallback(async (id) => {
    setAbonnements(p => p.filter(a => a.id !== id));
    showToast("Supprimé", "Abonnement supprimé", "info");
    try { await apiPost("deleteAbonnement", { id }); } catch {}
  }, [setAbonnements, showToast]);

  const handleCheckIn = useCallback(async (aboId) => {
    const abo = abonnements.find(a => a.id === aboId);
    if (!abo) return false;
    if (abo.seances_restantes <= 0) {
      showToast("Quota atteint", "Plus de séances disponibles", "error");
      return false;
    }
    const newRestantes = abo.seances_restantes - 1;
    setAbonnements(p =>
      p.map(a => a.id === aboId ? { ...a, seances_restantes: newRestantes } : a)
    );
    showToast("Séance pointée", `${newRestantes} restante(s)`, "success");
    try {
      await apiPost("checkIn", { id: aboId, seances_restantes: newRestantes });
    } catch {}
    return true;
  }, [abonnements, setAbonnements, showToast]);

  const handleStartSeance = useCallback(async (data) => {
    const memberDuration = Number(appConfig?.memberSessionDuration) || 120;
    const rate = data.isMember ? { price: 0, durationMinutes: memberDuration } : SESSION_RATES[data.rateKey];
    const newId = genId();
    const newSeance = { 
      id: newId, 
      nom: data.nom, 
      isMember: data.isMember, 
      price: rate.price, 
      durationMinutes: rate.durationMinutes, 
      debut: new Date().toISOString(), 
      type: data.rateKey || "membre",
      statut: "en_cours"
    };

    setSeancesActives(p => [newSeance, ...p]);
    showToast("Séance démarrée", data.nom, "success");

    if (!data.isMember && rate.price > 0) {
      const montant = Number(rate.price);
      const tempId = genId();
      const desc = `Séance directe — ${data.nom} (${SESSION_RATES[data.rateKey]?.label || data.rateKey})`;
      
      setCaisse(p => [normalizeCaisse({ 
        id: tempId, 
        date: new Date().toISOString(), 
        description: desc, 
        montant: montant 
      }), ...p]);
      
      showToast("✅ Paiement encaissé", `${fmtGNF(montant)} pour la séance de ${data.nom}`, "success");
      
      try {
        await apiPost("startSeance", newSeance);
        await new Promise(resolve => setTimeout(resolve, 800));
        const resTx = await apiPost("addTransaction", {
          date: new Date().toISOString(),
          description: desc,
          montant: montant
        });
        if (resTx?.txId) {
          setCaisse(p => p.map(t => t.id === tempId ? { ...t, id: String(resTx.txId) } : t));
        }
      } catch (err) {
        console.error("Erreur lors de la synchronisation:", err);
        showToast("Erreur de synchronisation", "Vérifiez votre connexion ou l'onglet Caisse sur Sheets.", "error");
      }
    } else {
      try {
        await apiPost("startSeance", newSeance);
      } catch (err) {
        console.error("Erreur lors de l'enregistrement de la séance:", err);
        showToast("Erreur", "La séance n'a pas pu être synchronisée.", "error");
      }
    }
  }, [setSeancesActives, setCaisse, showToast, appConfig]);

  const handleEndSeance = useCallback(async (id, sessionData) => {
    const s = sessionData || seancesActives.find(x => x.id === id);
    if (!s) return;
    setSeancesActives(p => p.filter(x => x.id !== id));
    if (!s.isMember) {
      showToast("Séance terminée", `${s.nom} a terminé sa séance`, "success");
      try { 
        await apiPost("finishSeance", { 
          id: s.id, 
          nom: s.nom, 
          type: s.type, 
          debut: s.debut, 
          fin: new Date().toISOString(), 
          statut: "terminee",
          montant: 0,
          description: `Séance terminée — ${s.nom}`
        }); 
      } catch {}
    } else {
      showToast("Séance terminée", "Séance membre clôturée (gratuit)", "info");
      try { 
        await apiPost("finishSeance", { 
          id: s.id, 
          nom: s.nom, 
          type: "membre", 
          debut: s.debut, 
          fin: new Date().toISOString(), 
          statut: "terminee" 
        }); 
      } catch {}
    }
  }, [seancesActives, setSeancesActives, showToast]);

  // ── 4. RETOURS CONDITIONNELS (UNIQUEMENT POUR LE LOGIN) ────
  // Le login doit être traité avant tout, car on ne peut pas appeler de hooks après un return.
  // Mais comme tous les hooks sont déjà déclarés avant, c'est sûr.

  if (!user) {
    return (
      <ToastContext.Provider value={showToast}>
        <style>{GLOBAL_CSS}</style>
        <LoginScreen onLogin={setUser} />
        <ToastManager toasts={toasts} />
      </ToastContext.Provider>
    );
  }

  // ── 5. RENDU FINAL AVEC CHARGEMENT CONDITIONNEL ────────────
  // Plus de return anticipé pour configLoading.
  // L'affichage du chargement est géré dans le JSX.

  const authValue = { ...user };

  // On prépare l'écran de chargement de la configuration
  const ConfigLoadingScreen = () => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", gap: 16, background: "#090909", color: "#e8e8e8" }}>
      <div style={S.spinner} />
      <div style={{ color: T.textDim, fontSize: 13 }}>Chargement en cours...</div>
    </div>
  );

  return (
    <AuthContext.Provider value={authValue}>
      <ToastContext.Provider value={showToast}>
        <SettingsContext.Provider value={{ settings, updateFlatSetting, resetToDefaults, updateConfig }}>
          <style>{GLOBAL_CSS}</style>

          <div style={S.app} className={`app${settings?.darkMode === false ? " light-mode" : ""}`}>
            {/* Top Bar */}
            <div style={S.topBar} className="top-bar">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", position: "relative" }}>
                <button
                  className="mobile-hamburger"
                  onClick={() => setMobileMenuOpen(true)}
                  aria-label="Ouvrir le menu"
                >☰</button>

                <span style={{
                  fontWeight: 800,
                  fontSize: 16,
                  color: T.text,
                  position: "absolute",
                  left: "50%",
                  transform: "translateX(-50%)",
                  whiteSpace: "nowrap"
                }}>{appConfig?.gymName || CONFIG.APP_NAME}</span>

                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 12, color: T.textDim, display: "none", "@media(min-width:700px)": { display: "block" } }}>{user.displayName}</span>
                  <span style={S.roleBadge(user.role)}>{user.role === "admin" ? "Admin" : "Staff"}</span>
                  <button
                    style={{ ...S.iconBtn("ghost"), width: 32, height: 32, fontSize: 16 }}
                    onClick={handleLogout}
                    title="Déconnexion"
                  >⏻</button>
                </div>
              </div>
            </div>

            {mobileMenuOpen && (
              <div className="sidebar-overlay" onClick={() => setMobileMenuOpen(false)} />
            )}

            <Sidebar
              view={view} setView={setView}
              alertCount={alertCount}
              syncing={syncing} offline={offline} lastSync={lastSync}
              onRefresh={() => loadData(true)}
              onLogout={handleLogout}
              mobileOpen={mobileMenuOpen}
              onCloseMobile={() => setMobileMenuOpen(false)}
            />

            <main style={S.main}>
              {configLoading ? (
                <ConfigLoadingScreen />
              ) : loading ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "70vh", gap: 16 }}>
                  <div style={S.spinner} />
                  <div style={{ color: T.textDim, fontSize: 13 }}>Chargement des données...</div>
                </div>
              ) : (
                <div style={S.mainInner}>
                  {view === "dashboard" && (
                    <DashboardView clients={clients} abonnements={abonnements} caisse={caisse} seancesActives={seancesActives} now={now} offline={offline} />
                  )}
                  {view === "clients" && (
                    <ClientsView clients={clients} abonnements={abonnements} caisse={caisse} now={now} syncing={syncing} onAdd={handleAddClient} onDelete={handleDeleteClient} />
                  )}
                  {view === "abonnements" && (
                    <AbonnementsView abonnements={abonnements} clients={clients} now={now} syncing={syncing} onAdd={handleAddAbonnement} onDelete={handleDeleteAbonnement} onCheckIn={handleCheckIn} />
                  )}
                  {view === "seances" && (
                    <SeancesView 
                      seancesActives={seancesActives} 
                      clients={clients} 
                      now={now} 
                      onStart={handleStartSeance} 
                      onEnd={handleEndSeance}
                      abonnements={abonnements}
                      onCheckIn={handleCheckIn}
                    />
                  )}
                  {view === "artsMartiaux" && (
                    <ArtsMartiauxView />
                  )}
                  {view === "gestionGlobale" && user.role === "admin" && (
                    <GestionGlobaleView 
                      gymCaisse={caisse}
                      artsPaiements={paiements}
                      clients={clients}
                      abonnements={abonnements}
                      eleves={eleves}
                      now={now}
                    />
                  )}
                  {view === "caisse" && can(user.role, "view_caisse") && (
                    <CaisseView caisse={caisse} now={now} syncing={syncing} />
                  )}
                  {view === "parametres" && user.role === "admin" && (
                    <ParametresViewV2 />
                  )}
                </div>
              )}
            </main>
          </div>

          <ToastManager toasts={toasts} />
        </SettingsContext.Provider>
      </ToastContext.Provider>
    </AuthContext.Provider>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 21. CSS GLOBAL
// ═══════════════════════════════════════════════════════════════════

const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800;900&display=swap');

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  @keyframes slideIn { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: none; } }

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html { font-size: 16px; }
  body { margin: 0; background: #090909; color: #e8e8e8; }

  /* Scrollbar */
  ::-webkit-scrollbar { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track { background: #0a0a0a; }
  ::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: #3a3a3a; }

  /* Inputs */
  input, select, textarea {
    font-family: 'DM Sans', sans-serif;
    color-scheme: dark;
  }
  input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(0.4); cursor: pointer; }
  select option { background: #161616; color: #e8e8e8; }
  input:focus, select:focus { border-color: #4ade80 !important; box-shadow: 0 0 0 2px rgba(74,222,128,0.12); }

  /* Buttons */
  button { font-family: 'DM Sans', sans-serif; }
  button:hover { opacity: 0.85; }
  button:active { opacity: 0.7; }
  button:disabled { cursor: not-allowed; }

  /* Animations */
  .fade-in { animation: fadeIn 0.2s ease; }

  /* Overlay pour sidebar mobile */
  .sidebar-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.5);
    z-index: 90;
  }

  /* Bouton hamburger dans la top bar */
  .mobile-hamburger {
    display: none;
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: transparent;
    border: none;
    color: #e8e8e8;
    font-size: 22px;
    cursor: pointer;
    align-items: center;
    justify-content: center;
  }

  /* Responsive Mobile */
  @media (max-width: 900px) {
    aside {
      position: fixed !important;
      top: 0;
      left: 0;
      z-index: 100;
      width: 230px;
      height: 100vh;
      background: #111111;
      border-right: 1px solid #1e1e1e;
      transform: translateX(-100%);
      transition: transform 0.25s ease;
      box-shadow: 2px 0 20px rgba(0,0,0,0.5);
    }
    aside.sidebar-open {
      transform: translateX(0);
    }
    .main-inner { padding: 16px !important; }
    .mobile-hamburger { display: flex; }
  }
    /* Cacher la top bar sur PC (écrans larges) */
  @media (min-width: 769px) {
    .top-bar {
      display: none !important;
    }
    /* Supprimer le padding-top du main sur PC pour compenser */
    main {
      padding-top: 0 !important;
    }
  }

  /* ============================================================
     CARTES KPI - FORCER 2 COLONNES SUR MOBILE
     ============================================================ */
  @media (max-width: 768px) {
    /* Forcer la grille en 2 colonnes en écrasant le style inline */
    .kpi-grid {
      display: grid !important;
      grid-template-columns: 1fr 1fr !important;
      gap: 8px !important;
      width: 100% !important;
      max-width: 100% !important;
    }
        /* Masquer les colonnes Objectif, Statut, Inscription, Actions sur mobile */
  .clients-table th:nth-child(3),
  .clients-table th:nth-child(4),
  .clients-table th:nth-child(5),
  .clients-table th:nth-child(6),
  .clients-table td:nth-child(3),
  .clients-table td:nth-child(4),
  .clients-table td:nth-child(5),
  .clients-table td:nth-child(6) {
    display: none !important;
  }

    /* Forcer chaque carte à occuper toute la largeur de sa colonne */
    .kpi-card {
      width: 100% !important;
      max-width: 100% !important;
      box-sizing: border-box !important;
      padding: 8px 6px !important;
      border-radius: 8px !important;
    }

    .kpi-card .kpi-bar {
      height: 2px !important;
    }
    .kpi-card .kpi-label {
      font-size: 7px !important;
      letter-spacing: 0.04em !important;
      margin-bottom: 2px !important;
    }
    .kpi-card .kpi-value {
      font-size: 15px !important;
      line-height: 1.2 !important;
    }
    .kpi-card .kpi-sub {
      font-size: 6.5px !important;
      margin-top: 1px !important;
    }
    .kpi-card .kpi-delta {
      font-size: 7px !important;
      margin-top: 1px !important;
    }
    .kpi-card .sparkline {
      transform: scale(0.6);
      transform-origin: left center;
      margin-top: -2px !important;
    }

    /* Autres ajustements généraux */
    .grid3 { grid-template-columns: 1fr !important; }
    .grid2 { grid-template-columns: 1fr !important; }
    table { font-size: 10px !important; }
    .main-inner { padding: 10px !important; }
    .sub-card-head { padding: 8px 10px !important; }
    .sub-card-body { padding: 8px 10px !important; }
    .sub-card-foot { padding: 6px 10px !important; flex-wrap: wrap; gap: 4px; }
    .sub-card-foot .btn { font-size: 9px !important; padding: 4px 8px !important; }

    .sub-card {
      width: 100% !important;
      max-width: 100% !important;
      min-width: 0 !important;
      box-sizing: border-box !important;
    }

    .subs-grid {
      display: grid !important;
      grid-template-columns: 1fr !important;
      gap: 12px !important;
      width: 100% !important;
    }
  }

  @media (max-width: 480px) {
    .kpi-grid {
      gap: 6px !important;
    }
    .kpi-card {
      padding: 6px 5px !important;
      border-radius: 6px !important;
    }
    .kpi-card .kpi-label {
      font-size: 5.5px !important;
      letter-spacing: 0.03em !important;
      margin-bottom: 1px !important;
    }
    .kpi-card .kpi-value {
      font-size: 12px !important;
    }
    .kpi-card .kpi-sub {
      font-size: 5.5px !important;
      margin-top: 0 !important;
    }
    .kpi-card .kpi-delta {
      font-size: 6px !important;
      margin-top: 0 !important;
    }
    .kpi-card .sparkline {
      display: none !important;
    }
  }

  /* Styles pour les cartes Arts Martiaux */
  .arts-card {
    transition: all 0.2s ease !important;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.02) !important;
  }
  .arts-card:hover:not(.disabled) {
    box-shadow: 0 4px 20px rgba(0,0,0,0.5), 0 0 0 2px rgba(74,222,128,0.3) !important;
    transform: translateY(-2px) !important;
  }
  @media (max-width: 768px) {
    .arts-grid {
      grid-template-columns: repeat(2, 1fr) !important;
      gap: 10px !important;
    }
  }
    /* ===== Arts Martiaux ===== */

.arts-dashboard-grid{
    display:grid;
    grid-template-columns:repeat(4,minmax(180px,1fr));
    gap:14px;
    justify-content:center;
    align-items:stretch;
}

@media (max-width:768px){

    .arts-dashboard-grid{
        grid-template-columns:repeat(2,minmax(145px,170px));
        justify-content:center;
        gap:12px;
    }

    .arts-dashboard-grid > div{
        width:100%;
    }

}

  .app {
    --bg: #090909;
    --surface: #111111;
    --surface2: #161616;
    --surface3: #1a1a1a;
    --border: #1e1e1e;
    --border2: #252525;
    --text: #e8e8e8;
    --text-mid: #888;
    --text-dim: #555;
    --text-faint: #333;
  }
  .app.light-mode {
    --bg: #f0f0f0;
    --surface: #ffffff;
    --surface2: #f7f7f7;
    --surface3: #f0f0f0;
    --border: #e0e0e0;
    --border2: #d0d0d0;
    --text: #1a1a1a;
    --text-mid: #555555;
    --text-dim: #777777;
    --text-faint: #999999;
    background: #f0f0f0 !important;
    color: #1a1a1a !important;
  }
  .app.light-mode .card,
  .app.light-mode .kpi-card,
  .app.light-mode .sub-card,
  .app.light-mode .modal-box {
    background: #ffffff !important;
    border-color: #d0d0d0 !important;
  }
  .app.light-mode .sidebar {
    background: #f8f8f8 !important;
    border-color: #d0d0d0 !important;
  }
  .app.light-mode .sidebar .nav-item {
    color: #555 !important;
  }
  .app.light-mode .sidebar .nav-item.active {
    background: #e8e8e8 !important;
    color: #22a06b !important;
    border-color: #d0d0d0 !important;
  }
  .app.light-mode .sidebar .logo {
    border-color: #d0d0d0 !important;
  }
  .app.light-mode .sidebar .sidebar-foot {
    border-color: #d0d0d0 !important;
  }
  .app.light-mode input,
  .app.light-mode select,
  .app.light-mode textarea {
    background: #f5f5f5 !important;
    border-color: #d0d0d0 !important;
    color: #1a1a1a !important;
  }
  .app.light-mode input:focus,
  .app.light-mode select:focus {
    border-color: #22a06b !important;
    box-shadow: 0 0 0 2px rgba(34,160,107,0.15) !important;
  }
  .app.light-mode .page-title {
    color: #1a1a1a !important;
  }
  .app.light-mode .text-dim {
    color: #666 !important;
  }
  .app.light-mode .text-faint {
    color: #999 !important;
  }
  .app.light-mode .surface,
  .app.light-mode .surface2,
  .app.light-mode .surface3 {
    background: #f5f5f5 !important;
  }
  .app.light-mode .border {
    border-color: #d0d0d0 !important;
  }
  .app.light-mode .border2 {
    border-color: #e0e0e0 !important;
  }
  .app.light-mode .offline-banner {
    background: #fff3e0 !important;
    border-color: #ffb74d !important;
    color: #e65100 !important;
  }
  .app.light-mode .kpi-label {
    color: #888 !important;
  }
  .app.light-mode .kpi-sub {
    color: #999 !important;
  }
  .app.light-mode .empty-state {
    color: #999 !important;
  }
  .app.light-mode .alert-row {
    border-color: #e0e0e0 !important;
  }
  .app.light-mode .tx-row {
    border-color: #e0e0e0 !important;
  }
  .app.light-mode .top-bar {
    background: rgba(255,255,255,0.95) !important;
    border-color: #d0d0d0 !important;
  }
  .app.light-mode .top-bar .mobile-hamburger {
    color: #1a1a1a !important;
  }
  .app.light-mode .sub-card-head,
  .app.light-mode .sub-card-body,
  .app.light-mode .sub-card-foot {
    border-color: #e0e0e0 !important;
  }
  .app.light-mode .sub-card-foot {
    background: #f0f0f0 !important;
  }
  .app.light-mode .pill {
    background: rgba(0,0,0,0.05) !important;
  }
  .app.light-mode .badge-active {
    background: #e8f5e9 !important;
    color: #2e7d32 !important;
    border-color: #a5d6a7 !important;
  }
  .app.light-mode .badge-expiring {
    background: #fff3e0 !important;
    color: #e65100 !important;
    border-color: #ffb74d !important;
  }
  .app.light-mode .badge-expired {
    background: #ffebee !important;
    color: #c62828 !important;
    border-color: #ef9a9a !important;
  }
  .app.light-mode .progress {
    background: #e0e0e0 !important;
  }
  .app.light-mode .role-badge-admin {
    background: #fff8e1 !important;
    color: #f57f17 !important;
    border-color: #ffca28 !important;
  }
  .app.light-mode .role-badge-staff {
    background: #e3f2fd !important;
    color: #0d47a1 !important;
    border-color: #90caf9 !important;
  }
  .app.light-mode .toast {
    background: #ffffff !important;
    border-color: #d0d0d0 !important;
    color: #1a1a1a !important;
  }
  .app.light-mode .kpi-card .kpi-value {
    color: #1a1a1a !important;
  }
  .app.light-mode .kpi-card .kpi-bar {
    opacity: 0.6 !important;
  }
  .app.light-mode .sub-card .sub-card-head .text {
    color: #1a1a1a !important;
  }
  .app.light-mode .sub-card .sub-card-body .text-mid {
    color: #555 !important;
  }
  .app.light-mode .sub-card .sub-card-body .text-dim {
    color: #777 !important;
  }
  .app.light-mode .sub-card .status-badge {
    background: rgba(0,0,0,0.05) !important;
  }
  .app.light-mode .btn-ghost {
    background: #f0f0f0 !important;
    border-color: #d0d0d0 !important;
    color: #555 !important;
  }
  .app.light-mode .btn-primary {
    background: #e8f5e9 !important;
    border-color: #a5d6a7 !important;
    color: #2e7d32 !important;
  }
  .app.light-mode .btn-danger {
    background: #ffebee !important;
    border-color: #ef9a9a !important;
    color: #c62828 !important;
  }
  .app.light-mode .search-bar {
    background: #f5f5f5 !important;
    border-color: #d0d0d0 !important;
    color: #1a1a1a !important;
  }
  .app.light-mode .search-bar:focus {
    border-color: #22a06b !important;
  }
  .app.light-mode .avatar {
    background: rgba(0,0,0,0.08) !important;
    border-color: rgba(0,0,0,0.15) !important;
    color: #333 !important;
  }
  `;

// ═══════════════════════════════════════════════════════════════════
// 19-B. NOUVEAUX PARAMÈTRES AVANCÉS (admin uniquement)
// ═══════════════════════════════════════════════════════════════════

// Hook pour la gestion des paramètres globaux (localStorage)
function useSettings() {
  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem("gym_advanced_settings");
      if (saved) return JSON.parse(saved);
    } catch {}
    return {
      // A. Paramètres généraux
      gymName: "Gym Nouvel Élan",
      primaryColor: "#4ade80",
      currency: "CDF",
      timezone: "Africa/Kinshasa",
      logoUrl: "",
      darkMode: true, // ← Ajout du thème par défaut (sombre)
      
      // B. Paramètres des tarifs (abonnements)
      subscriptionPrices: {
        mensuel: 115000,
        seances16: 80500,
        seances12: 57500,
      },
      sessionPrices: {
        no_coach_1h: 4500,
        no_coach_2h: 7500,
        with_coach_1h: 6500,
        with_coach_1h30: 8000,
        with_coach_2h: 10000,
      },
      
      // C. Paramètres des notifications
      whatsappMessage: "Bonjour {name}, votre abonnement {status}. Venez renouveler au Gym Nouvel Élan 💪",
      alertDaysBefore: 3,
      enableNotifications: true,
      
      // E. Paramètres des séances
      memberSessionDuration: 120,
      visitorDefaultDuration: 60,
      memberFree: true,
    };
  });

  const updateSetting = useCallback((category, key, value) => {
    setSettings(prev => {
      const updated = { ...prev, [category]: { ...prev[category], [key]: value } };
      localStorage.setItem("gym_advanced_settings", JSON.stringify(updated));
      return updated;
    });
  }, []);

  const updateFlatSetting = useCallback((key, value) => {
    setSettings(prev => {
      const updated = { ...prev, [key]: value };
      localStorage.setItem("gym_advanced_settings", JSON.stringify(updated));
      return updated;
    });
  }, []);

  const resetToDefaults = useCallback(() => {
    const defaults = {
      gymName: "Gym Nouvel Élan",
      primaryColor: "#4ade80",
      currency: "CDF",
      timezone: "Africa/Kinshasa",
      logoUrl: "",
      subscriptionPrices: { mensuel: 115000, seances16: 80500, seances12: 57500 },
      sessionPrices: { no_coach_1h: 4500, no_coach_2h: 7500, with_coach_1h: 6500, with_coach_1h30: 8000, with_coach_2h: 10000 },
      whatsappMessage: "Bonjour {name}, votre abonnement {status}. Venez renouveler au Gym Nouvel Élan 💪",
      alertDaysBefore: 3,
      enableNotifications: true,
      memberSessionDuration: 120,
      visitorDefaultDuration: 60,
      memberFree: true,
    };
    localStorage.setItem("gym_advanced_settings", JSON.stringify(defaults));
    setSettings(defaults);
  }, []);

  return { settings, updateSetting, updateFlatSetting, resetToDefaults };
}

// Composant pour les paramètres avancés
function AdvancedSettingsView() {
  const { role } = useAuth();
  const showToast = useToast();
  const { settings, updateFlatSetting, resetToDefaults } = useSettingsCtx();
  
  const [activeTab, setActiveTab] = useState("general");
  const [tempSubscriptionPrices, setTempSubscriptionPrices] = useState(settings.subscriptionPrices);
  const [tempSessionPrices, setTempSessionPrices] = useState(settings.sessionPrices);
  const [savingPrices, setSavingPrices] = useState(false);

  // Assistant de suppression
  const [deleteWizardOpen, setDeleteWizardOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  const [deletePeriod, setDeletePeriod] = useState("today");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const [deleteCalcLoading, setDeleteCalcLoading] = useState(false);
  const [deleteCalc, setDeleteCalc] = useState(null);
  const [deletePasswordInput, setDeletePasswordInput] = useState("");
  const [deletePasswordError, setDeletePasswordError] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Seul l'admin peut accéder
  if (role !== "admin") {
    return (
      <div>
        <h1 style={S.pageTitle}>Paramètres avancés</h1>
        <div style={{ ...S.card, padding: "40px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
          <div style={{ fontWeight: 700, color: T.textMid }}>Accès réservé à l'administrateur</div>
        </div>
      </div>
    );
  }

  const tabs = [
    { id: "general", label: "🔐 Généraux", icon: "🏢" },
    { id: "prices", label: "💰 Tarifs", icon: "💵" },
    { id: "notifications", label: "📱 Notifications", icon: "🔔" },
    { id: "sessions", label: "⏱️ Séances", icon: "⏱️" },
    { id: "data", label: "🗄️ Données", icon: "🗄️" },
  ];

  const handleSavePrices = async () => {
    setSavingPrices(true);
    try {
      // 1. Préparer les données à envoyer au backend
      const configUpdates = {
        subscription_mensuel: String(tempSubscriptionPrices.mensuel),
        subscription_seances16: String(tempSubscriptionPrices.seances16),
        subscription_seances12: String(tempSubscriptionPrices.seances12),
        session_no_coach_1h: String(tempSessionPrices.no_coach_1h),
        session_no_coach_2h: String(tempSessionPrices.no_coach_2h),
        session_with_coach_1h: String(tempSessionPrices.with_coach_1h),
        session_with_coach_1h30: String(tempSessionPrices.with_coach_1h30),
        session_with_coach_2h: String(tempSessionPrices.with_coach_2h),
      };

      // 2. Envoyer au backend via updateConfig
      const result = await updateConfig(configUpdates);
      
      if (result) {
        // 3. Mettre à jour le localStorage
        updateFlatSetting("subscriptionPrices", tempSubscriptionPrices);
        updateFlatSetting("sessionPrices", tempSessionPrices);
        
        // 4. Mettre à jour les variables globales
        Object.keys(tempSubscriptionPrices).forEach(key => {
          if (currentSubTypes[key]) currentSubTypes[key].price = tempSubscriptionPrices[key];
        });
        Object.keys(tempSessionPrices).forEach(key => {
          if (currentSessionRates[key]) currentSessionRates[key].price = tempSessionPrices[key];
        });
        
        // 5. Mettre à jour les prix globaux
        updatePrices(configUpdates);
        
        showToast("Tarifs mis à jour", "Les nouveaux prix sont synchronisés avec le serveur", "success");
      } else {
        throw new Error("Échec de la synchronisation");
      }
    } catch (err) {
      showToast("Erreur", "Impossible de synchroniser les tarifs avec le serveur", "error");
    } finally {
      setSavingPrices(false);
    }
  };

  const handleResetAll = () => {
    if (window.confirm("⚠️ Réinitialiser TOUS les paramètres avancés ?\n\nCette action est irréversible.")) {
      resetToDefaults();
      setTempSubscriptionPrices(settings.subscriptionPrices);
      setTempSessionPrices(settings.sessionPrices);
      showToast("Paramètres réinitialisés", "Valeurs par défaut restaurées", "success");
    }
  };

  // Calcule la plage de dates selon la période choisie dans l'assistant de suppression
  const getDeletePeriodRange = () => {
    const nowD = new Date();
    const toStr = (d) => d.toISOString().split("T")[0];
    const todayStr = toStr(nowD);

    switch (deletePeriod) {
      case "today":
        return { from: todayStr, to: todayStr };
      case "yesterday": {
        const y = new Date(nowD);
        y.setDate(nowD.getDate() - 1);
        const yStr = toStr(y);
        return { from: yStr, to: yStr };
      }
      case "last7": {
        const d = new Date(nowD);
        d.setDate(nowD.getDate() - 7);
        return { from: toStr(d), to: todayStr };
      }
      case "last30": {
        const d = new Date(nowD);
        d.setDate(nowD.getDate() - 30);
        return { from: toStr(d), to: todayStr };
      }
      case "thisMonth": {
        const d = new Date(nowD.getFullYear(), nowD.getMonth(), 1);
        return { from: toStr(d), to: todayStr };
      }
      case "previousMonth": {
        const start = new Date(nowD.getFullYear(), nowD.getMonth() - 1, 1);
        const end = new Date(nowD.getFullYear(), nowD.getMonth(), 0);
        return { from: toStr(start), to: toStr(end) };
      }
      case "all":
        return { from: "1970-01-01", to: todayStr };
      case "custom":
        return { from: customStart || todayStr, to: customEnd || todayStr };
      default:
        return { from: todayStr, to: todayStr };
    }
  };

  // Étape 1 : calcule ce qui sera supprimé pour la période choisie
  const handleCalculerSuppression = async () => {
    if (deletePeriod === "custom" && (!customStart || !customEnd)) {
      showToast("Dates manquantes", "Renseignez les deux dates de la plage personnalisée", "warning");
      return;
    }

    setDeleteCalcLoading(true);
    setDeleteCalc(null);
    setDeletePasswordInput("");
    setDeletePasswordError("");

    try {
      const { from, to } = getDeletePeriodRange();
      const [resAbo, resCaisse, resSeances] = await Promise.all([
        apiGet("abonnements"),
        apiGet("caisse"),
        apiGet("seances"),
      ]);

      const extract = (res) => Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);
      const inRange = (dateVal) => {
        const d = String(dateVal || "").split("T")[0];
        return d && d >= from && d <= to;
      };

      const abosFiltres = extract(resAbo).filter(a => inRange(a.debut));
      const caisseFiltree = extract(resCaisse).filter(t => inRange(t.date));
      const seancesFiltrees = extract(resSeances).filter(s => inRange(s.debut));

      const totalCaisse = caisseFiltree.reduce((sum, t) => sum + (Number(t.montant) || 0), 0);

      setDeleteCalc({
        from, to,
        abonnements: abosFiltres.length,
        caisse: caisseFiltree.length,
        seances: seancesFiltrees.length,
        totalCaisse,
      });
    } catch (err) {
      showToast("Erreur", "Impossible de calculer les données à supprimer", "error");
    } finally {
      setDeleteCalcLoading(false);
    }
  };

  // Étape 2 : vérifie le mot de passe admin puis supprime réellement
  const handleConfirmerSuppression = async () => {
    const passwords = pwdManager.load();
    if (deletePasswordInput !== passwords.admin) {
      setDeletePasswordError("Mot de passe incorrect.");
      return;
    }
    setDeletePasswordError("");
    setDeleting(true);
    try {
      const { from, to } = getDeletePeriodRange();
      await apiPost("deleteByPeriod", {
        debut: from,
        fin: to,
        cibles: { abonnements: true, caisse: true, seances: true },
      });
      showToast(
        "Suppression effectuée",
        "Les données seront à jour au prochain rafraîchissement.",
        "success"
      );
      setDeleteWizardOpen(false);
      setDeleteCalc(null);
      setDeletePasswordInput("");
    } catch (err) {
      showToast("Erreur", "La suppression a échoué", "error");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <div style={S.pageHeader}>
        <div>
          <h1 style={S.pageTitle}>Paramètres avancés</h1>
          <div style={S.pageSubtitle}>Configuration complète de l'application</div>
        </div>
        <button style={S.btn("danger")} onClick={handleResetAll}>
          ↺ Tout réinitialiser
        </button>
      </div>

      {/* Onglets */}
      <div style={{ display: "flex", gap: 6, marginBottom: 24, flexWrap: "wrap", borderBottom: `1px solid ${T.border}`, paddingBottom: 8 }}>
        {tabs.map(tab => (
          <span
            key={tab.id}
            style={{
              ...S.fPill(activeTab === tab.id),
              padding: "8px 18px",
              fontSize: 12,
            }}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.icon} {tab.label}
          </span>
        ))}
      </div>

      {/* Contenu des onglets */}
      <div style={{ ...S.card, maxWidth: 700 }}>
        {/* A. PARAMÈTRES GÉNÉRAUX */}
        {activeTab === "general" && (
          <div>
            <div style={S.cardHead}>
              <span style={S.cardTitle}>🏢 Paramètres généraux</span>
            </div>
            <div style={{ padding: "18px" }}>
              <Inp
                label="Nom de la salle"
                value={settings.gymName}
                onChange={e => updateFlatSetting("gymName", e.target.value)}
                placeholder="Gym Nouvel Élan"
              />
              <Inp
                label="Couleur principale (hex)"
                value={settings.primaryColor}
                onChange={e => updateFlatSetting("primaryColor", e.target.value)}
                placeholder="#4ade80"
              />
              <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                <div style={{ width: 40, height: 40, background: settings.primaryColor, borderRadius: 8, border: `1px solid ${T.border}` }} />
                <span style={{ fontSize: 11, color: T.textDim, alignSelf: "center" }}>Aperçu de la couleur</span>
              </div>

              {/* Thème sombre/clair */}
              <div style={{ 
                marginTop: 16, 
                paddingTop: 16,
                borderTop: `1px solid ${T.border}`,
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>Thème de l'application</div>
                    <div style={{ fontSize: 11, color: T.textDim, marginTop: 2 }}>
                      {settings.darkMode ? "Mode sombre actif" : "Mode clair actif"}
                    </div>
                  </div>
                  <span
                    style={{
                      ...S.fPill(settings.darkMode),
                      padding: "6px 16px",
                      cursor: "pointer",
                      fontSize: 12,
                    }}
                    onClick={() => updateFlatSetting("darkMode", !settings.darkMode)}
                  >
                    {settings.darkMode ? "🌙 Sombre" : "☀️ Clair"}
                  </span>
                </div>
              </div>
              
              <Sel
                label="Devise"
                value={settings.currency}
                onChange={e => updateFlatSetting("currency", e.target.value)}
              >
                <option value="CDF">Franc Congolais (CDF)</option>
                <option value="GNF">Franc Guinéen (GNF)</option>
                <option value="USD">Dollar US (USD)</option>
                <option value="EUR">Euro (EUR)</option>
              </Sel>
              
              <Sel
                label="Fuseau horaire"
                value={settings.timezone}
                onChange={e => updateFlatSetting("timezone", e.target.value)}
              >
                <option value="Africa/Kinshasa">Kinshasa (UTC+1)</option>
                <option value="Africa/Lubumbashi">Lubumbashi (UTC+2)</option>
                <option value="Africa/Conakry">Conakry (UTC+0)</option>
                <option value="Europe/Paris">Paris (UTC+1/UTC+2)</option>
              </Sel>
              
              <div style={{ marginTop: 12, padding: "10px 12px", background: T.surface2, borderRadius: 8, border: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 11, color: T.textDim }}>ℹ️ Logo personnalisé (fonctionnalité à venir)</div>
              </div>
            </div>
          </div>
        )}

        {/* B. PARAMÈTRES DES TARIFS */}
        {activeTab === "prices" && (
          <div>
            <div style={S.cardHead}>
              <span style={S.cardTitle}>💰 Tarifs des abonnements</span>
            </div>
            <div style={{ padding: "18px" }}>
              <div style={{ fontSize: 12, color: T.textMid, marginBottom: 14 }}>Modifiez les prix des formules d'abonnement</div>
              <Inp
                label="Mensuel Illimité"
                type="number"
                value={tempSubscriptionPrices.mensuel}
                onChange={e => setTempSubscriptionPrices(prev => ({ ...prev, mensuel: parseInt(e.target.value) || 0 }))}
              />
              <Inp
                label="16 Séances / Mois"
                type="number"
                value={tempSubscriptionPrices.seances16}
                onChange={e => setTempSubscriptionPrices(prev => ({ ...prev, seances16: parseInt(e.target.value) || 0 }))}
              />
              <Inp
                label="12 Séances / Mois"
                type="number"
                value={tempSubscriptionPrices.seances12}
                onChange={e => setTempSubscriptionPrices(prev => ({ ...prev, seances12: parseInt(e.target.value) || 0 }))}
              />
            </div>

            <div style={{ ...S.cardHead, marginTop: 8 }}>
              <span style={S.cardTitle}>💵 Tarifs des séances directes</span>
            </div>
            <div style={{ padding: "18px" }}>
              <Inp
                label="Sans coach — 1h"
                type="number"
                value={tempSessionPrices.no_coach_1h}
                onChange={e => setTempSessionPrices(prev => ({ ...prev, no_coach_1h: parseInt(e.target.value) || 0 }))}
              />
              <Inp
                label="Sans coach — 2h"
                type="number"
                value={tempSessionPrices.no_coach_2h}
                onChange={e => setTempSessionPrices(prev => ({ ...prev, no_coach_2h: parseInt(e.target.value) || 0 }))}
              />
              <Inp
                label="Avec coach — 1h"
                type="number"
                value={tempSessionPrices.with_coach_1h}
                onChange={e => setTempSessionPrices(prev => ({ ...prev, with_coach_1h: parseInt(e.target.value) || 0 }))}
              />
              <Inp
                label="Avec coach — 1h30"
                type="number"
                value={tempSessionPrices.with_coach_1h30}
                onChange={e => setTempSessionPrices(prev => ({ ...prev, with_coach_1h30: parseInt(e.target.value) || 0 }))}
              />
              <Inp
                label="Avec coach — 2h"
                type="number"
                value={tempSessionPrices.with_coach_2h}
                onChange={e => setTempSessionPrices(prev => ({ ...prev, with_coach_2h: parseInt(e.target.value) || 0 }))}
              />
              
              <button
                style={{ ...S.btn("primary"), width: "100%", justifyContent: "center", marginTop: 12, padding: "10px" }}
                onClick={handleSavePrices}
                disabled={savingPrices}
              >
                {savingPrices ? "💾 Enregistrement..." : "💾 Enregistrer tous les tarifs"}
              </button>
            </div>
          </div>
        )}

        {/* C. PARAMÈTRES DES NOTIFICATIONS */}
        {activeTab === "notifications" && (
          <div>
            <div style={S.cardHead}>
              <span style={S.cardTitle}>📱 Notifications WhatsApp</span>
            </div>
            <div style={{ padding: "18px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <span style={{ fontSize: 13, color: T.text }}>Activer les notifications</span>
                <span
                  style={{
                    ...S.fPill(settings.enableNotifications),
                    padding: "5px 14px",
                    cursor: "pointer",
                  }}
                  onClick={() => updateFlatSetting("enableNotifications", !settings.enableNotifications)}
                >
                  {settings.enableNotifications ? "✅ Activé" : "⛔ Désactivé"}
                </span>
              </div>
              
              <Inp
                label="Délai d'alerte (jours avant expiration)"
                type="number"
                min="1"
                max="30"
                value={settings.alertDaysBefore}
                onChange={e => updateFlatSetting("alertDaysBefore", parseInt(e.target.value) || 3)}
              />
              
              <Field label="Message WhatsApp personnalisé">
                <textarea
                  style={{ ...S.input, minHeight: 100, fontFamily: "monospace", fontSize: 11 }}
                  value={settings.whatsappMessage}
                  onChange={e => updateFlatSetting("whatsappMessage", e.target.value)}
                  placeholder="Bonjour {name}, votre abonnement {status}..."
                />
                <div style={{ fontSize: 10, color: T.textFaint, marginTop: 5 }}>
                  Variables disponibles : {'{name}'} = nom du client, {'{status}'} = "expire bientôt" ou "est expiré"
                </div>
              </Field>
            </div>
          </div>
        )}

        {/* E. PARAMÈTRES DES SÉANCES */}
        {activeTab === "sessions" && (
          <div>
            <div style={S.cardHead}>
              <span style={S.cardTitle}>⏱️ Configuration des séances</span>
            </div>
            <div style={{ padding: "18px" }}>
              <Inp
                label="Durée maximale membre (minutes)"
                type="number"
                min="30"
                max="240"
                value={settings.memberSessionDuration}
                onChange={e => updateFlatSetting("memberSessionDuration", parseInt(e.target.value) || 120)}
              />
              <Inp
                label="Durée par défaut visiteur (minutes)"
                type="number"
                min="30"
                max="180"
                value={settings.visitorDefaultDuration}
                onChange={e => updateFlatSetting("visitorDefaultDuration", parseInt(e.target.value) || 60)}
              />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
                <span style={{ fontSize: 13, color: T.text }}>Gratuité pour les membres</span>
                <span
                  style={{
                    ...S.fPill(settings.memberFree),
                    padding: "5px 14px",
                    cursor: "pointer",
                  }}
                  onClick={() => updateFlatSetting("memberFree", !settings.memberFree)}
                >
                  {settings.memberFree ? "✅ Gratuit" : "💰 Payant"}
                </span>
              </div>
              
              <div style={{ marginTop: 16, padding: "10px 12px", background: T.surface2, borderRadius: 8, border: `1px solid ${T.border}` }}>
                <div style={{ fontSize: 11, color: T.textDim }}>
                  ℹ️ Ces paramètres affectent la durée des séances et les règles de facturation.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* F. GESTION DES DONNÉES */}
        {activeTab === "data" && (
          <div>
            <div style={S.cardHead}>
              <span style={S.cardTitle}>🗄️ Gestion des données</span>
            </div>

            <div style={{ padding: "18px" }}>

              <div
                style={{
                  padding: "12px",
                  marginBottom: 22,
                  borderRadius: 8,
                  background: "#3a2b00",
                  border: "1px solid #6b4f00",
                  color: "#ffd86b",
                  fontSize: 12,
                  lineHeight: 1.5
                }}
              >
                ⚠️ Les outils ci-dessous permettent de gérer les données de
                l'application. Les actions de suppression sont irréversibles.
              </div>

              {/* Carte Suppression */}
              <div
                style={{
                  border: `1px solid ${T.border}`,
                  background: T.surface,
                  borderRadius: 12,
                  padding: 18,
                  marginBottom: 18
                }}
              >
                <div style={{ fontSize: 22, marginBottom: 10 }}>
                  🗑️
                </div>

                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>
                  Supprimer des données
                </div>

                <div
                  style={{
                    color: T.textDim,
                    fontSize: 12,
                    marginBottom: 18,
                    lineHeight: 1.5
                  }}
                >
                  Supprime les données d'une période précise sans toucher aux
                  autres enregistrements.
                </div>

                <button
                  style={{
                    ...S.btn("primary"),
                    width: "100%",
                    justifyContent: "center"
                  }}
                  onClick={() => setDeleteWizardOpen(true)}
                >
                  Ouvrir →
                </button>
              </div>

              {/* Carte Réinitialisation */}
              <div
                style={{
                  border: `1px solid ${T.redBd}`,
                  background: T.surface,
                  borderRadius: 12,
                  padding: 18
                }}
              >
                <div style={{ fontSize: 22, marginBottom: 10 }}>
                  ☠️
                </div>

                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 15,
                    marginBottom: 6,
                    color: T.red
                  }}
                >
                  Réinitialiser complètement l'application
                </div>

                <div
                  style={{
                    color: T.textDim,
                    fontSize: 12,
                    marginBottom: 18,
                    lineHeight: 1.5
                  }}
                >
                  Efface toutes les données du système et remet l'application à
                  son état initial.
                </div>

                <button
                  style={{
                    ...S.btn("danger"),
                    width: "100%",
                    justifyContent: "center",
                    opacity: .55,
                    cursor: "not-allowed"
                  }}
                  disabled
                >
                  🚧 Bientôt disponible
                </button>
              </div>

            </div>
          </div>
        )}
      </div>

      <Modal
        open={deleteWizardOpen}
        onClose={() => setDeleteWizardOpen(false)}
        title="🗑️ Assistant de suppression"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{
            padding: 12,
            border: `1px solid ${T.border}`,
            borderRadius: 8,
            background: T.surface2,
            fontSize: 12,
            color: T.textDim
          }}>
            Choisissez la période des données à supprimer.
          </div>

          {[
            ["today","Aujourd'hui"],
            ["yesterday","Hier"],
            ["last7","7 derniers jours"],
            ["last30","30 derniers jours"],
            ["thisMonth","Ce mois"],
            ["previousMonth","Mois précédent"],
            ["all","Depuis le début"],
            ["custom","Plage personnalisée"]
          ].map(([value,label]) => (
            <label
              key={value}
              style={{
                display:"flex",
                alignItems:"center",
                gap:10,
                cursor:"pointer"
              }}
            >
              <input
                type="radio"
                checked={deletePeriod===value}
                onChange={()=>setDeletePeriod(value)}
              />
              {label}
            </label>
          ))}

          {deletePeriod==="custom" && (
            <div style={{
              display:"grid",
              gridTemplateColumns:"1fr 1fr",
              gap:10
            }}>
              <Inp
                label="Date début"
                type="date"
                value={customStart}
                onChange={e=>setCustomStart(e.target.value)}
              />
              <Inp
                label="Date fin"
                type="date"
                value={customEnd}
                onChange={e=>setCustomEnd(e.target.value)}
              />
            </div>
          )}

          <button
            style={{
              ...S.btn("primary"),
              width:"100%",
              justifyContent:"center",
              opacity: deleteCalcLoading ? .6 : 1
            }}
            disabled={deleteCalcLoading}
            onClick={handleCalculerSuppression}
          >
            {deleteCalcLoading ? "Calcul en cours..." : "Continuer →"}
          </button>

          {deleteCalc && (
            <div style={{
              padding: 14,
              border: `1px solid ${T.redBd}`,
              borderRadius: 8,
              background: T.redDark,
              fontSize: 12,
              color: T.text,
              lineHeight: 1.7
            }}>
              <div style={{ fontWeight: 700, marginBottom: 8, color: T.red }}>
                ⚠️ Vous allez supprimer définitivement :
              </div>
              <div>• {deleteCalc.abonnements} abonnement(s)</div>
              <div>• {deleteCalc.seances} séance(s)</div>
              <div>• {deleteCalc.caisse} transaction(s) de caisse — {fmtGNF(deleteCalc.totalCaisse)}</div>
              <div style={{ marginTop: 8, color: T.textDim }}>
                Période : {deleteCalc.from} → {deleteCalc.to}
              </div>

              {(deleteCalc.abonnements + deleteCalc.seances + deleteCalc.caisse) === 0 ? (
                <div style={{ marginTop: 10, color: T.textDim }}>
                  Aucune donnée à supprimer pour cette période.
                </div>
              ) : (
                <div style={{ marginTop: 14 }}>
                  <Inp
                    label="Mot de passe admin pour confirmer"
                    type="password"
                    value={deletePasswordInput}
                    onChange={e => { setDeletePasswordInput(e.target.value); setDeletePasswordError(""); }}
                  />
                  {deletePasswordError && (
                    <div style={{ color: T.red, fontSize: 11, marginTop: 4 }}>
                      ⚠ {deletePasswordError}
                    </div>
                  )}
                  <button
                    style={{
                      ...S.btn("danger"),
                      width: "100%",
                      justifyContent: "center",
                      marginTop: 10,
                      opacity: deleting ? .6 : 1
                    }}
                    disabled={deleting}
                    onClick={handleConfirmerSuppression}
                  >
                    {deleting ? "Suppression..." : "🗑️ Confirmer la suppression"}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 19-C. MODIFICATION DE LA VUE PARAMÈTRES (on conserve l'existant + ajout)
// ═══════════════════════════════════════════════════════════════════

// On remplace la fonction ParametresView existante par une version enrichie
// Pour éviter les conflits, on redéfinit la fonction avec un nom différent
// et on modifie l'export dans App

function ParametresViewV2() {
  const { role } = useAuth();
  const [showAdvanced, setShowAdvanced] = useState(false);

  if (role !== "admin") {
    return (
      <div>
        <h1 style={S.pageTitle}>Paramètres</h1>
        <div style={{ ...S.card, padding: "40px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
          <div style={{ fontWeight: 700, color: T.textMid }}>Accès réservé à l'administrateur</div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Bascule entre paramètres simples et avancés */}
      <div style={{ display: "flex", gap: 12, marginBottom: 20, alignItems: "center" }}>
        <span
          style={{
            ...S.fPill(!showAdvanced),
            padding: "8px 20px",
            fontSize: 13,
            cursor: "pointer",
          }}
          onClick={() => setShowAdvanced(false)}
        >
          🔑 Mots de passe
        </span>
        <span
          style={{
            ...S.fPill(showAdvanced),
            padding: "8px 20px",
            fontSize: 13,
            cursor: "pointer",
          }}
          onClick={() => setShowAdvanced(true)}
        >
          ⚙️ Paramètres avancés
        </span>
      </div>

      {/* Affichage conditionnel */}
      {!showAdvanced ? <ParametresView /> : <AdvancedSettingsView />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// NOTE: Pour intégrer ces nouveaux paramètres, modifiez dans le composant App
// le rendu de la vue "parametres" en remplaçant <ParametresView /> par <ParametresViewV2 />
// 
// Remplacer :
// {view === "parametres" && user.role === "admin" && (
//   <ParametresView />
// )}
// 
// Par :
// {view === "parametres" && user.role === "admin" && (
//   <ParametresViewV2 />
// )}
// ═══════════════════════════════════════════════════════════════════
