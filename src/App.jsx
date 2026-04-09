import { useState, useRef, useCallback, useEffect } from "react";
import { pipeline, env } from "@huggingface/transformers";

// Garante que o WASM seja carregado do CDN correto sem depender do pre-bundle do Vite
env.allowLocalModels = false;

const LOGO = "/logo.png";

const fmtDur = (s) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const fmtSize = (b) =>
  b < 1048576
    ? (b / 1024).toFixed(1) + " KB"
    : (b / 1048576).toFixed(1) + " MB";
const wc = (t) => t.trim().split(/\s+/).filter(Boolean).length;

const themes = {
  dark: {
    bg: "#0a0d0b",
    bg2: "#060806",
    surface: "#12171400",
    surface2: "#182019",
    border: "#1c2b21",
    text: "#e6f0ea",
    text2: "#6b8575",
    text3: "#3d5447",
    accent: "#25D366",
    accentSoft: "rgba(37,211,102,0.08)",
    accentGlow: "rgba(37,211,102,0.15)",
    card: "#0f1512",
    cardBorder: "#1a2820",
    inputBg: "#0c100e",
    errBg: "#1a0e0e",
    errBd: "#331a1a",
    shadow: "0 2px 12px rgba(0,0,0,0.4)",
    heroGradient:
      "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(37,211,102,0.06) 0%, transparent 70%)",
  },
  light: {
    bg: "#f7faf8",
    bg2: "#eef3f0",
    surface: "#ffffff00",
    surface2: "#f0f5f2",
    border: "#d4dfd8",
    text: "#1a2b21",
    text2: "#5a7568",
    text3: "#9aab9f",
    accent: "#1db954",
    accentSoft: "rgba(29,185,84,0.06)",
    accentGlow: "rgba(29,185,84,0.12)",
    card: "#ffffff",
    cardBorder: "#d4dfd8",
    inputBg: "#f0f5f2",
    errBg: "#fef2f2",
    errBd: "#fecaca",
    shadow: "0 2px 16px rgba(0,0,0,0.06)",
    heroGradient:
      "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(29,185,84,0.05) 0%, transparent 70%)",
  },
};

const LANGS = [
  { v: "pt", l: "🇧🇷 Português" },
  { v: "en", l: "🇺🇸 English" },
  { v: "es", l: "🇪🇸 Español" },
  { v: "auto", l: "🔍 Auto-detectar" },
];

export default function App() {
  const [mode, setMode] = useState("dark");
  const t = themes[mode];

  const [file, setFile] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [duration, setDuration] = useState(0);
  const [lang, setLang] = useState("pt");
  const [dragOver, setDragOver] = useState(false);
  const [phase, setPhase] = useState("idle");
  const [transcript, setTranscript] = useState("");
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [curTime, setCurTime] = useState(0);

  const fileRef = useRef(null);
  const audioRef = useRef(null);
  const timerRef = useRef(null);
  const whisperRef = useRef(null);

  useEffect(() => {
    if (phase === "loading" || phase === "transcribing") {
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else clearInterval(timerRef.current);
    return () => clearInterval(timerRef.current);
  }, [phase]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const fn = () => setCurTime(a.currentTime);
    a.addEventListener("timeupdate", fn);
    return () => a.removeEventListener("timeupdate", fn);
  });

  const onFile = useCallback((f) => {
    if (!f) return;
    setFile(f);
    setTranscript("");
    setPhase("idle");
    const url = URL.createObjectURL(f);
    setAudioUrl(url);
    const a = new Audio(url);
    a.addEventListener("loadedmetadata", () => setDuration(a.duration));
  }, []);

  const remove = () => {
    setFile(null);
    setAudioUrl(null);
    setDuration(0);
    setTranscript("");
    setPhase("idle");
    setPlaying(false);
    setCurTime(0);
    if (audioRef.current) audioRef.current.pause();
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    playing ? audioRef.current.pause() : audioRef.current.play();
    setPlaying(!playing);
  };

  const seek = (e) => {
    if (!audioRef.current || !duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    audioRef.current.currentTime =
      Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration;
  };

  const transcribe = async () => {
    if (!file) return;
    try {
      setPhase("loading");
      setProgress(0);
      setStatus("Baixando modelo Whisper (~75 MB)…");

      if (!whisperRef.current) {
        whisperRef.current = await pipeline(
          "automatic-speech-recognition",
          "onnx-community/whisper-tiny",
          {
            dtype: "q8",
            progress_callback: (p) => {
              if (p.status === "progress" && p.progress) {
                const pct = Math.round(p.progress);
                setProgress(Math.min(pct, 95));
                setStatus(`Baixando modelo… ${pct}%`);
              }
            },
          },
        );
      }

      setPhase("transcribing");
      setProgress(0);
      setStatus("Transcrevendo áudio…");

      const url = URL.createObjectURL(file);
      const opts = { chunk_length_s: 30, stride_length_s: 5 };
      if (lang !== "auto") opts.language = lang;
      const result = await whisperRef.current(url, opts);
      URL.revokeObjectURL(url);

      setTranscript(result.text.trim());
      setPhase("done");
    } catch (err) {
      console.error("Transcription error:", err);
      const msg = err.message || String(err);
      let friendlyMsg;
      if (msg.includes("fetch") || msg.includes("network") || msg.includes("NetworkError")) {
        friendlyMsg = "Não foi possível baixar o modelo Whisper. Verifique sua conexão com a internet e tente novamente.";
      } else if (msg.includes("SharedArrayBuffer") || msg.includes("COEP") || msg.includes("cross-origin")) {
        friendlyMsg = "Erro de segurança do navegador. Recarregue a página e tente novamente.";
      } else {
        friendlyMsg = "Erro: " + msg;
      }
      setStatus(friendlyMsg);
      setPhase("error");
    }
  };

  const copy = () => {
    navigator.clipboard.writeText(transcript);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const download = () => {
    const blob = new Blob([transcript], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download =
      (file?.name?.replace(/\.[^.]+$/, "") || "transcricao") + ".txt";
    a.click();
  };

  const busy = phase === "loading" || phase === "transcribing";
  const pct = duration > 0 ? (curTime / duration) * 100 : 0;

  const langBtn = (active) => ({
    background: active ? t.accent : "transparent",
    color: active ? "#fff" : t.text2,
    border: `1.5px solid ${active ? t.accent : t.border}`,
    borderRadius: 10,
    padding: "7px 14px",
    fontSize: "0.78rem",
    fontWeight: active ? 700 : 500,
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "all 0.2s",
  });

  const actionBtn = (hl) => ({
    background: hl ? t.accentSoft : "transparent",
    border: `1.5px solid ${hl ? t.accent : t.border}`,
    color: hl ? t.accent : t.text2,
    fontSize: "0.76rem",
    fontWeight: 600,
    padding: "6px 14px",
    borderRadius: 8,
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "all 0.2s",
  });

  return (
    <div
      style={{
        minHeight: "100vh",
        background: t.bg,
        color: t.text,
        fontFamily:
          "'Segoe UI', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
        transition: "background 0.35s, color 0.35s",
      }}
    >
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
        ::selection { background: ${t.accent}; color: #fff; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-thumb { background: ${t.border}; border-radius: 3px; }
        body { margin: 0; }
      `}</style>

      {/* ═══ NAVBAR ═══ */}
      <nav
        className="app-nav"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          maxWidth: 960,
          margin: "0 auto",
          borderBottom: `1px solid ${t.border}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img
            src={LOGO}
            alt="Guebly"
            style={{
              height: 36,
              width: 36,
              objectFit: "contain",
            }}
          />
          <span
            style={{
              fontWeight: 800,
              fontSize: "1.2rem",
              letterSpacing: "-0.03em",
            }}
          >
            <span style={{ color: t.accent }}>Zap</span>Transcriber
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <a
            href="https://github.com/Guebly/zap-transcriber"
            target="_blank"
            rel="noreferrer"
            className="nav-github"
            style={{
              fontSize: "0.72rem",
              fontWeight: 600,
              color: t.accent,
              textDecoration: "none",
              padding: "4px 10px",
              border: `1.5px solid ${t.accent}`,
              borderRadius: 8,
              transition: "all 0.2s",
            }}
          >
            <span>⭐ GitHub</span>
          </a>
          <button
            onClick={() => setMode((m) => (m === "dark" ? "light" : "dark"))}
            style={{
              background: "transparent",
              border: `1.5px solid ${t.border}`,
              borderRadius: 10,
              padding: "6px 14px",
              cursor: "pointer",
              fontSize: "0.78rem",
              color: t.text2,
              fontFamily: "inherit",
              fontWeight: 600,
              transition: "all 0.2s",
            }}
          >
            {mode === "dark" ? "☀️ Light" : "🌙 Dark"}
          </button>
        </div>
      </nav>

      {/* ═══ HERO ═══ */}
      <div
        className="hero-section"
        style={{
          background: t.heroGradient,
          paddingTop: "3rem",
          paddingBottom: "2rem",
          textAlign: "center",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            background: t.accentSoft,
            border: `1px solid ${t.accent}30`,
            borderRadius: 20,
            padding: "5px 14px",
            marginBottom: 20,
          }}
        >
          <span
            style={{
              fontSize: "0.7rem",
              fontWeight: 700,
              color: t.accent,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            ✦ Open Source · 100% gratuito
          </span>
        </div>

        <h1
          style={{
            fontSize: "clamp(1.8rem, 5vw, 2.8rem)",
            fontWeight: 800,
            letterSpacing: "-0.045em",
            lineHeight: 1.1,
            maxWidth: 760,
            margin: "0 auto",
          }}
        >
          Transcreva áudios do
          <br />
          WhatsApp <span style={{ color: t.accent }}>direto no navegador</span>
        </h1>

        <p
          style={{
            color: t.text2,
            fontSize: "1rem",
            lineHeight: 1.6,
            marginTop: 16,
            maxWidth: 660,
            margin: "16px auto 0",
          }}
        >
          Nenhum dado é enviado para servidores. O modelo de IA roda localmente
          no seu dispositivo. Suporta áudios longos de 3+ minutos.
        </p>

        <div
          className="hero-stats"
          style={{
            color: t.text3,
            fontSize: "0.78rem",
            fontWeight: 500,
          }}
        >
          {["🔒 100% privado", "⚡ Sem cadastro", "🌐 Multi-idioma"].map(
            (item) => (
              <span key={item}>{item}</span>
            ),
          )}
        </div>
      </div>

      {/* ═══ MAIN CONTENT ═══ */}
      <div
        className="app-main"
        style={{
          maxWidth: 760,
          margin: "0 auto",
        }}
      >
        {/* ── LANGUAGE SELECTOR ── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 20,
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: "0.8rem",
              color: t.text2,
              fontWeight: 600,
              marginRight: 4,
            }}
          >
            Idioma do áudio:
          </span>
          {LANGS.map(({ v, l }) => (
            <button
              key={v}
              onClick={() => setLang(v)}
              style={langBtn(lang === v)}
            >
              {l}
            </button>
          ))}
        </div>

        {/* ── DROPZONE ── */}
        {!file && (
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              onFile(e.dataTransfer.files[0]);
            }}
            style={{
              border: `2px dashed ${dragOver ? t.accent : t.border}`,
              borderRadius: 20,
              padding: "3rem 2.5rem",
              textAlign: "center",
              cursor: "pointer",
              background: dragOver ? t.accentGlow : t.card,
              transition: "all 0.3s",
              boxShadow: t.shadow,
            }}
          >
            <div
              style={{
                fontSize: 56,
                marginBottom: 16,
                animation: dragOver ? "float 0.6s ease infinite" : "none",
              }}
            >
              {dragOver ? "📥" : "🎤"}
            </div>
            <p style={{ fontWeight: 700, fontSize: "1.1rem", marginBottom: 8 }}>
              Arraste o áudio aqui
            </p>
            <p
              style={{ color: t.text2, fontSize: "0.85rem", marginBottom: 16 }}
            >
              ou clique para selecionar um arquivo
            </p>
            <div
              style={{
                display: "inline-flex",
                gap: 6,
                flexWrap: "wrap",
                justifyContent: "center",
              }}
            >
              {[".ogg", ".opus", ".mp3", ".m4a", ".wav", ".webm"].map((ext) => (
                <span
                  key={ext}
                  style={{
                    background: t.accentSoft,
                    color: t.text2,
                    fontSize: "0.7rem",
                    fontWeight: 600,
                    padding: "3px 8px",
                    borderRadius: 5,
                  }}
                >
                  {ext}
                </span>
              ))}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="audio/*,.ogg,.opus,.mp3,.m4a,.wav,.webm"
              style={{ display: "none" }}
              onChange={(e) => onFile(e.target.files?.[0])}
            />
          </div>
        )}

        {/* ── FILE CARD ── */}
        {file && (
          <div
            style={{
              background: t.card,
              border: `1.5px solid ${t.cardBorder}`,
              borderRadius: 18,
              overflow: "hidden",
              boxShadow: t.shadow,
            }}
          >
            {/* File info */}
            <div
              style={{
                padding: "1.1rem 1.3rem",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div
                style={{
                  width: 48,
                  height: 48,
                  background: t.accentGlow,
                  borderRadius: 14,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 22,
                  flexShrink: 0,
                }}
              >
                🎵
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: "0.9rem",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {file.name}
                </div>
                <div
                  style={{ color: t.text2, fontSize: "0.76rem", marginTop: 3 }}
                >
                  {fmtSize(file.size)}
                  {duration > 0 && ` · ${fmtDur(duration)}`}
                </div>
              </div>
              <button
                onClick={togglePlay}
                style={{
                  background: playing ? t.accent : "transparent",
                  border: `1.5px solid ${playing ? t.accent : t.border}`,
                  color: playing ? "#fff" : t.text,
                  borderRadius: 12,
                  width: 42,
                  height: 42,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  fontSize: 16,
                  flexShrink: 0,
                  transition: "all 0.2s",
                }}
              >
                {playing ? "⏸" : "▶"}
              </button>
              <button
                onClick={remove}
                style={{
                  background: "none",
                  border: "none",
                  color: t.text3,
                  cursor: "pointer",
                  fontSize: 20,
                  padding: 4,
                  flexShrink: 0,
                }}
              >
                ✕
              </button>
              <audio
                ref={audioRef}
                src={audioUrl}
                onEnded={() => setPlaying(false)}
              />
            </div>

            {/* Seek bar */}
            <div
              style={{
                padding: "0 1.3rem 1rem",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <span
                style={{
                  fontSize: "0.68rem",
                  color: t.text3,
                  fontVariantNumeric: "tabular-nums",
                  minWidth: 32,
                  textAlign: "right",
                }}
              >
                {fmtDur(curTime)}
              </span>
              <div
                onClick={seek}
                style={{
                  flex: 1,
                  height: 8,
                  background: t.surface2,
                  borderRadius: 4,
                  cursor: "pointer",
                  overflow: "hidden",
                  position: "relative",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    background: t.accent,
                    borderRadius: 4,
                    width: `${pct}%`,
                    transition: "width 0.15s",
                  }}
                />
              </div>
              <span
                style={{
                  fontSize: "0.68rem",
                  color: t.text3,
                  fontVariantNumeric: "tabular-nums",
                  minWidth: 32,
                }}
              >
                {fmtDur(duration)}
              </span>
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: t.border }} />

            {/* CTA */}
            {phase !== "done" && (
              <button
                onClick={transcribe}
                disabled={busy}
                style={{
                  width: "100%",
                  padding: "1rem",
                  background: busy ? "transparent" : t.accent,
                  color: busy ? t.accent : "#fff",
                  border: "none",
                  fontSize: "0.95rem",
                  fontWeight: 700,
                  cursor: busy ? "default" : "pointer",
                  fontFamily: "inherit",
                  transition: "all 0.2s",
                  letterSpacing: "-0.01em",
                }}
              >
                {phase === "idle" || phase === "error"
                  ? "⚡ Transcrever áudio"
                  : `${status} (${elapsed}s)`}
              </button>
            )}

            {busy && (
              <div style={{ height: 4, background: t.bg }}>
                <div
                  style={{
                    height: "100%",
                    width: phase === "transcribing" ? "100%" : `${progress}%`,
                    background: t.accent,
                    transition: "width 0.4s",
                    animation:
                      phase === "transcribing" ? "pulse 1.5s infinite" : "none",
                    borderRadius: 2,
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* ── ERROR ── */}
        {phase === "error" && (
          <div
            style={{
              marginTop: 16,
              padding: "1rem 1.2rem",
              background: t.errBg,
              border: `1px solid ${t.errBd}`,
              borderRadius: 12,
              fontSize: "0.84rem",
              color: "#ef4444",
            }}
          >
            {status}
          </div>
        )}

        {/* ── RESULT ── */}
        {phase === "done" && transcript && (
          <div
            style={{
              marginTop: 16,
              background: t.card,
              border: `1.5px solid ${t.accent}40`,
              borderRadius: 18,
              overflow: "hidden",
              boxShadow: `${t.shadow}, 0 0 20px ${t.accentSoft}`,
            }}
          >
            <div
              style={{
                padding: "0.85rem 1.3rem",
                borderBottom: `1px solid ${t.border}`,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              <span
                style={{
                  fontSize: "0.72rem",
                  fontWeight: 700,
                  color: t.accent,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                ✅ Transcrição completa · {elapsed}s
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={copy} style={actionBtn(copied)}>
                  {copied ? "✓ Copiado" : "📋 Copiar"}
                </button>
                <button onClick={download} style={actionBtn(false)}>
                  💾 Baixar .txt
                </button>
              </div>
            </div>
            <div
              style={{
                padding: "1.3rem",
                fontSize: "0.92rem",
                lineHeight: 1.8,
                maxHeight: 400,
                overflowY: "auto",
                whiteSpace: "pre-wrap",
              }}
            >
              {transcript}
            </div>
            <div
              className="result-stats"
              style={{
                padding: "0.7rem 1.3rem",
                borderTop: `1px solid ${t.border}`,
                fontSize: "0.72rem",
                color: t.text2,
                fontWeight: 500,
              }}
            >
              <span>📝 {wc(transcript)} palavras</span>
              <span>🔤 {transcript.length} caracteres</span>
              <span>⏱ ~{Math.ceil(wc(transcript) / 200)} min leitura</span>
            </div>
          </div>
        )}

        {/* ── HOW TO ── */}
        <div
          style={{
            marginTop: 32,
            background: t.card,
            border: `1.5px solid ${t.cardBorder}`,
            borderRadius: 18,
            overflow: "hidden",
            boxShadow: t.shadow,
          }}
        >
          <div
            style={{
              padding: "1rem 1.3rem",
              borderBottom: `1px solid ${t.border}`,
              fontWeight: 700,
              fontSize: "0.88rem",
            }}
          >
            📱 Como pegar o áudio do WhatsApp
          </div>
          <div style={{ padding: "1rem 1.3rem" }}>
            <div
              style={{
                display: "flex",
                gap: 12,
                marginBottom: 12,
                alignItems: "flex-start",
              }}
            >
              <span
                style={{
                  background: t.accentGlow,
                  color: t.accent,
                  fontWeight: 800,
                  fontSize: "0.72rem",
                  width: 24,
                  height: 24,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                1
              </span>
              <div>
                <p style={{ fontWeight: 600, fontSize: "0.84rem" }}>
                  No celular
                </p>
                <p style={{ color: t.text2, fontSize: "0.8rem", marginTop: 2 }}>
                  Segure o áudio → Encaminhar → Salve no dispositivo ou envie
                  para si mesmo → Baixe o arquivo
                </p>
              </div>
            </div>
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "flex-start",
              }}
            >
              <span
                style={{
                  background: t.accentGlow,
                  color: t.accent,
                  fontWeight: 800,
                  fontSize: "0.72rem",
                  width: 24,
                  height: 24,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                2
              </span>
              <div>
                <p style={{ fontWeight: 600, fontSize: "0.84rem" }}>
                  No WhatsApp Web
                </p>
                <p style={{ color: t.text2, fontSize: "0.8rem", marginTop: 2 }}>
                  Passe o mouse sobre o áudio → Clique na setinha → Download
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── FEATURES ── */}
        <div className="features-grid">
          {[
            { icon: "🔒", title: "Privado", desc: "Nada sai do navegador" },
            { icon: "⚡", title: "Rápido", desc: "Modelo Whisper otimizado" },
            { icon: "🆓", title: "Gratuito", desc: "Open source, sem limites" },
          ].map(({ icon, title, desc }) => (
            <div
              key={title}
              style={{
                background: t.card,
                border: `1.5px solid ${t.cardBorder}`,
                borderRadius: 14,
                padding: "1.1rem",
                textAlign: "center",
                boxShadow: t.shadow,
              }}
            >
              <div style={{ fontSize: 24, marginBottom: 8 }}>{icon}</div>
              <p
                style={{
                  fontWeight: 700,
                  fontSize: "0.82rem",
                  marginBottom: 4,
                }}
              >
                {title}
              </p>
              <p style={{ color: t.text2, fontSize: "0.72rem" }}>{desc}</p>
            </div>
          ))}
        </div>

        {/* ── FOOTER ── */}
        <footer
          style={{
            textAlign: "center",
            padding: "2.5rem 0 1.5rem",
            borderTop: `1px solid ${t.border}`,
            marginTop: 40,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              marginBottom: 8,
            }}
          >
            <img
              src={LOGO}
              alt="Guebly"
              style={{
                height: 22,
                objectFit: "contain",
              }}
            />
            <a
              href="https://www.guebly.com.br"
              target="_blank"
              rel="noreferrer"
              style={{
                color: t.text,
                textDecoration: "none",
                fontWeight: 700,
                fontSize: "0.88rem",
              }}
            >
              Guebly
            </a>
          </div>
          <p style={{ color: t.text3, fontSize: "0.72rem", lineHeight: 1.6 }}>
            Open Source · Whisper (MIT) + Transformers.js (Apache 2.0)
            <br />
            Feito com ❤️ no Brasil
          </p>
        </footer>
      </div>
    </div>
  );
}
