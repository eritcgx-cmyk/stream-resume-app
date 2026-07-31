# 🎬 StreamResume — Large Video Cloud Player & Auto-Resume Platform

A cloud-ready web application specifically designed to upload, host, stream, and automatically track watch progress for videos of any length — including multi-gigabyte **9+ hour videos**.

---

## ✨ Features

- ⚡ **9+ Hour Video Support**: Uses 5MB chunked HTTP streaming uploads so massive video files upload reliably without connection timeouts.
- 🔖 **Auto-Resume Playback**: Tracks watch position down to the exact second (saved in SQLite & localStorage). When you open a video again, it auto-seeks to where you left off.
- 📡 **HTTP Range Streaming (`206 Partial Content`)**: Smooth seeking and fast scrubbing across multi-gigabyte videos without downloading the full video into browser RAM.
- 🎨 **Dark Glassmorphic UI**: Vibrant, responsive layout built with custom CSS, animated glowing ambient lights, micro-interactions, speed control (0.5x – 2.0x), and +/-10s quick jump controls.
- ☁️ **Cloud Deployment Ready**: Preconfigured with `render.yaml` for instant Render.com deployment with Persistent Disk mounting.

---

## 🚀 Quick Start (Local Setup)

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
```bash
npm start
```
Or for auto-reload development mode:
```bash
npm run dev
```

### 3. Open in Browser
Visit `http://localhost:3000` in your web browser.

---

## ☁️ How to Host on Render.com (Cloud Deployment)

Render allows hosting Node.js web services with **Persistent Disks** so your uploaded 9-hour videos and SQLite progress database persist across server restarts.

### Step-by-Step Deployment:

1. **Push your code to GitHub**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit of StreamResume app"
   git remote add origin https://github.com/YOUR_USERNAME/stream-resume-app.git
   git push -u origin main
   ```

2. **Deploy on Render**:
   - Go to [dashboard.render.com](https://dashboard.render.com/) and click **New +** -> **Blueprints**.
   - Connect your GitHub repository.
   - Render will detect `render.yaml` automatically and prompt you to create the service with a **Persistent Disk** mounted at `/data`.

3. **Alternative Manual Setup on Render**:
   - Click **New +** -> **Web Service**.
   - **Environment**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - Under **Advanced**:
     - Add Environment Variable: `DATA_DIR` = `/data`
   - Under **Disks**:
     - Click **Add Disk**
     - **Name**: `video-storage`
     - **Mount Path**: `/data`
     - **Size**: Set size based on your video storage needs (e.g. 10GB–50GB).

---

## 🛠️ Architecture & Technical Highlights

```
┌─────────────────┐       HTTP Range (206)      ┌───────────────────────┐
│                 │ ◄─────────────────────────► │                       │
│  HTML5 Video    │  Resumable Chunked Upload   │  Node.js / Express    │
│     Player      │ ──────────────────────────► │     Backend API       │
│                 │      Save Position (POST)   │                       │
└─────────────────┘ ──────────────────────────► └───────────┬───────────┘
                                                            │
                                                   ┌────────┴────────┐
                                                   │ Persistent Disk │
                                                   │ /data/uploads/  │
                                                   │ /data/*.db      │
                                                   └─────────────────┘
```

1. **Chunked Upload Pipeline**:
   - The frontend slices large video files into 5MB chunks using `Blob.prototype.slice()`.
   - Each chunk is transmitted individually over HTTP with speed and ETA calculation.
   - The server stores chunks in `/data/temp_chunks/[uploadId]/` and assembles them into `/data/uploads/[id].mp4` upon completion.

2. **HTTP Range Streaming**:
   - Express handles `Range: bytes=start-end` headers.
   - The video tag receives 206 Partial Content responses, enabling instantaneous scrubbing anywhere in a 9-hour timeline.

3. **Progress Synchronization**:
   - Playback timestamp is saved automatically every 4 seconds, as well as on `pause`, `seek`, and window unload.
   - Saved progress is linked to a persistent device ID in SQLite database `playback_progress` table.
