import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import http from 'http';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const CHUNKS_DIR = path.join(DATA_DIR, 'temp_chunks');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// Ensure directories exist
[DATA_DIR, UPLOADS_DIR, CHUNKS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Lightweight File-based Database Helper
class FileDB {
  constructor(filepath) {
    this.filepath = filepath;
    this.data = { videos: [], progress: {} };
    this.load();
  }

  load() {
    try {
      if (fs.existsSync(this.filepath)) {
        const content = fs.readFileSync(this.filepath, 'utf8');
        this.data = JSON.parse(content);
        if (!this.data.videos) this.data.videos = [];
        if (!this.data.progress) this.data.progress = {};
      } else {
        this.save();
      }
    } catch (err) {
      console.error('Error loading DB file:', err);
    }
  }

  save() {
    try {
      fs.writeFileSync(this.filepath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      console.error('Error writing DB file:', err);
    }
  }

  getVideos() {
    return (this.data.videos || []).sort((a, b) => b.created_at - a.created_at);
  }

  getVideo(id) {
    return (this.data.videos || []).find(v => v.id === id);
  }

  addVideo(video) {
    this.data.videos.push(video);
    this.save();
  }

  deleteVideo(id) {
    this.data.videos = (this.data.videos || []).filter(v => v.id !== id);
    Object.keys(this.data.progress || {}).forEach(key => {
      if (key.startsWith(`${id}_`)) {
        delete this.data.progress[key];
      }
    });
    this.save();
  }

  saveProgress(videoId, userId, timestamp, duration) {
    const key = `${videoId}_${userId}`;
    if (!this.data.progress) this.data.progress = {};
    this.data.progress[key] = {
      videoId,
      userId,
      timestamp: Number(timestamp) || 0,
      duration: Number(duration) || 0,
      updated_at: Date.now()
    };
    this.save();
  }

  getProgress(videoId, userId) {
    const key = `${videoId}_${userId}`;
    return (this.data.progress && this.data.progress[key]) || { timestamp: 0, duration: 0 };
  }
}

const db = new FileDB(DB_FILE);

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to download raw URL following redirects
function downloadRawStream(targetUrl, destinationPath, maxRedirects = 10) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects'));

    const protocol = targetUrl.startsWith('https') ? https : http;

    const request = protocol.get(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        let redirectUrl = response.headers.location;
        if (!redirectUrl.startsWith('http')) {
          const parsed = new URL(targetUrl);
          redirectUrl = `${parsed.protocol}//${parsed.host}${redirectUrl}`;
        }
        return downloadRawStream(redirectUrl, destinationPath, maxRedirects - 1).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        return reject(new Error(`HTTP ${response.statusCode}`));
      }

      const fileStream = fs.createWriteStream(destinationPath);
      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close(() => resolve({
          contentType: response.headers['content-type'],
          contentLength: Number(response.headers['content-length']) || fs.statSync(destinationPath).size
        }));
      });

      fileStream.on('error', (err) => {
        fs.unlink(destinationPath, () => reject(err));
      });
    });

    request.on('error', (err) => {
      fs.unlink(destinationPath, () => reject(err));
    });
  });
}

// Google Drive 20GB Virus Scan Bypass Link Extractor
async function fetchGoogleDriveDirectInfo(fileId) {
  const initialUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download`;

  return new Promise((resolve, reject) => {
    https.get(initialUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    }, (res) => {
      let html = '';
      res.on('data', chunk => html += chunk);
      res.on('end', () => {
        const uuidMatch = html.match(/name="uuid"\s+value="([^"]+)"/);
        const confirmMatch = html.match(/name="confirm"\s+value="([^"]+)"/);
        const titleMatch = html.match(/<span class="uc-name-size"><a[^>]*>(.*?)<\/a>/);

        const title = titleMatch ? titleMatch[1].trim() : 'Google Drive Video';

        if (uuidMatch && confirmMatch) {
          const directUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=${confirmMatch[1]}&uuid=${uuidMatch[1]}`;
          resolve({ title, directUrl });
        } else {
          // Fallback standard export URL
          const fallbackUrl = `https://drive.google.com/uc?export=download&id=${fileId}&confirm=t`;
          resolve({ title, directUrl: fallbackUrl });
        }
      });
    }).on('error', reject);
  });
}

// Helper to extract Google Drive File ID from shared links
function extractGoogleDriveFileId(rawUrl) {
  const matchD = rawUrl.match(/\/d\/([a-zA-Z0-9_-]+)/);
  const matchId = rawUrl.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (matchD && matchD[1]) return matchD[1];
  if (matchId && matchId[1]) return matchId[1];
  return null;
}

// --- API ROUTES ---

// 1. List all videos
app.get('/api/videos', (req, res) => {
  try {
    const videos = db.getVideos();
    res.json({ success: true, videos });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Get single video details
app.get('/api/video/:id', (req, res) => {
  try {
    const video = db.getVideo(req.params.id);
    if (!video) return res.status(404).json({ error: 'Video not found' });
    res.json({ success: true, video });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Initiate Chunked Upload
app.post('/api/upload/init', (req, res) => {
  try {
    let { title, fileName, fileSize, totalChunks, mimeType } = req.body;
    
    if (!fileName) {
      return res.status(400).json({ error: 'fileName is required' });
    }

    const safeTitle = title || fileName.replace(/\.[^/.]+$/, "") || 'Untitled Video';
    const uploadId = crypto.randomUUID();
    const sessionDir = path.join(CHUNKS_DIR, uploadId);
    fs.mkdirSync(sessionDir, { recursive: true });

    // Save session metadata
    const metaPath = path.join(sessionDir, 'meta.json');
    fs.writeFileSync(metaPath, JSON.stringify({
      uploadId,
      title: safeTitle,
      fileName,
      fileSize: Number(fileSize) || 0,
      totalChunks: Math.max(1, Number(totalChunks) || 1),
      mimeType: mimeType || 'video/mp4',
      created: Date.now()
    }));

    res.json({ success: true, uploadId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Direct Stream Pipe Upload for Chunks (Zero RAM overhead)
app.post('/api/upload/chunk', (req, res) => {
  try {
    const uploadId = req.headers['x-upload-id'] || req.query.uploadId;
    const chunkIndex = req.headers['x-chunk-index'] || req.query.chunkIndex;

    if (!uploadId || chunkIndex === undefined) {
      return res.status(400).json({ error: 'Missing uploadId or chunkIndex' });
    }

    const sessionDir = path.join(CHUNKS_DIR, String(uploadId));
    if (!fs.existsSync(sessionDir)) {
      return res.status(404).json({ error: 'Upload session not found or expired' });
    }

    const chunkPath = path.join(sessionDir, `chunk_${chunkIndex}`);
    const writeStream = fs.createWriteStream(chunkPath);

    req.pipe(writeStream);

    writeStream.on('finish', () => {
      res.json({ success: true, chunkIndex: Number(chunkIndex) });
    });

    writeStream.on('error', (err) => {
      res.status(500).json({ error: err.message });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Complete Upload & Assemble Chunks
app.post('/api/upload/complete', async (req, res) => {
  try {
    const { uploadId } = req.body;
    if (!uploadId) return res.status(400).json({ error: 'Missing uploadId' });

    const sessionDir = path.join(CHUNKS_DIR, uploadId);
    const metaPath = path.join(sessionDir, 'meta.json');

    if (!fs.existsSync(metaPath)) {
      return res.status(404).json({ error: 'Upload metadata not found' });
    }

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const videoId = crypto.randomUUID();
    const fileExt = path.extname(meta.fileName) || '.mp4';
    const finalFilename = `${videoId}${fileExt}`;
    const finalFilePath = path.join(UPLOADS_DIR, finalFilename);

    const writeStream = fs.createWriteStream(finalFilePath);

    for (let i = 0; i < meta.totalChunks; i++) {
      const chunkPath = path.join(sessionDir, `chunk_${i}`);
      if (!fs.existsSync(chunkPath)) {
        writeStream.close();
        if (fs.existsSync(finalFilePath)) fs.unlinkSync(finalFilePath);
        return res.status(400).json({ error: `Missing chunk ${i}` });
      }
      const buffer = fs.readFileSync(chunkPath);
      writeStream.write(buffer);
    }

    writeStream.end();

    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    const stat = fs.statSync(finalFilePath);

    // Clean up temporary chunks
    fs.rmSync(sessionDir, { recursive: true, force: true });

    // Save to Database
    const newVideo = {
      id: videoId,
      title: meta.title,
      filename: finalFilename,
      filesize: stat.size || meta.fileSize,
      mime_type: meta.mimeType,
      created_at: Date.now()
    };

    db.addVideo(newVideo);

    res.json({ success: true, video: newVideo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Direct Import from Google Drive / URL Endpoint (Handles 20GB+ virus scan bypass)
app.post('/api/upload/url', async (req, res) => {
  try {
    const { url, title } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    let targetUrl = url;
    let autoTitle = title;

    const gdriveId = extractGoogleDriveFileId(url);
    if (gdriveId) {
      console.log(`Extracting Google Drive direct info for File ID: ${gdriveId}...`);
      const gdriveInfo = await fetchGoogleDriveDirectInfo(gdriveId);
      targetUrl = gdriveInfo.directUrl;
      if (!autoTitle) autoTitle = gdriveInfo.title;
      console.log(`Resolved Google Drive Direct Stream URL: ${targetUrl}`);
    }

    const videoId = crypto.randomUUID();
    const finalFilename = `${videoId}.mp4`;
    const finalFilePath = path.join(UPLOADS_DIR, finalFilename);

    console.log(`Downloading stream from ${targetUrl} to ${finalFilePath}...`);
    const streamMeta = await downloadRawStream(targetUrl, finalFilePath);

    const stat = fs.statSync(finalFilePath);
    const safeTitle = autoTitle || 'Imported Video';

    const newVideo = {
      id: videoId,
      title: safeTitle,
      filename: finalFilename,
      filesize: stat.size || streamMeta.contentLength,
      mime_type: streamMeta.contentType || 'video/mp4',
      created_at: Date.now()
    };

    db.addVideo(newVideo);

    res.json({ success: true, video: newVideo });
  } catch (err) {
    console.error('URL import error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 7. Delete Video
app.delete('/api/video/:id', (req, res) => {
  try {
    const videoId = req.params.id;
    const video = db.getVideo(videoId);

    if (!video) return res.status(404).json({ error: 'Video not found' });

    // Delete file
    const filePath = path.join(UPLOADS_DIR, video.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Delete DB record
    db.deleteVideo(videoId);

    res.json({ success: true, message: 'Video deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Video Streaming Endpoint (HTTP 206 Partial Content Range Requests for 9+ hour files)
app.get('/api/video/:id/stream', (req, res) => {
  try {
    const video = db.getVideo(req.params.id);

    if (!video) return res.status(404).json({ error: 'Video not found' });

    const videoPath = path.join(UPLOADS_DIR, video.filename);
    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ error: 'Video file missing from storage' });
    }

    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize) {
        res.status(416).send(`Requested range not satisfiable\n${start} >= ${fileSize}`);
        return;
      }

      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(videoPath, { start, end });
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': video.mime_type || 'video/mp4',
      };

      res.writeHead(206, head);
      file.pipe(res);
    } else {
      const head = {
        'Content-Length': fileSize,
        'Content-Type': video.mime_type || 'video/mp4',
      };
      res.writeHead(200, head);
      fs.createReadStream(videoPath).pipe(res);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 9. Save Playback Progress (Resume feature)
app.post('/api/progress', (req, res) => {
  try {
    const { videoId, userId, timestamp, duration } = req.body;
    if (!videoId || !userId || timestamp === undefined) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    db.saveProgress(videoId, userId, timestamp, duration);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 10. Get Playback Progress
app.get('/api/progress/:videoId', (req, res) => {
  try {
    const { videoId } = req.params;
    const userId = req.query.userId;

    if (!userId) return res.status(400).json({ error: 'userId parameter is required' });

    const progress = db.getProgress(videoId, userId);
    res.json({ success: true, progress });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Catch-all route to SPA index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(` StreamResume Server active on port ${PORT}`);
  console.log(` Data Directory: ${DATA_DIR}`);
  console.log(`===================================================`);
});
