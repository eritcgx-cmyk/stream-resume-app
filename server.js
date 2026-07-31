import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

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
      timestamp,
      duration: duration || 0,
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

// Raw body parser for binary chunks up to 50MB
app.use('/api/upload/chunk', express.raw({ type: '*/*', limit: '50mb' }));

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
    
    // Auto-fallback for title if missing
    if (!title && fileName) {
      title = fileName.replace(/\.[^/.]+$/, "");
    }

    if (!fileName || fileSize === undefined || fileSize === null || totalChunks === undefined || totalChunks === null) {
      return res.status(400).json({ error: 'Missing required upload parameters (fileName, fileSize, or totalChunks)' });
    }

    const safeTitle = title || 'Untitled Video';
    const uploadId = crypto.randomUUID();
    const sessionDir = path.join(CHUNKS_DIR, uploadId);
    fs.mkdirSync(sessionDir, { recursive: true });

    // Save session metadata
    const metaPath = path.join(sessionDir, 'meta.json');
    fs.writeFileSync(metaPath, JSON.stringify({
      uploadId,
      title: safeTitle,
      fileName,
      fileSize: Number(fileSize),
      totalChunks: Math.max(1, Number(totalChunks)),
      mimeType: mimeType || 'video/mp4',
      created: Date.now()
    }));

    res.json({ success: true, uploadId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Upload a Chunk
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
    fs.writeFileSync(chunkPath, req.body);

    res.json({ success: true, chunkIndex: Number(chunkIndex) });
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

    // Clean up temporary chunks
    fs.rmSync(sessionDir, { recursive: true, force: true });

    // Save to Database
    const newVideo = {
      id: videoId,
      title: meta.title,
      filename: finalFilename,
      filesize: meta.fileSize,
      mime_type: meta.mimeType,
      created_at: Date.now()
    };

    db.addVideo(newVideo);

    res.json({ success: true, video: newVideo });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Delete Video
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

// 7. Video Streaming Endpoint (HTTP 206 Partial Content Range Requests for 9+ hour files)
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

// 8. Save Playback Progress (Resume feature)
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

// 9. Get Playback Progress
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
