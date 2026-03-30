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

// ═══════════════════════════════════════════════════════════════════
// 1. CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

const CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycbwN0scQhA2HEnMDreWZQeGiZtMM3jysZ_3HvJWycpPAjr6uE7WQWTZZWVrEeflAiFaX/exec",
  APP_NAME: "Gym Nouvel Élan",
  VERSION: "2.1.0",
  PASSWORDS_KEY: "gym_passwords",
  REFRESH_INTERVAL: 120_000,       // 2 min
  SESSION_TTL: 8 * 60 * 60 * 1000, // 8h
  MAX_RETRY: 3,
  RETRY_DELAY: 1500,
  CACHE_KEY: "gym_cache_v2",
  SESSION_KEY: "gym_session_v2",
};

// Mots de passe par défaut — modifiables depuis l'app (vue Paramètres, admin uniquement)
const DEFAULT_PASSWORDS = {
  admin: "Bavon1986",
  staff: "Gym2025",
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

const SUB_TYPES = {
  mensuel:   { label: "Mensuel Illimité",  price: 200_000, duration: 30, maxSessions: null },
  seances16: { label: "16 Séances / Mois", price: 140_000, duration: 30, maxSessions: 16 },
  seances12: { label: "12 Séances / Mois", price: 120_000, duration: 30, maxSessions: 12 },
};

const SESSION_RATES = {
  no_coach_1h:     { label: "Sans coach — 1h",    price: 8_000,  durationMinutes: 60 },
  no_coach_2h:     { label: "Sans coach — 2h",    price: 14_000, durationMinutes: 120 },
  with_coach_1h:   { label: "Avec coach — 1h",    price: 12_000, durationMinutes: 60 },
  with_coach_1h30: { label: "Avec coach — 1h30",  price: 16_000, durationMinutes: 90 },
  with_coach_2h:   { label: "Avec coach — 2h",    price: 18_000, durationMinutes: 120 },
};

const OBJECTIFS = ["Perte de poids", "Prise de masse", "Entretien / Santé", "Cardio", "Préparation sportive"];
const COLORS = ["#4ade80", "#60a5fa", "#f472b6", "#fb923c", "#a78bfa", "#34d399", "#fbbf24", "#e879f9"];

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

const apiGet = (sheet) =>
  fetchWithRetry(`${CONFIG.API_URL}?sheet=${sheet}`);

const apiPost = (action, data = {}) =>
  fetchWithRetry(CONFIG.API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ action, ...data }),
  });

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
  new Intl.NumberFormat("fr-GN", { style: "currency", currency: "GNF", minimumFractionDigits: 0 })
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

const useAuth = () => useContext(AuthContext);
const useToast = () => useContext(ToastContext);

// ═══════════════════════════════════════════════════════════════════
// 9. DESIGN SYSTEM — TOKENS + STYLES
// ═══════════════════════════════════════════════════════════════════

const T = {
  // Couleurs
  bg:        "#090909",
  surface:   "#111111",
  surface2:  "#161616",
  surface3:  "#1a1a1a",
  border:    "#1e1e1e",
  border2:   "#252525",
  text:      "#e8e8e8",
  textMid:   "#888",
  textDim:   "#555",
  textFaint: "#333",
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
  logoMain: { fontSize: 18, fontWeight: 900, color: "#fff", lineHeight: 1.2 },
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
  main: { flex: 1, overflowY: "auto", minWidth: 0 },
  mainInner: { padding: "28px 32px", maxWidth: 1400 },

  // ── Page header
  pageHeader: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, flexWrap: "wrap", gap: 12 },
  pageTitle: { fontSize: 22, fontWeight: 800, color: "#fff", letterSpacing: "-0.03em", margin: 0 },
  pageSubtitle: { fontSize: 12, color: T.textDim, marginTop: 3 },

  // ── KPI
  kpiGrid: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 24 },
  kpiCard: { background: T.surface, border: `1px solid ${T.border}`, borderRadius: 14, padding: "18px 18px 14px", position: "relative", overflow: "hidden", cursor: "default" },
  kpiBar: (c) => ({ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: c }),
  kpiLabel: { fontSize: 10, color: T.textDim, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 8, fontWeight: 600 },
  kpiValue: { fontSize: 24, fontWeight: 900, color: "#fff", letterSpacing: "-0.04em", lineHeight: 1 },
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
  modalTitle: { fontSize: 15, fontWeight: 700, color: "#fff" },
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
  return (
    <a href={url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
      {icon
        ? <div style={S.iconBtn("wa")}>💬</div>
        : <button style={S.btn("wa")}>💬 Relancer</button>
      }
    </a>
  );
});

function Modal({ open, onClose, title, children, footer, maxWidth = 440 }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
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
        <div style={{ fontWeight: 800, fontSize: 15, color: "#fff", marginBottom: 8 }}>{title}</div>
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
    return <svg width={width} height={height}><line x1="0" y1={height - 2} x2={width} y2={height - 2} stroke={T.border} strokeWidth="1" /></svg>;
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
    const passwords = pwdManager.load();
    if (password !== passwords[u]) { setError("Mot de passe incorrect."); return; }
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
          <div style={{ fontSize: 26, fontWeight: 900, color: "#fff", lineHeight: 1.1 }}>
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
      const [resC, resA, resCa] = await Promise.all([
        apiGet("clients"),
        apiGet("abonnements"),
        apiGet("caisse"),
      ]);

      const extract = (res) => Array.isArray(res) ? res : (Array.isArray(res?.data) ? res.data : []);

      const newClients = extract(resC).map(normalizeClient);
      const newAbos = extract(resA).map(normalizeAbonnement);
      const newCaisse = extract(resCa).map(normalizeCaisse);

      setClients(newClients);
      setAbonnements(newAbos);
      setCaisse(newCaisse);
      setOffline(false);
      setLastSync(new Date());
      cache.save({ clients: newClients, abonnements: newAbos, caisse: newCaisse });
      if (!silent) setLoading(false);
    } catch (err) {
      setOffline(true);
      if (!silent) setLoading(false);
      showToast("Hors ligne", "Les données locales sont affichées", "warning");
    } finally {
      setSyncing(false);
    }
  }, [showToast]);

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
      <div style={S.kpiGrid}>
        <div style={S.kpiCard}>
          <div style={S.kpiBar(T.green)} />
          <div style={S.kpiLabel}>Revenus aujourd'hui</div>
          <div style={S.kpiValue}>{fmtGNF(stats.revJour)}</div>
          <div style={S.kpiSub}>encaissé ce jour</div>
        </div>
        <div style={S.kpiCard}>
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
        <div style={S.kpiCard}>
          <div style={S.kpiBar(T.purple)} />
          <div style={S.kpiLabel}>Membres actifs</div>
          <div style={S.kpiValue}>{stats.actifs}</div>
          <div style={S.kpiSub}>sur {stats.totalClients} inscrits</div>
        </div>
        <div style={S.kpiCard}>
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
                  <div style={{ fontSize: 12, color: "#ccc", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.description}</div>
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
        <table style={S.table}>
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
                <tr key={c.id} style={{ transition: "background 0.08s" }}>
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
                        <div style={S.iconBtn("danger")} onClick={() => setConfirmDel(c)} title="Supprimer">🗑</div>
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
                  <div style={{ fontWeight: 800, fontSize: 17, color: "#fff" }}>{fiche.nom}</div>
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
    await onAdd(form.client_id, form.type, new Date(form.debut));
    setForm({ client_id: "", type: "", debut: todayISO() });
    setModalAdd(false);
    setSaving(false);
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

      <div style={S.grid3}>
        {filtered.map(a => {
          const client = clients.find(c => c.id === a.client_id);
          if (!client) return null;
          const cfg = SUB_TYPES[a.type];
          if (!cfg) return null;
          const status = getSubStatus(a.fin, now);
          const seancesMax = cfg.maxSessions;
          const seancesUtilisees = seancesMax ? seancesMax - a.seances_restantes : 0;
          const pct = seancesMax ? (seancesUtilisees / seancesMax) * 100 : 100;
          const full = seancesMax && a.seances_restantes <= 0;
          const idx = clients.indexOf(client);

          return (
            <div key={a.id} style={{ ...S.subCard, borderColor: status === "expired" ? T.redBd : status === "expiring" ? "#4d2e00" : T.border }}>
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
                    <button style={S.btn("ghost")} onClick={() => onCheckIn(a.id)}>✓ Pointer</button>
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
      <Modal open={modalAdd} onClose={() => setModalAdd(false)} title="Créer un abonnement">
        <Sel label="Client *" value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })}>
          <option value="">Sélectionner un client...</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
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
    </div>
  );
});

// ═══════════════════════════════════════════════════════════════════
// 17. VUE SÉANCES DIRECTES
// ═══════════════════════════════════════════════════════════════════

const SeancesView = memo(({ seancesActives, clients, now, onStart, onEnd }) => {
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({ isMember: false, client_id: "", nom_visiteur: "", rateKey: "" });
  const [tick, setTick] = useState(0);

  // Tick toutes les 30s pour mettre à jour les timers
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const handleStart = () => {
    if (!form.isMember && !form.rateKey) return;
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
        <button style={S.btn("orange")} onClick={() => setModal(true)}>▶ Démarrer une séance</button>
      </div>

      {!seancesActives.length
        ? (
          <div style={{ ...S.card, padding: "60px 24px", textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>⏱</div>
            <div style={{ fontWeight: 700, color: T.textMid, fontSize: 15 }}>Aucune séance active</div>
            <div style={{ color: T.textDim, fontSize: 12, marginTop: 6 }}>Cliquez sur "Démarrer" pour chronomètrer une séance</div>
          </div>
        )
        : (
          <div style={S.grid3}>
            {seancesActives.map(s => {
              const elapsed = Math.floor((now - new Date(s.debut)) / 60_000);
              const remaining = s.durationMinutes - elapsed;
              const urgent = remaining <= 5 && remaining > 0;
              const over = remaining <= 0;
              const hh = Math.max(0, Math.floor(remaining / 60)).toString().padStart(2, "0");
              const mm = Math.max(0, remaining % 60).toString().padStart(2, "0");
              return (
                <div key={s.id} style={{ ...S.subCard, borderColor: over ? T.redBd : urgent ? "#4d2e00" : T.border }}>
                  <div style={{ padding: "14px 16px", borderBottom: `1px solid ${T.surface3}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontWeight: 700, color: T.text, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.nom}</div>
                      <span style={S.pill(s.isMember ? T.purple : T.orange)}>
                        {s.isMember ? "Membre" : "Visiteur"} · {s.price > 0 ? fmtGNF(s.price) : "Gratuit"}
                      </span>
                    </div>
                    <button style={S.btn("ghost")} onClick={() => onEnd(s.id)}>Terminer</button>
                  </div>
                  <div style={{ padding: "20px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                    <div style={S.timerBig(urgent || over)}>
                      {over ? "FINI" : `${hh}:${mm}`}
                    </div>
                    <div style={{ fontSize: 10, color: over ? T.red : urgent ? T.orange : T.textDim, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 700 }}>
                      {over ? "Temps écoulé !" : urgent ? "⚠ Bientôt terminé" : "Restant"}
                    </div>
                    <div style={{ fontSize: 10, color: T.textFaint }}>Débuté à {fmtTime(s.debut)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      }

      <Modal open={modal} onClose={() => setModal(false)} title="Démarrer une séance">
        <div style={{ display: "flex", gap: 7, marginBottom: 18 }}>
          {["Visiteur direct", "Membre abonné"].map((label, i) => (
            <span key={label} style={{ ...S.fPill(form.isMember === (i === 1)), flex: 1, justifyContent: "center", display: "flex" }}
              onClick={() => setForm({ ...form, isMember: i === 1, client_id: "", rateKey: "" })}>
              {label}
            </span>
          ))}
        </div>

        {form.isMember
          ? <Sel label="Membre" value={form.client_id} onChange={e => setForm({ ...form, client_id: e.target.value })}>
              <option value="">Sélectionner un membre...</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </Sel>
          : <>
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
        }

        {form.isMember && (
          <div style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 8, padding: "10px 13px", marginBottom: 14, fontSize: 11, color: T.textDim }}>
            ℹ Séance membre — durée 2h max, aucun encaissement automatique.
          </div>
        )}

        <button
          style={{ ...S.btn("orange"), width: "100%", justifyContent: "center", padding: 11 }}
          onClick={handleStart}
          disabled={!form.isMember && !form.rateKey}
        >
          ▶ Lancer le chronomètre
        </button>
      </Modal>
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
          { label: "Encaissé ce mois", value: fmtGNF(stats.revMois), accent: T.blue, color: "#fff" },
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
    if (!window.confirm("Réinitialiser les mots de passe par défaut ?\n\nAdmin → Bavon1986\nStaff → Gym2025")) return;
    pwdManager.reset();
    showToast("Mots de passe réinitialisés", "Admin: Bavon1986 · Staff: Gym2025", "info");
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
            <strong style={{ color: T.textDim }}>Admin</strong> → Bavon1986 &nbsp;·&nbsp; <strong style={{ color: T.textDim }}>Staff</strong> → Gym2025
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 19. SIDEBAR
// ═══════════════════════════════════════════════════════════════════

function Sidebar({ view, setView, alertCount, syncing, offline, lastSync, onRefresh, onLogout }) {
  const { role, displayName } = useAuth();

  const NAV = [
    { id: "dashboard",   label: "Tableau de bord", icon: "◈" },
    { id: "clients",     label: "Clients",          icon: "👥" },
    { id: "abonnements", label: "Abonnements",       icon: "📋" },
    { id: "seances",     label: "Séances directes",  icon: "⏱" },
    ...(can(role, "view_caisse") ? [{ id: "caisse", label: "Caisse", icon: "💰" }] : []),
    ...(role === "admin" ? [{ id: "parametres", label: "Paramètres", icon: "⚙️" }] : []),
  ];

  return (
    <aside style={S.sidebar}>
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
// 20. APP ROOT
// ═══════════════════════════════════════════════════════════════════

export default function App() {
  const [user, setUser] = useState(() => loadSession());
  const [view, setView] = useState("dashboard");
  const [now, setNow] = useState(new Date());

  // Toast manager
  const { toasts, showToast } = useToastManager();

  // Timer
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Données
  const {
    clients, setClients,
    abonnements, setAbonnements,
    caisse, setCaisse,
    seancesActives, setSeancesActives,
    loading, syncing, offline, lastSync,
    loadData,
  } = useGymData(showToast);

  // Compteur alertes pour badge sidebar
  const alertCount = useMemo(() =>
    abonnements.filter(a => ["expiring", "expired"].includes(getSubStatus(a.fin, now))).length,
    [abonnements, now]
  );

  // ── LOGIN / LOGOUT ─────────────────────────────────────────────
  if (!user) {
    return (
      <ToastContext.Provider value={showToast}>
        <style>{GLOBAL_CSS}</style>
        <LoginScreen onLogin={setUser} />
        <ToastManager toasts={toasts} />
      </ToastContext.Provider>
    );
  }

  const handleLogout = () => {
    clearSession();
    setUser(null);
    showToast("Déconnecté", "À bientôt !", "info");
  };

  // ── HANDLERS CLIENTS ───────────────────────────────────────────
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

  // ── HANDLERS ABONNEMENTS ───────────────────────────────────────
  const handleAddAbonnement = useCallback(async (client_id, type, debut) => {
    const client = clients.find(c => c.id === client_id);
    if (!client) return;
    const cfg = SUB_TYPES[type];
    const fin = addDays(debut, cfg.duration - 1);
    const tempAboId = genId();
    const tempTxId = genId();
    const debutISO = debut.toISOString().split("T")[0];
    const finISO = fin.toISOString().split("T")[0];

    setAbonnements(p => [normalizeAbonnement({ id: tempAboId, client_id, type, debut: debutISO, fin: finISO, seances_restantes: cfg.maxSessions || 0, statut: "actif" }), ...p]);
    setCaisse(p => [normalizeCaisse({ id: tempTxId, date: new Date().toISOString(), description: `Abonnement ${cfg.label} — ${client.nom}`, montant: cfg.price }), ...p]);
    showToast("Abonnement créé", `${cfg.label} · ${fmtGNF(cfg.price)}`, "success");

    try {
      const res = await apiPost("addAbonnement", { client_id, type, debut: debutISO, fin: finISO, seances_restantes: cfg.maxSessions || 0, statut: "actif", montant: cfg.price, description: `Abonnement ${cfg.label} — ${client.nom}` });
      if (res?.aboId) setAbonnements(p => p.map(a => a.id === tempAboId ? { ...a, id: String(res.aboId) } : a));
      if (res?.txId) setCaisse(p => p.map(t => t.id === tempTxId ? { ...t, id: String(res.txId) } : t));
    } catch { showToast("Sync échouée", "Données sauvegardées localement", "error"); }
  }, [clients, setAbonnements, setCaisse, showToast]);

  const handleDeleteAbonnement = useCallback(async (id) => {
    setAbonnements(p => p.filter(a => a.id !== id));
    showToast("Supprimé", "Abonnement supprimé", "info");
    try { await apiPost("deleteAbonnement", { id }); } catch {}
  }, [setAbonnements, showToast]);

  const handleCheckIn = useCallback(async (aboId) => {
    const abo = abonnements.find(a => a.id === aboId);
    if (!abo) return;
    if (abo.seances_restantes <= 0) { showToast("Quota atteint", "Plus de séances disponibles", "error"); return; }
    const newRestantes = abo.seances_restantes - 1;
    setAbonnements(p => p.map(a => a.id === aboId ? { ...a, seances_restantes: newRestantes } : a));
    showToast("Séance pointée", `${newRestantes} restante(s)`, "success");
    try { await apiPost("checkIn", { id: aboId, seances_restantes: newRestantes }); } catch {}
  }, [abonnements, setAbonnements, showToast]);

  // ── HANDLERS SÉANCES ───────────────────────────────────────────
  const handleStartSeance = useCallback((data) => {
    const rate = data.isMember ? { price: 0, durationMinutes: 120 } : SESSION_RATES[data.rateKey];
    setSeancesActives(p => [{ id: genId(), nom: data.nom, isMember: data.isMember, price: rate.price, durationMinutes: rate.durationMinutes, debut: new Date().toISOString(), type: data.rateKey || "membre" }, ...p]);
    showToast("Séance démarrée", data.nom, "success");
  }, [setSeancesActives, showToast]);

  const handleEndSeance = useCallback(async (id) => {
    const s = seancesActives.find(x => x.id === id);
    if (!s) return;
    setSeancesActives(p => p.filter(x => x.id !== id));
    if (s.price > 0) {
      const tempId = genId();
      const desc = `Séance directe — ${s.nom} (${SESSION_RATES[s.type]?.label || s.type})`;
      setCaisse(p => [normalizeCaisse({ id: tempId, date: new Date().toISOString(), description: desc, montant: s.price }), ...p]);
      showToast("Séance terminée", `${fmtGNF(s.price)} encaissé`, "success");
      try {
        const res = await apiPost("addSeance", { nom: s.nom, type: s.type, debut: s.debut, fin: new Date().toISOString(), statut: "terminee", montant: s.price, description: desc });
        if (res?.txId) setCaisse(p => p.map(t => t.id === tempId ? { ...t, id: String(res.txId) } : t));
      } catch {}
    } else {
      showToast("Séance terminée", "Séance membre clôturée", "info");
      try { await apiPost("addSeance", { nom: s.nom, type: "membre", debut: s.debut, fin: new Date().toISOString(), statut: "terminee" }); } catch {}
    }
  }, [seancesActives, setSeancesActives, setCaisse, showToast]);

  // ── RENDU ──────────────────────────────────────────────────────
  const authValue = { ...user };

  return (
    <AuthContext.Provider value={authValue}>
      <ToastContext.Provider value={showToast}>
        <style>{GLOBAL_CSS}</style>

        <div style={S.app}>
          <Sidebar
            view={view} setView={setView}
            alertCount={alertCount}
            syncing={syncing} offline={offline} lastSync={lastSync}
            onRefresh={() => loadData(true)}
            onLogout={handleLogout}
          />

          <main style={S.main}>
            {loading
              ? (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "70vh", gap: 16 }}>
                  <div style={S.spinner} />
                  <div style={{ color: T.textDim, fontSize: 13 }}>Chargement des données...</div>
                </div>
              )
              : (
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
                    <SeancesView seancesActives={seancesActives} clients={clients} now={now} onStart={handleStartSeance} onEnd={handleEndSeance} />
                  )}
                  {view === "caisse" && can(user.role, "view_caisse") && (
                    <CaisseView caisse={caisse} now={now} syncing={syncing} />
                  )}
                  {view === "parametres" && user.role === "admin" && (
                    <ParametresView />
                  )}
                </div>
              )
            }
          </main>
        </div>

        <ToastManager toasts={toasts} />
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

  /* Responsive Mobile */
  @media (max-width: 900px) {
    aside { display: none !important; }
    .main-inner { padding: 16px !important; }
  }
  @media (max-width: 700px) {
    .kpi-grid { grid-template-columns: 1fr 1fr !important; }
    .grid3 { grid-template-columns: 1fr !important; }
    .grid2 { grid-template-columns: 1fr !important; }
    table { font-size: 11px !important; }
  }
`;
