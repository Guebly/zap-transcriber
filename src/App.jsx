import { useState, useRef, useCallback, useEffect } from "react";

const LOGO = "/logo.png";

const fmtDur = (s) =>
  `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const fmtSize = (b) =>
  b < 1_048_576
    ? (b / 1024).toFixed(1) + " KB"
    : (b / 1_048_576).toFixed(1) + " MB";
const wc = (t) => t.trim().split(/\s+/).filter(Boolean).length;
const isVideo = (f) =>
  f?.type?.startsWith("video/") ||
  /\.(mp4|mov|avi|mkv)$/i.test(f?.name || "");
const fmtSRT = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.round((s % 1) * 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
};

const themes = {
  dark: {
    bg: "#0a0d0b",
    bg2: "#060806",
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
    errBg: "#1a0e0e",
    errBd: "#331a1a",
    shadow: "0 2px 12px rgba(0,0,0,0.4)",
    heroGradient:
      "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(37,211,102,0.06) 0%, transparent 70%)",
    warnColor: "#f59e0b",
  },
  light: {
    bg: "#f7faf8",
    bg2: "#eef3f0",
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
    errBg: "#fef2f2",
    errBd: "#fecaca",
    shadow: "0 2px 16px rgba(0,0,0,0.06)",
    heroGradient:
      "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(29,185,84,0.05) 0%, transparent 70%)",
    warnColor: "#d97706",
  },
};

const LANGS = [
  { v: "pt", l: "🇧🇷 Português" },
  { v: "en", l: "🇺🇸 English" },
  { v: "es", l: "🇪🇸 Español" },
  { v: "auto", l: "🔍 Auto" },
];

const MODELS = [
  {
    v: "onnx-community/whisper-tiny",
    l: "Tiny ~40 MB",
    desc: "Mais rápido, menos preciso",
  },
  {
    v: "onnx-community/whisper-base",
    l: "Base ~150 MB",
    desc: "Mais lento, mais preciso",
  },
];

let _id = 0;
const mkId = () => ++_id;

export default function App() {
  const [mode, setMode] = useState("dark");
  const t = themes[mode];

  const [queue, setQueue] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lang, setLang] = useState("pt");
  const [model, setModel] = useState("onnx-community/whisper-base");
  const [showTimestamps, setShowTimestamps] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const [playingIds, setPlayingIds] = useState({});
  const [curTimes, setCurTimes] = useState({});

  const fileRef = useRef(null);
  const workerRef = useRef(null);
  const processingIdRef = useRef(null);
  const audioRefsMap = useRef({});
  const langRef = useRef(lang);
  const modelRef = useRef(model);
  const queueRef = useRef([]);

  useEffect(() => {
    langRef.current = lang;
  }, [lang]);
  useEffect(() => {
    modelRef.current = model;
  }, [model]);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  // ── Decode audio/video file → mono Float32Array at 16 kHz ──
  // AudioContext is not available in Web Workers, so decoding happens here.
  //
  // Path A (fast): AudioContext at native rate → OfflineAudioContext resample to 16 kHz.
  //   Works for all formats the browser can decode (audio + MP4/AAC).
  //
  // Path B (fallback): MediaElementSource + ScriptProcessorNode (real-time capture).
  //   Triggered when Path A fails (unusual codecs, some video containers).
  //   Uses <audio> for audio files, <video> for video. Takes as long as the media duration.
  const decodeFile = useCallback(async (item, onFallback) => {
    const TARGET_SR = 16000;

    const toMono = (buf) => {
      if (buf.numberOfChannels === 1) return buf.getChannelData(0).slice();
      const a = buf.getChannelData(0);
      const b = buf.getChannelData(1);
      const out = new Float32Array(a.length);
      for (let i = 0; i < a.length; i++) out[i] = (a[i] + b[i]) / 2;
      return out;
    };

    const resample = async (decoded) => {
      if (decoded.sampleRate === TARGET_SR) return toMono(decoded);
      const len = Math.ceil(decoded.duration * TARGET_SR);
      const off = new OfflineAudioContext(1, len, TARGET_SR);
      const src = off.createBufferSource();
      src.buffer = decoded;
      src.connect(off.destination);
      src.start(0);
      const rendered = await off.startRendering();
      return rendered.getChannelData(0).slice();
    };

    // ── Path A: AudioContext.decodeAudioData ──
    // Works for all audio formats and MP4/AAC video (Chrome supports it).
    // Fails for some video containers (MKV, AVI) — falls through to Path B.
    try {
      const arrayBuf = await item.file.arrayBuffer();
      if (arrayBuf.byteLength === 0) throw new Error("empty");
      const ctx = new AudioContext(); // native sample rate — most compatible
      let decoded;
      try {
        decoded = await ctx.decodeAudioData(arrayBuf);
      } finally {
        ctx.close();
      }
      const samples = await resample(decoded);
      return { samples, duration: decoded.duration };
    } catch (_) {
      // fall through to Path B
    }

    // ── Path B: MediaElement real-time capture ──
    // Works for any format the browser can play.
    // Runs in real-time (a 2-min video takes ~2 min to extract).
    // Requirements: el.muted=true (autoplay), el in DOM (reliable play), ctx.resume().
    onFallback?.();

    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (fn) => { if (!done) { done = true; fn(); } };

      const el = document.createElement(isVideo(item.file) ? "video" : "audio");
      el.src = item.url;
      el.preload = "auto";
      el.muted = true;       // bypass autoplay policy — muted media plays without user gesture
      el.style.display = "none";
      document.body.appendChild(el);

      const cleanup = (ctx) => {
        try { document.body.removeChild(el); } catch (_) {}
        ctx?.close();
      };

      el.addEventListener("error", () => {
        const code = el.error?.code ?? "?";
        finish(() => {
          cleanup(null);
          reject(new Error(
            `Erro de mídia (código ${code}). ` +
            "Salve o arquivo no computador e tente novamente, ou converta para MP4/MP3.",
          ));
        });
      });

      el.addEventListener("loadedmetadata", async () => {
        const duration = el.duration;
        // Use NATIVE rate — browsers may silently ignore sampleRate:16000.
        // Capture at whatever rate the context actually runs at, then resample afterward.
        const ctx = new AudioContext();
        await ctx.resume(); // AudioContext may start suspended outside user-gesture
        const nativeSR = ctx.sampleRate; // actual rate (usually 44100 or 48000)
        const source = ctx.createMediaElementSource(el);
        const processor = ctx.createScriptProcessor(4096, 1, 1);
        const silencer = ctx.createGain();
        silencer.gain.value = 0;
        const collected = [];

        processor.onaudioprocess = (e) => {
          collected.push(new Float32Array(e.inputBuffer.getChannelData(0)));
        };

        source.connect(processor);
        processor.connect(silencer);
        silencer.connect(ctx.destination);

        el.addEventListener("ended", async () => {
          finish(async () => {
            processor.disconnect();
            silencer.disconnect();
            cleanup(ctx);

            // Concatenate all captured chunks (at nativeSR)
            const total = collected.reduce((s, c) => s + c.length, 0);
            const raw = new Float32Array(total);
            let off = 0;
            for (const chunk of collected) { raw.set(chunk, off); off += chunk.length; }

            // Resample from nativeSR → 16 kHz using OfflineAudioContext
            let samples;
            if (nativeSR === TARGET_SR) {
              samples = raw;
            } else {
              const targetLen = Math.ceil(duration * TARGET_SR);
              const offCtx = new OfflineAudioContext(1, targetLen, TARGET_SR);
              const buf = offCtx.createBuffer(1, raw.length, nativeSR);
              buf.copyToChannel(raw, 0);
              const bufSrc = offCtx.createBufferSource();
              bufSrc.buffer = buf;
              bufSrc.connect(offCtx.destination);
              bufSrc.start(0);
              const rendered = await offCtx.startRendering();
              samples = rendered.getChannelData(0).slice();
            }

            resolve({ samples, duration });
          });
        });

        el.play().catch(() => {
          finish(() => {
            cleanup(ctx);
            reject(new Error("Reprodução bloqueada pelo navegador. Tente novamente."));
          });
        });
      });
    });
  }, []);

  // ── Start next idle item in queue ──
  const startNext = useCallback(async (currentQueue) => {
    const next = currentQueue.find((i) => i.status === "idle");
    if (!next) {
      processingIdRef.current = null;
      setIsProcessing(false);
      return;
    }

    const id = next.id;
    processingIdRef.current = id;
    setIsProcessing(true);

    let audio, duration;
    try {
      const { samples, duration: dur } = await decodeFile(next, () => {
        // Notify UI that we're using the real-time fallback
        setQueue((q) =>
          q.map((item) =>
            item.id === id
              ? { ...item, status: "loading", statusMsg: "Extraindo áudio do vídeo…" }
              : item,
          ),
        );
      });
      audio = samples;
      duration = dur;
    } catch (err) {
      setQueue((q) => {
        const updated = q.map((item) =>
          item.id === id
            ? { ...item, status: "error", error: "Erro ao decodificar: " + err.message }
            : item,
        );
        setTimeout(() => startNext(updated), 0);
        return updated;
      });
      processingIdRef.current = null;
      setIsProcessing(false);
      return;
    }

    if (processingIdRef.current !== id) return; // cancelled during decode

    const opts = {
      chunk_length_s: 28,
      stride_length_s: 6,
      return_timestamps: true,
      no_repeat_ngram_size: 3,
    };
    if (langRef.current !== "auto") opts.language = langRef.current;

    workerRef.current?.postMessage(
      { type: "transcribe", payload: { audio, opts, model: modelRef.current, duration } },
      [audio.buffer],
    );
  }, [decodeFile]);

  // ── Worker message handler (stable, uses only refs) ──
  const handleWorkerMessage = useCallback(
    ({ data }) => {
      const { type, payload } = data;
      const id = processingIdRef.current;
      if (!id) return;

      if (type === "cached") {
        setQueue((q) =>
          q.map((item) =>
            item.id === id
              ? { ...item, status: "loading", progress: 100, statusMsg: "Modelo em cache ✓" }
              : item,
          ),
        );
      } else if (type === "loading") {
        setQueue((q) =>
          q.map((item) =>
            item.id === id
              ? { ...item, status: "loading", progress: 0, statusMsg: "Baixando modelo…" }
              : item,
          ),
        );
      } else if (type === "download_progress") {
        setQueue((q) =>
          q.map((item) =>
            item.id === id
              ? { ...item, progress: payload, statusMsg: `Baixando modelo… ${payload}%` }
              : item,
          ),
        );
      } else if (type === "transcribing") {
        setQueue((q) =>
          q.map((item) =>
            item.id === id
              ? {
                  ...item,
                  status: "transcribing",
                  progress: 0,
                  statusMsg: isVideo(item.file)
                    ? "Transcrevendo vídeo…"
                    : "Transcrevendo áudio…",
                }
              : item,
          ),
        );
      } else if (type === "trans_progress") {
        setQueue((q) =>
          q.map((item) =>
            item.id === id ? { ...item, progress: payload } : item,
          ),
        );
      } else if (type === "result") {
        const text =
          payload.text?.trim() ||
          payload.chunks?.map((c) => c.text).join(" ").trim() ||
          "";
        const chunks = payload.chunks || [];
        setQueue((q) => {
          const updated = q.map((item) =>
            item.id === id
              ? { ...item, status: "done", transcript: text, chunks, progress: 100 }
              : item,
          );
          setTimeout(() => startNext(updated), 0);
          return updated;
        });
      } else if (type === "error") {
        setQueue((q) => {
          const updated = q.map((item) =>
            item.id === id ? { ...item, status: "error", error: payload } : item,
          );
          setTimeout(() => startNext(updated), 0);
          return updated;
        });
      }
    },
    [startNext],
  );

  // ── Create / recreate worker ──
  const initWorker = useCallback(() => {
    workerRef.current?.terminate();
    const worker = new Worker(
      new URL("./whisper.worker.js", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = handleWorkerMessage;
    workerRef.current = worker;
  }, [handleWorkerMessage]);

  useEffect(() => {
    initWorker();
    return () => workerRef.current?.terminate();
  }, [initWorker]);

  // ── Cancel current transcription ──
  const cancelTranscription = useCallback(() => {
    const id = processingIdRef.current;
    if (!id) return;
    processingIdRef.current = null;
    setIsProcessing(false);
    initWorker();
    setQueue((q) =>
      q.map((item) =>
        item.id === id
          ? { ...item, status: "idle", progress: 0, elapsed: 0, statusMsg: "" }
          : item,
      ),
    );
  }, [initWorker]);

  // ── Elapsed timer ──
  useEffect(() => {
    if (!isProcessing) return;
    const timer = setInterval(() => {
      if (processingIdRef.current) {
        setQueue((q) =>
          q.map((item) =>
            item.id === processingIdRef.current
              ? { ...item, elapsed: (item.elapsed || 0) + 1 }
              : item,
          ),
        );
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [isProcessing]);

  // ── Add files to queue ──
  const addFiles = useCallback((fileList) => {
    if (!fileList?.length) return;
    const newItems = Array.from(fileList).map((f) => {
      const url = URL.createObjectURL(f);
      const id = mkId();
      const sizeWarning =
        f.size === 0
          ? "Arquivo sem conteúdo (0 bytes). Baixe o arquivo para o seu computador antes de arrastar."
          : (isVideo(f) && f.size > 1_073_741_824) ||
            (!isVideo(f) && f.size > 209_715_200)
          ? `Arquivo grande (${fmtSize(f.size)}) — pode ser lento ou falhar.`
          : null;

      const item = {
        id,
        file: f,
        url,
        duration: 0,
        status: "idle",
        progress: 0,
        elapsed: 0,
        transcript: "",
        chunks: [],
        error: null,
        statusMsg: "",
        sizeWarning,
      };

      const a = new Audio(url);
      a.addEventListener("loadedmetadata", () => {
        setQueue((q) =>
          q.map((i) => (i.id === id ? { ...i, duration: a.duration } : i)),
        );
      });

      return item;
    });

    setQueue((q) => [...q, ...newItems]);
  }, []);

  const removeItem = useCallback((id) => {
    if (processingIdRef.current === id) return;
    setQueue((q) => {
      const item = q.find((i) => i.id === id);
      if (item) URL.revokeObjectURL(item.url);
      return q.filter((i) => i.id !== id);
    });
    setPlayingIds((p) => {
      const n = { ...p };
      delete n[id];
      return n;
    });
    setCurTimes((c) => {
      const n = { ...c };
      delete n[id];
      return n;
    });
    delete audioRefsMap.current[id];
  }, []);

  const startAll = useCallback(() => {
    setQueue((q) => {
      setTimeout(() => startNext(q), 0);
      return q;
    });
  }, [startNext]);

  const retryItem = useCallback(
    (id) => {
      setQueue((q) => {
        const updated = q.map((i) =>
          i.id === id
            ? { ...i, status: "idle", error: null, progress: 0, elapsed: 0 }
            : i,
        );
        setTimeout(() => startNext(updated), 0);
        return updated;
      });
    },
    [startNext],
  );

  const togglePlay = useCallback((id) => {
    const el = audioRefsMap.current[id];
    if (!el) return;
    if (el.paused) {
      el.play();
      setPlayingIds((p) => ({ ...p, [id]: true }));
    } else {
      el.pause();
      setPlayingIds((p) => ({ ...p, [id]: false }));
    }
  }, []);

  const seek = useCallback((id, e) => {
    const el = audioRefsMap.current[id];
    const item = queueRef.current.find((i) => i.id === id);
    if (!el || !item?.duration) return;
    const r = e.currentTarget.getBoundingClientRect();
    el.currentTime =
      Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) *
      item.duration;
  }, []);

  const copyTranscript = useCallback((id) => {
    const item = queueRef.current.find((i) => i.id === id);
    if (!item) return;
    navigator.clipboard.writeText(item.transcript);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const downloadTxt = useCallback((id) => {
    const item = queueRef.current.find((i) => i.id === id);
    if (!item) return;
    const blob = new Blob([item.transcript], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download =
      (item.file.name.replace(/\.[^.]+$/, "") || "transcricao") + ".txt";
    a.click();
  }, []);

  const downloadSrt = useCallback((id) => {
    const item = queueRef.current.find((i) => i.id === id);
    if (!item?.chunks?.length) return;
    const lines = item.chunks
      .filter((c) => c.timestamp?.[0] != null)
      .map((c, i) => {
        const start = fmtSRT(c.timestamp[0]);
        const end = fmtSRT(
          Math.max(
            c.timestamp[0] + 0.5,
            c.timestamp[1] ?? c.timestamp[0] + 3,
          ),
        );
        return `${i + 1}\n${start} --> ${end}\n${c.text.trim()}\n`;
      })
      .join("\n");
    const blob = new Blob([lines], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download =
      (item.file.name.replace(/\.[^.]+$/, "") || "legenda") + ".srt";
    a.click();
  }, []);

  // ── Derived state ──
  const idleItems = queue.filter((i) => i.status === "idle");
  const hasIdle = idleItems.length > 0;

  const transcribeLabel =
    idleItems.length > 1
      ? `⚡ Transcrever todos (${idleItems.length} arquivos)`
      : idleItems.length === 1
        ? isVideo(idleItems[0]?.file)
          ? "⚡ Transcrever vídeo"
          : "⚡ Transcrever áudio"
        : "";

  // ── Style helpers ──
  const toggleBtn = (active, disabled) => ({
    background: active ? t.accent : "transparent",
    color: active ? "#fff" : t.text2,
    border: `1.5px solid ${active ? t.accent : t.border}`,
    borderRadius: 10,
    padding: "7px 14px",
    fontSize: "0.78rem",
    fontWeight: active ? 700 : 500,
    cursor: disabled ? "default" : "pointer",
    fontFamily: "inherit",
    transition: "all 0.2s",
    opacity: disabled ? 0.5 : 1,
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

  const stepBadge = {
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
  };

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
            style={{ height: 36, width: 36, objectFit: "contain" }}
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
          Transcreva áudios e vídeos
          <br />
          <span style={{ color: t.accent }}>direto no navegador</span>
        </h1>

        <p
          style={{
            color: t.text2,
            fontSize: "1rem",
            lineHeight: 1.6,
            maxWidth: 660,
            margin: "16px auto 0",
          }}
        >
          Nenhum dado é enviado para servidores. O modelo de IA roda localmente
          no seu dispositivo. Suporta vários arquivos de uma vez.
        </p>

        <div
          className="hero-stats"
          style={{ color: t.text3, fontSize: "0.78rem", fontWeight: 500 }}
        >
          {["🔒 100% privado", "⚡ Sem cadastro", "🌐 Multi-idioma"].map(
            (item) => (
              <span key={item}>{item}</span>
            ),
          )}
        </div>
      </div>

      {/* ═══ MAIN CONTENT ═══ */}
      <div className="app-main" style={{ maxWidth: 760, margin: "0 auto" }}>

        {/* ── SETTINGS ROW ── */}
        <div
          style={{
            display: "flex",
            gap: 20,
            marginBottom: 20,
            flexWrap: "wrap",
          }}
        >
          {/* Language */}
          <div style={{ flex: 1, minWidth: 220 }}>
            <span
              style={{
                fontSize: "0.8rem",
                color: t.text2,
                fontWeight: 600,
                display: "block",
                marginBottom: 8,
              }}
            >
              Idioma do áudio/vídeo:
            </span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {LANGS.map(({ v, l }) => (
                <button
                  key={v}
                  onClick={() => setLang(v)}
                  disabled={isProcessing}
                  style={toggleBtn(lang === v, isProcessing)}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* Model */}
          <div style={{ flex: 1, minWidth: 220 }}>
            <span
              style={{
                fontSize: "0.8rem",
                color: t.text2,
                fontWeight: 600,
                display: "block",
                marginBottom: 8,
              }}
            >
              Modelo Whisper:
            </span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {MODELS.map(({ v, l, desc }) => (
                <button
                  key={v}
                  onClick={() => setModel(v)}
                  disabled={isProcessing}
                  style={toggleBtn(model === v, isProcessing)}
                  title={desc}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── DROPZONE ── */}
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
            addFiles(e.dataTransfer.files);
          }}
          style={{
            border: `2px dashed ${dragOver ? t.accent : t.border}`,
            borderRadius: queue.length > 0 ? 12 : 20,
            padding: queue.length > 0 ? "0.85rem 1.5rem" : "3rem 2.5rem",
            textAlign: "center",
            cursor: "pointer",
            background: dragOver
              ? t.accentGlow
              : queue.length > 0
                ? "transparent"
                : t.card,
            transition: "all 0.3s",
            boxShadow: queue.length > 0 ? "none" : t.shadow,
            marginBottom: 16,
          }}
        >
          {queue.length === 0 ? (
            <>
              <div
                style={{
                  fontSize: 56,
                  marginBottom: 16,
                  animation: dragOver ? "float 0.6s ease infinite" : "none",
                }}
              >
                {dragOver ? "📥" : "🎤"}
              </div>
              <p
                style={{
                  fontWeight: 700,
                  fontSize: "1.1rem",
                  marginBottom: 8,
                }}
              >
                Arraste o áudio ou vídeo aqui
              </p>
              <p
                style={{
                  color: t.text2,
                  fontSize: "0.85rem",
                  marginBottom: 16,
                }}
              >
                ou clique para selecionar — múltiplos arquivos suportados
              </p>
              <div
                style={{
                  display: "inline-flex",
                  gap: 6,
                  flexWrap: "wrap",
                  justifyContent: "center",
                  maxWidth: 440,
                }}
              >
                {[
                  ".ogg",
                  ".opus",
                  ".mp3",
                  ".m4a",
                  ".wav",
                  ".webm",
                  ".mp4",
                  ".mov",
                  ".avi",
                  ".mkv",
                ].map((ext) => (
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
            </>
          ) : (
            <span
              style={{ fontSize: "0.82rem", color: t.text2, fontWeight: 600 }}
            >
              {dragOver ? "📥 Soltar aqui" : "+ Adicionar mais arquivos"}
            </span>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,video/*,.ogg,.opus,.mp3,.m4a,.wav,.webm,.mp4,.mov,.avi,.mkv"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {/* ── QUEUE ── */}
        {queue.map((item) => {
          const itemBusy =
            item.status === "loading" || item.status === "transcribing";
          const playPct =
            item.duration > 0
              ? ((curTimes[item.id] || 0) / item.duration) * 100
              : 0;
          const isPlaying = !!playingIds[item.id];
          const isCurrentlyProcessing = processingIdRef.current === item.id;
          const hasSrt = item.chunks?.some((c) => c.timestamp?.[0] != null);

          return (
            <div
              key={item.id}
              style={{
                marginBottom: 16,
                background: t.card,
                border: `1.5px solid ${
                  item.status === "done"
                    ? t.accent + "40"
                    : item.status === "error"
                      ? t.errBd
                      : t.cardBorder
                }`,
                borderRadius: 18,
                overflow: "hidden",
                boxShadow: t.shadow,
              }}
            >
              {/* File info row */}
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
                  {isVideo(item.file) ? "🎬" : "🎵"}
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
                    {item.file.name}
                  </div>
                  <div
                    style={{
                      color: t.text2,
                      fontSize: "0.76rem",
                      marginTop: 2,
                    }}
                  >
                    {fmtSize(item.file.size)}
                    {item.duration > 0 && ` · ${fmtDur(item.duration)}`}
                  </div>
                  {item.sizeWarning && (
                    <div
                      style={{
                        color: t.warnColor,
                        fontSize: "0.7rem",
                        marginTop: 2,
                      }}
                    >
                      ⚠️ {item.sizeWarning}
                    </div>
                  )}
                </div>

                {/* Status */}
                <div
                  style={{
                    flexShrink: 0,
                    textAlign: "right",
                    minWidth: 0,
                    maxWidth: 160,
                  }}
                >
                  {item.status === "idle" && (
                    <span
                      style={{
                        fontSize: "0.7rem",
                        color: t.text3,
                        fontWeight: 600,
                      }}
                    >
                      Aguardando
                    </span>
                  )}
                  {itemBusy && (
                    <span
                      style={{
                        fontSize: "0.7rem",
                        color: t.accent,
                        fontWeight: 600,
                        display: "block",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {item.statusMsg || "Processando…"}
                      {item.progress > 0 && item.status === "loading"
                        ? ""
                        : ` (${item.elapsed}s)`}
                    </span>
                  )}
                  {item.status === "done" && (
                    <span
                      style={{
                        fontSize: "0.7rem",
                        color: t.accent,
                        fontWeight: 700,
                      }}
                    >
                      ✅ {item.elapsed}s
                    </span>
                  )}
                  {item.status === "error" && (
                    <span
                      style={{
                        fontSize: "0.7rem",
                        color: "#ef4444",
                        fontWeight: 600,
                      }}
                    >
                      ❌ Erro
                    </span>
                  )}
                </div>

                {/* Play/pause */}
                <button
                  onClick={() => togglePlay(item.id)}
                  style={{
                    background: isPlaying ? t.accent : "transparent",
                    border: `1.5px solid ${isPlaying ? t.accent : t.border}`,
                    color: isPlaying ? "#fff" : t.text,
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
                  {isPlaying ? "⏸" : "▶"}
                </button>

                {/* Cancel (when processing) or Remove */}
                {isCurrentlyProcessing ? (
                  <button
                    onClick={cancelTranscription}
                    style={{
                      background: "none",
                      border: `1.5px solid ${t.border}`,
                      color: "#ef4444",
                      cursor: "pointer",
                      fontSize: "0.72rem",
                      fontWeight: 700,
                      padding: "4px 10px",
                      borderRadius: 8,
                      fontFamily: "inherit",
                      flexShrink: 0,
                      transition: "all 0.2s",
                    }}
                  >
                    ✕ Cancelar
                  </button>
                ) : (
                  <button
                    onClick={() => removeItem(item.id)}
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
                )}

                <audio
                  ref={(el) => {
                    if (el) audioRefsMap.current[item.id] = el;
                  }}
                  src={item.url}
                  onEnded={() =>
                    setPlayingIds((p) => ({ ...p, [item.id]: false }))
                  }
                  onTimeUpdate={(e) =>
                    setCurTimes((c) => ({
                      ...c,
                      [item.id]: e.target.currentTime,
                    }))
                  }
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
                  {fmtDur(curTimes[item.id] || 0)}
                </span>
                <div
                  onClick={(e) => seek(item.id, e)}
                  style={{
                    flex: 1,
                    height: 8,
                    background: t.surface2,
                    borderRadius: 4,
                    cursor: "pointer",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      background: t.accent,
                      borderRadius: 4,
                      width: `${playPct}%`,
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
                  {fmtDur(item.duration)}
                </span>
              </div>

              <div style={{ height: 1, background: t.border }} />

              {/* Download progress bar */}
              {itemBusy && (
                <div style={{ height: 4, background: t.bg2 }}>
                  <div
                    style={{
                      height: "100%",
                      width:
                        item.status === "transcribing" && item.progress === 0
                          ? "100%"
                          : `${item.progress}%`,
                      background: t.accent,
                      transition: item.progress > 0 ? "width 0.5s" : "none",
                      animation:
                        item.status === "transcribing" && item.progress === 0
                          ? "pulse 1.5s infinite"
                          : "none",
                      borderRadius: 2,
                    }}
                  />
                </div>
              )}

              {/* Error state */}
              {item.status === "error" && (
                <div>
                  <div
                    style={{
                      padding: "0.75rem 1.3rem",
                      background: t.errBg,
                      borderTop: `1px solid ${t.errBd}`,
                      fontSize: "0.82rem",
                      color: "#ef4444",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0, wordBreak: "break-word" }}>
                      {item.error}
                    </span>
                    <button
                      onClick={() => retryItem(item.id)}
                      disabled={isProcessing}
                      style={{
                        background: "transparent",
                        border: "1.5px solid #ef4444",
                        color: "#ef4444",
                        borderRadius: 8,
                        padding: "5px 12px",
                        fontSize: "0.74rem",
                        fontWeight: 600,
                        cursor: isProcessing ? "default" : "pointer",
                        fontFamily: "inherit",
                        flexShrink: 0,
                        opacity: isProcessing ? 0.5 : 1,
                      }}
                    >
                      🔄 Tentar novamente
                    </button>
                  </div>
                </div>
              )}

              {/* Result */}
              {item.status === "done" && item.transcript && (
                <div>
                  {/* Actions */}
                  <div
                    style={{
                      padding: "0.85rem 1.3rem",
                      borderTop: `1px solid ${t.border}`,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      flexWrap: "wrap",
                      gap: 8,
                    }}
                  >
                    <button
                      onClick={() => setShowTimestamps((s) => !s)}
                      style={actionBtn(showTimestamps)}
                    >
                      🕐 {showTimestamps ? "Com timestamps" : "Ver timestamps"}
                    </button>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => copyTranscript(item.id)}
                        style={actionBtn(copiedId === item.id)}
                      >
                        {copiedId === item.id ? "✓ Copiado" : "📋 Copiar"}
                      </button>
                      <button
                        onClick={() => downloadTxt(item.id)}
                        style={actionBtn(false)}
                      >
                        💾 .txt
                      </button>
                      {hasSrt && (
                        <button
                          onClick={() => downloadSrt(item.id)}
                          style={actionBtn(false)}
                        >
                          🎬 .srt
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Transcript content */}
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
                    {showTimestamps && item.chunks?.length > 0
                      ? item.chunks.map((c, i) => (
                          <span key={i}>
                            {c.timestamp?.[0] != null && (
                              <span
                                style={{
                                  color: t.text3,
                                  fontSize: "0.72rem",
                                  fontVariantNumeric: "tabular-nums",
                                  userSelect: "none",
                                }}
                              >
                                [{fmtDur(c.timestamp[0])}]{" "}
                              </span>
                            )}
                            {c.text}
                          </span>
                        ))
                      : item.transcript}
                  </div>

                  {/* Stats */}
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
                    <span>📝 {wc(item.transcript)} palavras</span>
                    <span>🔤 {item.transcript.length} caracteres</span>
                    <span>
                      ⏱ ~{Math.ceil(wc(item.transcript) / 200)} min leitura
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* ── TRANSCRIBE ALL BUTTON ── */}
        {hasIdle && !isProcessing && (
          <button
            onClick={startAll}
            style={{
              width: "100%",
              padding: "1rem",
              background: t.accent,
              color: "#fff",
              border: "none",
              borderRadius: 14,
              fontSize: "1rem",
              fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
              marginBottom: 16,
              transition: "all 0.2s",
              letterSpacing: "-0.01em",
            }}
          >
            {transcribeLabel}
          </button>
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
            📱 Como usar
          </div>
          <div style={{ padding: "1rem 1.3rem" }}>
            <p
              style={{
                fontWeight: 700,
                fontSize: "0.82rem",
                color: t.text2,
                marginBottom: 12,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              🎤 Áudio do WhatsApp
            </p>

            {[
              {
                title: "No celular",
                desc: "Segure o áudio → Encaminhar → Salve no dispositivo ou envie para si mesmo → Baixe o arquivo",
              },
              {
                title: "No WhatsApp Web",
                desc: "Passe o mouse sobre o áudio → Clique na setinha → Download",
              },
            ].map((step, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 12,
                  marginBottom: i === 0 ? 12 : 0,
                  alignItems: "flex-start",
                }}
              >
                <span style={stepBadge}>{i + 1}</span>
                <div>
                  <p style={{ fontWeight: 600, fontSize: "0.84rem" }}>
                    {step.title}
                  </p>
                  <p
                    style={{
                      color: t.text2,
                      fontSize: "0.8rem",
                      marginTop: 2,
                    }}
                  >
                    {step.desc}
                  </p>
                </div>
              </div>
            ))}

            <div
              style={{
                height: 1,
                background: t.border,
                margin: "16px 0",
              }}
            />

            <p
              style={{
                fontWeight: 700,
                fontSize: "0.82rem",
                color: t.text2,
                marginBottom: 12,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              🎬 Vídeo
            </p>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <span style={stepBadge}>1</span>
              <div>
                <p style={{ fontWeight: 600, fontSize: "0.84rem" }}>
                  Qualquer vídeo MP4, MOV, AVI, MKV
                </p>
                <p style={{ color: t.text2, fontSize: "0.8rem", marginTop: 2 }}>
                  Arraste o arquivo ou clique para selecionar. O áudio é
                  extraído automaticamente pelo navegador para transcrição.
                  Baixe o resultado como <strong>.txt</strong> ou{" "}
                  <strong>.srt</strong> (legenda com timestamps).
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
              style={{ height: 22, objectFit: "contain" }}
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
