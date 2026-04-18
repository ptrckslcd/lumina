# 🪼 Project Lumina — Interactive WLED Companion UI

Lumina is a highly visual, interactive web-based interface designed to be the ultimate companion for your WLED smart lighting devices. Developed as an Internet of Things (IoT) Capstone Project by Team Hauers, it moves beyond standard remote control dashboards by blending utility with personality. Lumina features a physics-simulated "Digital Twin"—an animated jellyfish companion rendered on an HTML5 canvas that reacts to your routines, live weather data, and wellness reminders, seamlessly bridging the gap between your digital screen and physical environment.

--------------------------------------------------------------------------------

## ✨ Key Features

### 🐙 Interactive Digital Twin
A virtual, animated jellyfish entity lives within the UI, featuring smooth interpolation and procedural animation. This mascot reacts dynamically to changes in your physical lamp's state, acting as a visual representation of your lighting ecosystem.

### 🌈 Curated WLED Control
Lumina provides full control over your lighting's primary and secondary colors, brightness, speed, and intensity. To maintain a specific adaptive atmosphere aesthetic, the application currently supports a curated selection of WLED's built-in effects (such as Pacifica and Aurora) rather than the entire 100+ effect library.

### ☁️ Real-Time Weather Syncing
The application automatically pulls local weather data via the OpenWeatherMap API to update the UI background. It maps specific lighting presets to match your current climate, such as cool blues for rain or warm yellows for sunny conditions.

### 💧 Hydration & Wellness Reminders
Lumina includes a built-in scheduler that triggers specific ambient lighting sequences and mascot dialogue to remind you to drink water at configurable intervals.

### 🔌 Fault-Tolerant Hybrid Connectivity
Users can seamlessly switch between two modes of operation:
- Local REST API: For zero-latency home network control.
- WebSockets-based MQTT: For global remote management.

### 🧪 Developer Lab Tools
For advanced users, the interface includes experimental features such as a Raw JSON Payload Injector for testing custom WLED commands and a Morse Code visual flasher.

--------------------------------------------------------------------------------

## 🛠️ Technology Stack & Architecture

Lumina is built as a purely client-side application (Static Site), ensuring privacy, rapid loading times, and ease of deployment.

- Frontend: Vanilla JavaScript (ES6+), HTML5 Canvas Engine, and CSS3 featuring a Glassmorphism UI.
- State Management: Utilizes the browser's native localStorage to persist user settings, API keys, and UI preferences across sessions without the need for a backend database.
- External Integrations: Powered by the OpenWeatherMap API for live atmospheric data parsing.
- Connectivity Protocols:
  - RESTful HTTP: Direct edge-network communication via /json/state for high-speed local control.
  - MQTT over WebSockets: Remote cloud control capability utilizing Eclipse Paho MQTT.

--------------------------------------------------------------------------------

## 📁 Repository Structure

The project consists of the following core files:

| File | Description |
| --- | --- |
| index.html | The main entry point and UI structure. |
| app.js | Core application logic and state management. |
| weather-animations.js | Logic for dynamic backgrounds and weather-based lighting. |
| party-mode-effects.js | Specialized lighting sequences for high-energy environments. |
| fakeLamp.js | A utility for simulating WLED hardware during development. |
| loader.js / loader.css | Visual assets for the initial application loading sequence. |
| style.css | Primary Glassmorphism styling. |
| mobile-block.css | Constraints and styling for mobile device responsiveness. |

--------------------------------------------------------------------------------

## 🚀 Getting Started

### Prerequisites

- A microcontroller (for example ESP32/ESP8266) running WLED v0.12 or higher.
- A modern web browser (Chrome, Firefox, Edge, or Safari).
- Optional: An OpenWeatherMap API key for weather syncing features.

### How to Run Locally

Because Lumina is a pure frontend app, you can run it in several ways.

#### Option 1: Local Web Server (Recommended)
To avoid strict file:// CORS restrictions, serve the folder locally:

- Node.js: Run npx serve . in the project directory.
- Python: Run python -m http.server 8000 in the project directory.
- VS Code: Install the Live Server extension, right-click index.html, and select Open with Live Server.

#### Option 2: Direct File Open
Extract the folder and double-click index.html to open it in your default browser.

--------------------------------------------------------------------------------

## ⚙️ Configuration Setup

### 1. WLED REST Configuration (Local Network)
In your WLED web interface, navigate to Config > Security & Updates and ensure CORS (Cross-Origin Resource Sharing) is allowed. This is required if the app is hosted on a platform like Vercel or GitHub Pages to allow commands to be sent to your local IP.

### 2. MQTT Configuration (Remote Control)
Navigate to Config > Sync Interfaces > MQTT in WLED.

- Enable MQTT and enter your broker details (for example broker.hivemq.com).
- Set the Device Topic to match your Lumina settings (for example wled/lumina/hauers2026).
- Note: Lumina must connect using MQTT over WebSockets (typically port 8000, 8083, or 9001). Standard TCP MQTT (port 1883) is unsupported by web browsers.

### 3. Weather API Key

- Register for a free account at OpenWeatherMap.
- Generate a new API key from your dashboard.
- Paste this key into the Lumina Web UI Settings menu (not the source code).
- New keys may take 10-15 minutes to activate.

--------------------------------------------------------------------------------

## ⚠️ Limitations & Security

- HTTPS vs HTTP (Mixed Content): If Lumina is hosted on a secure https:// platform, browsers will block REST commands to local http:// WLED devices. To fix this, use MQTT Mode, click the browser padlock icon to allow insecure content, or run the app locally.
- Background Throttling: Modern browsers may pause timers for the hydration scheduler or weather fetching if the Lumina tab is inactive or minimized.
- Single Device: The interface is currently designed to manage one WLED instance at a time.
- Local Storage: All configurations are saved in your browser's localStorage. These settings do not sync across different devices and will be lost if you clear your browser cache.

--------------------------------------------------------------------------------

## 👨‍💻 Developed By

Team Hauers — IoT Capstone Project.
