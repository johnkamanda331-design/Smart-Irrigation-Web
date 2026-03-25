# Smart Irrigation Web

A comprehensive, progressive web application for monitoring and controlling a solar-powered ESP32 irrigation system with advanced features for professional use.

## Features

### Core Functionality
- Real-time sensor data monitoring (soil moisture, water flow, battery, solar voltage)
- Weather integration with hourly precipitation forecasting
- Irrigation scheduling with intelligent predictions
- Multiple device switching and management
- Browser push notifications for critical alerts
- Offline capability with service worker caching

### Security & Authentication
- Bcrypt-hashed password protection (not Base64)
- Session management with inactivity lockout
- Failed login attempt limits with cooldown
- Server-side security header support via Vercel

### Smart Features
- **Predictive Irrigation**: Analyzes soil trends to forecast next irrigation time
- **Smart Advice**: AI-driven recommendations based on soil, weather, and battery levels
- **Critical Alerts**: Real-time warnings for soil <20%, battery <15%, solar <5V
- **Water Usage Tracking**: Liters used per irrigation event with cost estimation
- **System Health Dashboard**: Performance metrics, success rates, response times

### Advanced Scheduling
- Irrigation schedules with time, duration, and day selection
- 5 built-in presets: Conservative, Moderate, Aggressive, Summer, Winter
- Schedule search and filtering (enabled/disabled)
- Conflict detection for overlapping schedules
- One-click apply for preset profiles

### Analytics & Monitoring
- Historical trend charts (soil, water flow, battery, solar)
- Event logging with timestamps (100+ events tracked)
- System health report with uptime, fetch success rate
- CSV export for water usage, events, and health data
- Performance metrics tracking (response times, error logging)

### Accessibility & Mobile
- WCAG AA compliant contrast ratios
- ARIA labels for screen readers
- Keyboard navigation support (R=refresh, S=start, T=stop, L=lock, ?=help)
- Mobile-optimized UI with 44x44px touch targets
- Responsive design for all screen sizes
- Light/Dark theme toggle with persistent preference

### User Experience
- **Multi-Device Support**: Save and switch between multiple ESP32 devices
- **Debouncing & Caching**: 2s minimum fetch interval, 5s response cache
- **Exponential Backoff**: Auto-retry with increasing delays on failures
- **Live Connection Status**: Visual indicators and last update timestamps
- **Quick Actions**: Footer controls for water stats, health, event logs, and help

### Deployment & PWA
- Web App Manifest for "Install App" functionality
- HTTPS enforcement via Vercel
- Security headers (HSTS, X-Frame-Options, CSP)
- Automatic deployment on GitHub push

## Getting Started

### Local Development
```bash
# Serve locally
python -m http.server 8000
# or
npx http-server

# Open http://localhost:8000
```

### Deployment on Vercel
1. Push code to GitHub repository
2. Import repository on [vercel.com](https://vercel.com)
3. Vercel automatically deploys and provides a URL
4. HTTPS and security headers are automatically configured

### Setting Up
1. Open the app and login with password: `password123`
2. Enter your ESP32 IP address (e.g., 192.168.1.100)
3. Set location (auto-detect available) for weather forecasts
4. Create irrigation schedules or load a preset
5. Enable push notifications for alerts

## Keyboard Shortcuts
- **R**: Refresh data from ESP32
- **S**: Start irrigation (manual override)
- **T**: Stop irrigation (manual override)
- **L**: Lock session (requires password to unlock)
- **?**: Show this help menu

## API Requirements

### ESP32 Endpoints
- `GET /status` - Returns JSON with current sensor data
- `GET /ON` - Start irrigation
- `GET /OFF` - Stop irrigation
- `POST /set_schedule` - Accept schedule array

### Expected Status Response
```json
{
  "soil_moisture": 45,
  "water_flow": 2.5,
  "battery_voltage": 4.1,
  "battery_percentage": 85,
  "solar_voltage": 8.2,
  "valve_status": "ON"
}
```

## Password Security
The app uses bcrypt for password hashing. The default hash for "password123" is:
```
$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi
```

To change the password, use an online bcrypt generator and update `PASSWORD_HASH` in `script.js`.

## Browser Support
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers (iOS Safari, Chrome Android)

## Features Matrix

| Feature | Status |
|---------|--------|
| Real-time data monitoring | ✅ |
| Weather forecasting (hourly) | ✅ |
| Irrigation scheduling | ✅ |
| Smart predictions | ✅ |
| Multi-device support | ✅ |
| Event logging | ✅ |
| System health monitoring | ✅ |
| Accessibility (WCAG AA) | ✅ |
| Mobile responsiveness | ✅ |
| PWA (installable) | ✅ |
| Offline mode | ✅ |
| Performance monitoring | ✅ |

## Troubleshooting

**Can't connect to ESP32?**
- Verify ESP32 is on the same network
- Check IP address in device settings
- Ensure firewall allows connections to port 80

**No weather data showing?**
- Verify location is saved correctly
- Check internet connection
- Wait 30 minutes before refreshing (API throttling)

**Schedules not executing?**
- Ensure ESP32 has schedule-supporting firmware
- Check "Save to ESP32" was successful
- Verify ESP32 is powered and connected

**Push notifications not working?**
- Enable notifications in browser settings
- Check system notification settings
- Some browsers require HTTPS

## Future Enhancements
- Role-based access control (admin/user)
- Database integration for historical data
- Machine learning for predictive watering
- Mobile app (React Native)
- API documentation and webhook support