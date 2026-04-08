# 🎤 Zap Transcriber

> Transcritor de áudios do WhatsApp que roda **100% no navegador**. Sem backend, sem envio de dados. Open source por [Guebly](https://www.guebly.com.br).

<p align="center">
  <img src="public/logo.png" alt="Guebly" width="80" />
</p>

<p align="center">
  <a href="README.md">🇺🇸 Read in English</a>
</p>

## ✨ Funcionalidades

- **100% client-side** — todo processamento acontece no navegador, nada é enviado para servidores
- **Sem backend** — deploy estático na Vercel, Netlify, GitHub Pages, onde quiser
- **Áudios longos** — suporta mensagens de voz de 3+ minutos
- **Multi-idioma** — Português, Inglês, Espanhol ou detecção automática
- **Dark / Light mode** — alterne entre temas
- **Player de áudio** — ouça antes de transcrever com barra de progresso
- **Exportar** — copie ou baixe como .txt
- **Estatísticas** — contagem de palavras, caracteres e tempo de leitura
- **Formatos WhatsApp** — .ogg, .opus, .mp3, .m4a, .wav, .webm

## 🚀 Início Rápido

```bash
git clone https://github.com/guebly/zap-transcriber.git
cd zap-transcriber
npm install
npm run dev
```

Abra [http://localhost:5173](http://localhost:5173)

## 🌐 Deploy na Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/guebly/zap-transcriber)

Ou manualmente:

```bash
npm run build
# Suba a pasta `dist/` para qualquer hosting estático
```

A Vercel detecta Vite automaticamente — só conectar o repo e pronto.

## 📱 Como Pegar o Áudio do WhatsApp

**No celular:**
1. Segure a mensagem de voz
2. Toque em Encaminhar → salve ou envie para si mesmo
3. Baixe o arquivo

**No WhatsApp Web:**
1. Passe o mouse sobre a mensagem de voz
2. Clique na setinha → Download

Depois arraste o arquivo para o Zap Transcriber.

## 🛠 Stack

| Tecnologia | Uso |
|---|---|
| [Vite](https://vitejs.dev) | Build tool e dev server |
| [React 18](https://react.dev) | Framework de UI |
| [Transformers.js](https://huggingface.co/docs/transformers.js) | Inferência ML no navegador |
| [Whisper Tiny](https://huggingface.co/openai/whisper-tiny) | Modelo de reconhecimento de fala |

## 🧠 Como Funciona

1. Usuário arrasta um arquivo de áudio
2. No primeiro uso, o modelo Whisper Tiny (~75 MB) é baixado e cacheado pelo navegador
3. O áudio é processado localmente via WebAssembly pelo Transformers.js
4. O resultado da transcrição é exibido — nada sai do dispositivo

## 📁 Estrutura do Projeto

```
zap-transcriber/
├── public/
│   └── logo.png           # Logo Guebly
├── src/
│   ├── main.jsx           # Entry point React
│   ├── index.css           # Estilos globais
│   └── App.jsx             # Aplicação principal
├── index.html              # Template HTML com meta tags SEO
├── vite.config.js          # Configuração Vite
├── package.json            # Dependências e scripts
├── LICENSE                 # Licença MIT
├── README.md               # Docs em Inglês
└── README.pt-BR.md         # Este arquivo (Português)
```

## 🤝 Contribuindo

Contribuições são bem-vindas! Sinta-se à vontade para:

1. Fazer fork do repo
2. Criar uma branch (`git checkout -b feature/minha-feature`)
3. Commitar suas mudanças (`git commit -m 'Adiciona minha feature'`)
4. Push (`git push origin feature/minha-feature`)
5. Abrir um Pull Request

## 📄 Licença

MIT — [Guebly](https://www.guebly.com.br)
