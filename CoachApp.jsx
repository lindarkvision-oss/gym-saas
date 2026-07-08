// CoachApp.jsx - Version Pro avec toutes les fonctionnalités
import { useState, useEffect, useCallback, useMemo, useRef } from "react";

// ═══════════════════════════════════════════════════════════════════
// 1. CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

const CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycbw2X-CBg8RKbKFaJVNWHBa_Y6hTZYpThUt_C6M7YRpNhRxrKBavWU3aDxe_dtJ-U28h/exec",
  APP_NAME: "Coach - Nouvel Élan",
  VERSION: "1.0.0",
  REFRESH_INTERVAL: 10_000,
  MAX_RETRY: 3,
  RETRY_DELAY: 1000,
  // Sons pour la playlist
  PLAYLIST: [
    { id: 1, name: "🎵 Chill Lo-Fi", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" },
    { id: 2, name: "🎵 Énergie Gym", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3" },
    { id: 3, name: "🎵 Relaxation", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3" },
    { id: 4, name: "🎵 Rythme Entraînement", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3" },
    { id: 5, name: "🎵 Motivation", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3" },
    { id: 6, name: "🎵 Calme et Zen", url: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3" },
  ],
};

// ═══════════════════════════════════════════════════════════════════
// 2. UTILS
// ═══════════════════════════════════════════════════════════════════

const fmtTime = (d) => {
  if (!d) return "";
  try {
    return new Date(d).toLocaleTimeString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ═══════════════════════════════════════════════════════════════════
// 3. API
// ═══════════════════════════════════════════════════════════════════

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

const apiGetSeances = () =>
  fetchWithRetry(`${CONFIG.API_URL}?sheet=seances&t=${Date.now()}`);

const apiGetClients = () =>
  fetchWithRetry(`${CONFIG.API_URL}?sheet=clients&t=${Date.now()}`);

const apiPost = (action, data = {}) =>
  fetchWithRetry(CONFIG.API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify({ action, ...data }),
  });

// ═══════════════════════════════════════════════════════════════════
// 4. STYLES
// ═══════════════════════════════════════════════════════════════════

const T = {
  bg: "#090909",
  surface: "#111111",
  surface2: "#161616",
  surface3: "#1a1a1a",
  border: "#1e1e1e",
  border2: "#252525",
  text: "#e8e8e8",
  textMid: "#888",
  textDim: "#555",
  textFaint: "#333",
  green: "#4ade80",
  greenDark: "#0d2d1a",
  greenBd: "#1a4d2a",
  blue: "#60a5fa",
  blueDark: "#0d1a2d",
  blueBd: "#1a2d4d",
  orange: "#fb923c",
  orangeDark: "#2d1500",
  red: "#f87171",
  redDark: "#2d0d0d",
  redBd: "#4d1a1a",
  purple: "#a78bfa",
  yellow: "#fbbf24",
  whatsapp: "#25D366",
  lightBg: "#f5f5f5",
  lightText: "#1a1a1a",
  lightSurface: "#ffffff",
  lightBorder: "#e0e0e0",
};

// ═══════════════════════════════════════════════════════════════════
// 5. HOOK - Gestion des sons (amélioré)
// ═══════════════════════════════════════════════════════════════════

function useNotificationSound() {
  const audioContextRef = useRef(null);
  const [isAudioReady, setIsAudioReady] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);

  // Initialisation (doit être appelée après un clic utilisateur)
  const initAudio = useCallback(() => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }
      setIsAudioReady(true);
      setAudioEnabled(true);
      console.log("✅ Audio prêt");
      return true;
    } catch (err) {
      console.log("❌ Audio non disponible:", err);
      return false;
    }
  }, []);

  // Son de cloche (amélioré)
  const playBellSound = useCallback(() => {
    try {
      if (!audioEnabled || !isAudioReady) {
        if (!initAudio()) return;
      }

      const ctx = audioContextRef.current;
      if (!ctx || ctx.state === 'suspended') {
        ctx?.resume();
        return;
      }

      // Son 1 - cloche principale
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.frequency.value = 880;
      osc1.type = "sine";
      gain1.gain.setValueAtTime(0.3, ctx.currentTime);
      gain1.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
      osc1.start(ctx.currentTime);
      osc1.stop(ctx.currentTime + 0.4);

      // Son 2 - harmonique
      setTimeout(() => {
        try {
          const osc2 = ctx.createOscillator();
          const gain2 = ctx.createGain();
          osc2.connect(gain2);
          gain2.connect(ctx.destination);
          osc2.frequency.value = 660;
          osc2.type = "sine";
          gain2.gain.setValueAtTime(0.2, ctx.currentTime);
          gain2.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
          osc2.start(ctx.currentTime);
          osc2.stop(ctx.currentTime + 0.3);
        } catch (e) {}
      }, 150);

      // Son 3 - grave (carillon)
      setTimeout(() => {
        try {
          const osc3 = ctx.createOscillator();
          const gain3 = ctx.createGain();
          osc3.connect(gain3);
          gain3.connect(ctx.destination);
          osc3.frequency.value = 440;
          osc3.type = "sine";
          gain3.gain.setValueAtTime(0.15, ctx.currentTime);
          gain3.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
          osc3.start(ctx.currentTime);
          osc3.stop(ctx.currentTime + 0.5);
        } catch (e) {}
      }, 300);

    } catch (err) {
      console.log("Erreur audio (bell):", err);
    }
  }, [audioEnabled, isAudioReady, initAudio]);

  // Son d'alerte (bip bip pour l'urgence)
  const playAlertSound = useCallback(() => {
    try {
      if (!audioEnabled || !isAudioReady) {
        if (!initAudio()) return;
      }

      const ctx = audioContextRef.current;
      if (!ctx || ctx.state === 'suspended') {
        ctx?.resume();
        return;
      }

      // 3 bips
      for (let i = 0; i < 3; i++) {
        setTimeout(() => {
          try {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 600 + (i * 100);
            osc.type = "square";
            gain.gain.setValueAtTime(0.12, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + 0.12);
          } catch (e) {}
        }, i * 250);
      }
    } catch (err) {
      console.log("Erreur audio (alert):", err);
    }
  }, [audioEnabled, isAudioReady, initAudio]);

  return { 
    playBellSound, 
    playAlertSound, 
    initAudio, 
    isAudioReady, 
    audioEnabled,
    setAudioEnabled 
  };
}

// ═══════════════════════════════════════════════════════════════════
// 6. COMPOSANT - Carte de séance améliorée avec gradient
// ═══════════════════════════════════════════════════════════════════

function SeanceCard({ seance, clients, onEndSeance, isEnding, darkMode = true }) {
  const [tempsRestant, setTempsRestant] = useState("");
  const [statut, setStatut] = useState("en_cours");
  const [showAlerte, setShowAlerte] = useState(false);
  const [pourcentage, setPourcentage] = useState(0);
  const { playBellSound, playAlertSound } = useNotificationSound();
  const alerteJouee = useRef(false);
  const alerteUrgenceJouee = useRef(false);

  const clientInfo = useMemo(() => {
    if (seance.isMember && seance.client_id) {
      return clients.find(c => c.id === seance.client_id);
    }
    return null;
  }, [clients, seance]);

  // Calcul du temps restant et gestion des alertes
  useEffect(() => {
    const updateTimer = () => {
      const debutMs = typeof seance.debut === "string" ? new Date(seance.debut).getTime() : seance.debut;
      const durationMs = (Number(seance.durationMinutes) || 60) * 60 * 1000;
      const diffMs = debutMs + durationMs - Date.now();
      const elapsed = (Date.now() - debutMs) / durationMs;
      const pct = Math.min(Math.max(elapsed * 100, 0), 100);
      setPourcentage(pct);

      if (diffMs <= 0) {
        setTempsRestant("✅ Terminé");
        setStatut("terminee");
        if (!alerteJouee.current) {
          alerteJouee.current = true;
          playBellSound();
          setShowAlerte(true);
          setTimeout(() => setShowAlerte(false), 5000);
        }
        return;
      }

      const totalSec = Math.floor(diffMs / 1000);
      const hh = Math.floor(totalSec / 3600).toString().padStart(2, "0");
      const mm = Math.floor((totalSec % 3600) / 60).toString().padStart(2, "0");
      const ss = (totalSec % 60).toString().padStart(2, "0");
      setTempsRestant(`${hh}:${mm}:${ss}`);

      if (totalSec <= 300 && totalSec > 0) {
        setStatut("urgence");
      if (!alerteUrgenceJouee.current && totalSec <= 60) {
  alerteUrgenceJouee.current = true;
  playAlertSound();
  setShowAlerte(true);
  setTimeout(() => setShowAlerte(false), 3000);
}
      } else {
        setStatut("en_cours");
        alerteUrgenceJouee.current = false;
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [seance, playBellSound, playAlertSound]);

  useEffect(() => {
    alerteJouee.current = false;
    alerteUrgenceJouee.current = false;
    setShowAlerte(false);
  }, [seance.id]);

  // Couleurs et gradient selon le statut et la progression
  const getGradientColors = () => {
    const pct = Math.min(pourcentage, 100);
    if (statut === "terminee") {
      return {
        background: darkMode ? 
          `linear-gradient(135deg, #2d0d0d 0%, #1a0a0a 100%)` :
          `linear-gradient(135deg, #ffebee 0%, #f5f5f5 100%)`,
        border: T.redBd,
        textColor: darkMode ? T.red : "#c62828",
        labelBg: darkMode ? T.redDark : "#ffcdd2",
        labelColor: darkMode ? T.red : "#c62828",
        progressColor: T.red,
        shadow: darkMode ? `0 4px 30px rgba(248, 113, 113, 0.15)` : `0 4px 30px rgba(198, 40, 40, 0.15)`,
      };
    }
    if (statut === "urgence") {
      const intensity = 1 - (pct - 80) / 20;
      const r = Math.floor(251 * intensity);
      const g = Math.floor(146 * intensity);
      const b = Math.floor(60 * intensity);
      return {
        background: darkMode ?
          `linear-gradient(135deg, rgb(${r + 10}, ${g + 10}, ${b + 10}) 0%, #1a0a00 100%)` :
          `linear-gradient(135deg, #fff3e0 0%, #ffffff 100%)`,
        border: "#4d2e00",
        textColor: darkMode ? T.orange : "#e65100",
        labelBg: darkMode ? T.orangeDark : "#ffe0b2",
        labelColor: darkMode ? T.orange : "#e65100",
        progressColor: T.orange,
        shadow: darkMode ? `0 4px 30px rgba(251, 146, 60, 0.2)` : `0 4px 30px rgba(230, 81, 0, 0.15)`,
      };
    }
    const intensity = 1 - pct / 100;
    const r = Math.floor(74 * intensity);
    const g = Math.floor(222 * intensity);
    const b = Math.floor(128 * intensity);
    return {
      background: darkMode ?
        `linear-gradient(135deg, rgb(${r + 10}, ${g + 10}, ${b + 10}) 0%, #0d1a0d 100%)` :
        `linear-gradient(135deg, #e8f5e9 0%, #ffffff 100%)`,
      border: darkMode ? T.greenBd : "#a5d6a7",
      textColor: darkMode ? T.green : "#2e7d32",
      labelBg: darkMode ? T.greenDark : "#c8e6c9",
      labelColor: darkMode ? T.green : "#2e7d32",
      progressColor: T.green,
      shadow: darkMode ? `0 4px 30px rgba(74, 222, 128, 0.15)` : `0 4px 30px rgba(46, 125, 50, 0.15)`,
    };
  };

  const colors = getGradientColors();
  const estTermine = statut === "terminee";
  const enUrgence = statut === "urgence";

  return (
    <div
      style={{
        background: colors.background,
        border: `2px solid ${colors.border}`,
        borderRadius: 16,
        padding: "20px 22px",
        marginBottom: 14,
        transition: "all 0.4s ease",
        position: "relative",
        boxShadow: colors.shadow,
        animation: showAlerte ? "alerteFlash 0.5s ease 3" : "none",
        transform: estTermine ? "scale(0.98)" : "scale(1)",
        opacity: estTermine ? 0.7 : 1,
      }}
    >
      {/* Badge de progression */}
      {!estTermine && (
        <div
          style={{
            position: "absolute",
            top: -6,
            right: -6,
            padding: "2px 10px",
            borderRadius: 12,
            fontSize: 9,
            fontWeight: 700,
            background: colors.labelBg,
            color: colors.labelColor,
            border: `1px solid ${colors.border}`,
          }}
        >
          {Math.round(pourcentage)}%
        </div>
      )}

      {/* Alerte visuelle */}
      {showAlerte && !estTermine && (
        <div
          style={{
            position: "absolute",
            top: -4,
            left: -4,
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: T.red,
            boxShadow: `0 0 25px ${T.red}`,
            animation: "pulse 0.8s ease infinite",
          }}
        />
      )}

      {/* En-tête */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 12,
        }}
      >
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontWeight: 800,
              fontSize: 19,
              color: darkMode ? T.text : T.lightText,
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            {seance.nom || "Client"}
            {clientInfo && clientInfo.objectif && (
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  color: darkMode ? T.textDim : "#666",
                  background: darkMode ? T.surface2 : "#f0f0f0",
                  padding: "2px 10px",
                  borderRadius: 12,
                  border: `1px solid ${darkMode ? T.border : "#e0e0e0"}`,
                }}
              >
                🎯 {clientInfo.objectif}
              </span>
            )}
            {!seance.isMember && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  color: darkMode ? T.orange : "#e65100",
                  background: darkMode ? T.orangeDark : "#fff3e0",
                  padding: "2px 10px",
                  borderRadius: 12,
                  border: `1px solid ${darkMode ? "#4d2e00" : "#ffe0b2"}`,
                }}
              >
                Visiteur
              </span>
            )}
          </div>

          <div style={{ fontSize: 12, color: darkMode ? T.textDim : "#666", marginTop: 4 }}>
            {clientInfo ? (
              <>
                {clientInfo.telephone && <span>📞 {clientInfo.telephone}</span>}
                {clientInfo.statut && (
                  <span style={{ marginLeft: 12 }}>
                    {clientInfo.statut === "actif" ? "🟢 Actif" : "⚪ Inactif"}
                  </span>
                )}
              </>
            ) : (
              <span>🚶 Visiteur direct</span>
            )}
          </div>

          <div style={{ fontSize: 11, color: darkMode ? T.textDim : "#777", marginTop: 2 }}>
            {seance.durationMinutes && `⏱ ${seance.durationMinutes} min`}
            {seance.price > 0 && ` · ${seance.price} GNF`}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
          <span
            style={{
              padding: "4px 14px",
              borderRadius: 20,
              fontSize: 11,
              fontWeight: 700,
              background: colors.labelBg,
              color: colors.labelColor,
              border: `1px solid ${colors.border}`,
              whiteSpace: "nowrap",
            }}
          >
            {estTermine ? "✅ Terminée" : enUrgence ? "⚠ Bientôt fin" : "🟢 En cours"}
          </span>

          {!estTermine && (
            <button
              onClick={() => onEndSeance(seance)}
              disabled={isEnding}
              style={{
                padding: "5px 16px",
                borderRadius: 10,
                fontSize: 12,
                fontWeight: 600,
                background: darkMode ? T.redDark : "#ffcdd2",
                border: `1px solid ${darkMode ? T.redBd : "#ef9a9a"}`,
                color: darkMode ? T.red : "#c62828",
                cursor: isEnding ? "not-allowed" : "pointer",
                opacity: isEnding ? 0.6 : 1,
                transition: "all 0.2s",
                width: "100%",
              }}
            >
              {isEnding ? "⏳ Traitement..." : "🛑 Terminer"}
            </button>
          )}
        </div>
      </div>

      {/* Timer */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 8,
          paddingTop: 12,
          borderTop: `1px solid ${darkMode ? "#1a1a1a" : "#f0f0f0"}`,
        }}
      >
        <div style={{ fontSize: 11, color: darkMode ? T.textDim : "#777" }}>
          Début : {fmtTime(seance.debut)}
        </div>
        <div
          style={{
            fontSize: 34,
            fontWeight: 900,
            fontFamily: "monospace",
            color: estTermine ? T.red : enUrgence ? T.orange : T.green,
            letterSpacing: "-1px",
            transition: "color 0.3s",
          }}
        >
          {tempsRestant}
        </div>
      </div>

      {/* Barre de progression avec gradient */}
      {!estTermine && (
        <div style={{ marginTop: 10 }}>
          <div
            style={{
              width: "100%",
              height: 4,
              background: darkMode ? T.surface3 : "#f0f0f0",
              borderRadius: 3,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${pourcentage}%`,
                height: "100%",
                background: `linear-gradient(90deg, 
                  ${estTermine ? T.red : enUrgence ? T.orange : T.green} 0%, 
                  ${estTermine ? T.red : enUrgence ? "#ff6b00" : "#8be04a"} 50%, 
                  ${estTermine ? T.red : enUrgence ? T.orange : T.green} 100%)`,
                transition: "width 1s linear",
                borderRadius: 3,
                boxShadow: `0 0 20px ${estTermine ? T.red : enUrgence ? T.orange : T.green}33`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 7. COMPOSANT - Barre de recherche
// ═══════════════════════════════════════════════════════════════════

function SearchBar({ value, onChange, placeholder = "Rechercher un client..." }) {
  return (
    <div style={{ position: "relative", width: "100%" }}>
      <span
        style={{
          position: "absolute",
          left: 14,
          top: "50%",
          transform: "translateY(-50%)",
          color: T.textDim,
          fontSize: 16,
          pointerEvents: "none",
        }}
      >
        🔍
      </span>
      <input
        style={{
          width: "100%",
          background: T.surface2,
          border: `1px solid ${T.border}`,
          borderRadius: 12,
          padding: "12px 16px 12px 44px",
          color: T.text,
          fontSize: 14,
          outline: "none",
          boxSizing: "border-box",
          transition: "all 0.2s",
        }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 8. PAGE PRINCIPALE COACH
// ═══════════════════════════════════════════════════════════════════

function CoachApp() {
  const [seances, setSeances] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [endingSeanceId, setEndingSeanceId] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState("all"); // all | membre | visiteur
  const [filterStatus, setFilterStatus] = useState("all"); // all | en_cours | urgence | terminee
  const [darkMode, setDarkMode] = useState(true);
 const [showMusicModal, setShowMusicModal] = useState(false);
const [musicMode, setMusicMode] = useState(null); // null | 'local' | 'spotify'
const [currentMusicIndex, setCurrentMusicIndex] = useState(0);
const [isMusicPlaying, setIsMusicPlaying] = useState(false);
const [musicVolume, setMusicVolume] = useState(0.5);
const [localPlaylist, setLocalPlaylist] = useState([]);
const [spotifyLink, setSpotifyLink] = useState("");
const [showMiniPlayer, setShowMiniPlayer] = useState(false);
const audioRef = useRef(null);  
  // Audio
  const { playBellSound, playAlertSound, initAudio, audioEnabled } = useNotificationSound();

  // Chargement des données
  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [resSeances, resClients] = await Promise.all([
        apiGetSeances(),
        apiGetClients(),
      ]);

      const extract = (data) =>
        Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];

      const seancesData = extract(resSeances)
        .filter((s) => s.statut === "en_cours")
        .map((s) => ({
          ...s,
          id: String(s.id),
          client_id: String(s.client_id || ""),
          isMember: String(s.type).toLowerCase() === "membre",
          price: Number(s.price) || 0,
          durationMinutes: Number(s.durationMinutes) || 60,
          debut: s.debut,
        }));

      const clientsData = extract(resClients).map((c) => ({
        id: String(c.id),
        nom: String(c.nom || ""),
        telephone: String(c.telephone || ""),
        objectif: String(c.objectif || ""),
        statut: String(c.statut || "actif"),
        date_inscription: c.date_inscription ? String(c.date_inscription) : "",
      }));

      setSeances(seancesData);
      setClients(clientsData);
      setLastUpdate(new Date());
    } catch (err) {
      setError("Impossible de charger les données");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Terminer une séance
  const handleEndSeance = useCallback(async (seance) => {
    if (!seance || endingSeanceId) return;
    setEndingSeanceId(seance.id);
    try {
      await apiPost("finishSeance", {
        id: seance.id,
        nom: seance.nom,
        type: seance.type,
        debut: seance.debut,
        fin: new Date().toISOString(),
        statut: "terminee",
        montant: 0,
        description: `Séance terminée — ${seance.nom}`,
      });
      setSeances(prev => prev.filter(s => s.id !== seance.id));
      setTimeout(loadData, 1000);
    } catch (err) {
      console.error("Erreur lors de la fin de séance:", err);
      setError("Impossible de terminer la séance");
    } finally {
      setEndingSeanceId(null);
    }
  }, [endingSeanceId, loadData]);

  // Activer l'audio
  const handleEnableAudio = useCallback(() => {
    const success = initAudio();
    if (success) {
      // Jouer un son de test
      setTimeout(() => playBellSound(), 300);
    }
  }, [initAudio, playBellSound]);

  // --- Fonctions Musique ---
  // Initialiser le lecteur audio
  const initAudioPlayer = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.loop = false;
      audioRef.current.volume = musicVolume;
      audioRef.current.addEventListener('ended', () => {
        playNextMusic();
      });
    }
  }, [musicVolume]);

  // Jouer une piste (depuis la playlist locale)
  const playMusic = useCallback((index) => {
    initAudioPlayer();
    if (localPlaylist.length === 0) return;
    const track = localPlaylist[index];
    if (!track) return;
    
    audioRef.current.src = track.url;
    audioRef.current.volume = musicVolume;
    audioRef.current.play()
      .then(() => {
        setIsMusicPlaying(true);
        setCurrentMusicIndex(index);
      })
      .catch((err) => {
        console.log("Erreur lecture audio:", err);
        setIsMusicPlaying(false);
      });
  }, [initAudioPlayer, musicVolume, localPlaylist]);

  // Pause
  const pauseMusic = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      setIsMusicPlaying(false);
    }
  }, []);

  // Chanson suivante
  const playNextMusic = useCallback(() => {
    if (localPlaylist.length === 0) return;
    const nextIndex = (currentMusicIndex + 1) % localPlaylist.length;
    playMusic(nextIndex);
  }, [currentMusicIndex, playMusic, localPlaylist]);

  // Chanson précédente
  const playPreviousMusic = useCallback(() => {
    if (localPlaylist.length === 0) return;
    const prevIndex = (currentMusicIndex - 1 + localPlaylist.length) % localPlaylist.length;
    playMusic(prevIndex);
  }, [currentMusicIndex, playMusic, localPlaylist]);

  // Importer des fichiers audio locaux
  const handleImportMusic = useCallback((event) => {
    const files = Array.from(event.target.files);
    const audioFiles = files.filter(file => 
      file.type.startsWith('audio/') || 
      file.name.endsWith('.mp3') || 
      file.name.endsWith('.wav') || 
      file.name.endsWith('.ogg') || 
      file.name.endsWith('.m4a')
    );

    if (audioFiles.length === 0) {
      alert("Veuillez sélectionner des fichiers audio (MP3, WAV, OGG, M4A)");
      return;
    }

    const newTracks = audioFiles.map((file, index) => ({
      id: Date.now() + index,
      name: file.name.replace(/\.[^/.]+$/, ""), // Nom sans extension
      url: URL.createObjectURL(file), // URL locale
      file: file,
    }));

    setLocalPlaylist(prev => [...prev, ...newTracks]);
    // Si c'est la première piste, la jouer automatiquement
    if (localPlaylist.length === 0 && newTracks.length > 0) {
      setTimeout(() => playMusic(0), 500);
    }
  }, [localPlaylist, playMusic]);

  // Changer le volume
  const handleVolumeChange = useCallback((e) => {
    const vol = parseFloat(e.target.value);
    setMusicVolume(vol);
    if (audioRef.current) {
      audioRef.current.volume = vol;
    }
  }, []);
    // Ouvrir Spotify
  const openSpotify = useCallback(() => {
    const link = spotifyLink.trim();
    if (!link) {
      alert("Veuillez coller un lien Spotify (playlist, album ou piste)");
      return;
    }
    
    // Vérifier si c'est un lien Spotify valide
    if (!link.includes('spotify.com')) {
      alert("Veuillez coller un lien Spotify valide (ex: https://open.spotify.com/playlist/...)");
      return;
    }
    
    // Ouvrir dans un nouvel onglet
    window.open(link, '_blank');
  }, [spotifyLink]);

  // Ouvrir l'app Spotify (ou site)
  const openSpotifyApp = useCallback(() => {
    const link = spotifyLink.trim() || 'https://open.spotify.com';
    // Essayer d'ouvrir l'app Spotify d'abord
    const spotifyUri = link.replace('https://open.spotify.com/', 'spotify:');
    // Tentative d'ouverture via l'app
    window.open(`intent://${link.replace('https://', '')}#Intent;scheme=https;package=com.spotify.music;end`, '_blank');
    // Fallback: ouvrir dans le navigateur
    setTimeout(() => {
      window.open(link, '_blank');
    }, 500);
  }, [spotifyLink]);

    // Fermer la modale mais garder la musique
  const handleCloseModal = useCallback(() => {
    setShowMusicModal(false);
    setMusicMode(null);
    if (isMusicPlaying || localPlaylist.length > 0) {
      setShowMiniPlayer(true);
    }
  }, [isMusicPlaying, localPlaylist]);

  // Chargement initial
  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, CONFIG.REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [loadData]);

  // Filtrage et recherche
  const seancesFiltrees = useMemo(() => {
    let result = [...seances];

    // Recherche par nom
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter(s => {
        const nom = s.nom?.toLowerCase() || "";
        return nom.includes(query);
      });
    }

    // Filtre par type (membre/visiteur)
    if (filterType === "membre") {
      result = result.filter(s => s.isMember);
    } else if (filterType === "visiteur") {
      result = result.filter(s => !s.isMember);
    }

    // Filtre par statut (en_cours/urgence/terminee)
    if (filterStatus !== "all") {
      result = result.filter(s => {
        const debutMs = typeof s.debut === "string" ? new Date(s.debut).getTime() : s.debut;
        const durationMs = (Number(s.durationMinutes) || 60) * 60 * 1000;
        const diffMs = debutMs + durationMs - Date.now();
        if (diffMs <= 0) return filterStatus === "terminee";
        const totalSec = Math.floor(diffMs / 1000);
        if (totalSec <= 300) return filterStatus === "urgence";
        return filterStatus === "en_cours";
      });
    }

    // Tri : les séances qui finissent bientôt remontent en haut
    result.sort((a, b) => {
      const getTimeLeft = (s) => {
        const debutMs = typeof s.debut === "string" ? new Date(s.debut).getTime() : s.debut;
        const durationMs = (Number(s.durationMinutes) || 60) * 60 * 1000;
        return debutMs + durationMs - Date.now();
      };
      const timeA = getTimeLeft(a);
      const timeB = getTimeLeft(b);
      
      // Si les deux sont terminées, les mettre en bas
      if (timeA <= 0 && timeB <= 0) return 0;
      if (timeA <= 0) return 1;
      if (timeB <= 0) return -1;
      
      // Sinon, trier par temps restant (croissant)
      return timeA - timeB;
    });

    return result;
  }, [seances, searchQuery, filterType, filterStatus]);

  // Statistiques
  const stats = useMemo(() => {
    const total = seances.length;
    const actives = seances.filter(s => {
      const debutMs = typeof s.debut === "string" ? new Date(s.debut).getTime() : s.debut;
      const durationMs = (Number(s.durationMinutes) || 60) * 60 * 1000;
      return debutMs + durationMs > Date.now();
    }).length;
    const urgences = seances.filter(s => {
      const debutMs = typeof s.debut === "string" ? new Date(s.debut).getTime() : s.debut;
      const durationMs = (Number(s.durationMinutes) || 60) * 60 * 1000;
      const diffMs = debutMs + durationMs - Date.now();
      return diffMs > 0 && diffMs <= 300000;
    }).length;
    const membres = seances.filter(s => s.isMember).length;
    const visiteurs = seances.filter(s => !s.isMember).length;
    return { total, actives, urgences, membres, visiteurs };
  }, [seances]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: darkMode ? T.bg : T.lightBg,
        color: darkMode ? T.text : T.lightText,
        fontFamily: "'DM Sans','Segoe UI',sans-serif",
        padding: "16px",
        maxWidth: 800,
        margin: "0 auto",
        transition: "background 0.3s, color 0.3s",
      }}
    >
      {/* En-tête avec boutons */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "12px 0 20px",
          borderBottom: `1px solid ${darkMode ? T.border : T.lightBorder}`,
          marginBottom: 20,
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 24,
              fontWeight: 900,
              color: darkMode ? T.text : T.lightText,
              letterSpacing: "-0.03em",
            }}
          >
            GNE Coach
          </div>
          <div
            style={{
              fontSize: 12,
              color: darkMode ? T.textDim : "#666",
              marginTop: 2,
            }}
          >
            Focus client · {stats.actives} séance(s) en cours
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* Bouton Activation Audio */}
          {!audioEnabled && (
            <button
              onClick={handleEnableAudio}
              style={{
                padding: "8px 16px",
                borderRadius: 12,
                background: "#2d1500",
                border: `1px solid #4d2e00`,
                color: "#fb923c",
                fontSize: 13,
                cursor: "pointer",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                gap: 8,
                animation: "pulse 2s ease infinite",
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#3d1a00";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "#2d1500";
              }}
            >
              🔔 Activer les sons
            </button>
          )}
          {audioEnabled && (
            <span
              style={{
                fontSize: 12,
                color: "#4ade80",
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "4px 12px",
                background: "#0d2d1a",
                borderRadius: 8,
                border: "1px solid #1a4d2a",
              }}
            >
              🔔 Sons activés
            </span>
          )}

          {/* Bouton Musique */}
          <button
            onClick={() => {
              setMusicMode(null);
              setShowMusicModal(true);
            }}
            style={{
              padding: "8px 14px",
              borderRadius: 12,
              background: darkMode ? T.surface2 : "#f0f0f0",
              border: `1px solid ${darkMode ? T.border : T.lightBorder}`,
              color: darkMode ? T.text : T.lightText,
              fontSize: 13,
              cursor: "pointer",
              transition: "all 0.2s",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = darkMode ? T.surface3 : "#e8e8e8";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = darkMode ? T.surface2 : "#f0f0f0";
            }}
          >
            🎵 Musique
          </button>

          {/* Bouton Thème */}
          <button
            onClick={() => setDarkMode(!darkMode)}
            style={{
              padding: "8px 14px",
              borderRadius: 12,
              background: darkMode ? T.surface2 : "#f0f0f0",
              border: `1px solid ${darkMode ? T.border : T.lightBorder}`,
              color: darkMode ? T.text : T.lightText,
              fontSize: 13,
              cursor: "pointer",
              transition: "all 0.2s",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = darkMode ? T.surface3 : "#e8e8e8";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = darkMode ? T.surface2 : "#f0f0f0";
            }}
          >
            {darkMode ? "☀️ Clair" : "🌙 Sombre"}
          </button>

          {/* Compteur */}
          <div
            style={{
              textAlign: "center",
              padding: "4px 16px",
              background: darkMode ? T.surface2 : "#f0f0f0",
              borderRadius: 12,
              border: `1px solid ${darkMode ? T.border : T.lightBorder}`,
            }}
          >
            <div
              style={{
                fontSize: 20,
                fontWeight: 800,
                color: stats.urgences > 0 ? T.orange : T.green,
              }}
            >
              {stats.actives}
            </div>
            <div
              style={{
                fontSize: 9,
                color: darkMode ? T.textFaint : "#999",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              Actives
            </div>
          </div>
        </div>
      </div>

      {/* Barre de recherche et filtres */}
      <div style={{ marginBottom: 16 }}>
        <SearchBar value={searchQuery} onChange={setSearchQuery} />
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        {/* Filtre Type */}
        <div style={{ display: "flex", gap: 4 }}>
          <span
            style={{
              padding: "5px 12px",
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              background: filterType === "all" 
                ? (darkMode ? T.greenDark : "#c8e6c9")
                : (darkMode ? T.surface2 : "#f0f0f0"),
              color: filterType === "all"
                ? (darkMode ? T.green : "#2e7d32")
                : (darkMode ? T.textDim : "#666"),
              border: `1px solid ${filterType === "all" 
                ? (darkMode ? T.greenBd : "#a5d6a7")
                : (darkMode ? T.border : T.lightBorder)}`,
              transition: "all 0.2s",
            }}
            onClick={() => setFilterType("all")}
          >
            Tous
          </span>
          <span
            style={{
              padding: "5px 12px",
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              background: filterType === "membre" 
                ? (darkMode ? T.greenDark : "#c8e6c9")
                : (darkMode ? T.surface2 : "#f0f0f0"),
              color: filterType === "membre"
                ? (darkMode ? T.green : "#2e7d32")
                : (darkMode ? T.textDim : "#666"),
              border: `1px solid ${filterType === "membre" 
                ? (darkMode ? T.greenBd : "#a5d6a7")
                : (darkMode ? T.border : T.lightBorder)}`,
              transition: "all 0.2s",
            }}
            onClick={() => setFilterType("membre")}
          >
            🏋️ Membres ({stats.membres})
          </span>
          <span
            style={{
              padding: "5px 12px",
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              background: filterType === "visiteur" 
                ? (darkMode ? T.orangeDark : "#fff3e0")
                : (darkMode ? T.surface2 : "#f0f0f0"),
              color: filterType === "visiteur"
                ? (darkMode ? T.orange : "#e65100")
                : (darkMode ? T.textDim : "#666"),
              border: `1px solid ${filterType === "visiteur" 
                ? (darkMode ? "#4d2e00" : "#ffe0b2")
                : (darkMode ? T.border : T.lightBorder)}`,
              transition: "all 0.2s",
            }}
            onClick={() => setFilterType("visiteur")}
          >
            🚶 Visiteurs ({stats.visiteurs})
          </span>
        </div>

        <div style={{ flex: 1 }} />

        {/* Filtre Statut */}
        <div style={{ display: "flex", gap: 4 }}>
          <span
            style={{
              padding: "5px 12px",
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              background: filterStatus === "all" 
                ? (darkMode ? T.blueDark : "#e3f2fd")
                : (darkMode ? T.surface2 : "#f0f0f0"),
              color: filterStatus === "all"
                ? (darkMode ? T.blue : "#0d47a1")
                : (darkMode ? T.textDim : "#666"),
              border: `1px solid ${filterStatus === "all" 
                ? (darkMode ? T.blueBd : "#90caf9")
                : (darkMode ? T.border : T.lightBorder)}`,
            }}
            onClick={() => setFilterStatus("all")}
          >
            📊 Tous
          </span>
          <span
            style={{
              padding: "5px 12px",
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              background: filterStatus === "en_cours" 
                ? (darkMode ? T.greenDark : "#c8e6c9")
                : (darkMode ? T.surface2 : "#f0f0f0"),
              color: filterStatus === "en_cours"
                ? (darkMode ? T.green : "#2e7d32")
                : (darkMode ? T.textDim : "#666"),
              border: `1px solid ${filterStatus === "en_cours" 
                ? (darkMode ? T.greenBd : "#a5d6a7")
                : (darkMode ? T.border : T.lightBorder)}`,
            }}
            onClick={() => setFilterStatus("en_cours")}
          >
            🟢 En cours
          </span>
          <span
            style={{
              padding: "5px 12px",
              borderRadius: 8,
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              background: filterStatus === "urgence" 
                ? (darkMode ? T.orangeDark : "#fff3e0")
                : (darkMode ? T.surface2 : "#f0f0f0"),
              color: filterStatus === "urgence"
                ? (darkMode ? T.orange : "#e65100")
                : (darkMode ? T.textDim : "#666"),
              border: `1px solid ${filterStatus === "urgence" 
                ? (darkMode ? "#4d2e00" : "#ffe0b2")
                : (darkMode ? T.border : T.lightBorder)}`,
            }}
            onClick={() => setFilterStatus("urgence")}
          >
            ⚠ Urgence ({stats.urgences})
          </span>
        </div>
      </div>

      {/* Indicateur de rafraîchissement */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
          fontSize: 10,
          color: darkMode ? T.textFaint : "#999",
        }}
      >
        <span>
          {lastUpdate
            ? `🔄 Mis à jour à ${lastUpdate.toLocaleTimeString("fr-FR", {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}`
            : "Chargement..."}
        </span>
        <button
          onClick={loadData}
          style={{
            background: darkMode ? T.surface2 : "#f0f0f0",
            border: `1px solid ${darkMode ? T.border : T.lightBorder}`,
            borderRadius: 8,
            color: darkMode ? T.text : T.lightText,
            padding: "4px 14px",
            fontSize: 12,
            cursor: "pointer",
            fontWeight: 600,
            transition: "all 0.2s",
          }}
        >
          ⟳
        </button>
      </div>

      {/* Erreur */}
      {error && (
        <div
          style={{
            background: darkMode ? T.redDark : "#ffebee",
            border: `1px solid ${darkMode ? T.redBd : "#ef9a9a"}`,
            borderRadius: 10,
            padding: "12px 16px",
            marginBottom: 16,
            fontSize: 12,
            color: darkMode ? T.red : "#c62828",
          }}
        >
          ⚠ {error}
        </div>
      )}

      {/* Chargement */}
      {loading && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: "40px 0",
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              border: `3px solid ${darkMode ? T.border : T.lightBorder}`,
              borderTopColor: T.green,
              animation: "spin 0.7s linear infinite",
            }}
          />
        </div>
      )}

      {/* Liste des séances */}
      {!loading && seancesFiltrees.length === 0 && (
        <div
          style={{
            textAlign: "center",
            padding: "60px 20px",
            color: darkMode ? T.textDim : "#666",
          }}
        >
          <div style={{ fontSize: 48, marginBottom: 12 }}>⏱️</div>
          <div style={{ fontSize: 16, fontWeight: 700 }}>
            {searchQuery ? "Aucun client trouvé" : "Aucune séance en cours"}
          </div>
          <div style={{ fontSize: 13, marginTop: 6, color: darkMode ? T.textFaint : "#999" }}>
            {searchQuery 
              ? "Essayez une autre recherche"
              : "Les séances apparaîtront ici lorsqu'elles seront démarrées"}
          </div>
        </div>
      )}

      {/* Séances */}
      {!loading &&
        seancesFiltrees.map((seance) => (
          <SeanceCard
            key={seance.id}
            seance={seance}
            clients={clients}
            onEndSeance={handleEndSeance}
            isEnding={endingSeanceId === seance.id}
            darkMode={darkMode}
            audioEnabled={audioEnabled}
            playBellSound={playBellSound}
            playAlertSound={playAlertSound}
          />
        ))}

      {/* Modal Musique */}
      {showMusicModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.95)",
            zIndex: 1000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            animation: "fadeIn 0.3s ease",
          }}
          onClick={(e) => {
            // Ne pas fermer en cliquant sur l'overlay
          }}
        >
          <div
            style={{
              background: darkMode ? T.bg : T.lightBg,
              width: "100%",
              height: "100vh",
              maxHeight: "100vh",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              padding: "20px 24px",
              boxShadow: "0 30px 80px rgba(0,0,0,0.5)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Écran de choix du mode */}
            {musicMode === null && (
              <>
                <div style={{ textAlign: "center", marginBottom: 24 }}>
                  <div style={{ fontSize: 48, marginBottom: 8 }}>🎵</div>
                  <div
                    style={{
                      fontSize: 20,
                      fontWeight: 800,
                      color: darkMode ? T.text : T.lightText,
                    }}
                  >
                    Musique de la salle
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: darkMode ? T.textDim : "#666",
                      marginTop: 4,
                    }}
                  >
                    Choisissez votre source musicale
                  </div>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <button
                    onClick={() => setMusicMode("local")}
                    style={{
                      padding: "20px",
                      borderRadius: 16,
                      background: darkMode ? T.surface2 : "#f0f0f0",
                      border: `2px solid ${darkMode ? T.border : T.lightBorder}`,
                      color: darkMode ? T.text : T.lightText,
                      fontSize: 16,
                      fontWeight: 700,
                      cursor: "pointer",
                      transition: "all 0.2s",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 12,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = darkMode ? T.surface3 : "#e8e8e8";
                      e.currentTarget.style.borderColor = T.green;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = darkMode ? T.surface2 : "#f0f0f0";
                      e.currentTarget.style.borderColor = darkMode ? T.border : T.lightBorder;
                    }}
                  >
                    📁 Fichiers locaux
                    <span style={{ fontSize: 12, fontWeight: 400, color: darkMode ? T.textDim : "#666" }}>
                      (MP3, WAV, OGG)
                    </span>
                  </button>

                  <button
                    onClick={() => setMusicMode("spotify")}
                    style={{
                      padding: "20px",
                      borderRadius: 16,
                      background: darkMode ? "#0d1a2d" : "#e3f2fd",
                      border: `2px solid ${darkMode ? "#1a2d4d" : "#90caf9"}`,
                      color: darkMode ? T.blue : "#0d47a1",
                      fontSize: 16,
                      fontWeight: 700,
                      cursor: "pointer",
                      transition: "all 0.2s",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 12,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = darkMode ? "#0d2d4d" : "#bbdefb";
                      e.currentTarget.style.borderColor = T.blue;
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = darkMode ? "#0d1a2d" : "#e3f2fd";
                      e.currentTarget.style.borderColor = darkMode ? "#1a2d4d" : "#90caf9";
                    }}
                  >
                    🔗 Spotify
                    <span style={{ fontSize: 12, fontWeight: 400, color: darkMode ? T.textDim : "#666" }}>
                      (Playlist, album, piste)
                    </span>
                  </button>
                </div>

                <button
                  onClick={handleCloseModal}
                  style={{
                    marginTop: 20,
                    padding: "10px 30px",
                    borderRadius: 12,
                    background: darkMode ? T.surface2 : "#f0f0f0",
                    border: `1px solid ${darkMode ? T.border : T.lightBorder}`,
                    color: darkMode ? T.text : T.lightText,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.2s",
                    width: "100%",
                  }}
                >
                  Fermer
                </button>
              </>
            )}

            {/* Mode Local */}
            {musicMode === "local" && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <button
                    onClick={() => setMusicMode(null)}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 8,
                      background: darkMode ? T.surface2 : "#f0f0f0",
                      border: `1px solid ${darkMode ? T.border : T.lightBorder}`,
                      color: darkMode ? T.text : T.lightText,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    ⬅ Retour
                  </button>
                  <span style={{ fontSize: 13, fontWeight: 700, color: darkMode ? T.text : T.lightText }}>
                    📁 Fichiers locaux
                  </span>
                  <div style={{ width: 60 }} />
                </div>

                <div style={{ textAlign: "center", marginBottom: 16 }}>
                  <div
                    style={{
                      fontSize: 13,
                      color: darkMode ? T.textDim : "#666",
                    }}
                  >
                    {localPlaylist.length > 0 
                      ? (localPlaylist[currentMusicIndex]?.name || "Aucune piste") 
                      : "📁 Aucun fichier importé"}
                  </div>
                </div>

                {/* Contrôles */}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    gap: 16,
                    marginBottom: 16,
                  }}
                >
                  <button
                    onClick={playPreviousMusic}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      background: darkMode ? T.surface2 : "#f0f0f0",
                      border: `1px solid ${darkMode ? T.border : T.lightBorder}`,
                      color: darkMode ? T.text : T.lightText,
                      fontSize: 18,
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                  >
                    ⏮
                  </button>

                  <button
                    onClick={() => {
                      if (isMusicPlaying) {
                        pauseMusic();
                      } else {
                        playMusic(currentMusicIndex);
                      }
                    }}
                    style={{
                      padding: "12px 24px",
                      borderRadius: 12,
                      background: isMusicPlaying ? T.orangeDark : T.greenDark,
                      border: `1px solid ${isMusicPlaying ? "#4d2e00" : T.greenBd}`,
                      color: isMusicPlaying ? T.orange : T.green,
                      fontSize: 24,
                      cursor: "pointer",
                      transition: "all 0.2s",
                      minWidth: 70,
                    }}
                  >
                    {isMusicPlaying ? "⏸" : "▶"}
                  </button>

                  <button
                    onClick={playNextMusic}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      background: darkMode ? T.surface2 : "#f0f0f0",
                      border: `1px solid ${darkMode ? T.border : T.lightBorder}`,
                      color: darkMode ? T.text : T.lightText,
                      fontSize: 18,
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                  >
                    ⏭
                  </button>
                </div>

                {/* Volume */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    marginBottom: 16,
                  }}
                >
                  <span style={{ fontSize: 14, color: darkMode ? T.textDim : "#666" }}>🔊</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={musicVolume}
                    onChange={handleVolumeChange}
                    style={{
                      flex: 1,
                      height: 4,
                      borderRadius: 2,
                      background: darkMode ? T.border : T.lightBorder,
                      outline: "none",
                      WebkitAppearance: "none",
                      appearance: "none",
                    }}
                  />
                </div>

                {/* Playlist locale */}
                <div
                  style={{
                    maxHeight: 180,
                    overflowY: "auto",
                    borderTop: `1px solid ${darkMode ? T.border : T.lightBorder}`,
                    paddingTop: 12,
                  }}
                >
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      padding: "10px",
                      borderRadius: 10,
                      background: darkMode ? T.surface2 : "#f0f0f0",
                      border: `1px dashed ${darkMode ? T.border : T.lightBorder}`,
                      cursor: "pointer",
                      marginBottom: 10,
                      transition: "all 0.2s",
                      fontSize: 13,
                      color: darkMode ? T.text : T.lightText,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = darkMode ? T.surface3 : "#e8e8e8";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = darkMode ? T.surface2 : "#f0f0f0";
                    }}
                  >
                    📁 Importer des fichiers audio
                    <input
                      type="file"
                      accept="audio/*,.mp3,.wav,.ogg,.m4a"
                      multiple
                      style={{ display: "none" }}
                      onChange={handleImportMusic}
                    />
                  </label>

                  {localPlaylist.length === 0 ? (
                    <div
                      style={{
                        textAlign: "center",
                        padding: "20px 0",
                        color: darkMode ? T.textFaint : "#999",
                        fontSize: 12,
                      }}
                    >
                      Aucun fichier audio importé
                      <br />
                      <span style={{ fontSize: 10 }}>
                        Cliquez sur "Importer des fichiers" pour ajouter de la musique
                      </span>
                    </div>
                  ) : (
                    localPlaylist.map((track, idx) => (
                      <div
                        key={track.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "8px 12px",
                          borderRadius: 8,
                          cursor: "pointer",
                          background: currentMusicIndex === idx && isMusicPlaying
                            ? (darkMode ? T.greenDark : "#c8e6c9")
                            : "transparent",
                          border: currentMusicIndex === idx && isMusicPlaying
                            ? `1px solid ${darkMode ? T.greenBd : "#a5d6a7"}`
                            : `1px solid transparent`,
                          transition: "all 0.2s",
                          marginBottom: 2,
                        }}
                        onClick={() => playMusic(idx)}
                        onMouseEnter={(e) => {
                          if (!(currentMusicIndex === idx && isMusicPlaying)) {
                            e.currentTarget.style.background = darkMode ? T.surface2 : "#f0f0f0";
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!(currentMusicIndex === idx && isMusicPlaying)) {
                            e.currentTarget.style.background = "transparent";
                          }
                        }}
                      >
                        <span
                          style={{
                            fontSize: 13,
                            color: currentMusicIndex === idx && isMusicPlaying
                              ? (darkMode ? T.green : "#2e7d32")
                              : (darkMode ? T.text : T.lightText),
                            flex: 1,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {currentMusicIndex === idx && isMusicPlaying ? "▶ " : ""}{track.name}
                        </span>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          {currentMusicIndex === idx && isMusicPlaying && (
                            <span
                              style={{
                                fontSize: 10,
                                color: darkMode ? T.green : "#2e7d32",
                              }}
                            >
                              ●
                            </span>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removeTrack(track.id);
                            }}
                            style={{
                              padding: "2px 8px",
                              borderRadius: 6,
                              background: darkMode ? T.redDark : "#ffcdd2",
                              border: `1px solid ${darkMode ? T.redBd : "#ef9a9a"}`,
                              color: darkMode ? T.red : "#c62828",
                              fontSize: 10,
                              cursor: "pointer",
                              transition: "all 0.2s",
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <button
                  onClick={handleCloseModal}
                  style={{
                    marginTop: 16,
                    padding: "10px 30px",
                    borderRadius: 12,
                    background: darkMode ? T.surface2 : "#f0f0f0",
                    border: `1px solid ${darkMode ? T.border : T.lightBorder}`,
                    color: darkMode ? T.text : T.lightText,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.2s",
                    width: "100%",
                  }}
                >
                  Fermer
                </button>
              </>
            )}

            {/* Mode Spotify */}
            {musicMode === "spotify" && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <button
                    onClick={() => setMusicMode(null)}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 8,
                      background: darkMode ? T.surface2 : "#f0f0f0",
                      border: `1px solid ${darkMode ? T.border : T.lightBorder}`,
                      color: darkMode ? T.text : T.lightText,
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    ⬅ Retour
                  </button>
                  <span style={{ fontSize: 13, fontWeight: 700, color: darkMode ? T.text : T.lightText }}>
                    🔗 Spotify
                  </span>
                  <div style={{ width: 60 }} />
                </div>

                <div style={{ textAlign: "center", marginBottom: 20 }}>
                  <div style={{ fontSize: 40, marginBottom: 8 }}>🎧</div>
                  <div
                    style={{
                      fontSize: 14,
                      color: darkMode ? T.textDim : "#666",
                      lineHeight: 1.6,
                    }}
                  >
                    Collez le lien d'une playlist, d'un album ou d'une piste Spotify
                  </div>
                </div>

                {/* Champ de saisie du lien */}
                <div style={{ marginBottom: 16 }}>
                  <input
                    type="text"
                    placeholder="https://open.spotify.com/playlist/..."
                    value={spotifyLink}
                    onChange={(e) => setSpotifyLink(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "12px 16px",
                      borderRadius: 12,
                      background: darkMode ? T.surface2 : "#f0f0f0",
                      border: `1px solid ${darkMode ? T.border : T.lightBorder}`,
                      color: darkMode ? T.text : T.lightText,
                      fontSize: 13,
                      outline: "none",
                      boxSizing: "border-box",
                      transition: "border-color 0.2s",
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = T.blue;
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = darkMode ? T.border : T.lightBorder;
                    }}
                    placeholder="https://open.spotify.com/playlist/..."
                  />
                </div>

                {/* Boutons Spotify */}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <button
                    onClick={openSpotify}
                    style={{
                      padding: "14px",
                      borderRadius: 12,
                      background: "#1DB954",
                      border: "none",
                      color: "#fff",
                      fontSize: 15,
                      fontWeight: 700,
                      cursor: "pointer",
                      transition: "all 0.2s",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 10,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "#1aa34a";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "#1DB954";
                    }}
                  >
                    ▶ Ouvrir dans Spotify
                  </button>

                  <button
                    onClick={openSpotifyApp}
                    style={{
                      padding: "14px",
                      borderRadius: 12,
                      background: darkMode ? T.surface2 : "#f0f0f0",
                      border: `1px solid ${darkMode ? T.border : T.lightBorder}`,
                      color: darkMode ? T.text : T.lightText,
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: "pointer",
                      transition: "all 0.2s",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 10,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = darkMode ? T.surface3 : "#e8e8e8";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = darkMode ? T.surface2 : "#f0f0f0";
                    }}
                  >
                    📱 Ouvrir l'application Spotify
                  </button>
                </div>

                {/* Bouton flottant de retour (style) */}
                <div
                  style={{
                    marginTop: 16,
                    padding: "10px 14px",
                    borderRadius: 10,
                    background: darkMode ? "#1a0a0a" : "#ffebee",
                    border: `1px solid ${darkMode ? T.redBd : "#ef9a9a"}`,
                    textAlign: "center",
                    fontSize: 11,
                    color: darkMode ? T.textDim : "#666",
                  }}
                >
                  🔄 <strong style={{ color: darkMode ? T.red : "#c62828" }}>Retour à l'app</strong>
                  <br />
                  <span style={{ fontSize: 10 }}>
                    (Sur Android, utilisez le bouton "Retour" du téléphone)
                  </span>
                </div>

                <button
                  onClick={handleCloseModal}
                  style={{
                    marginTop: 16,
                    padding: "10px 30px",
                    borderRadius: 12,
                    background: darkMode ? T.surface2 : "#f0f0f0",
                    border: `1px solid ${darkMode ? T.border : T.lightBorder}`,
                    color: darkMode ? T.text : T.lightText,
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.2s",
                    width: "100%",
                  }}
                >
                  Fermer
                </button>
              </>
            )}
          </div>
        </div>
      )}
      
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// 9. CSS GLOBAL
// ═══════════════════════════════════════════════════════════════════

const GlobalStyle = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&display=swap');
    
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { margin: 0; background: #090909; color: #e8e8e8; font-family: 'DM Sans', sans-serif; }
    
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.2; } }
    @keyframes alerteFlash { 0%, 100% { border-color: #4d1a1a; } 50% { border-color: #f87171; } }
    @keyframes fadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
    
    ::-webkit-scrollbar { width: 4px; }
    ::-webkit-scrollbar-track { background: #0a0a0a; }
    ::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #3a3a3a; }
  `}</style>
);

// ═══════════════════════════════════════════════════════════════════
// 10. EXPORT
// ═══════════════════════════════════════════════════════════════════

export default function App() {
  return (
    <>
      <GlobalStyle />
      <CoachApp />
    </>
  );
}