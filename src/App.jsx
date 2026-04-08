import { useState, useRef, useCallback, useEffect } from 'react'
import { pipeline } from '@huggingface/transformers'

const LOGO = '/logo.png'

const fmtDur = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const fmtSize = (b) => b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB'
const wc = (t) => t.trim().split(/\s+/).filter(Boolean).length

const themes = {
  dark: {
    bg: '#0b0f0d', surface: '#111916', surface2: '#182019', border: '#1f2e24',
    text: '#e6f0ea', text2: '#6b8575', accent: '#25D366', accentGlow: 'rgba(37,211,102,0.10)',
    card: '#111916', shadow: '0 1px 3px rgba(0,0,0,0.3)',
    toggle: '#182019', toggleBd: '#1f2e24', errBg: '#1a0e0e', errBd: '#331a1a',
  },
  light: {
    bg: '#f4f7f5', surface: '#ffffff', surface2: '#f0f4f1', border: '#dce5df',
    text: '#1a2b21', text2: '#6b8575', accent: '#25D366', accentGlow: 'rgba(37,211,102,0.08)',
    card: '#ffffff', shadow: '0 1px 4px rgba(0,0,0,0.06)',
    toggle: '#eef2ef', toggleBd: '#dce5df', errBg: '#fef2f2', errBd: '#fecaca',
  },
}

const LANGS = [
  { v: 'pt', l: '🇧🇷 Português' },
  { v: 'en', l: '🇺🇸 English' },
  { v: 'es', l: '🇪🇸 Español' },
  { v: 'auto', l: '🔍 Auto' },
]

export default function App() {
  const [mode, setMode] = useState('dark')
  const t = themes[mode]

  const [file, setFile] = useState(null)
  const [audioUrl, setAudioUrl] = useState(null)
  const [duration, setDuration] = useState(0)
  const [lang, setLang] = useState('pt')
  const [dragOver, setDragOver] = useState(false)
  const [phase, setPhase] = useState('idle')
  const [transcript, setTranscript] = useState('')
  const [copied, setCopied] = useState(false)
  const [status, setStatus] = useState('')
  const [progress, setProgress] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [curTime, setCurTime] = useState(0)

  const fileRef = useRef(null)
  const audioRef = useRef(null)
  const timerRef = useRef(null)
  const whisperRef = useRef(null)

  // Elapsed timer
  useEffect(() => {
    if (phase === 'loading' || phase === 'transcribing') {
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000)
    } else clearInterval(timerRef.current)
    return () => clearInterval(timerRef.current)
  }, [phase])

  // Audio time
  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const fn = () => setCurTime(a.currentTime)
    a.addEventListener('timeupdate', fn)
    return () => a.removeEventListener('timeupdate', fn)
  })

  const onFile = useCallback((f) => {
    if (!f) return
    setFile(f)
    setTranscript('')
    setPhase('idle')
    const url = URL.createObjectURL(f)
    setAudioUrl(url)
    const a = new Audio(url)
    a.addEventListener('loadedmetadata', () => setDuration(a.duration))
  }, [])

  const remove = () => {
    setFile(null); setAudioUrl(null); setDuration(0)
    setTranscript(''); setPhase('idle'); setPlaying(false); setCurTime(0)
    if (audioRef.current) audioRef.current.pause()
  }

  const togglePlay = () => {
    if (!audioRef.current) return
    playing ? audioRef.current.pause() : audioRef.current.play()
    setPlaying(!playing)
  }

  const seek = (e) => {
    if (!audioRef.current || !duration) return
    const r = e.currentTarget.getBoundingClientRect()
    audioRef.current.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration
  }

  const transcribe = async () => {
    if (!file) return
    try {
      setPhase('loading'); setProgress(0)
      setStatus('Downloading Whisper model (~75 MB)…')

      if (!whisperRef.current) {
        whisperRef.current = await pipeline(
          'automatic-speech-recognition',
          'onnx-community/whisper-tiny',
          {
            dtype: 'q8',
            progress_callback: (p) => {
              if (p.status === 'progress' && p.progress) {
                const pct = Math.round(p.progress)
                setProgress(Math.min(pct, 95))
                setStatus(`Downloading model… ${pct}%`)
              }
            },
          }
        )
      }

      setPhase('transcribing'); setProgress(0)
      setStatus('Transcribing audio…')

      const url = URL.createObjectURL(file)
      const opts = { chunk_length_s: 30, stride_length_s: 5 }
      if (lang !== 'auto') opts.language = lang
      const result = await whisperRef.current(url, opts)
      URL.revokeObjectURL(url)

      setTranscript(result.text.trim())
      setPhase('done')
    } catch (err) {
      console.error(err)
      setStatus('Error: ' + err.message)
      setPhase('error')
    }
  }

  const copy = () => {
    navigator.clipboard.writeText(transcript)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const download = () => {
    const blob = new Blob([transcript], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = (file?.name?.replace(/\.[^.]+$/, '') || 'transcription') + '.txt'
    a.click()
  }

  const busy = phase === 'loading' || phase === 'transcribing'
  const pct = duration > 0 ? (curTime / duration) * 100 : 0

  // ─── Inline styles ───
  const btn = (active) => ({
    background: active ? t.accent : t.surface,
    color: active ? '#fff' : t.text2,
    border: `1px solid ${active ? t.accent : t.border}`,
    borderRadius: 8, padding: '5px 10px',
    fontSize: '0.72rem', fontWeight: active ? 700 : 500,
    cursor: 'pointer', fontFamily: 'inherit', transition: 'all 0.15s',
  })

  const smallBtn = (hl) => ({
    background: t.surface2, border: `1px solid ${t.border}`,
    color: hl ? t.accent : t.text2, fontSize: '0.7rem',
    padding: '4px 9px', borderRadius: 6, cursor: 'pointer',
    fontFamily: 'inherit', transition: 'all 0.15s',
  })

  return (
    <div style={{
      minHeight: '100vh', background: t.bg, color: t.text,
      fontFamily: "'Segoe UI',-apple-system,system-ui,sans-serif",
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      transition: 'background 0.3s, color 0.3s',
    }}>
      {/* ── NAV ── */}
      <nav style={{
        width: '100%', maxWidth: 640, padding: '1rem 1.5rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: `1px solid ${t.border}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src={LOGO} alt="Guebly" style={{ height: 32, borderRadius: 8 }} />
          <span style={{ fontWeight: 800, fontSize: '1.1rem', letterSpacing: '-0.03em' }}>
            <span style={{ color: t.accent }}>Zap</span>Transcriber
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            fontSize: '0.6rem', fontWeight: 700,
            background: t.accentGlow, color: t.accent,
            padding: '3px 8px', borderRadius: 4,
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>Open Source</span>
          <button
            onClick={() => setMode((m) => (m === 'dark' ? 'light' : 'dark'))}
            style={{
              background: t.toggle, border: `1px solid ${t.toggleBd}`,
              borderRadius: 20, padding: '5px 12px', cursor: 'pointer',
              fontSize: '0.74rem', color: t.text2, fontFamily: 'inherit',
            }}
          >
            {mode === 'dark' ? '☀️ Light' : '🌙 Dark'}
          </button>
        </div>
      </nav>

      {/* ── HERO ── */}
      <div style={{ textAlign: 'center', padding: '2rem 1.5rem 1.2rem', maxWidth: 520 }}>
        <h1 style={{
          fontSize: 'clamp(1.35rem,3.5vw,1.9rem)', fontWeight: 800,
          letterSpacing: '-0.04em', lineHeight: 1.15,
        }}>
          Transcreva áudios do WhatsApp<br />
          <span style={{ color: t.accent }}>direto no navegador</span>
        </h1>
        <p style={{ color: t.text2, fontSize: '0.84rem', lineHeight: 1.5, marginTop: 8 }}>
          100% local · nenhum dado enviado · áudios longos · open source by{' '}
          <a href="https://www.guebly.com.br" target="_blank" rel="noreferrer"
            style={{ color: t.accent, textDecoration: 'none', fontWeight: 600 }}>
            Guebly
          </a>
        </p>
      </div>

      {/* ── MAIN ── */}
      <div style={{ width: '100%', maxWidth: 520, padding: '0 1rem' }}>
        {/* Language */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.73rem', color: t.text2, marginRight: 3 }}>Idioma:</span>
          {LANGS.map(({ v, l }) => (
            <button key={v} onClick={() => setLang(v)} style={btn(lang === v)}>{l}</button>
          ))}
        </div>

        {/* Dropzone */}
        {!file && (
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); onFile(e.dataTransfer.files[0]) }}
            style={{
              border: `2px dashed ${dragOver ? t.accent : t.border}`,
              borderRadius: 16, padding: '2.5rem 2rem', textAlign: 'center',
              cursor: 'pointer', background: dragOver ? t.accentGlow : t.surface,
              transition: 'all 0.25s', boxShadow: t.shadow,
            }}
          >
            <div style={{ fontSize: 44, marginBottom: 10 }}>{dragOver ? '📥' : '🎤'}</div>
            <p style={{ fontWeight: 700, fontSize: '0.92rem', marginBottom: 4 }}>Arraste o áudio aqui</p>
            <p style={{ color: t.text2, fontSize: '0.78rem' }}>
              ou clique para selecionar · .ogg .opus .mp3 .m4a .wav .webm
            </p>
            <input
              ref={fileRef} type="file" accept="audio/*,.ogg,.opus,.mp3,.m4a,.wav,.webm"
              style={{ display: 'none' }} onChange={(e) => onFile(e.target.files?.[0])}
            />
          </div>
        )}

        {/* File card */}
        {file && (
          <div style={{
            background: t.card, border: `1px solid ${t.border}`,
            borderRadius: 14, overflow: 'hidden', boxShadow: t.shadow,
          }}>
            {/* File info */}
            <div style={{
              padding: '0.9rem 1.1rem', display: 'flex', alignItems: 'center',
              gap: 10, borderBottom: `1px solid ${t.border}`,
            }}>
              <div style={{
                width: 42, height: 42, background: t.accentGlow, borderRadius: 11,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 19, flexShrink: 0,
              }}>🎵</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontWeight: 600, fontSize: '0.85rem',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>{file.name}</div>
                <div style={{ color: t.text2, fontSize: '0.72rem', marginTop: 2 }}>
                  {fmtSize(file.size)}{duration > 0 && ` · ${fmtDur(duration)}`}
                </div>
              </div>
              <button onClick={togglePlay} style={{
                background: t.surface2, border: `1px solid ${t.border}`,
                color: t.text, borderRadius: 10, width: 36, height: 36,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', fontSize: 15, flexShrink: 0,
              }}>{playing ? '⏸' : '▶'}</button>
              <button onClick={remove} style={{
                background: 'none', border: 'none', color: t.text2,
                cursor: 'pointer', fontSize: 17, padding: 4, flexShrink: 0,
              }}>✕</button>
              <audio ref={audioRef} src={audioUrl} onEnded={() => setPlaying(false)} />
            </div>

            {/* Seek bar */}
            <div style={{
              padding: '0 1.1rem 0.7rem', display: 'flex', alignItems: 'center', gap: 8,
              paddingTop: '0.5rem',
            }}>
              <span style={{ fontSize: '0.64rem', color: t.text2, fontVariantNumeric: 'tabular-nums', minWidth: 30 }}>
                {fmtDur(curTime)}
              </span>
              <div
                onClick={seek}
                style={{
                  flex: 1, height: 6, background: t.surface2,
                  borderRadius: 3, cursor: 'pointer', overflow: 'hidden',
                }}
              >
                <div style={{
                  height: '100%', background: t.accent, borderRadius: 3,
                  width: `${pct}%`, transition: 'width 0.1s',
                }} />
              </div>
              <span style={{ fontSize: '0.64rem', color: t.text2, fontVariantNumeric: 'tabular-nums', minWidth: 30 }}>
                {fmtDur(duration)}
              </span>
            </div>

            {/* CTA */}
            {phase !== 'done' && (
              <button onClick={transcribe} disabled={busy} style={{
                width: '100%', padding: '0.85rem',
                background: busy ? t.surface2 : t.accent,
                color: busy ? t.accent : '#fff',
                border: 'none', borderTop: `1px solid ${t.border}`,
                fontSize: '0.88rem', fontWeight: 700,
                cursor: busy ? 'default' : 'pointer', fontFamily: 'inherit',
              }}>
                {phase === 'idle' || phase === 'error'
                  ? '⚡ Transcrever áudio'
                  : `${status} (${elapsed}s)`}
              </button>
            )}

            {/* Progress */}
            {busy && (
              <div style={{ height: 3, background: t.bg }}>
                <div style={{
                  height: '100%',
                  width: phase === 'transcribing' ? '100%' : `${progress}%`,
                  background: t.accent, transition: 'width 0.4s',
                  animation: phase === 'transcribing' ? 'pulse 1.5s infinite' : 'none',
                }} />
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {phase === 'error' && (
          <div style={{
            marginTop: 12, padding: '0.75rem 1rem',
            background: t.errBg, border: `1px solid ${t.errBd}`,
            borderRadius: 10, fontSize: '0.8rem', color: '#ef4444',
          }}>{status}</div>
        )}

        {/* Result */}
        {phase === 'done' && transcript && (
          <div style={{
            marginTop: 12, background: t.card, border: `1px solid ${t.border}`,
            borderRadius: 14, overflow: 'hidden', boxShadow: t.shadow,
          }}>
            <div style={{
              padding: '0.65rem 1.1rem', borderBottom: `1px solid ${t.border}`,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              flexWrap: 'wrap', gap: 8,
            }}>
              <span style={{
                fontSize: '0.67rem', fontWeight: 700, color: t.accent,
                textTransform: 'uppercase', letterSpacing: '0.07em',
              }}>✅ Transcrição · {elapsed}s</span>
              <div style={{ display: 'flex', gap: 5 }}>
                <button onClick={copy} style={smallBtn(copied)}>
                  {copied ? 'Copiado ✓' : '📋 Copiar'}
                </button>
                <button onClick={download} style={smallBtn(false)}>💾 .txt</button>
              </div>
            </div>
            <div style={{
              padding: '1.1rem', fontSize: '0.88rem', lineHeight: 1.75,
              maxHeight: 350, overflowY: 'auto', whiteSpace: 'pre-wrap',
            }}>{transcript}</div>
            <div style={{
              padding: '0.55rem 1.1rem', borderTop: `1px solid ${t.border}`,
              display: 'flex', gap: 16, fontSize: '0.67rem', color: t.text2,
            }}>
              <span>{wc(transcript)} palavras</span>
              <span>{transcript.length} caracteres</span>
              <span>~{Math.ceil(wc(transcript) / 200)} min leitura</span>
            </div>
          </div>
        )}

        {/* How to */}
        <div style={{
          marginTop: 20, padding: '1rem', background: t.surface,
          border: `1px solid ${t.border}`, borderRadius: 14, boxShadow: t.shadow,
        }}>
          <p style={{ fontWeight: 700, fontSize: '0.8rem', marginBottom: 8 }}>
            📱 Como pegar o áudio do WhatsApp
          </p>
          <div style={{ color: t.text2, fontSize: '0.76rem', lineHeight: 1.7 }}>
            <p>
              <span style={{ color: t.accent, fontWeight: 700 }}>Celular →</span>{' '}
              Segure o áudio → Encaminhar → Salve → Baixe
            </p>
            <p style={{ marginTop: 3 }}>
              <span style={{ color: t.accent, fontWeight: 700 }}>WhatsApp Web →</span>{' '}
              Setinha do áudio → Download
            </p>
          </div>
        </div>

        {/* Footer */}
        <footer style={{
          textAlign: 'center', padding: '1.2rem 0 2rem',
          color: t.text2, fontSize: '0.68rem', lineHeight: 1.6, opacity: 0.7,
        }}>
          <img src={LOGO} alt="" style={{ height: 14, borderRadius: 3, marginRight: 4, verticalAlign: 'middle' }} />
          <a href="https://www.guebly.com.br" target="_blank" rel="noreferrer"
            style={{ color: t.accent, textDecoration: 'none' }}>Guebly</a>
          {' · Open Source · Whisper (MIT) + Transformers.js (Apache 2.0)'}
        </footer>
      </div>
    </div>
  )
}
