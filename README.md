# Smart Irrigation Web

A web-based dashboard for monitoring and controlling a solar-powered ESP32 irrigation system.

## Features
- Real-time sensor data from ESP32
- Weather integration with precipitation forecasting
- Browser notifications for alerts
- Offline capability with service worker
- Data visualization with charts
- Auto-location detection with IP fallback

## Deployment on Vercel
1. Sign up at [vercel.com](https://vercel.com).
2. Connect your GitHub repository or upload the project files.
3. Vercel will automatically detect and deploy the static site.
4. Access your deployed app at the provided URL.

## Local Development
Run a local server (e.g., `python -m http.server`) and open `index.html`.

## ESP32 Integration
Ensure the ESP32 is running on your network. Update the fetch URLs in `script.js` if needed for remote access.