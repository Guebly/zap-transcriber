# 🎤 Zap Transcriber

> WhatsApp audio transcriber that runs **100% in the browser**. No backend, no data sent to servers. Open source by [Guebly](https://www.guebly.com.br).

<p align="center">
  <img src="public/logo.png" alt="Guebly" width="80" />
</p>

<p align="center">
  <a href="README.pt-BR.md">🇧🇷 Leia em Português</a>
</p>

## ✨ Features

- **100% client-side** — all processing happens in the browser, nothing is sent to any server
- **No backend required** — static deploy on Vercel, Netlify, GitHub Pages, anywhere
- **Long audio support** — handles 3+ minute WhatsApp voice messages
- **Multi-language** — Portuguese, English, Spanish, or auto-detection
- **Dark / Light mode** — toggle between themes
- **Audio player** — listen before transcribing with seek bar
- **Export** — copy to clipboard or download as .txt
- **Stats** — word count, character count, reading time
- **WhatsApp formats** — .ogg, .opus, .mp3, .m4a, .wav, .webm

## 🚀 Quick Start

```bash
git clone https://github.com/guebly/zap-transcriber.git
cd zap-transcriber
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

## 🌐 Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/guebly/zap-transcriber)

Or manually:

```bash
npm run build
# Upload the `dist/` folder to any static hosting
```

Vercel auto-detects Vite — just connect your repo and it deploys.

## 📱 How to Get WhatsApp Audio

**On mobile:**
1. Long-press the voice message
2. Tap Forward → save it or send to yourself
3. Download the file

**On WhatsApp Web:**
1. Hover over the voice message
2. Click the dropdown arrow → Download

Then drag the file into Zap Transcriber.

## 🛠 Tech Stack

| Tech | Purpose |
|---|---|
| [Vite](https://vitejs.dev) | Build tool & dev server |
| [React 18](https://react.dev) | UI framework |
| [Transformers.js](https://huggingface.co/docs/transformers.js) | ML inference in the browser |
| [Whisper Tiny](https://huggingface.co/openai/whisper-tiny) | Speech recognition model |

## 🧠 How It Works

1. User drops an audio file
2. On first use, the Whisper Tiny model (~75 MB) is downloaded and cached by the browser
3. Audio is processed locally using WebAssembly via Transformers.js
4. Transcription result is displayed — nothing ever leaves the device

## 📁 Project Structure

```
zap-transcriber/
├── public/
│   └── logo.png          # Guebly logo
├── src/
│   ├── main.jsx          # React entry point
│   ├── index.css          # Global styles
│   └── App.jsx            # Main application
├── index.html             # HTML template with SEO meta tags
├── vite.config.js         # Vite configuration
├── package.json           # Dependencies & scripts
├── LICENSE                # MIT License
├── README.md              # This file (English)
└── README.pt-BR.md        # Portuguese docs
```

## 🤝 Contributing

Contributions are welcome! Feel free to:

1. Fork the repo
2. Create a branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'Add my feature'`)
4. Push (`git push origin feature/my-feature`)
5. Open a Pull Request

## 📄 License

MIT — [Guebly](https://www.guebly.com.br)
