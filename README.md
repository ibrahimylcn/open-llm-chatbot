# AI Chat App

Local LLM modellerinizle çalışan basit bir AI Chat uygulaması.

## Özellikler

- 🤖 Model seçimi (deepseek-r1:14b, deepseek-coder:6.7b, qwen2.5-coder:latest)
- 💬 Gerçek zamanlı sohbet arayüzü
- ⌨️ Ctrl + Enter ile hızlı gönderim
- ⚡ Loading animasyonları
- 📱 Responsive tasarım

## Kurulum

```bash
npm install
```

## Çalıştırma

```bash
npm run dev
```

Uygulama `http://localhost:5173` adresinde çalışacaktır.

## API Yapılandırması

API Base URL: ``

- `GET /v1/models` - Model listesi
- `POST /v1/completions` - Prompt gönderimi

