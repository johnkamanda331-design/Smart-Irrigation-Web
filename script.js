let ip = localStorage.getItem("esp32_ip") || "";
let autoRefreshIntervalId = null;
let currentTheme = localStorage.getItem("theme") || "light";
let latitude = localStorage.getItem("weather_latitude") || "";
let longitude = localStorage.getItem("weather_longitude") || "";
let rainThreshold = parseInt(localStorage.getItem("rain_threshold")) || 50;
let forceIPMode = localStorage.getItem("force_ip_mode") === "true";
let weatherFetchTimestamp = localStorage.getItem("weather_last_update") ? new Date(localStorage.getItem("weather_last_update")) : null;
let autoRefreshEnabled = localStorage.getItem("auto_refresh_enabled") !== "false";
let autoRefreshIntervalMs = parseInt(localStorage.getItem("auto_refresh_interval_ms")) || 30000;
let failedFetchCount = 0;
let trendMetric = "soil";
let trendChart = null;
let historicalData = [];
const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const lastSensorDataKey = "last_sensor_data";
const weatherDataKey = "weather_data";
const trendHistoryKey = "trend_history";
const maxHistoryPoints = 144; // around 24h at 10-minute refresh

// Alert thresholds
const ALERT_THRESHOLDS = { soil: 20, battery: 15, solar: 5 };

// Event logging
let eventLog = JSON.parse(localStorage.getItem('event_log') || '[]');
let lastData = null;
let irrigationStartTime = null;

// Performance optimization
let lastFetchTime = 0;
const MIN_FETCH_INTERVAL = 2000; // Minimum 2 seconds between fetches
let cachedResponse = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 5000; // Cache for 5 seconds

// Simple password protection
const PASSWORD_HASH = "$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi"; // bcrypt hash of "password123"
let passwordAttempts = 0;
const maxPasswordAttempts = 3;

function isAuthenticated() {
  return localStorage.getItem("access_hash") === PASSWORD_HASH;
}

function showLoginModal() {
  const modal = document.getElementById('loginModal');
  if (modal) {
    modal.style.display = 'flex';
  }
}

function hideLoginModal() {
  const modal = document.getElementById('loginModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

function updateLoginError(message) {
  const errorEl = document.getElementById('loginError');
  if (errorEl) {
    errorEl.textContent = message;
  }
}

// Alert functions
function showAlert(message) {
  const banner = document.getElementById('alertBanner');
  const messageEl = document.getElementById('alertMessage');
  if (banner && messageEl) {
    messageEl.textContent = message;
    banner.style.display = 'flex';
  }
}

function dismissAlert() {
  const banner = document.getElementById('alertBanner');
  if (banner) {
    banner.style.display = 'none';
  }
}

function checkAlerts(data) {
  let alerts = [];
  if (data.soil_moisture < ALERT_THRESHOLDS.soil) alerts.push(`Soil moisture critically low: ${data.soil_moisture}%`);
  if (data.battery_voltage < ALERT_THRESHOLDS.battery) alerts.push(`Battery voltage critically low: ${data.battery_voltage}V`);
  if (data.solar_voltage < ALERT_THRESHOLDS.solar) alerts.push(`Solar voltage critically low: ${data.solar_voltage}V`);
  if (alerts.length > 0) {
    showAlert(alerts.join(' | '));
  } else {
    dismissAlert();
  }
}

function logEvent(action, details = '') {
  eventLog.push({ timestamp: new Date().toISOString(), action, details });
  if (eventLog.length > 100) eventLog.shift();
  localStorage.setItem('event_log', JSON.stringify(eventLog));
}

// Modal functions
function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.style.display = 'none';
}

function showWaterStats() {
  const modal = document.getElementById('waterStatsModal');
  if (!modal) return;
  
  // Calculate water stats from event log
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const oneWeekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const oneMonthAgo = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
  
  let todayL = 0, weekL = 0, monthL = 0, totalL = 0, eventCount = 0;
  
  eventLog.forEach(log => {
    if (log.action === 'Irrigation completed') {
      const match = log.details.match(/Liters used: ([\d.]+)/);
      if (match) {
        const liters = parseFloat(match[1]);
        totalL += liters;
        const logDate = new Date(log.timestamp);
        if (logDate >= today) todayL += liters;
        if (logDate >= oneWeekAgo) weekL += liters;
        if (logDate >= oneMonthAgo) monthL += liters;
        eventCount++;
      }
    }
  });
  
  document.getElementById('waterToday').textContent = todayL.toFixed(2) + ' L';
  document.getElementById('waterWeek').textContent = weekL.toFixed(2) + ' L';
  document.getElementById('waterMonth').textContent = monthL.toFixed(2) + ' L';
  document.getElementById('waterAvgDaily').textContent = eventCount > 0 ? (totalL / Math.max(eventCount, 1)).toFixed(2) + ' L' : '0 L';
  
  modal.style.display = 'flex';
}

function showEventLog() {
  const modal = document.getElementById('eventLogModal');
  if (!modal) return;
  
  const container = document.getElementById('eventLogContainer');
  container.innerHTML = '';
  
  [...eventLog].reverse().forEach(log => {
    const div = document.createElement('div');
    div.className = 'event-item';
    const time = new Date(log.timestamp).toLocaleString();
    div.innerHTML = `
      <span class="event-time">${time}</span>
      <span class="event-action">${log.action}</span>
      <span class="event-details">${log.details}</span>
    `;
    container.appendChild(div);
  });
  
  modal.style.display = 'flex';
}

function showHelp() {
  const modal = document.getElementById('helpModal');
  if (modal) modal.style.display = 'flex';
}

function downloadWaterReport() {
  let csv = 'Water Usage Report\n';
  csv += `Generated: ${new Date().toLocaleString()}\n\n`;
  csv += 'Event, Date/Time, Details\n';
  eventLog.forEach(log => {
    if (log.action === 'Irrigation completed') {
      csv += `${log.action}, ${log.timestamp}, ${log.details}\n`;
    }
  });
  downloadCSV(csv, 'water-report.csv');
}

function downloadEventLog() {
  let csv = 'System Event Log\n';
  csv += `Generated: ${new Date().toLocaleString()}\n\n`;
  csv += 'Timestamp, Action, Details\n';
  eventLog.forEach(log => {
    csv += `${log.timestamp}, ${log.action}, ${log.details}\n`;
  });
  downloadCSV(csv, 'event-log.csv');
}

function downloadCSV(csvContent, filename) {
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  window.URL.revokeObjectURL(url);
}

let idleTimeoutMs = 5 * 60 * 1000; // 5 minutes
let idleTimerId = null;
let cooldownTimeoutId = null;
const cooldownMs = 30 * 1000; // 30 seconds

function resetIdleTimer() {
  if (idleTimerId) clearTimeout(idleTimerId);
  idleTimerId = setTimeout(() => {
    lockSession('Session locked due to inactivity. Please login again.');
  }, idleTimeoutMs);
}

function setupIdleListeners() {
  ['click', 'mousemove', 'keydown', 'touchstart'].forEach(eventName => {
    window.addEventListener(eventName, resetIdleTimer);
  });
  resetIdleTimer();
}

function clearIdleTimer() {
  if (idleTimerId) clearTimeout(idleTimerId);
  idleTimerId = null;
}

function lockSession(message) {
  localStorage.removeItem('access_hash');
  hideAppContent();
  showLoginModal();
  updateLoginError(message);
  clearIdleTimer();
}

function hideAppContent() {
  document.querySelector('main').style.display = 'none';
  document.querySelector('footer').style.display = 'none';
}

function showAppContent() {
  document.querySelector('main').style.display = '';
  document.querySelector('footer').style.display = '';
}

function attemptLogin() {
  if (cooldownTimeoutId) {
    updateLoginError('Cooldown active. Please wait for timer to finish.');
    return;
  }

  const input = document.getElementById('loginPassword').value;
  if (!input) {
    updateLoginError('Password is required.');
    return;
  }

  if (bcrypt.compareSync(input, PASSWORD_HASH)) {
    localStorage.setItem('access_hash', PASSWORD_HASH);
    passwordAttempts = 0;
    updateLoginError('');
    hideLoginModal();
    showAppContent();
    initializeApp();
    setupIdleListeners();
  } else {
    passwordAttempts++;
    const remaining = maxPasswordAttempts - passwordAttempts;
    if (remaining > 0) {
      updateLoginError(`Incorrect password. ${remaining} attempt(s) remaining.`);
    } else {
      document.getElementById('loginSubmit').disabled = true;
      document.getElementById('loginPassword').disabled = true;

      let secondsRemaining = 30;
      updateLoginError(`Too many failed attempts. Try again in ${secondsRemaining}s.`);

      const countdownInterval = setInterval(() => {
        secondsRemaining--;
        if (secondsRemaining > 0) {
          updateLoginError(`Too many failed attempts. Try again in ${secondsRemaining}s.`);
        } else {
          clearInterval(countdownInterval);
          passwordAttempts = 0;
          document.getElementById('loginSubmit').disabled = false;
          document.getElementById('loginPassword').disabled = false;
          document.getElementById('loginPassword').value = '';
          updateLoginError('You may try again.');
          cooldownTimeoutId = null;
        }
      }, 1000);

      cooldownTimeoutId = setTimeout(() => {
        clearInterval(countdownInterval);
      }, 30500);
    }
  }
}

document.getElementById("ip").value = ip;
document.getElementById("latitude").value = latitude;
document.getElementById("longitude").value = longitude;
document.getElementById("rainThreshold").value = rainThreshold;
document.getElementById("forceIpMode").checked = forceIPMode;
setLocationSource(forceIPMode ? 'IP' : (latitude && longitude ? 'Manual' : 'Unknown'));
document.documentElement.setAttribute("data-theme", currentTheme);

// Initialize theme on load
updateThemeIcon();

function updateThemeIcon() {
  const themeBtn = document.getElementById("themeToggle");
  const icon = themeBtn.querySelector("i");
  if (currentTheme === "dark") {
    icon.className = "fas fa-sun";
  } else {
    icon.className = "fas fa-moon";
  }
}

function setLocationSource(source) {
  const sourceEl = document.getElementById('locationSource');
  const sourceTimeEl = document.getElementById('locationSourceLastUpdated');
  if (sourceEl) {
    sourceEl.textContent = source;
    sourceEl.className = 'status-chip ' + (source === 'GPS' ? 'status-good' : source === 'IP' ? 'status-warning' : source === 'Manual' ? 'status-info' : 'status-muted');
  }
  if (sourceTimeEl) {
    const now = new Date();
    sourceTimeEl.textContent = `(updated: ${now.toLocaleTimeString()})`;
  }
}

function setLocationSourceDirectly(source) {
  setLocationSource(source);
  if (source === 'GPS' || source === 'IP') {
    setLocationSource(lastUpdateTime ? 'GPS' : 'IP');
  }
}

function toggleForceIPMode() {
  forceIPMode = document.getElementById('forceIpMode').checked;
  localStorage.setItem('force_ip_mode', forceIPMode);
  setLocationSource(forceIPMode ? 'IP' : (latitude && longitude ? 'Manual' : 'Unknown'));
  showStatus(`Force IP mode ${forceIPMode ? 'enabled' : 'disabled'}.`, 'info');
  if (forceIPMode) {
    lookupLocationByIP();
  }
}

function toggleTheme() {
  currentTheme = currentTheme === "light" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", currentTheme);
  localStorage.setItem("theme", currentTheme);
  updateThemeIcon();
}

function initTrendChart() {
  const ctx = document.getElementById('trendChart').getContext('2d');
  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Soil Moisture ( % )',
        data: [],
        borderColor: 'rgba(46, 125, 50, 0.9)',
        backgroundColor: 'rgba(76, 175, 80, 0.25)',
        tension: 0.25,
        fill: true,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          display: true,
        },
      },
      scales: {
        x: {
          type: 'time',
          time: { unit: 'hour', tooltipFormat: 'MMM d, h:mm a' },
          title: { display: true, text: 'Time' }
        },
        y: {
          title: { display: true, text: 'Percent' }
        }
      }
    }
  });
}

function setTrendMetric(metric) {
  trendMetric = metric;
  const metricMap = {
    soil: { label: 'Soil Moisture (%)', color: 'rgba(46, 125, 50, 0.9)', fill: 'rgba(76, 175, 80, 0.25)', unit: '%' },
    water_flow: { label: 'Water Flow (L/min)', color: 'rgba(33, 150, 243, 0.9)', fill: 'rgba(33, 150, 243, 0.2)', unit: 'L/min' },
    battery_voltage: { label: 'Battery Voltage (V)', color: 'rgba(156, 39, 176, 0.9)', fill: 'rgba(156, 39, 176, 0.2)', unit: 'V' },
    solar_voltage: { label: 'Solar Voltage (V)', color: 'rgba(255, 87, 34, 0.9)', fill: 'rgba(255, 87, 34, 0.2)', unit: 'V' },
  };

  if (metric === 'combined') {
    trendChart.data.datasets = [
      { label: 'Soil Moisture (%)', data: historicalData.map(item => item.soil), borderColor: 'rgba(46, 125, 50, 0.9)', backgroundColor: 'rgba(76, 175, 80, 0.25)', tension: 0.25, fill: false },
      { label: 'Battery Voltage (V)', data: historicalData.map(item => item.battery_voltage), borderColor: 'rgba(156, 39, 176, 0.9)', backgroundColor: 'rgba(156, 39, 176, 0.2)', tension: 0.25, fill: false },
    ];
    trendChart.options.scales.y.title.text = 'Values';
  } else {
    const selected = metricMap[metric] || metricMap.soil;
    trendChart.data.datasets = [{
      label: selected.label,
      data: historicalData.map(item => item[metric]),
      borderColor: selected.color,
      backgroundColor: selected.fill,
      tension: 0.25,
      fill: true,
    }];
    trendChart.options.scales.y.title.text = selected.unit;
  }

  trendChart.data.labels = historicalData.map(item => new Date(item.ts));
  trendChart.update();
}

function addTrendEntry(data) {
  let record = {
    ts: new Date().toISOString(),
    soil: data.soil_moisture !== undefined ? Number(data.soil_moisture) : (data.soil !== undefined ? Number(data.soil) : null),
    water_flow: data.water_flow !== undefined ? Number(data.water_flow) : (data.flow !== undefined ? Number(data.flow) : null),
    battery_voltage: data.battery_voltage !== undefined ? Number(data.battery_voltage) : (data.battery !== undefined ? Number(data.battery) : null),
    solar_voltage: data.solar_voltage !== undefined ? Number(data.solar_voltage) : (data.solar !== undefined ? Number(data.solar) : null),
  };

  historicalData.push(record);
  if (historicalData.length > maxHistoryPoints) {
    historicalData.shift();
  }

  localStorage.setItem(trendHistoryKey, JSON.stringify(historicalData));
  setTrendMetric(trendMetric);
}

function downloadHistory() {
  const csv = Papa.unparse(historicalData.map(entry => ({
    timestamp: entry.timestamp,
    soil_moisture: entry.soil_moisture || entry.soil,
    water_flow: entry.water_flow || entry.flow,
    battery_voltage: entry.battery_voltage || entry.battery,
    solar_voltage: entry.solar_voltage || entry.solar
  })));
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'irrigation_history.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function loadTrendHistory() {
  const savedHistory = localStorage.getItem(trendHistoryKey);
  if (savedHistory) {
    historicalData = JSON.parse(savedHistory);
  } else {
    historicalData = [];
  }
}

function initFromCache() {
  const lastSensorData = JSON.parse(localStorage.getItem(lastSensorDataKey) || '{}');
  if (lastSensorData && Object.keys(lastSensorData).length) {
    updateSoilMoisture(lastSensorData.soil_moisture ?? lastSensorData.soil);
    updateWaterFlow(lastSensorData.water_flow ?? lastSensorData.flow);
    updateValveStatus(lastSensorData.valve_status ?? lastSensorData.valve);
    updateBattery(lastSensorData.battery_voltage ?? lastSensorData.battery, lastSensorData.battery_percentage ?? lastSensorData.battery_percent);
    updateSolarVoltage(lastSensorData.solar_voltage ?? lastSensorData.solar);
    updateMode(lastSensorData.auto_mode || false);
    updateSystemStatus(assessSystemHealth(lastSensorData));
    if (lastSensorData.lastUpdateTime) {
      lastUpdateTime = new Date(lastSensorData.lastUpdateTime);
      updateLastUpdate();
    }
  }

  const weatherCache = JSON.parse(localStorage.getItem(weatherDataKey) || '{}');
  if (weatherCache && weatherCache.summary) {
    updateWeatherUI(weatherCache);
  }
}

function showStatus(message, type = "info") {
  const statusEl = document.getElementById("status");
  statusEl.textContent = message;
  statusEl.className = `status-message ${type} show`;

  // Auto-hide after 5 seconds for success/info, keep errors visible
  if (type !== "error") {
    setTimeout(() => {
      statusEl.className = "status-message";
    }, 5000);
  }

  if (type === 'warning' || type === 'error') {
    notifyUser(message, type);
  }
}

function notifyUser(message, type = 'info') {
  if (!('Notification' in window)) return;

  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }

  if (Notification.permission === 'granted') {
    new Notification(`Irrigation ${type}`, {
      body: message,
      icon: type === 'error' ? 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/svgs/solid/exclamation-circle.svg' : 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/svgs/solid/check-circle.svg'
    });
  }
}

function toggleNotifications() {
  if (Notification.permission === 'default') {
    Notification.requestPermission().then(permission => {
      showStatus(`Notifications ${permission === 'granted' ? 'enabled' : 'denied'}.`, 'info');
    });
  } else {
    showStatus('Notifications already configured.', 'info');
  }
}

function setUpAutoRefresh() {
  const intervalInput = document.getElementById('refreshInterval');
  const autoRefreshBtn = document.getElementById('autoRefreshBtn');

  if (intervalInput) intervalInput.value = autoRefreshIntervalMs / 1000;
  if (autoRefreshBtn) autoRefreshBtn.textContent = autoRefreshEnabled ? 'Auto Refresh: ON' : 'Auto Refresh: OFF';

  if (autoRefreshEnabled) {
    startAutoRefresh();
  } else {
    stopAutoRefresh();
  }
}

function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshIntervalId = setInterval(() => {
    if (document.visibilityState === 'visible') {
      fetchData();
    }
  }, autoRefreshIntervalMs);
  autoRefreshEnabled = true;
  localStorage.setItem('auto_refresh_enabled', 'true');
}

function stopAutoRefresh() {
  if (autoRefreshIntervalId) {
    clearInterval(autoRefreshIntervalId);
    autoRefreshIntervalId = null;
  }
  autoRefreshEnabled = false;
  localStorage.setItem('auto_refresh_enabled', 'false');
}

function toggleAutoRefresh() {
  autoRefreshEnabled = !autoRefreshEnabled;
  if (autoRefreshEnabled) {
    startAutoRefresh();
    showStatus('Auto-refresh enabled.', 'success');
  } else {
    stopAutoRefresh();
    showStatus('Auto-refresh disabled.', 'warning');
  }
  const autoRefreshBtn = document.getElementById('autoRefreshBtn');
  if (autoRefreshBtn) autoRefreshBtn.textContent = autoRefreshEnabled ? 'Auto Refresh: ON' : 'Auto Refresh: OFF';
}

function updateAutoRefreshInterval() {
  const intervalInput = document.getElementById('refreshInterval');
  const value = parseInt(intervalInput.value, 10);

  if (isNaN(value) || value < 5 || value > 3600) {
    showStatus('Auto-refresh interval must be between 5 and 3600 seconds.', 'error');
    intervalInput.value = autoRefreshIntervalMs / 1000;
    return;
  }

  autoRefreshIntervalMs = value * 1000;
  localStorage.setItem('auto_refresh_interval_ms', autoRefreshIntervalMs.toString());

  if (autoRefreshEnabled) {
    startAutoRefresh();
  }

  showStatus(`Auto-refresh interval set to ${value}s.`, 'success');
}

function updateOnlineStatus() {
  const status = navigator.onLine ? 'Online' : 'Offline';
  const color = navigator.onLine ? 'var(--success-color)' : 'var(--danger-color)';
  const statusEl = document.getElementById('connectionStatus');
  if (statusEl) {
    statusEl.textContent = status;
    statusEl.style.color = color;
  }
  const offlineIndicator = document.getElementById('offlineIndicator');
  if (offlineIndicator) {
    offlineIndicator.style.display = navigator.onLine ? 'none' : 'block';
  }
  if (!navigator.onLine) {
    showStatus('You are offline. Showing cached data if available.', 'warning');
  } else {
    showStatus('Network connection restored.', 'success');
    fetchData();
  }
}

async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('service-worker.js');
      console.log('Service Worker registered');
    } catch (error) {
      console.error('Service Worker registration failed:', error);
    }
  }
}

async function saveLastSensorData(data) {
  localStorage.setItem(lastSensorDataKey, JSON.stringify({ ...data, lastUpdateTime: new Date().toISOString() }));
}

async function fetchWeather() {
  if (!latitude || !longitude) {
    showStatus('Please save latitude and longitude first.', 'error');
    return;
  }

  const refreshBtn = document.getElementById('refreshWeatherBtn');
  const refreshText = refreshBtn.querySelector('span');
  refreshBtn.disabled = true;
  refreshText.textContent = 'Loading...';

  try {
    // Fetch current + hourly weather
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&hourly=temperature_2m,precipitation_probability&daily=precipitation_probability_max&timezone=auto`);
    if (!response.ok) throw new Error(`Weather HTTP ${response.status}`);
    const data = await response.json();

    const weatherInfo = {
      current: data.current_weather,
      hourly: data.hourly,
      daily: data.daily,
      summary: `${data.current_weather.temperature}°C, ${data.current_weather.weathercode}`,
    };

    localStorage.setItem(weatherDataKey, JSON.stringify(weatherInfo));
    weatherFetchTimestamp = new Date();
    localStorage.setItem('weather_last_update', weatherFetchTimestamp.toISOString());
    updateWeatherUI(weatherInfo);
    checkRainDelay(weatherInfo);
    showStatus('Weather data updated (with hourly forecast).', 'success');
  } catch (error) {
    console.error('Weather fetch failed:', error);
    showStatus(`Weather fetch failed: ${error.message}`, 'error');
  } finally {
    refreshBtn.disabled = false;
    refreshText.textContent = 'Fetch Weather';
  }
}

function updateWeatherUI(weatherInfo) {
  const weatherStatus = document.getElementById('weatherStatus');
  const weatherIcon = document.getElementById('weatherIcon');

  if (weatherInfo && weatherInfo.current) {
    const temp = weatherInfo.current.temperature;
    const rainProb = weatherInfo.daily ? weatherInfo.daily.precipitation_probability_max[0] : 0;
    weatherStatus.textContent = `${temp}°C, Rain ${rainProb}% | `;
    
    // Add hourly forecast snippet
    if (weatherInfo.hourly && weatherInfo.hourly.precipitation_probability) {
      const nextHours = weatherInfo.hourly.precipitation_probability.slice(0, 4).join('%, ') + '%';
      weatherStatus.textContent += `Next 4h rain: ${nextHours}`;
    }

    if (rainProb > 70) weatherIcon.className = 'fas fa-cloud-showers-heavy';
    else if (rainProb > 30) weatherIcon.className = 'fas fa-cloud-rain';
    else weatherIcon.className = 'fas fa-sun';
  } else {
    weatherStatus.textContent = 'No weather data';
  }

  updateNextIrrigationAndAdvice();
}

function checkRainDelay(weatherInfo) {
  if (!weatherInfo || !weatherInfo.daily) return;
  const rainProb = weatherInfo.daily.precipitation_probability_max[0] || 0;
  if (rainProb >= rainThreshold) {
    showStatus(`Rain probability is ${rainProb}%. Suggested irrigation delay.`, 'warning');
    notifyUser(`Rain probability is ${rainProb}%. Recommend delay irrigating.`, 'warning');
  }
}

function saveLocation() {
  const latInput = document.getElementById('latitude');
  const lonInput = document.getElementById('longitude');
  const thresholdInput = document.getElementById('rainThreshold');

  latitude = latInput.value.trim();
  longitude = lonInput.value.trim();
  rainThreshold = Number(thresholdInput.value || 50);

  if (!latitude || !longitude || isNaN(latitude) || isNaN(longitude)) {
    showStatus('Please provide valid latitude and longitude.', 'error');
    return;
  }
  if (isNaN(rainThreshold) || rainThreshold < 0 || rainThreshold > 100) {
    showStatus('Rain threshold must be between 0 and 100.', 'error');
    return;
  }

  localStorage.setItem('weather_latitude', latitude);
  localStorage.setItem('weather_longitude', longitude);
  localStorage.setItem('rain_threshold', rainThreshold);
  setLocationSource('Manual');
  showStatus('Location and threshold saved.', 'success');
  fetchWeather();
}

async function lookupLocationByIP() {
  try {
    showStatus('Trying IP-based location fallback...', 'info');
    const response = await fetch('https://ipapi.co/json/');
    if (!response.ok) throw new Error(`IP geolocation HTTP ${response.status}`);
    const data = await response.json();
    if (data && data.latitude && data.longitude) {
      const lat = Number(data.latitude).toFixed(6);
      const lon = Number(data.longitude).toFixed(6);

      document.getElementById('latitude').value = lat;
      document.getElementById('longitude').value = lon;

      latitude = String(lat);
      longitude = String(lon);
      localStorage.setItem('weather_latitude', latitude);
      localStorage.setItem('weather_longitude', longitude);

      setLocationSource('IP');
      showStatus(`IP-based location detected: ${lat}, ${lon}`, 'success');
      fetchWeather();
      return true;
    }
    throw new Error('IP location data missing');
  } catch (error) {
    console.error('IP location fallback failed:', error);
    showStatus('IP-based location fallback failed.', 'error');
    return false;
  }
}

function autoDetectLocation() {
  if (!('geolocation' in navigator)) {
    showStatus('Geolocation is not available in this browser. Using IP-based fallback.', 'warning');
    lookupLocationByIP();
    return;
  }

  showStatus('Detecting location...', 'info');

  navigator.geolocation.getCurrentPosition(
    position => {
      const lat = position.coords.latitude.toFixed(6);
      const lon = position.coords.longitude.toFixed(6);

      document.getElementById('latitude').value = lat;
      document.getElementById('longitude').value = lon;

      latitude = String(lat);
      longitude = String(lon);
      localStorage.setItem('weather_latitude', latitude);
      localStorage.setItem('weather_longitude', longitude);

      setLocationSource('GPS');
      showStatus(`Location detected: ${lat}, ${lon}`, 'success');
      fetchWeather();
    },
    async error => {
      let msg = 'Unable to determine location.';
      if (error.code === error.PERMISSION_DENIED) msg = 'Location permission denied.';
      else if (error.code === error.POSITION_UNAVAILABLE) msg = 'Location unavailable.';
      else if (error.code === error.TIMEOUT) msg = 'Location request timed out.';
      showStatus(`${msg} Using IP-based fallback.`, 'warning');
      await lookupLocationByIP();
    },
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 600000
    }
  );
}

async function fetchData() {
  if (!ip) {
    updateConnectionStatus(false);
    showStatus("Please set the ESP32 IP address first.", "error");
    return;
  }

  // Debounce: Prevent rapid successive fetches
  const now = Date.now();
  if (now - lastFetchTime < MIN_FETCH_INTERVAL) {
    showStatus("Please wait before fetching again.", "info");
    return;
  }
  lastFetchTime = now;

  // Check cache first
  if (cachedResponse && now - cacheTimestamp < CACHE_DURATION) {
    const data = cachedResponse;
    lastData = data;
    updateConnectionStatus(true);
    updateSoilMoisture(data.soil_moisture || data.soil || 0);
    updateWaterFlow(data.water_flow || data.flow || 0);
    updateValveStatus(data.valve_status || data.valve || "UNKNOWN");
    updateBattery(data.battery_voltage || data.battery || 0, data.battery_percentage || data.battery_percent || 0);
    updateSolarVoltage(data.solar_voltage || data.solar || 0);
    updateMode(data.auto_mode || false);
    const systemHealth = assessSystemHealth(data);
    updateSystemStatus(systemHealth);
    lastUpdateTime = new Date();
    updateLastUpdate();
    checkAlerts(data);
    showStatus("(Cached) Data loaded successfully!", "success");
    return;
  }

  const refreshBtn = document.getElementById("refreshBtn");
  const refreshIcon = refreshBtn.querySelector("i");
  const refreshText = refreshBtn.querySelector("span");

  // Show loading state
  refreshBtn.classList.add("spinning");
  refreshText.textContent = "Refreshing...";

  try {
    showStatus("Fetching data from ESP32...", "info");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const response = await fetch(`http://${ip}/status`, {
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();

    // Cache the response
    cachedResponse = data;
    cacheTimestamp = Date.now();

    lastData = data;

    // Update connection status
    updateConnectionStatus(true);

    // Update all displays
    updateSoilMoisture(data.soil_moisture || data.soil || 0);
    updateWaterFlow(data.water_flow || data.flow || 0);
    updateValveStatus(data.valve_status || data.valve || "UNKNOWN");
    updateBattery(data.battery_voltage || data.battery || 0, data.battery_percentage || data.battery_percent || 0);
    updateSolarVoltage(data.solar_voltage || data.solar || 0);
    updateMode(data.auto_mode || false);

    // Assess system health
    const systemHealth = assessSystemHealth(data);
    updateSystemStatus(systemHealth);

    // Update last update time
    lastUpdateTime = new Date();
    updateLastUpdate();

    await saveLastSensorData(data);
    addTrendEntry(data);
    updateNextIrrigationAndAdvice();
    checkAlerts(data);

    // Reset failure state when success
    failedFetchCount = 0;
    if (autoRefreshEnabled && autoRefreshIntervalMs !== parseInt(localStorage.getItem('auto_refresh_interval_ms') || '30000')) {
      setUpAutoRefresh();
    }

    // Optionally refresh weather if older than 30 minutes
    const needsWeatherRefresh = !weatherFetchTimestamp || ((new Date() - weatherFetchTimestamp) > (30 * 60 * 1000));
    if (needsWeatherRefresh && latitude && longitude) {
      fetchWeather();
    }

    showStatus("Data updated successfully!", "success");

  } catch (error) {
    console.error("Fetch error:", error);
    updateConnectionStatus(false);
    failedFetchCount++;
    if (failedFetchCount >= 3) {
      const previous = autoRefreshIntervalMs;
      autoRefreshIntervalMs = Math.min(120000, autoRefreshIntervalMs * 2);
      localStorage.setItem('auto_refresh_interval_ms', autoRefreshIntervalMs.toString());
      showStatus(`Fetch failed repeatedly. Backing off to ${autoRefreshIntervalMs / 1000}s interval.`, 'warning');
      if (autoRefreshEnabled) {
        startAutoRefresh();
      }
    }

    if (error.name === 'AbortError') {
      showStatus("Request timed out. Please check your connection.", "error");
    } else {
      showStatus(`Error fetching data: ${error.message}`, "error");
    }
  } finally {
    // Reset loading state
    refreshBtn.classList.remove("spinning");
    refreshText.textContent = "Refresh Data";
  }
}

function assessSystemHealth(data) {
  let healthScore = 0;
  let maxScore = 4;

  // Check battery level
  if (data.battery_percentage !== undefined) {
    if (data.battery_percentage >= 60) healthScore++;
    else if (data.battery_percentage >= 20) healthScore += 0.5;
  }

  // Check solar voltage
  if (data.solar_voltage !== undefined) {
    if (data.solar_voltage >= 8) healthScore++;
  }

  // Check if system is responding
  healthScore++;

  // Check soil moisture (reasonable range)
  if (data.soil_moisture !== undefined && data.soil_moisture >= 0 && data.soil_moisture <= 100) {
    healthScore++;
  }

  const healthPercentage = (healthScore / maxScore) * 100;

  if (healthPercentage >= 75) return 'good';
  else if (healthPercentage >= 50) return 'warning';
  else return 'error';
}

function updateSoilMoisture(value) {
  const element = document.getElementById("soil");
  const indicator = document.getElementById("soilIndicator");

  element.textContent = value !== undefined ? value : "--";

  if (value !== undefined && value >= 0 && value <= 100) {
    indicator.style.setProperty('--indicator-width', `${value}%`);
  } else {
    indicator.style.setProperty('--indicator-width', '0%');
  }

  element.classList.add("loading");
  setTimeout(() => element.classList.remove("loading"), 500);
}

function updateWaterFlow(value) {
  const element = document.getElementById("flow");
  element.textContent = value !== undefined ? value : "--";
  element.classList.add("loading");
  setTimeout(() => element.classList.remove("loading"), 500);
}

function updateValveStatus(status) {
  const valveElement = document.getElementById("valve");
  const icon = valveElement.querySelector("i");
  const text = valveElement.querySelector("span");
  const description = document.getElementById("valveDescription");

  valveElement.className = "valve-status";

  if (status === "ON" || status === "OPEN" || status === true) {
    icon.className = "fas fa-circle open";
    text.textContent = "Open";
    valveElement.classList.add("open");
    description.textContent = "Irrigation active";
  } else if (status === "OFF" || status === "CLOSED" || status === false) {
    icon.className = "fas fa-circle closed";
    text.textContent = "Closed";
    valveElement.classList.add("closed");
    description.textContent = "Irrigation stopped";
  } else {
    icon.className = "fas fa-circle";
    text.textContent = status || "--";
    description.textContent = "Status unknown";
  }

  valveElement.classList.add("loading");
  setTimeout(() => valveElement.classList.remove("loading"), 500);
}

function updateBattery(voltage, percentage) {
  const voltageElement = document.getElementById("battery-voltage");
  const percentageElement = document.getElementById("battery-percentage");
  const fillElement = document.getElementById("battery-fill");
  const levelText = document.getElementById("batteryLevelText");

  voltageElement.textContent = voltage ? voltage.toFixed(1) : "--";
  percentageElement.textContent = percentage !== undefined ? `${percentage}%` : "--";

  if (percentage !== undefined && percentage >= 0 && percentage <= 100) {
    fillElement.style.width = `${percentage}%`;

    if (percentage >= 80) {
      levelText.textContent = "Excellent";
      levelText.style.color = "var(--success-color)";
    } else if (percentage >= 60) {
      levelText.textContent = "Good";
      levelText.style.color = "var(--success-color)";
    } else if (percentage >= 40) {
      levelText.textContent = "Fair";
      levelText.style.color = "var(--warning-color)";
    } else if (percentage >= 20) {
      levelText.textContent = "Low";
      levelText.style.color = "var(--danger-color)";
    } else {
      levelText.textContent = "Critical";
      levelText.style.color = "var(--danger-color)";
    }
  } else {
    fillElement.style.width = "0%";
    levelText.textContent = "Unknown";
    levelText.style.color = "var(--text-secondary)";
  }

  voltageElement.classList.add("loading");
  setTimeout(() => voltageElement.classList.remove("loading"), 500);
}

function updateSolarVoltage(voltage) {
  const element = document.getElementById("solar");
  const efficiencyElement = document.getElementById("solarEfficiency");

  element.textContent = voltage ? voltage.toFixed(1) : "--";

  if (voltage !== undefined) {
    if (voltage >= 12) {
      efficiencyElement.textContent = "High output";
      efficiencyElement.style.color = "var(--success-color)";
    } else if (voltage >= 8) {
      efficiencyElement.textContent = "Good output";
      efficiencyElement.style.color = "var(--success-color)";
    } else if (voltage >= 5) {
      efficiencyElement.textContent = "Low output";
      efficiencyElement.style.color = "var(--warning-color)";
    } else {
      efficiencyElement.textContent = "Very low";
      efficiencyElement.style.color = "var(--danger-color)";
    }
  } else {
    efficiencyElement.textContent = "Efficiency: --";
    efficiencyElement.style.color = "var(--text-secondary)";
  }

  element.classList.add("loading");
  setTimeout(() => element.classList.remove("loading"), 500);
}

function updateMode(isAuto) {
  const modeElement = document.getElementById("mode");
  const icon = modeElement.querySelector("i");
  const text = modeElement.querySelector("span");
  const description = document.getElementById("modeDescription");
  const toggle = document.getElementById("autoToggle");

  modeElement.className = "mode-status";

  if (isAuto) {
    icon.className = "fas fa-circle auto";
    text.textContent = "Auto";
    modeElement.classList.add("auto");
    description.textContent = "Smart irrigation active";
    toggle.checked = true;
  } else {
    icon.className = "fas fa-circle manual";
    text.textContent = "Manual";
    modeElement.classList.add("manual");
    description.textContent = "Manual control only";
    toggle.checked = false;
  }

  modeElement.classList.add("loading");
  setTimeout(() => modeElement.classList.remove("loading"), 500);
}

async function sendCommand(cmd) {
  if (!ip) {
    showStatus("Please set the ESP32 IP address first.", "error");
    return;
  }

  logEvent(`Valve ${cmd}`, '');
  if (cmd === 'ON') {
    irrigationStartTime = Date.now();
  } else if (cmd === 'OFF' && irrigationStartTime) {
    const durationMinutes = (Date.now() - irrigationStartTime) / 1000 / 60;
    const flowRate = lastData ? (lastData.water_flow || 0) : 0;
    const litersUsed = flowRate * durationMinutes;
    logEvent('Irrigation completed', `Duration: ${durationMinutes.toFixed(1)} min, Liters used: ${litersUsed.toFixed(2)} L`);
    irrigationStartTime = null;
  }

  const btnId = cmd === "ON" ? "startBtn" : "stopBtn";
  const button = document.getElementById(btnId);

  // Disable button and show loading
  button.disabled = true;
  button.classList.add("loading");
  const originalText = button.innerHTML;
  button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';

  try {
    showStatus(`Sending ${cmd} command...`, "info");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`http://${ip}/${cmd}`, {
      method: 'GET',
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    showStatus(`${cmd} command sent successfully!`, "success");

    // Refresh data after successful command
    setTimeout(fetchData, 1000);

  } catch (error) {
    console.error("Command error:", error);

    if (error.name === 'AbortError') {
      showStatus("Command timed out. Please try again.", "error");
    } else {
      showStatus(`Error sending ${cmd}: ${error.message}`, "error");
    }
  } finally {
    // Reset button state
    button.disabled = false;
    button.classList.remove("loading");
    button.innerHTML = originalText;
  }
}

function toggleAuto() {
  const isChecked = document.getElementById("autoToggle").checked;
  const cmd = isChecked ? "AUTO_ON" : "AUTO_OFF";
  sendCommand(cmd);
}

// Schedule management
let lastUpdateTime = null;

function updateConnectionStatus(connected) {
  const connectionIcon = document.getElementById('connectionIcon');
  const connectionStatus = document.getElementById('connectionStatus');

  if (connected) {
    connectionIcon.className = 'fas fa-wifi';
    connectionStatus.textContent = 'Connected';
    connectionStatus.style.color = 'var(--success-color)';
  } else {
    connectionIcon.className = 'fas fa-wifi-slash';
    connectionStatus.textContent = 'Disconnected';
    connectionStatus.style.color = 'var(--danger-color)';
  }
}

function updateSystemStatus(health) {
  const systemIcon = document.getElementById('systemIcon');
  const systemStatus = document.getElementById('systemStatus');

  if (health === 'good') {
    systemIcon.className = 'fas fa-heartbeat';
    systemStatus.textContent = 'Good';
    systemStatus.style.color = 'var(--success-color)';
  } else if (health === 'warning') {
    systemIcon.className = 'fas fa-exclamation-triangle';
    systemStatus.textContent = 'Warning';
    systemStatus.style.color = 'var(--warning-color)';
  } else {
    systemIcon.className = 'fas fa-times-circle';
    systemStatus.textContent = 'Error';
    systemStatus.style.color = 'var(--danger-color)';
  }
}

function updateLastUpdate() {
  const lastUpdateElement = document.getElementById('lastUpdate');
  if (lastUpdateTime) {
    const now = new Date();
    const diff = Math.floor((now - lastUpdateTime) / 1000);
    if (diff < 60) {
      lastUpdateElement.textContent = `${diff}s ago`;
    } else if (diff < 3600) {
      lastUpdateElement.textContent = `${Math.floor(diff / 60)}m ago`;
    } else {
      lastUpdateElement.textContent = `${Math.floor(diff / 3600)}h ago`;
    }
  } else {
    lastUpdateElement.textContent = 'Never';
  }
}

function loadSchedules() {
  const scheduleList = document.getElementById("scheduleList");
  const template = document.getElementById("scheduleTemplate");
  const noSchedules = document.getElementById("noSchedules");

  // Clear existing schedules except template
  const existingItems = scheduleList.querySelectorAll('.schedule-item:not(.template)');
  existingItems.forEach(item => item.remove());

  // Add each schedule
  schedules.forEach(schedule => {
    addScheduleToUI(schedule);
  });

  // Show/hide no schedules message
  if (schedules.length === 0) {
    noSchedules.style.display = 'block';
  } else {
    noSchedules.style.display = 'none';
  }

  updateScheduleStats();
}

function updateScheduleStats() {
  const totalElement = document.getElementById("totalSchedules");
  const activeElement = document.getElementById("enabledSchedules");
  const summaryElement = document.getElementById("activeSchedules");

  const total = schedules.length;
  const active = schedules.filter(s => s.enabled).length;

  totalElement.textContent = `${total} total`;
  activeElement.textContent = `${active} active`;
  summaryElement.textContent = `${active} active schedule${active !== 1 ? 's' : ''}`;

  updateNextIrrigationAndAdvice();
}

function getNextScheduledIrrigation() {
  if (!schedules || schedules.length === 0) return null;

  const now = new Date();
  const dayIdx = now.getDay();
  let best = null;

  for (let offset = 0; offset < 7; offset++) {
    const targetDay = (dayIdx + offset) % 7;
    schedules.filter(schedule => schedule.enabled && schedule.days.includes(targetDay)).forEach(schedule => {
      const [h, m] = schedule.time.split(':').map(Number);
      const candidate = new Date(now);
      candidate.setDate(now.getDate() + offset);
      candidate.setHours(h, m, 0, 0);

      if (candidate <= now) return;

      if (!best || candidate < best.candidate) {
        best = { schedule, candidate };
      }
    });
    if (best) break; // first eligible in time order
  }

  return best;
}

function formatDateTime(dt) {
  if (!dt || !(dt instanceof Date)) return 'TBD';
  const opts = { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  return dt.toLocaleString(undefined, opts);
}

function generateSmartAdvice() {
  const soilValue = Number(document.getElementById('soil').textContent.replace('%', ''));
  const battery = Number(document.getElementById('battery-percentage').textContent.replace('%', ''));
  const rainThresholdValue = Number(document.getElementById('rainThreshold').value || 50);
  const weatherCache = JSON.parse(localStorage.getItem(weatherDataKey) || '{}');
  const rainProb = weatherCache.daily?.precipitation_probability_max?.[0] ?? null;
  const nextIrrigation = getNextScheduledIrrigation();

  if (!schedules || schedules.length === 0) {
    return 'No irrigation schedule has been configured. Add a schedule to enable predictions.';
  }

  if (rainProb !== null && !Number.isNaN(rainProb) && rainProb >= rainThresholdValue) {
    return `High rain chance (${rainProb}%). Delay or skip next irrigation.`;
  }

  if (!Number.isNaN(soilValue) && soilValue < 35) {
    return `Soil moisture is low (${soilValue}%). Irrigation is recommended; next run ${nextIrrigation ? formatDateTime(nextIrrigation.candidate) : 'TBD'}.`;
  }

  if (!Number.isNaN(soilValue) && soilValue > 75) {
    return `Soil moisture is high (${soilValue}%). Skip irrigation unless schedule requires it.`;
  }

  if (!Number.isNaN(battery) && battery < 25) {
    return `Battery low (${battery}%). Ensure solar charging and avoid long irrigation cycles.`;
  }

  if (nextIrrigation) {
    return `Next irrigation targets ${dayNames[nextIrrigation.candidate.getDay()]} ${formatDateTime(nextIrrigation.candidate)}.`;
  }

  return 'System conditions are good. Monitor soil and rain forecast for optimal decisions.';
}

function updateNextIrrigationAndAdvice() {
  const nextElement = document.getElementById('nextIrrigation');
  const adviceElement = document.getElementById('smartAdvice');

  const next = getNextScheduledIrrigation();
  if (next) {
    nextElement.textContent = `${dayNames[next.candidate.getDay()]} ${formatDateTime(next.candidate)} (${next.schedule.duration} min)`;
  } else {
    nextElement.textContent = 'No enabled schedule found';
  }

  adviceElement.textContent = generateSmartAdvice();
}

function addScheduleToUI(schedule) {
  const scheduleList = document.getElementById("scheduleList");
  const template = document.getElementById("scheduleTemplate");

  const scheduleItem = template.cloneNode(true);
  scheduleItem.classList.remove('template');
  scheduleItem.dataset.id = schedule.id;

  // Set time
  const timeDisplay = scheduleItem.querySelector('.time-display');
  timeDisplay.textContent = schedule.time;

  // Set duration
  const durationDisplay = scheduleItem.querySelector('.duration-display');
  durationDisplay.textContent = `${schedule.duration} min`;

  // Set days
  const daysDisplay = scheduleItem.querySelector('.days-display');
  const dayLabels = schedule.days.map(day => dayNames[day]).join(', ');
  daysDisplay.textContent = dayLabels || 'None';

  // Set enabled state
  const toggleInput = scheduleItem.querySelector('.schedule-enabled');
  toggleInput.checked = schedule.enabled;
  toggleInput.addEventListener('change', () => toggleSchedule(schedule.id));

  scheduleList.appendChild(scheduleItem);
}

function addSchedule() {
  const timeInput = document.getElementById('scheduleTime');
  const durationInput = document.getElementById('scheduleDuration');
  const dayCheckboxes = document.querySelectorAll('.day-checkbox input:checked');

  // Validation
  if (!timeInput.value) {
    showStatus("Please select a start time.", "error");
    timeInput.focus();
    return;
  }

  if (!durationInput.value || durationInput.value < 1 || durationInput.value > 480) {
    showStatus("Please enter a valid duration (1-480 minutes).", "error");
    durationInput.focus();
    return;
  }

  const selectedDays = Array.from(dayCheckboxes).map(cb => parseInt(cb.value));
  if (selectedDays.length === 0) {
    showStatus("Please select at least one day of the week.", "error");
    return;
  }

  // Check for potential conflicts (basic check)
  const newStartTime = timeToMinutes(timeInput.value);
  const newEndTime = newStartTime + parseInt(durationInput.value);

  for (const schedule of schedules) {
    if (schedule.enabled && selectedDays.some(day => schedule.days.includes(day))) {
      const existingStart = timeToMinutes(schedule.time);
      const existingEnd = existingStart + schedule.duration;

      // Check for overlap
      if ((newStartTime < existingEnd && newEndTime > existingStart)) {
        showStatus("Warning: This schedule overlaps with an existing schedule on the same days.", "error");
        return;
      }
    }
  }

  // Create new schedule
  const newSchedule = {
    id: scheduleIdCounter++,
    time: timeInput.value,
    duration: parseInt(durationInput.value),
    days: selectedDays,
    enabled: true
  };

  schedules.push(newSchedule);
  saveSchedulesToStorage();
  addScheduleToUI(newSchedule);

  // Reset form
  timeInput.value = '';
  durationInput.value = '';
  dayCheckboxes.forEach(cb => cb.checked = false);

  updateScheduleStats();
  showStatus("Schedule added successfully!", "success");
}

function timeToMinutes(timeString) {
  const [hours, minutes] = timeString.split(':').map(Number);
  return hours * 60 + minutes;
}

function toggleSchedule(scheduleId) {
  const schedule = schedules.find(s => s.id === scheduleId);
  if (schedule) {
    schedule.enabled = !schedule.enabled;
    saveSchedulesToStorage();
    showStatus(`Schedule ${schedule.enabled ? 'enabled' : 'disabled'}.`, "success");
  }
}

function deleteSchedule(button) {
  const scheduleItem = button.closest('.schedule-item');
  const scheduleId = parseInt(scheduleItem.dataset.id);

  // Remove from array
  schedules = schedules.filter(s => s.id !== scheduleId);
  saveSchedulesToStorage();

  // Remove from UI
  scheduleItem.remove();

  updateScheduleStats();
  showStatus("Schedule deleted.", "success");
}

function saveSchedulesToStorage() {
  localStorage.setItem("irrigation_schedules", JSON.stringify(schedules));
  localStorage.setItem("schedule_id_counter", scheduleIdCounter.toString());
}

async function saveSchedulesToESP32() {
  if (!ip) {
    showStatus("Please set the ESP32 IP address first.", "error");
    return;
  }

  if (schedules.length === 0) {
    showStatus("No schedules to save.", "error");
    return;
  }

  const saveBtn = document.getElementById("saveSchedulesBtn");
  const saveIcon = saveBtn.querySelector("i");
  const saveText = saveBtn.querySelector("span");

  // Show loading state
  saveBtn.disabled = true;
  saveIcon.className = "fas fa-spinner fa-spin";
  saveText.textContent = "Saving...";

  try {
    showStatus("Sending schedules to ESP32...", "info");

    // Prepare schedule data for ESP32
    const scheduleData = {
      schedules: schedules.map(s => ({
        id: s.id,
        hour: parseInt(s.time.split(':')[0]),
        minute: parseInt(s.time.split(':')[1]),
        duration: s.duration,
        days: s.days,
        enabled: s.enabled
      }))
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`http://${ip}/set_schedule`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(scheduleData),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();

    if (result.success) {
      showStatus("Schedules saved to ESP32 successfully!", "success");
    } else {
      throw new Error(result.message || "Failed to save schedules");
    }

  } catch (error) {
    console.error("Save schedules error:", error);

    if (error.name === 'AbortError') {
      showStatus("Save request timed out. Please try again.", "error");
    } else {
      showStatus(`Error saving schedules: ${error.message}`, "error");
    }
  } finally {
    // Reset button state
    saveBtn.disabled = false;
    saveIcon.className = "fas fa-save";
    saveText.textContent = "Save to ESP32";
  }
}

function clearAllSchedules() {
  if (schedules.length === 0) {
    showStatus("No schedules to clear.", "info");
    return;
  }

  if (!confirm("Are you sure you want to delete all schedules? This action cannot be undone.")) {
    return;
  }

  schedules = [];
  saveSchedulesToStorage();

  // Clear UI
  const scheduleList = document.getElementById("scheduleList");
  const existingItems = scheduleList.querySelectorAll('.schedule-item:not(.template)');
  existingItems.forEach(item => item.remove());

  updateScheduleStats();
  showStatus("All schedules cleared.", "success");
}

// Clear any existing text selection (prevents dashboard blue overlay)
function clearAnySelection() {
  if (window.getSelection) {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      selection.removeAllRanges();
    }
  }
  if (document.selection) {
    document.selection.empty();
  }
}

function deselectAndBlur() {
  clearAnySelection();
  if (document.activeElement && document.activeElement !== document.body) {
    document.activeElement.blur();
  }
  if (document.body) {
    document.body.setAttribute('tabindex', '-1');
    document.body.focus({preventScroll: true});
  }
}

// Prevent pointer-based selection globally
document.addEventListener('selectstart', event => {
  const tag = event.target.tagName.toLowerCase();
  if (!['input','textarea','select','button','a'].includes(tag)) {
    event.preventDefault();
  }
});

document.addEventListener('mousedown', () => {
  clearAnySelection();
});

function initializeApp() {
  deselectAndBlur();
  loadSchedules();
  loadTrendHistory();
  initTrendChart();
  setTrendMetric(trendMetric);
  initFromCache();
  updateOnlineStatus();
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  registerServiceWorker();

  window.addEventListener('focus', clearAnySelection);
  document.addEventListener('selectionchange', clearAnySelection);

  // Final race-condition safety: clear any lingering selection shortly after render
  setTimeout(() => {
    clearAnySelection();
  }, 100);

  if (Notification && Notification.permission !== 'granted') {
    Notification.requestPermission();
  }

  if (ip) {
    setUpAutoRefresh();
    if (autoRefreshEnabled) fetchData();
  }
}

// Initialize app on page load
document.addEventListener('DOMContentLoaded', function() {
  const loginSubmit = document.getElementById('loginSubmit');
  const loginPassword = document.getElementById('loginPassword');

  loginSubmit.addEventListener('click', attemptLogin);
  loginPassword.addEventListener('keyup', function(event) {
    if (event.key === 'Enter') {
      attemptLogin();
    }
  });

  if (isAuthenticated()) {
    hideLoginModal();
    initializeApp();
  } else {
    showLoginModal();
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', function(e) {
    if (!isAuthenticated() || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    switch(e.key.toLowerCase()) {
      case 'r':
        fetchData();
        e.preventDefault();
        break;
      case 's':
        sendCommand('ON');
        e.preventDefault();
        break;
      case 't':
        sendCommand('OFF');
        e.preventDefault();
        break;
      case 'l':
        lockSession();
        e.preventDefault();
        break;
      case '?':
        showHelp();
        e.preventDefault();
        break;
    }
  });
});

// Update last update time every minute
setInterval(updateLastUpdate, 60000);

// Initial data fetch if IP is set
if (ip) {
  fetchData();
}