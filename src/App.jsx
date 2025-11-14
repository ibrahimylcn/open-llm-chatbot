import { useState, useEffect, useRef } from 'react'

const API_BASE_URL = 'http://localhost:11434' // API base URL'si

function App() {
  // Default modelleri hemen set et
  const defaultModels = [
    'deepseek-r1:14b',
    'deepseek-coder:6.7b',
    'qwen2.5-coder:latest'
  ]

  const [models, setModels] = useState(defaultModels)
  const [selectedModel, setSelectedModel] = useState(defaultModels[0])
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isLoadingModels, setIsLoadingModels] = useState(true)
  const messagesEndRef = useRef(null)
  const abortControllerRef = useRef(null)

  // Model listesini yükle
  useEffect(() => {
    fetchModels()
  }, [])

  // Mesajlar değiştiğinde en alta scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const fetchModels = async () => {
    setIsLoadingModels(true)

    try {
      console.log('API isteği atılıyor:', `${API_BASE_URL}/api/tags`)

      // Timeout ile fetch wrapper
      const fetchWithTimeout = (url, timeout = 5000) => {
        return Promise.race([
          fetch(url),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), timeout)
          )
        ])
      }

      // Önce /api/tags endpoint'ini dene (Ollama native)
      let response = null
      let data = null

      try {
        response = await fetchWithTimeout(`${API_BASE_URL}/api/tags`, 5000)
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`)
        }
        data = await response.json()
        console.log('API yanıtı (/api/tags):', data)
      } catch (error) {
        console.log('/api/tags başarısız, /v1/models deneniyor...', error.message)
        // Eğer /api/tags çalışmazsa /v1/models'ı dene
        try {
          response = await fetchWithTimeout(`${API_BASE_URL}/v1/models`, 5000)
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`)
          }
          data = await response.json()
          console.log('API yanıtı (/v1/models):', data)
        } catch (error2) {
          throw new Error(`Her iki endpoint de başarısız: ${error2.message}`)
        }
      }

      // Farklı API yanıt formatlarını kontrol et
      let modelList = []

      if (data.models && Array.isArray(data.models)) {
        // Ollama native format: { models: [{ name: "model1" }, ...] }
        modelList = data.models.map(m => m.name || m.id || m.model).filter(Boolean)
        console.log('Ollama formatından çıkarılan modeller:', modelList)
      } else if (data.data && Array.isArray(data.data)) {
        // OpenAI format: { data: [{ id: "model1" }, ...] }
        modelList = data.data.map(m => m.id || m.model || m.name).filter(Boolean)
        console.log('OpenAI formatından çıkarılan modeller:', modelList)
      } else if (Array.isArray(data)) {
        // Direkt array format: [{ id: "model1" }, ...]
        modelList = data.map(m => m.id || m.model || m.name).filter(Boolean)
        console.log('Array formatından çıkarılan modeller:', modelList)
      }

      // Eğer API'den model gelmediyse veya boşsa, default modelleri kullan
      if (modelList.length === 0) {
        console.warn('API\'den model gelmedi, default modeller kullanılıyor')
        modelList = defaultModels
      } else {
        console.log('Modeller başarıyla yüklendi:', modelList)
      }

      setModels(modelList)
      setSelectedModel(modelList[0])
    } catch (error) {
      console.error('Model listesi alınamadı:', error)
      console.log('Default modeller kullanılıyor:', defaultModels)
      // Hata durumunda default modelleri kullan (zaten set edilmiş)
      setModels(defaultModels)
      setSelectedModel(defaultModels[0])
    } finally {
      setIsLoadingModels(false)
    }
  }

  const sendMessage = async () => {
    if (!input.trim() || !selectedModel || isLoading) return

    const userMessage = input.trim()
    setInput('')
    setIsLoading(true)

    // Yeni AbortController oluştur
    abortControllerRef.current = new AbortController()
    const signal = abortControllerRef.current.signal

    // Kullanıcı mesajını ekle
    setMessages(prev => [...prev, { role: 'user', content: userMessage }])

    // AI mesajını başlat (boş)
    setMessages(prev => [...prev, { role: 'assistant', content: '' }])

    try {
      // Önce Ollama native endpoint'i dene (streaming için optimize)
      let response = null
      let useOllamaNative = true

      try {
        response = await fetch(`${API_BASE_URL}/api/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: selectedModel,
            prompt: userMessage,
            stream: true,
          }),
          signal: signal,
        })

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
      } catch (error) {
        // Ollama native başarısızsa OpenAI formatını dene
        console.log('Ollama native endpoint başarısız, OpenAI format deneniyor...')
        useOllamaNative = false

        response = await fetch(`${API_BASE_URL}/v1/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: selectedModel,
            prompt: userMessage,
            stream: true,
          }),
          signal: signal,
        })

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
      }

      // Streaming response'u oku
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let fullResponse = ''

      while (true) {
        const { done, value } = await reader.read()

        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // Son tamamlanmamış satırı buffer'da tut

        for (const line of lines) {
          if (line.trim() === '') continue

          try {
            // Ollama native format: "data: {...}\n" veya direkt JSON
            let jsonStr = line
            if (line.startsWith('data: ')) {
              jsonStr = line.slice(6)
            }

            if (jsonStr.trim() === '[DONE]') {
              continue
            }

            const data = JSON.parse(jsonStr)

            let chunk = ''
            if (useOllamaNative) {
              // Ollama format: { response: "...", done: false }
              chunk = data.response || ''
            } else {
              // OpenAI format: { choices: [{ delta: { content: "..." } }] }
              chunk = data.choices?.[0]?.delta?.content || data.choices?.[0]?.text || ''
            }

            if (chunk) {
              fullResponse += chunk
              // Mesajı anlık güncelle
              setMessages(prev => {
                const newMessages = [...prev]
                const lastIndex = newMessages.length - 1
                if (newMessages[lastIndex]?.role === 'assistant') {
                  newMessages[lastIndex] = {
                    role: 'assistant',
                    content: fullResponse
                  }
                }
                return newMessages
              })
            }

            // Eğer done: true ise, stream bitti
            if (useOllamaNative && data.done) {
              break
            }
          } catch (e) {
            // JSON parse hatası, bu chunk'ı atla
            continue
          }
        }
      }

      // Eğer hiçbir şey gelmediyse
      if (fullResponse === '') {
        setMessages(prev => {
          const newMessages = [...prev]
          const lastIndex = newMessages.length - 1
          if (newMessages[lastIndex]?.role === 'assistant') {
            newMessages[lastIndex] = {
              role: 'assistant',
              content: 'Yanıt alınamadı'
            }
          }
          return newMessages
        })
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        // İptal edildi, son mesajı kaldır ve bilgi ver
        setMessages(prev => {
          const newMessages = [...prev]
          // Son assistant mesajını kontrol et ve güncelle
          const lastIndex = newMessages.length - 1
          if (newMessages[lastIndex]?.role === 'assistant' && newMessages[lastIndex]?.content === '') {
            newMessages[lastIndex] = {
              role: 'assistant',
              content: 'İstek durduruldu.'
            }
          } else {
            newMessages.push({
              role: 'assistant',
              content: 'İstek durduruldu.'
            })
          }
          return newMessages
        })
      } else {
        console.error('Mesaj gönderilirken hata:', error)
        setMessages(prev => {
          const newMessages = [...prev]
          const lastIndex = newMessages.length - 1
          if (newMessages[lastIndex]?.role === 'assistant' && newMessages[lastIndex]?.content === '') {
            newMessages[lastIndex] = {
              role: 'assistant',
              content: `Hata: ${error.message}`
            }
          } else {
            newMessages.push({
              role: 'assistant',
              content: `Hata: ${error.message}`
            })
          }
          return newMessages
        })
      }
    } finally {
      setIsLoading(false)
      abortControllerRef.current = null
    }
  }

  const stopMessage = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      setIsLoading(false)
      abortControllerRef.current = null
    }
  }

  const handleKeyPress = (e) => {
    if (e.ctrlKey && e.key === 'Enter') {
      sendMessage()
    }
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header - Model Seçimi */}
      <div className="bg-white border-b border-gray-200 p-4 shadow-sm">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-2xl font-bold text-gray-800 mb-3">AI Chat</h1>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Model Seçimi:
          </label>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="w-full md:w-64 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none bg-white"
            disabled={isLoading || isLoadingModels}
          >
            {isLoadingModels ? (
              <option value={selectedModel}>Model yükleniyor...</option>
            ) : (
              models.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))
            )}
          </select>
          {isLoadingModels && (
            <p className="text-xs text-gray-500 mt-1">API'den modeller yükleniyor...</p>
          )}
        </div>
      </div>

      {/* Mesaj Listesi */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-4xl mx-auto space-y-4">
          {messages.length === 0 ? (
            <div className="text-center text-gray-500 mt-20">
              <p className="text-lg">Hoş geldiniz! 👋</p>
              <p className="text-sm mt-2">Bir soru sorarak başlayabilirsiniz.</p>
            </div>
          ) : (
            messages.map((message, index) => (
              <div
                key={index}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'
                  }`}
              >
                <div
                  className={`max-w-[80%] rounded-lg p-4 ${message.role === 'user'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-200 text-gray-800'
                    }`}
                >
                  <div className="whitespace-pre-wrap break-words">
                    {message.content}
                  </div>
                </div>
              </div>
            ))
          )}

          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-gray-200 rounded-lg p-4">
                <div className="flex space-x-2">
                  <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce"></div>
                  <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                  <div className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Alanı */}
      <div className="bg-white border-t border-gray-200 p-4 shadow-lg">
        <div className="max-w-4xl mx-auto">
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="Mesajınızı yazın... (Ctrl + Enter ile gönder)"
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none"
              rows="2"
              disabled={isLoading}
            />
            {isLoading ? (
              <button
                onClick={stopMessage}
                className="px-6 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors font-medium"
              >
                Durdur
              </button>
            ) : (
              <button
                onClick={sendMessage}
                disabled={!input.trim() || !selectedModel || isLoadingModels}
                className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors font-medium"
              >
                Gönder
              </button>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-2 text-center">
            Ctrl + Enter tuş kombinasyonu ile de gönderebilirsiniz
          </p>
        </div>
      </div>
    </div>
  )
}

export default App

