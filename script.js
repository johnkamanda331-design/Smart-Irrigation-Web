let ip = localStorage.getItem("esp32_ip") || "";
let autoRefreshInterval;
let currentTheme = localStorage.getItem("theme") || "light";
let latitude = localStorage.getItem("weather_latitude") || "";
let longitude = localStorage.getItem("weather_longitude") || "";
let rainThreshold = parseInt(localStorage.getItem("rain_threshold")) || 50;
let forceIPMode = localStorage.getItem("force_ip_mode") === "true";
let weatherFetchTimestamp = localStorage.getItem("weather_last_update") ? new Date(localStorage.getItem("weather_last_update")) : null;
let trendMetric = "soil";
let trendChart = null;
let historicalData = [];
const lastSensorDataKey = "last_sensor_data";
const weatherDataKey = "weather_data";
const trendHistoryKey = "trend_history";
const maxHistoryPoints = 144; // around 24h at 10-minute refresh

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
  const selected = metricMap[metric] || metricMap.soil;

  trendChart.data.datasets[0].label = selected.label;
  trendChart.data.datasets[0].borderColor = selected.color;
  trendChart.data.datasets[0].backgroundColor = selected.fill;
  trendChart.options.scales.y.title.text = selected.unit;

  trendChart.data.labels = historicalData.map(item => new Date(item.ts));
  trendChart.data.datasets[0].data = historicalData.map(item => item[metric] !== undefined ? item[metric] : null);
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
  const blob = new Blob([JSON.stringify(historicalData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'irrigation_history.json';
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

  if (Notification.permission === 'granted') {
    new Notification(`Irrigation ${type}`, {
      body: message,
      icon: type === 'error' ? 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/svgs/solid/exclamation-circle.svg' : 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/svgs/solid/check-circle.svg'
    });
  }
}

function updateOnlineStatus() {
  const status = navigator.onLine ? 'Online' : 'Offline';
  const color = navigator.onLine ? 'var(--success-color)' : 'var(--danger-color)';
  const statusEl = document.getElementById('connectionStatus');
  if (statusEl) {
    statusEl.textContent = status;
    statusEl.style.color = color;
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
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&daily=precipitation_probability_max&timezone=auto`);
    if (!response.ok) throw new Error(`Weather HTTP ${response.status}`);
    const data = await response.json();

    const weatherInfo = {
      current: data.current_weather,
      daily: data.daily,
      summary: `${data.current_weather.temperature}°C, ${data.current_weather.weathercode}`,
    };

    localStorage.setItem(weatherDataKey, JSON.stringify(weatherInfo));
    weatherFetchTimestamp = new Date();
    localStorage.setItem('weather_last_update', weatherFetchTimestamp.toISOString());
    updateWeatherUI(weatherInfo);
    checkRainDelay(weatherInfo);
    showStatus('Weather data updated.', 'success');
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
    weatherStatus.textContent = `${temp}°C, Rain ${rainProb}%`;

    if (rainProb > 70) weatherIcon.className = 'fas fa-cloud-showers-heavy';
    else if (rainProb > 30) weatherIcon.className = 'fas fa-cloud-rain';
    else weatherIcon.className = 'fas fa-sun';
  } else {
    weatherStatus.textContent = 'No weather data';
  }
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

    // Optionally refresh weather if older than 30 minutes
    const needsWeatherRefresh = !weatherFetchTimestamp || ((new Date() - weatherFetchTimestamp) > (30 * 60 * 1000));
    if (needsWeatherRefresh && latitude && longitude) {
      fetchWeather();
    }

    showStatus("Data updated successfully!", "success");

  } catch (error) {
    console.error("Fetch error:", error);
    updateConnectionStatus(false);

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

// Initialize app on page load
document.addEventListener('DOMContentLoaded', async function() {
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
    autoRefreshInterval = setInterval(() => fetchData(), 30000);
    fetchData();
  }
});

// Update last update time every minute
setInterval(updateLastUpdate, 60000);

// Initial data fetch if IP is set
if (ip) {
  fetchData();
}