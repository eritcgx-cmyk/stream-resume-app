// Application State & User Device Identity
let USER_ID = getOrCreateUserId();
const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB chunks for reliable streaming upload

let currentVideos = [];
let activeUploadController = null;
let currentPlayingVideo = null;
let autoSaveInterval = null;

// DOM Elements
const videoGrid = document.getElementById('videoGrid');
const emptyState = document.getElementById('emptyState');
const refreshBtn = document.getElementById('refreshBtn');

// Profile Sync Elements
const profileSyncBtn = document.getElementById('profileSyncBtn');
const currentProfileName = document.getElementById('currentProfileName');
const profileModal = document.getElementById('profileModal');
const closeProfileModal = document.getElementById('closeProfileModal');
const profileInput = document.getElementById('profileInput');
const saveProfileBtn = document.getElementById('saveProfileBtn');

// Modal & Tab Elements
const openUploadBtn = document.getElementById('openUploadBtn');
const emptyUploadBtn = document.getElementById('emptyUploadBtn');
const uploadModal = document.getElementById('uploadModal');
const closeUploadModal = document.getElementById('closeUploadModal');
const tabLocalUploadBtn = document.getElementById('tabLocalUploadBtn');
const tabDriveImportBtn = document.getElementById('tabDriveImportBtn');
const uploadForm = document.getElementById('uploadForm');
const urlImportForm = document.getElementById('urlImportForm');

// Local Upload Form Elements
const cancelUploadBtn = document.getElementById('cancelUploadBtn');
const videoTitleInput = document.getElementById('videoTitle');
const videoFileInput = document.getElementById('videoFileInput');
const dropZone = document.getElementById('dropZone');
const selectedFileInfo = document.getElementById('selectedFileInfo');
const selectedFileName = document.getElementById('selectedFileName');
const selectedFileSize = document.getElementById('selectedFileSize');
const startUploadBtn = document.getElementById('startUploadBtn');

// Local Upload Progress Elements
const uploadProgressSection = document.getElementById('uploadProgressSection');
const uploadStatusText = document.getElementById('uploadStatusText');
const uploadPercent = document.getElementById('uploadPercent');
const uploadProgressBar = document.getElementById('uploadProgressBar');
const uploadSpeed = document.getElementById('uploadSpeed');
const uploadEta = document.getElementById('uploadEta');

// URL / Google Drive Import Elements
const urlTitleInput = document.getElementById('urlTitleInput');
const urlLinkInput = document.getElementById('urlLinkInput');
const startUrlImportBtn = document.getElementById('startUrlImportBtn');
const cancelUrlImportBtn = document.getElementById('cancelUrlImportBtn');
const urlImportStatus = document.getElementById('urlImportStatus');
const urlImportText = document.getElementById('urlImportText');

// Player Elements
const playerModal = document.getElementById('playerModal');
const closePlayerModal = document.getElementById('closePlayerModal');
const playerVideoTitle = document.getElementById('playerVideoTitle');
const mainVideoPlayer = document.getElementById('mainVideoPlayer');
const playerResumeBadge = document.getElementById('playerResumeBadge');
const playerResumeTime = document.getElementById('playerResumeTime');
const saveToast = document.getElementById('saveToast');
const seekBack10Btn = document.getElementById('seekBack10Btn');
const seekFwd10Btn = document.getElementById('seekFwd10Btn');
const speedSelect = document.getElementById('speedSelect');
const currentTimeDisplay = document.getElementById('currentTimeDisplay');
const durationDisplay = document.getElementById('durationDisplay');

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  updateProfileUI();
  setupEventListeners();
  loadVideos();
});

// Get or generate local Device/User ID
function getOrCreateUserId() {
  let uid = localStorage.getItem('stream_resume_user_id');
  if (!uid) {
    uid = 'Default';
    localStorage.setItem('stream_resume_user_id', uid);
  }
  return uid;
}

function updateProfileUI() {
  currentProfileName.textContent = USER_ID;
  profileInput.value = USER_ID;
}

// Event Listeners
function setupEventListeners() {
  refreshBtn.addEventListener('click', loadVideos);
  openUploadBtn.addEventListener('click', showUploadModal);
  emptyUploadBtn.addEventListener('click', showUploadModal);
  closeUploadModal.addEventListener('click', hideUploadModal);
  cancelUploadBtn.addEventListener('click', hideUploadModal);
  cancelUrlImportBtn.addEventListener('click', hideUploadModal);

  // Tabs
  tabLocalUploadBtn.addEventListener('click', () => switchTab('local'));
  tabDriveImportBtn.addEventListener('click', () => switchTab('drive'));

  // Profile modal listeners
  profileSyncBtn.addEventListener('click', () => profileModal.classList.remove('hidden'));
  closeProfileModal.addEventListener('click', () => profileModal.classList.add('hidden'));
  saveProfileBtn.addEventListener('click', handleProfileSave);

  // Drag and drop setup
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      videoFileInput.files = e.dataTransfer.files;
      handleFileSelected();
    }
  });

  videoFileInput.addEventListener('change', handleFileSelected);
  uploadForm.addEventListener('submit', handleUploadSubmit);
  urlImportForm.addEventListener('submit', handleUrlImportSubmit);

  // Player controls
  closePlayerModal.addEventListener('click', closePlayer);
  seekBack10Btn.addEventListener('click', () => jumpTime(-10));
  seekFwd10Btn.addEventListener('click', () => jumpTime(10));
  speedSelect.addEventListener('change', (e) => {
    mainVideoPlayer.playbackRate = parseFloat(e.target.value);
  });

  // Video time events
  mainVideoPlayer.addEventListener('timeupdate', updateTimeDisplays);
  mainVideoPlayer.addEventListener('pause', () => savePlaybackPosition(true));
  
  // Close player modal on ESC key
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!playerModal.classList.contains('hidden')) closePlayer();
      if (!uploadModal.classList.contains('hidden')) hideUploadModal();
      if (!profileModal.classList.contains('hidden')) profileModal.classList.add('hidden');
    }
  });
}

function switchTab(mode) {
  if (mode === 'local') {
    tabLocalUploadBtn.classList.add('active');
    tabDriveImportBtn.classList.remove('active');
    uploadForm.classList.remove('hidden');
    urlImportForm.classList.add('hidden');
  } else {
    tabDriveImportBtn.classList.add('active');
    tabLocalUploadBtn.classList.remove('active');
    urlImportForm.classList.remove('hidden');
    uploadForm.classList.add('hidden');
  }
}

function handleProfileSave() {
  const newName = profileInput.value.trim();
  if (!newName) return;

  USER_ID = newName;
  localStorage.setItem('stream_resume_user_id', USER_ID);
  updateProfileUI();
  profileModal.classList.add('hidden');
  loadVideos();
}

// Format bytes to human readable string
function formatBytes(bytes) {
  const num = Number(bytes);
  if (!num || isNaN(num) || num <= 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(num) / Math.log(k));
  return parseFloat((num / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Format seconds into HH:MM:SS
function formatTime(seconds) {
  if (isNaN(seconds) || seconds === null) return '00:00:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const pad = (num) => String(num).padStart(2, '0');
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
}

// Load Videos from Server
async function loadVideos() {
  videoGrid.innerHTML = `
    <div class="video-card skeleton"></div>
    <div class="video-card skeleton"></div>
    <div class="video-card skeleton"></div>
  `;
  emptyState.classList.add('hidden');

  try {
    const res = await fetch('/api/videos');
    const data = await res.json();

    if (!data.success || !data.videos || data.videos.length === 0) {
      videoGrid.innerHTML = '';
      emptyState.classList.remove('hidden');
      currentVideos = [];
      return;
    }

    currentVideos = data.videos;
    renderVideoGrid(data.videos);
  } catch (err) {
    console.error('Failed to load videos:', err);
    videoGrid.innerHTML = `<div class="empty-state glass-panel"><p style="color:#ef4444;">Failed to connect to server.</p></div>`;
  }
}

// Render Video Grid
async function renderVideoGrid(videos) {
  videoGrid.innerHTML = '';

  for (const video of videos) {
    const card = document.createElement('div');
    card.className = 'video-card';

    let progressSeconds = 0;
    let durationSeconds = 0;
    try {
      const pRes = await fetch(`/api/progress/${video.id}?userId=${encodeURIComponent(USER_ID)}`);
      const pData = await pRes.json();
      if (pData.success && pData.progress) {
        progressSeconds = pData.progress.timestamp || 0;
        durationSeconds = pData.progress.duration || 0;
      }
    } catch (e) {
      console.warn('Could not fetch progress for video', video.id);
    }

    const progressPercent = durationSeconds > 0 ? Math.min(100, (progressSeconds / durationSeconds) * 100) : 0;
    const formattedCreated = new Date(video.created_at).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric'
    });

    card.innerHTML = `
      <div class="card-thumbnail" onclick="openPlayer('${video.id}')">
        <i class="fa-solid fa-circle-play play-icon"></i>
        ${durationSeconds > 0 ? `<div class="card-duration-badge">${formatTime(durationSeconds)}</div>` : ''}
        <div class="card-progress-bar" style="width: ${progressPercent}%;"></div>
      </div>
      <div class="card-body">
        <h3 class="card-title" title="${escapeHtml(video.title)}">${escapeHtml(video.title)}</h3>
        <div class="card-meta">
          <span><i class="fa-solid fa-hard-drive"></i> ${formatBytes(video.filesize)}</span>
          <span><i class="fa-solid fa-calendar"></i> ${formattedCreated}</span>
        </div>
        ${progressSeconds > 5 ? `
          <div class="resume-status-text">
            <i class="fa-solid fa-bookmark"></i> Resumes at ${formatTime(progressSeconds)}
          </div>
        ` : `
          <div class="resume-status-text" style="color:var(--text-muted);">
            <i class="fa-solid fa-play"></i> Ready to watch
          </div>
        `}
        <div class="card-actions">
          <button class="btn btn-primary btn-sm" onclick="openPlayer('${video.id}')">
            <i class="fa-solid fa-play"></i> Watch Now
          </button>
          <button class="btn btn-danger btn-sm" onclick="deleteVideo('${video.id}', event)">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    `;

    videoGrid.appendChild(card);
  }
}

// Helper to sanitize text
function escapeHtml(text) {
  const div = document.createElement('div');
  div.innerText = text;
  return div.innerHTML;
}

// Handle File Selection
function handleFileSelected() {
  const file = videoFileInput.files[0];
  if (!file) return;

  selectedFileName.textContent = file.name;
  selectedFileSize.textContent = formatBytes(file.size);
  selectedFileInfo.classList.remove('hidden');

  if (!videoTitleInput.value.trim()) {
    const nameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
    videoTitleInput.value = nameWithoutExt;
  }

  startUploadBtn.disabled = false;
}

// Show & Hide Upload Modal
function showUploadModal() {
  uploadModal.classList.remove('hidden');
}

function hideUploadModal() {
  if (activeUploadController) {
    if (!confirm('Upload is currently in progress. Are you sure you want to cancel?')) {
      return;
    }
    activeUploadController.abort();
    activeUploadController = null;
  }

  uploadModal.classList.add('hidden');
  resetUploadForm();
}

function resetUploadForm() {
  uploadForm.reset();
  urlImportForm.reset();
  selectedFileInfo.classList.add('hidden');
  uploadProgressSection.classList.add('hidden');
  urlImportStatus.classList.add('hidden');
  startUploadBtn.disabled = true;
  startUrlImportBtn.disabled = false;
  uploadProgressBar.style.width = '0%';
}

// Handle Resumable Chunked Upload
async function handleUploadSubmit(e) {
  e.preventDefault();

  const file = videoFileInput.files[0];
  if (!file) return;

  const rawTitle = videoTitleInput.value.trim();
  const title = rawTitle || file.name.replace(/\.[^/.]+$/, "") || "Untitled Video";

  startUploadBtn.disabled = true;
  uploadProgressSection.classList.remove('hidden');

  const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
  activeUploadController = new AbortController();

  const startTime = Date.now();

  try {
    uploadStatusText.textContent = 'Initializing upload session...';
    const initRes = await fetch('/api/upload/init', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: title,
        fileName: file.name || 'video.mp4',
        fileSize: Number(file.size),
        totalChunks: totalChunks,
        mimeType: file.type || 'video/mp4'
      }),
      signal: activeUploadController.signal
    });

    const initData = await initRes.json();
    if (!initData.success) throw new Error(initData.error || 'Failed to start upload session');

    const uploadId = initData.uploadId;

    let uploadedBytes = 0;

    for (let i = 0; i < totalChunks; i++) {
      if (activeUploadController.signal.aborted) return;

      const start = i * CHUNK_SIZE;
      const end = Math.min(file.size, start + CHUNK_SIZE);
      const chunkBlob = file.slice(start, end);

      uploadStatusText.textContent = `Uploading chunk ${i + 1} of ${totalChunks}...`;

      const chunkRes = await fetch(`/api/upload/chunk?uploadId=${uploadId}&chunkIndex=${i}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream'
        },
        body: chunkBlob,
        signal: activeUploadController.signal
      });

      if (!chunkRes.ok) throw new Error(`Failed to upload chunk ${i + 1}`);

      uploadedBytes += (end - start);

      const percent = Math.round((uploadedBytes / file.size) * 100);
      const elapsedTime = Math.max(0.1, (Date.now() - startTime) / 1000);
      const speed = uploadedBytes / elapsedTime;
      const remainingBytes = file.size - uploadedBytes;
      const etaSeconds = speed > 0 ? Math.round(remainingBytes / speed) : 0;

      uploadPercent.textContent = `${percent}%`;
      uploadProgressBar.style.width = `${percent}%`;
      uploadSpeed.textContent = `${formatBytes(speed)}/s`;
      uploadEta.textContent = `ETA: ${formatTime(etaSeconds)}`;
    }

    uploadStatusText.textContent = 'Assembling video file on server...';
    uploadEta.textContent = 'Finalizing...';

    const completeRes = await fetch('/api/upload/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId }),
      signal: activeUploadController.signal
    });

    const completeData = await completeRes.json();
    if (!completeData.success) throw new Error(completeData.error || 'Failed to complete video assembly');

    uploadStatusText.textContent = 'Upload completed successfully!';
    uploadProgressBar.style.backgroundColor = '#10b981';

    setTimeout(() => {
      hideUploadModal();
      loadVideos();
    }, 1200);

  } catch (err) {
    if (err.name === 'AbortError') {
      console.log('Upload aborted by user');
    } else {
      console.error('Upload Error:', err);
      alert(`Upload failed: ${err.message}`);
    }
    resetUploadForm();
  } finally {
    activeUploadController = null;
  }
}

// Handle Google Drive / Direct Link Import Submit
async function handleUrlImportSubmit(e) {
  e.preventDefault();

  const url = urlLinkInput.value.trim();
  const title = urlTitleInput.value.trim();

  if (!url) return;

  startUrlImportBtn.disabled = true;
  urlImportStatus.classList.remove('hidden');
  urlImportText.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Transferring video directly from Google Drive to cloud server...';

  try {
    const res = await fetch('/api/upload/url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, title })
    });

    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Failed to import video from URL');

    urlImportText.innerHTML = '<i class="fa-solid fa-circle-check" style="color:#10b981;"></i> Video imported successfully!';

    setTimeout(() => {
      hideUploadModal();
      loadVideos();
    }, 1200);

  } catch (err) {
    console.error('Import Error:', err);
    alert(`Import failed: ${err.message}`);
    startUrlImportBtn.disabled = false;
    urlImportStatus.classList.add('hidden');
  }
}

// Delete Video
async function deleteVideo(id, event) {
  event.stopPropagation();
  if (!confirm('Are you sure you want to delete this video?')) return;

  try {
    const res = await fetch(`/api/video/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      loadVideos();
    } else {
      alert(`Error: ${data.error}`);
    }
  } catch (err) {
    alert('Failed to delete video');
  }
}

// Open Video Player & Auto-Resume
async function openPlayer(videoId) {
  const video = currentVideos.find(v => v.id === videoId);
  if (!video) return;

  currentPlayingVideo = video;
  playerVideoTitle.textContent = video.title;
  playerResumeBadge.classList.add('hidden');

  // Set streaming source
  mainVideoPlayer.src = `/api/video/${videoId}/stream`;
  playerModal.classList.remove('hidden');

  // Fetch saved playback progress for active profile
  let savedTime = 0;
  try {
    const res = await fetch(`/api/progress/${videoId}?userId=${encodeURIComponent(USER_ID)}`);
    const data = await res.json();
    if (data.success && data.progress) {
      savedTime = data.progress.timestamp || 0;
    }
  } catch (e) {
    console.warn('Could not fetch saved progress', e);
  }

  // Set initial seek when metadata loads
  mainVideoPlayer.onloadedmetadata = () => {
    durationDisplay.textContent = formatTime(mainVideoPlayer.duration);

    if (savedTime > 5 && savedTime < mainVideoPlayer.duration - 10) {
      mainVideoPlayer.currentTime = savedTime;
      playerResumeTime.textContent = formatTime(savedTime);
      playerResumeBadge.classList.remove('hidden');
    }

    mainVideoPlayer.play().catch(e => console.log('Autoplay prevented:', e));
  };

  // Start periodic auto-save (every 4 seconds)
  if (autoSaveInterval) clearInterval(autoSaveInterval);
  autoSaveInterval = setInterval(() => {
    savePlaybackPosition(false);
  }, 4000);
}

// Close Video Player
function closePlayer() {
  savePlaybackPosition(true);
  
  if (autoSaveInterval) {
    clearInterval(autoSaveInterval);
    autoSaveInterval = null;
  }

  mainVideoPlayer.pause();
  mainVideoPlayer.src = '';
  currentPlayingVideo = null;
  playerModal.classList.add('hidden');
  loadVideos();
}

// Save Current Playback Position
async function savePlaybackPosition(showToastNotification = false) {
  if (!currentPlayingVideo || mainVideoPlayer.paused || mainVideoPlayer.ended) return;

  const timestamp = mainVideoPlayer.currentTime;
  const duration = mainVideoPlayer.duration || 0;

  if (timestamp === 0) return;

  try {
    await fetch('/api/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId: currentPlayingVideo.id,
        userId: USER_ID,
        timestamp,
        duration
      })
    });

    if (showToastNotification) {
      showToast();
    }
  } catch (e) {
    console.warn('Failed to save position:', e);
  }
}

// Jump playback time +/-
function jumpTime(seconds) {
  if (!mainVideoPlayer) return;
  mainVideoPlayer.currentTime = Math.max(0, Math.min(mainVideoPlayer.duration, mainVideoPlayer.currentTime + seconds));
}

// Update UI Time Display
function updateTimeDisplays() {
  currentTimeDisplay.textContent = formatTime(mainVideoPlayer.currentTime);
  if (mainVideoPlayer.duration) {
    durationDisplay.textContent = formatTime(mainVideoPlayer.duration);
  }
}

// Show auto-save toast notification
function showToast() {
  saveToast.classList.remove('hidden');
  setTimeout(() => {
    saveToast.classList.add('hidden');
  }, 2000);
}
