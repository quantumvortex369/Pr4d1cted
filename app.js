// Variables globales
let priceChart;
let priceUpdateInterval;
let isWebSocketConnected = false;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache
const cache = {
    priceData: null,
    historicalData: {},
    lastUpdated: {}
};

// Elementos del DOM
const dom = {
    priceChartCtx: document.getElementById('priceChart'),
    timeRangeSelect: document.getElementById('timeRange'),
    currencySelect: document.getElementById('currency'),
    updateChartBtn: document.getElementById('updateChart'),
    currentPriceEl: document.getElementById('currentPrice'),
    priceChange24hEl: document.getElementById('priceChange24h'),
    volume24hEl: document.getElementById('volume24h'),
    fearGreedValueEl: document.getElementById('fear-greed-value'),
    fearGreedBarEl: document.getElementById('fear-greed-bar'),
    rsiValueEl: document.getElementById('rsi-value'),
    macdValueEl: document.getElementById('macd-value'),
    sma7ValueEl: document.getElementById('sma7-value'),
    sma30ValueEl: document.getElementById('sma30-value'),
    predictionShortPrice: document.querySelector('#prediction-short .prediction-price'),
    predictionShortConfidence: document.querySelector('#prediction-short .prediction-confidence-text'),
    predictionShortArrow: document.querySelector('#prediction-short .prediction-arrow'),
    predictionMidPrice: document.querySelector('#prediction-mid .prediction-price'),
    predictionMidConfidence: document.querySelector('#prediction-mid .prediction-confidence-text'),
    predictionMidArrow: document.querySelector('#prediction-mid .prediction-arrow'),
    predictionLongPrice: document.querySelector('#prediction-long .prediction-price'),
    predictionLongConfidence: document.querySelector('#prediction-long .prediction-confidence-text'),
    predictionLongArrow: document.querySelector('#prediction-long .prediction-arrow'),
};

// Estado de la aplicación
const state = {
    currentCurrency: 'usd',
    socket: null,
};

// --- INICIALIZACIÓN ---
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    initializeWebSocket();
    loadFromCache();
    fetchData();
    fetchNews();
    setupServiceWorker();
});

// Configurar Service Worker para soporte offline
function setupServiceWorker() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/service-worker.js')
                .then(registration => {
                    console.log('ServiceWorker registration successful');
                })
                .catch(err => {
                    console.error('ServiceWorker registration failed: ', err);
                });
        });
    }
}

// Inicializar WebSocket para actualizaciones en tiempo real
function initializeWebSocket() {
    console.log('Initializing WebSocket...');
    
    // Primero, verifiquemos si hay un servidor WebSocket disponible
    checkWebSocketAvailability().then(isAvailable => {
        if (isAvailable && window.WebSocket) {
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
            
            console.log('Attempting to connect to WebSocket at:', wsUrl);
            
            try {
                state.socket = new WebSocket(wsUrl);
                
                state.socket.onopen = () => {
                    console.log('WebSocket connected successfully');
                    isWebSocketConnected = true;
                    updateConnectionStatus(true);
                    showSuccess('Conexión en tiempo real establecida');
                };
                
                state.socket.onmessage = (event) => {
                    console.log('WebSocket message received:', event.data);
                    try {
                        const data = JSON.parse(event.data);
                        if (data.type === 'priceUpdate') {
                            updateRealTimePrice(data.payload);
                        }
                    } catch (e) {
                        console.error('Error parsing WebSocket message:', e);
                    }
                };
                
                state.socket.onclose = (event) => {
                    console.log(`WebSocket disconnected. Code: ${event.code}, Reason: ${event.reason}`);
                    isWebSocketConnected = false;
                    updateConnectionStatus(false);
                    
                    // Mostrar mensaje al usuario
                    if (event.code === 1006) {
                        showError('Error de conexión con el servidor. Reintentando...');
                    }
                    
                    // Intentar reconectar después de un retraso exponencial
                    const delay = Math.min(30000, 1000 * Math.pow(2, state.reconnectAttempts || 1));
                    console.log(`Reconnecting in ${delay}ms...`);
                    state.reconnectAttempts = (state.reconnectAttempts || 0) + 1;
                    
                    setTimeout(() => {
                        console.log('Attempting to reconnect...');
                        initializeWebSocket();
                    }, delay);
                };
                
                state.socket.onerror = (error) => {
                    console.error('WebSocket error:', error);
                    isWebSocketConnected = false;
                    updateConnectionStatus(false);
                    showError('Error de conexión. Verifica tu conexión a internet.');
                };
                
                // Configurar ping/pong para mantener la conexión activa
                const pingInterval = setInterval(() => {
                    if (state.socket && state.socket.readyState === WebSocket.OPEN) {
                        state.socket.send(JSON.stringify({ type: 'ping' }));
                    } else {
                        clearInterval(pingInterval);
                    }
                }, 30000);
                
            } catch (error) {
                console.error('Error initializing WebSocket:', error);
                isWebSocketConnected = false;
                updateConnectionStatus(false);
                showError('No se pudo conectar al servidor en tiempo real');
            }
        } else {
            console.warn('WebSocket not available, falling back to polling');
            isWebSocketConnected = false;
            updateConnectionStatus(false);
            startPolling();
        }
    }).catch(error => {
        console.error('Error checking WebSocket availability:', error);
        isWebSocketConnected = false;
        updateConnectionStatus(false);
        startPolling();
    });
}

// Verificar disponibilidad del WebSocket
async function checkWebSocketAvailability() {
    try {
        // Primero intentamos con una solicitud HTTP/HTTPS
        const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
        const response = await fetch(`${protocol}//${window.location.host}/health`);
        return response.ok;
    } catch (error) {
        console.log('HTTP health check failed, trying WebSocket directly...');
        return new Promise((resolve) => {
            const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const testWs = new WebSocket(`${wsProtocol}//${window.location.host}/ws`);
            
            testWs.onopen = () => {
                testWs.close();
                resolve(true);
            };
            
            testWs.onerror = () => {
                resolve(false);
            };
            
            // Timeout después de 3 segundos
            setTimeout(() => {
                testWs.close();
                resolve(false);
            }, 3000);
        });
    }
}

// Iniciar polling como alternativa a WebSocket
function startPolling() {
    console.log('Starting polling as fallback...');
    // Limpiar cualquier intervalo existente
    if (priceUpdateInterval) {
        clearInterval(priceUpdateInterval);
    }
    
    // Obtener datos inmediatamente
    fetchData();
    
    // Configurar polling cada 30 segundos
    priceUpdateInterval = setInterval(() => {
        console.log('Polling for updates...');
        fetchData();
    }, 30000);
    
    showInfo('Usando actualizaciones periódicas (cada 30 segundos)');
}

// Actualizar el estado de conexión en la UI
function updateConnectionStatus(isConnected) {
    const statusElement = document.getElementById('connectionStatus');
    if (statusElement) {
        const icon = isConnected ? 'fa-check-circle' : 'fa-exclamation-circle';
        const text = isConnected ? 'En línea' : 'Desconectado';
        const bgClass = isConnected ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400';
        
        statusElement.innerHTML = `
            <i class="fas ${icon} mr-1"></i>
            <span>${text}</span>
        `;
        statusElement.className = `text-sm px-3 py-1 rounded-full flex items-center ${bgClass} transition-colors`;
        
        // Añadir animación de conexión exitosa
        if (isConnected) {
            statusElement.classList.add('animate-pulse');
            setTimeout(() => statusElement.classList.remove('animate-pulse'), 2000);
        }
    }
}

// Mostrar notificación informativa
function showInfo(message, duration = 5000) {
    const infoDiv = document.createElement('div');
    infoDiv.className = 'fixed bottom-4 right-4 bg-blue-600 text-white px-6 py-3 rounded-lg shadow-lg flex items-center space-x-3 z-50 animate-fadeIn';
    infoDiv.innerHTML = `
        <i class="fas fa-info-circle text-xl"></i>
        <span>${message}</span>
    `;
    
    document.body.appendChild(infoDiv);
    
    // Auto-ocultar después de la duración
    setTimeout(() => {
        infoDiv.classList.add('opacity-0', 'transition-opacity', 'duration-300');
        setTimeout(() => infoDiv.remove(), 300);
    }, duration);
}

// Cargar datos desde la caché
function loadFromCache() {
    const cachedData = localStorage.getItem('bitcoinPredictorCache');
    if (cachedData) {
        try {
            const parsedData = JSON.parse(cachedData);
            const { data, timestamp } = parsedData;
            
            // Verificar si los datos en caché son recientes
            if (Date.now() - timestamp < CACHE_DURATION) {
                cache.priceData = data.priceData;
                cache.historicalData = data.historicalData;
                cache.lastUpdated = data.lastUpdated;
                
                // Actualizar la UI con los datos en caché
                if (cache.priceData) {
                    updatePriceDisplay(cache.priceData);
                }
                if (cache.historicalData[state.currentCurrency]) {
                    processAndRenderData(
                        cache.historicalData[state.currentCurrency],
                        cache.priceData,
                        state.currentCurrency
                    );
                }
                return true;
            }
        } catch (e) {
            console.error('Error loading from cache:', e);
            localStorage.removeItem('bitcoinPredictorCache');
        }
    }
    return false;
}

// Guardar datos en la caché
function saveToCache() {
    try {
        const cacheData = {
            priceData: cache.priceData,
            historicalData: cache.historicalData,
            lastUpdated: cache.lastUpdated,
            timestamp: Date.now()
        };
        localStorage.setItem('bitcoinPredictorCache', JSON.stringify(cacheData));
    } catch (e) {
        console.error('Error saving to cache:', e);
    }
}

function setupEventListeners() {
    dom.updateChartBtn.addEventListener('click', () => fetchData());
    dom.timeRangeSelect.addEventListener('change', () => fetchData());
    dom.currencySelect.addEventListener('change', () => {
        state.currentCurrency = dom.currencySelect.value;
        fetchData();
    });

    const exportBtn = document.getElementById('export-btn');
    exportBtn.addEventListener('click', exportDataToCSV);

    const refreshNewsBtn = document.getElementById('refresh-news-btn');
    refreshNewsBtn.addEventListener('click', fetchNews);
}

// --- OBTENCIÓN DE DATOS ---
async function fetchRealTimePrice(currency) {
    try {
        setLoadingState(true, 'priceTicker');
        
        // Mostrar datos en caché mientras se cargan los nuevos
        if (cache.priceData) {
            updatePriceDisplay(cache.priceData);
        }
        
        // Try Binance first
        const binanceSymbol = `BTC${currency.toUpperCase()}`;
        const binanceResponse = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbol}`);
        
        if (binanceResponse.ok) {
            return await binanceResponse.json();
        }
        
        // If Binance fails, try CoinGecko
        console.warn('Binance API falló, intentando con CoinGecko...');
        const coingeckoResponse = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=${currency}`);
        
        if (!coingeckoResponse.ok) {
            throw new Error('CoinGecko API falló');
        }
        
        const data = await coingeckoResponse.json();
        if (!data.bitcoin || data.bitcoin[currency] === undefined) {
            throw new Error('Formato de respuesta inesperado de CoinGecko');
        }
        
        return { 
            symbol: `BTC${currency.toUpperCase()}`,
            price: data.bitcoin[currency],
            source: 'coingecko'
        };
        
    } catch (error) {
        console.error('Error en fetchRealTimePrice:', error);
        showError('No se pudo cargar el precio actual. Intentando de nuevo...');
        
        // Reintentar después de un retraso
        setTimeout(() => fetchRealTimePrice(currency), 30000);
        
        // Devolver datos en caché si están disponibles
        return cache.priceData || null;
    } finally {
        setLoadingState(false, 'priceTicker');
    }
}

async function fetchHistoricalData(days, currency) {
    try {
        // First try Binance
        const endTime = Date.now();
        const startTime = endTime - (days * 24 * 60 * 60 * 1000);
        const interval = days <= 1 ? '15m' : days <= 7 ? '1h' : days <= 30 ? '4h' : '1d';
        const binanceSymbol = `BTC${currency.toUpperCase()}`;
        
        const binanceResponse = await fetch(
            `https://api.binance.com/api/v3/klines?` + 
            `symbol=${binanceSymbol}&interval=${interval}&` +
            `startTime=${startTime}&endTime=${endTime}&limit=1000`
        );
        
        if (binanceResponse.ok) {
            const klines = await binanceResponse.json();
            if (Array.isArray(klines) && klines.length > 0) {
                return klines.map(k => ({
                    time: k[0],
                    open: parseFloat(k[1]),
                    high: parseFloat(k[2]),
                    low: parseFloat(k[3]),
                    close: parseFloat(k[4]),
                    volume: parseFloat(k[5])
                }));
            }
        }
        
        // If Binance fails, try CoinGecko
        console.warn('Binance klines API falló, intentando con CoinGecko...');
        const coingeckoResponse = await fetch(
            `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?` +
            `vs_currency=${currency}&days=${days}&interval=daily`
        );
        
        if (!coingeckoResponse.ok) {
            throw new Error('CoinGecko API falló');
        }
        
        const data = await coingeckoResponse.json();
        if (!data.prices || !Array.isArray(data.prices) || data.prices.length === 0) {
            throw new Error('Datos históricos no disponibles');
        }
        
        // Process CoinGecko data to match our format
        return data.prices.map(([time, price], i) => ({
            time,
            close: price,
            open: i > 0 ? data.prices[i-1][1] : price,
            high: data.prices[i][1] * 1.001, // Approximate high
            low: data.prices[i][1] * 0.999,  // Approximate low
            volume: data.total_volumes && data.total_volumes[i] ? data.total_volumes[i][1] : 0,
            source: 'coingecko'
        }));
        
    } catch (error) {
        console.error('Error al obtener datos históricos:', error);
        return null; // Return null to indicate failure
    }
}

async function fetchData() {
    let priceData = null;
    let historicalData = null;
    let fearAndGreed = null;
    const currency = state.currentCurrency;
    const days = parseInt(dom.timeRangeSelect.value);
    
    try {
        setLoadingState(true, 'priceTicker');
        
        // Mostrar indicador de actualización
        updateLastUpdated('Actualizando datos...');
        
        // Pequeña pausa para evitar límites de tasa
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Obtener datos en paralelo con manejo de errores individual
        await Promise.allSettled([
            fetchRealTimePrice(currency).then(data => {
                priceData = data;
                // Actualizar caché si los datos son válidos
                if (priceData) {
                    cache.priceData = priceData;
                    cache.lastUpdated = new Date().toISOString();
                }
            }).catch(error => {
                console.error('Error al obtener el precio actual:', error);
                showError('No se pudo actualizar el precio. Usando datos en caché.');
                priceData = cache.priceData;
            }),
            
            fetchHistoricalData(days, currency).then(data => {
                historicalData = data;
                // Actualizar caché si los datos son válidos
                if (historicalData) {
                    cache.historicalData[currency] = historicalData;
                }
            }).catch(error => {
                console.error('Error al obtener datos históricos:', error);
                showError('No se pudieron actualizar los datos históricos. Usando caché.');
                historicalData = cache.historicalData[currency];
            }),
            
            fetchFearAndGreedIndex().then(data => {
                fearAndGreed = data;
            }).catch(error => {
                console.error('Error al obtener el índice de miedo y codicia:', error);
                fearAndGreed = { value: 50, value_classification: 'Neutral' };
            })
        ]);
        
        // Si no hay datos en absoluto, lanzar error
        if (!priceData && !historicalData) {
            throw new Error('No se pudieron cargar los datos. Verifica tu conexión a internet.');
        }
        
        // Guardar en caché si tenemos datos nuevos
        saveToCache();
        
        // Procesar y mostrar los datos
        processAndRenderData(
            historicalData || [],
            priceData || { price: 0 },
            currency,
            fearAndGreed || { value: 50, value_classification: 'Datos no disponibles' }
        );
        
        // Actualizar la última actualización
        updateLastUpdated(`Última actualización: ${new Date().toLocaleTimeString()}`);
        
        return { 
            priceData: priceData || cache.priceData, 
            historicalData: historicalData || cache.historicalData[currency], 
            fearAndGreed: fearAndGreed || { value: 50, value_classification: 'Datos no disponibles' } 
        };
        
    } catch (error) {
        console.error('Error en fetchData:', error);
        
        // Mostrar mensaje de error específico si es posible
        const errorMessage = error.message || 'Error al cargar los datos';
        showError(`Error: ${errorMessage}`);
        
        // Intentar cargar datos en caché si hay un error
        const hasCachedData = cache.priceData || (cache.historicalData[currency] && cache.historicalData[currency].length > 0);
        
        if (hasCachedData) {
            showInfo('Mostrando datos en caché');
            processAndRenderData(
                cache.historicalData[currency] || [],
                cache.priceData || { price: 0 },
                currency,
                { value: 50, value_classification: 'Datos en caché' }
            );
            
            return {
                priceData: cache.priceData,
                historicalData: cache.historicalData[currency],
                fearAndGreed: { value: 50, value_classification: 'Datos en caché' }
            };
        }
        
        // Si no hay datos en caché, mostrar error más detallado
        showError('No se pudieron cargar los datos. Por favor, verifica tu conexión a internet.');
        return null;
        
    } finally {
        setLoadingState(false, 'priceTicker');
    }
}

// Función auxiliar para actualizar el texto de última actualización
function updateLastUpdated(text) {
    const lastUpdatedEl = document.getElementById('lastUpdated');
    if (lastUpdatedEl) {
        if (text.includes('Actualizando')) {
            lastUpdatedEl.innerHTML = `
                <i class="fas fa-sync-alt fa-spin mr-1"></i>
                <span>${text}</span>
            `;
        } else {
            lastUpdatedEl.innerHTML = `
                <i class="far fa-clock mr-1"></i>
                <span>${text}</span>
            `;
        }
    }
}

async function fetchFearAndGreedIndex() {
    try {
        const response = await fetch('https://api.alternative.me/fng/?limit=1');
        const data = await response.json();
        return data.data[0];
    } catch (error) {
        console.error('Error al obtener el índice de Miedo y Codicia:', error);
        return { value: 50, value_classification: 'Neutral' }; // Valor neutral por defecto
    }
}

// --- PROCESAMIENTO Y RENDERIZADO ---
function processAndRenderData(historicalData, priceData, currency, fearAndGreed) {
    const currentPrice = parseFloat(priceData.price);
    const currencySymbol = getCurrencySymbol(currency);

    // Actualizar UI principal
    dom.currentPriceEl.textContent = `${currencySymbol}${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const priceChange24h = ((currentPrice - historicalData[0].open) / historicalData[0].open) * 100;
    dom.priceChange24hEl.textContent = `${priceChange24h.toFixed(2)}%`;
    dom.priceChange24hEl.className = `ml-2 text-sm px-2 py-1 rounded ${priceChange24h >= 0 ? 'bg-green-500 bg-opacity-20 text-green-400' : 'bg-red-500 bg-opacity-20 text-red-400'}`;
    const volume24h = historicalData.reduce((sum, d) => sum + d.volume, 0);
    dom.volume24hEl.textContent = `${currencySymbol}${formatLargeNumber(volume24h)}`;

    // Renderizar gráfico
    const chartLabels = historicalData.map(d => new Date(d.time));
    const chartData = historicalData.map(d => ({ x: d.time, y: d.close }));
    renderChart(chartLabels, chartData, currencySymbol);

    // Calcular y mostrar predicciones
    const shortTermPrediction = generateAdvancedPrediction(historicalData.slice(-96), currentPrice, fearAndGreed); // 96 puntos (1 día en velas de 15m) para corto plazo
    const midTermPrediction = generateAdvancedPrediction(historicalData.slice(-240), currentPrice, fearAndGreed); // 240 puntos (10 días en velas de 1h) para medio plazo
    const longTermPrediction = generateAdvancedPrediction(historicalData, currentPrice, fearAndGreed); // Todos los datos para largo plazo

    updatePredictionCard('short', shortTermPrediction, currencySymbol);
    updatePredictionCard('mid', midTermPrediction, currencySymbol);
    updatePredictionCard('long', longTermPrediction, currencySymbol);

    // Actualizar panel de indicadores y sentimiento
    const prices = historicalData.map(d => d.close);
    const sma7 = calculateSMA(prices, 7).slice(-1)[0];
    const sma30 = calculateSMA(prices, 30).slice(-1)[0];
    updateIndicatorsPanel({ rsi: longTermPrediction.details.RSI, macd: longTermPrediction.details.MACD, sma7, sma30 });
    updateFearGreedPanel(fearAndGreed);

    // Guardar datos históricos en el estado
    state.historicalData = historicalData;

    // Renderizar historial de precios
    renderPriceHistory(historicalData, currencySymbol);
}

function renderChart(labels, data, currencySymbol) {
    try {
        // Validar que el contexto del canvas esté disponible
        if (!dom.priceChartCtx) {
            console.error('No se encontró el elemento canvas para el gráfico');
            return;
        }

        // Validar que haya datos para mostrar
        if (!Array.isArray(data) || data.length === 0) {
            console.error('No hay datos válidos para mostrar en el gráfico');
            const container = dom.priceChartCtx.closest('.chart-container');
            if (container) {
                container.innerHTML = `
                    <div class="text-red-400 p-4 bg-red-900 bg-opacity-30 rounded-lg">
                        No se pudieron cargar los datos del gráfico. Por favor, intenta recargar la página.
                    </div>
                `;
            }
            return;
        }

        // Destruir el gráfico anterior si existe
        if (priceChart) {
            priceChart.destroy();
        }

        // Verificar que el contexto 2D esté disponible
        const ctx = dom.priceChartCtx.getContext('2d');
        if (!ctx) {
            console.error('No se pudo obtener el contexto 2D del canvas');
            return;
        }

        // Crear una copia de los datos para no modificar el original
        const chartData = [...data];
        
        // Configurar opciones del gráfico
        const options = {
            type: 'line',
            data: {
                datasets: [{
                    label: `Precio de Bitcoin (${currencySymbol})`,
                    data: chartData,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 6,
                    tension: 0.1,
                    fill: true,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            unit: 'day',
                            tooltipFormat: 'll HH:mm'
                        },
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: { color: '#94a3b8' },
                    },
                    y: {
                        grid: { color: 'rgba(255, 255, 255, 0.05)' },
                        ticks: {
                            color: '#94a3b8',
                            callback: (value) => `${currencySymbol}${value.toLocaleString()}`
                        }
                    }
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        callbacks: {
                            label: (context) => `Precio: ${currencySymbol}${context.parsed.y.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                        }
                    }
                },
                interaction: { 
                    mode: 'nearest', 
                    axis: 'x', 
                    intersect: false 
                }
            }
        };

        // Crear el gráfico
        priceChart = new Chart(ctx, options);
        
    } catch (error) {
        console.error('Error al renderizar el gráfico:', error);
        if (dom.priceChartCtx) {
            const container = dom.priceChartCtx.closest('.chart-container');
            if (container) {
                container.innerHTML = `
                    <div class="text-red-400 p-4 bg-red-900 bg-opacity-30 rounded-lg">
                        Error al cargar el gráfico: ${error.message}
                    </div>
                `;
            }
        }
    }
                tension: 0.1,
                fill: true,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'day',
                        tooltipFormat: 'll HH:mm'
                    },
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: { color: '#94a3b8' },
                },
                y: {
                    grid: { color: 'rgba(255, 255, 255, 0.05)' },
                    ticks: {
                        color: '#94a3b8',
                        callback: (value) => `${currencySymbol}${value.toLocaleString()}`
                    }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: (context) => `Precio: ${currencySymbol}${context.parsed.y.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                    }
                }
            },
            interaction: { mode: 'nearest', axis: 'x', intersect: false },
        }
    });
}

function updatePredictionCard(term, prediction, currencySymbol) {
    const priceEl = dom[`prediction${term.charAt(0).toUpperCase() + term.slice(1)}Price`];
    const confidenceEl = dom[`prediction${term.charAt(0).toUpperCase() + term.slice(1)}Confidence`];
    const arrowEl = dom[`prediction${term.charAt(0).toUpperCase() + term.slice(1)}Arrow`];

    if (!priceEl || !confidenceEl || !arrowEl) return;

    if (prediction && prediction.predictedPrice) {
        priceEl.textContent = `${currencySymbol}${prediction.predictedPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        confidenceEl.textContent = `${prediction.confidence.toFixed(0)}% Confianza`;
        
        arrowEl.classList.remove('fa-arrow-up', 'fa-arrow-down', 'fa-minus', 'text-green-500', 'text-red-500', 'text-gray-500');
        if (prediction.trend === 'Alcista') {
            arrowEl.classList.add('fa-arrow-up', 'text-green-500');
        } else if (prediction.trend === 'Bajista') {
            arrowEl.classList.add('fa-arrow-down', 'text-red-500');
        } else {
            arrowEl.classList.add('fa-minus', 'text-gray-500');
        }
    } else {
        priceEl.textContent = 'N/A';
        confidenceEl.textContent = 'Datos insuficientes';
        arrowEl.className = 'fas fa-minus text-gray-500 prediction-arrow';
    }
}

function updateIndicatorsPanel({ rsi, macd, sma7, sma30 }) {
    dom.rsiValueEl.textContent = rsi ? rsi.toFixed(2) : 'N/A';
    dom.macdValueEl.textContent = macd ? macd.toFixed(2) : 'N/A';
    dom.sma7ValueEl.textContent = sma7 ? sma7.toLocaleString(undefined, { minimumFractionDigits: 2 }) : 'N/A';
    dom.sma30ValueEl.textContent = sma30 ? sma30.toLocaleString(undefined, { minimumFractionDigits: 2 }) : 'N/A';
}

function updateFearGreedPanel(fearAndGreed) {
    if (!fearAndGreed) return;
    dom.fearGreedValueEl.textContent = `${fearAndGreed.value} - ${fearAndGreed.value_classification}`;
    dom.fearGreedBarEl.style.width = `${fearAndGreed.value}%`;
    
    const colors = {
        'Extreme Fear': 'bg-red-600',
        'Fear': 'bg-yellow-500',
        'Neutral': 'bg-gray-400',
        'Greed': 'bg-green-400',
        'Extreme Greed': 'bg-green-600',
    };
    dom.fearGreedBarEl.className = `h-full rounded-full ${colors[fearAndGreed.value_classification] || 'bg-gray-400'}`;
}

// Función para calcular la media móvil simple
function calculateSMA(prices, period) {
    const result = [];
    for (let i = period - 1; i < prices.length; i++) {
        const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
        result.push(sum / period);
    }
    return result;
}

// Función para calcular la desviación estándar
function calculateStdDev(prices, mean) {
    const squareDiffs = prices.map(price => Math.pow(price - mean, 2));
    return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / prices.length);
}

function processAndRenderData(historicalData, priceData, currency, fearAndGreed) {
    const currentPrice = parseFloat(priceData.price);
    const currencySymbol = getCurrencySymbol(currency);

    // Actualizar UI principal
    dom.currentPriceEl.textContent = `${currencySymbol}${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const priceChange24h = ((currentPrice - historicalData[0].open) / historicalData[0].open) * 100;
    dom.priceChange24hEl.textContent = `${priceChange24h.toFixed(2)}%`;
    dom.priceChange24hEl.className = `ml-2 text-sm px-2 py-1 rounded ${priceChange24h >= 0 ? 'bg-green-500 bg-opacity-20 text-green-400' : 'bg-red-500 bg-opacity-20 text-red-400'}`;
    const volume24h = historicalData.reduce((sum, d) => sum + d.volume, 0);
    dom.volume24hEl.textContent = `${currencySymbol}${formatLargeNumber(volume24h)}`;

    // Renderizar gráfico
    const chartLabels = historicalData.map(d => new Date(d.time));
    const chartData = historicalData.map(d => ({ x: d.time, y: d.close }));

    // 3. Bandas de Bollinger
    if (lastPrice < lowerBand.slice(-1)[0]) score += 20; // Precio toca banda inferior -> posible rebote
    if (lastPrice > upperBand.slice(-1)[0]) score -= 20; // Precio toca banda superior -> posible corrección
    const bandWidth = (upperBand.slice(-1)[0] - lowerBand.slice(-1)[0]) / middleBand.slice(-1)[0];
    confidence += (1 - Math.min(bandWidth, 0.1) * 10) * 15; // Bandas estrechas -> alta confianza

    // 4. Índice de Miedo y Codicia
    if (fearAndGreed.value < 25) score += 25; // Miedo extremo -> oportunidad de compra
    if (fearAndGreed.value > 75) score -= 25; // Codicia extrema -> posible corrección
    confidence += Math.abs(50 - fearAndGreed.value) * 0.4;

    // Normalizar puntuación y confianza
    score = Math.max(-100, Math.min(100, score));
    confidence = Math.max(40, Math.min(95, confidence));

    // Generar predicción basada en la puntuación
    const predictedChange = (score / 100) * 0.05; // Predicción de cambio porcentual máximo del 5%
    const predictedPrice = currentPrice * (1 + predictedChange);

    return {
        predictedPrice,
        confidence,
        trend: score > 10 ? 'Alcista' : score < -10 ? 'Bajista' : 'Neutral',
        details: { RSI: rsi, MACD: lastMacd, Bollinger: bandWidth, FearGreed: fearAndGreed.value }
    };
}

// --- FUNCIONES DE CÁLCULO DE INDICADORES ---
function calculateSMA(prices, period) {
    const result = [];
    for (let i = period - 1; i < prices.length; i++) {
        const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
        result.push(sum / period);
    }
    return result;
}

function calculateStdDev(prices, mean) {
    const squareDiffs = prices.map(price => Math.pow(price - mean, 2));
    return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / prices.length);
}

function calculateEMA(prices, period) {
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    const emas = [ema];
    for (let i = period; i < prices.length; i++) {
        ema = (prices[i] * k) + (ema * (1 - k));
        emas.push(ema);
    }
    return emas;
}

function calculateMACD(prices, shortPeriod = 12, longPeriod = 26, signalPeriod = 9) {
    const emaShort = calculateEMA(prices, shortPeriod);
    const emaLong = calculateEMA(prices, longPeriod);
    const macdLine = emaShort.slice(longPeriod - shortPeriod).map((e, i) => e - emaLong[i]);
    const signalLine = calculateEMA(macdLine, signalPeriod);
    const histogram = macdLine.slice(signalPeriod - 1).map((m, i) => m - signalLine[i]);
    return { macdLine, signalLine, histogram };
}

function calculateBollingerBands(prices, period = 20, stdDevFactor = 2) {
    const sma = calculateSMA(prices, period);
    const stdDevs = [];
    for (let i = 0; i < sma.length; i++) {
        const priceSlice = prices.slice(i, i + period);
        const stdDev = calculateStdDev(priceSlice, sma[i]);
        stdDevs.push(stdDev);
    }
    
    const upperBand = sma.map((s, i) => s + (stdDevs[i] * stdDevFactor));
    const lowerBand = sma.map((s, i) => s - (stdDevs[i] * stdDevFactor));
    
    return { middleBand: sma, upperBand, lowerBand };
}

function calculateRSI(prices, period = 14) {
    let gains = 0;
    let losses = 0;
    const rsi = [];

    for (let i = 1; i < prices.length; i++) {
        const delta = prices[i] - prices[i - 1];
        if (delta > 0) {
            gains += delta;
        } else {
            losses -= delta;
        }

        if (i >= period) {
            const rs = (gains / period) / (losses / period);
            rsi.push(100 - (100 / (1 + rs)));

            const prevDelta = prices[i - period + 1] - prices[i - period];
            if (prevDelta > 0) {
                gains -= prevDelta;
            } else {
                losses += prevDelta;
            }
        }
    }
    return rsi;
}

// --- FUNCIONES UTILITARIAS ---
function getCurrencySymbol(currency) {
    const symbols = { 'usd': '$', 'eur': '€', 'gbp': '£' };
    return symbols[currency] || currency.toUpperCase();
}

function formatLargeNumber(num) {
    if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
    if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
    return num.toFixed(2);
}

function formatLargeNumber(num) {
    if (num >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
    if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
    if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
    return num.toFixed(2);
}

function setLoadingState(isLoading, elementId = null) {
    if (elementId) {
        const element = document.getElementById(elementId);
        if (element) {
            if (isLoading) {
                element.classList.add('opacity-50', 'pointer-events-none');
                element.insertAdjacentHTML('beforeend', 
                    '<div class="absolute inset-0 flex items-center justify-center">' +
                    '  <div class="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-blue-500"></div>' +
                    '</div>');
            } else {
                element.classList.remove('opacity-50', 'pointer-events-none');
                const spinner = element.querySelector('.animate-spin');
                if (spinner) spinner.remove();
            }
        }
    } else {
        const buttons = document.querySelectorAll('button, .btn');
        buttons.forEach(btn => {
            if (isLoading) {
                btn.setAttribute('disabled', 'true');
                btn.classList.add('opacity-75');
            } else {
                btn.removeAttribute('disabled');
                btn.classList.remove('opacity-75');
            }
        });
    }
} {
    dom.updateChartBtn.disabled = isLoading;
    dom.updateChartBtn.innerHTML = isLoading ? '<div class="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>' : 'Actualizar';
}

// --- NOTICIAS ---
async function fetchNews() {
    const newsContainer = document.getElementById('news-container');
    newsContainer.innerHTML = '<div class="animate-spin rounded-full h-5 w-5 border-b-2 border-white mx-auto"></div>';

    try {
        const response = await fetch('https://min-api.cryptocompare.com/data/v2/news/?lang=EN&categories=BTC,Blockchain');
        const data = await response.json();
        const news = data.Data.slice(0, 5);

        newsContainer.innerHTML = '';
        news.forEach(article => {
            const newsItem = document.createElement('div');
            newsItem.className = 'p-4 border-b border-gray-700';
            newsItem.innerHTML = `
                <a href="${article.url}" target="_blank" rel="noopener noreferrer" class="hover:text-blue-400">
                    <h4 class="font-semibold">${article.title}</h4>
                    <p class="text-xs text-gray-400">${article.source_info.name} - ${new Date(article.published_on * 1000).toLocaleDateString()}</p>
                </a>
            `;
            newsContainer.appendChild(newsItem);
        });
    } catch (error) {
        console.error('Error al obtener noticias:', error);
        newsContainer.innerHTML = '<p class="text-center text-red-400">No se pudieron cargar las noticias.</p>';
    }
}

function exportDataToCSV() {
    const historicalData = state.historicalData;
    if (!historicalData || historicalData.length === 0) {
        alert('No hay datos para exportar.');
        return;
    }

    const headers = ['Fecha', 'Precio', 'Volumen'];
    const csvContent = [
        headers.join(','),
        ...historicalData.map(d => {
            const date = new Date(d.time).toLocaleString();
            const price = d.close;
            const volume = d.volume;
            return [date, price, volume].join(',');
        })
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'bitcoin_price_history.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// --- HISTORIAL DE PRECIOS ---
let historicalPage = 1;
const rowsPerPage = 10;

function renderPriceHistory(historicalData, currencySymbol) {
    const historyTableBody = document.getElementById('price-history-body');
    const paginationControls = document.getElementById('pagination-controls');
    historyTableBody.innerHTML = '';
    paginationControls.innerHTML = '';

    const startIndex = (historicalPage - 1) * rowsPerPage;
    const endIndex = startIndex + rowsPerPage;
    const paginatedData = historicalData.slice(startIndex, endIndex);

    paginatedData.forEach(data => {
        const row = document.createElement('tr');
        const date = new Date(data.time).toLocaleString();
        const price = `${currencySymbol}${data.close.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
        const volume = `${currencySymbol}${formatLargeNumber(data.volume)}`;

        row.innerHTML = `
            <td class="px-4 py-2">${date}</td>
            <td class="px-4 py-2">${price}</td>
            <td class="px-4 py-2">${volume}</td>
        `;
        historyTableBody.appendChild(row);
    });

    // Controles de paginación
    const totalPages = Math.ceil(historicalData.length / rowsPerPage);
    for (let i = 1; i <= totalPages; i++) {
        const pageButton = document.createElement('button');
        pageButton.textContent = i;
        pageButton.className = `px-3 py-1 rounded ${i === historicalPage ? 'bg-blue-500 text-white' : 'bg-gray-700'}`;
        pageButton.addEventListener('click', () => {
            historicalPage = i;
            renderPriceHistory(historicalData, currencySymbol);
        });
        paginationControls.appendChild(pageButton);
    }
}
