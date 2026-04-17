# Lumina - Interactive WLED Companion UI

Lumina is a highly visual, interactive web interface for controlling your WLED devices. It features an animated interactive Jellyfish companion, live weather condition syncing, hydration reminders, and complete control over your WLED light effects.

## 🌟 Overview
This project is built using purely client-side technologies (HTML, CSS, Vanilla JavaScript). It communicates directly with your WLED device via **RESTful API** or **MQTT** and pulls weather data to sync lighting settings dynamically based on local temperature and conditions.

## ✨ Features
- **Interactive Companion:** A virtual animated jellyfish that reacts to your routines.
- **WLED Control:** Easily pick effects, colors, and configure brightness, speed, and intensity.
- **Live Weather Integration:** Custom backgrounds and lighting mapping based on your real-time local weather.
- **Hydration Reminders:** Automated sequence to remind you to drink water at configurable intervals.
- **Dual Connect Modes:** Connects to WLED over the local network via REST or remotely using an MQTT broker.

---

##  How to Run Locally

If you've downloaded the repository or cloned it from GitHub to your computer, you have a few simple options to start the application.

### Option 1: Direct File Open
Since the project is completely client-side, the easiest way is:
1. Extract the downloaded folder.
2. Double-click the `index.html` file to open it in your default browser.

### Option 2: Run a Local Server
A local web server provides a more stable experience (especially for fetching resources and avoiding `file://` CORS restrictions):
- **Using Node.js:** Open a terminal in the folder and run:
  ```bash
  npx serve .
  ```
- **Using Python:** Open a terminal in the folder and run:
  ```bash
  python -m http.server 8000
  ```
- **VS Code:** Install the "Live Server" extension, right-click `index.html`, and select "Open with Live Server".

---

## 💡 WLED Configuration Setup

To make WLED listen to this app, you must configure a few settings in your WLED web interface.

### If using REST Mode (Local Network)
Go to **Config** > **Security & Updates** in WLED and make sure **CORS (Cross-Origin Resource Sharing)** is allowed. This allows your Vercel-hosted website to send commands to your local WLED IP address. 

### If using MQTT Mode
1. Go to **Config** > **Sync Interfaces**.
2. Scroll to the **MQTT** section.
3. Enable MQTT.
4. Enter your broker details (If you use the default public broker in the app, use `broker.hivemq.com` and the port depending on your WebSocket support, typically `8000`).
5. Set the "Device Topic" to match what you configured in Lumina's settings (e.g., `wled/lumina/hauers2026`).
6. *Note: As a browser-based application, Lumina must connect using **MQTT over WebSockets**. Regular TCP MQTT connections (like port `1883`) will not work.*

---

## ⛅ Getting your Weather API Key

This app fetches weather from OpenWeatherMap (or your configured weather provider).
1. Go to [OpenWeatherMap](https://openweathermap.org/).
2. Create a free account.
3. Go to the **API keys** section in your dashboard.
4. Generate a new key.
5. Paste this key into the **Lumina Web UI Settings** (Not the code!).
*Note: New keys can take up to 10-15 minutes to become active.*

---

## ⚠️ Limitations & Good to Know

- **HTTPS vs HTTP (Browser Security):** If you host this on a secure platform (like Vercel or GitHub Pages under `https://`), your browser will block direct REST communication to a local WLED device (`http://`) due to "Mixed Content" security rules.
  - *Workarounds:* Use **MQTT Mode**, click the padlock icon in your browser URL bar to explicitly "Allow insecure content" for the site, or simply run the HTML file locally on your computer instead of hosting it online.
- **Background Tab Throttling:** Because the hydration scheduler and weather fetching rely on browser JavaScript, modern browsers may pause or slow down the timers if the Lumina tab is inactive or minimized. For accurate timers, keep the tab visible or run it on a dedicated display.
- **Single Device Control:** The interface is currently designed to interact with and manage one WLED instance at a time.
- **Local Device Storage:** All of your configurations (IP addresses, UI preferences, and API keys) are saved in your browser's `localStorage`. They do not sync across different devices. If you clear your browser cache, you will need to re-enter your settings.
- **MQTT WebSockets:** Because this is a web application, it must connect to MQTT via **WebSockets** (commonly port `8000`, `8083`, or `9001`). It cannot connect via standard bare TCP MQTT (port `1883`).
