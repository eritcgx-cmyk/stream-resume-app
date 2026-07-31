import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function downloadHorimiya() {
  const fileId = '15eD6Bv7HXuhKEYFe9R2XWdRPbgG9cfWM';
  const initialUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download`;

  https.get(initialUrl, (res) => {
    let html = '';
    res.on('data', chunk => html += chunk);
    res.on('end', () => {
      const uuidMatch = html.match(/name="uuid"\s+value="([^"]+)"/);
      const confirmMatch = html.match(/name="confirm"\s+value="([^"]+)"/);
      const titleMatch = html.match(/<span class="uc-name-size"><a[^>]*>(.*?)<\/a>/);

      console.log('Title:', titleMatch ? titleMatch[1] : 'Horimiya - SUPERCUT (Dub).mp4');
      console.log('UUID:', uuidMatch ? uuidMatch[1] : 'none');
      console.log('Confirm:', confirmMatch ? confirmMatch[1] : 'none');

      if (uuidMatch && confirmMatch) {
        const downloadUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=${confirmMatch[1]}&uuid=${uuidMatch[1]}`;
        console.log('Downloading direct stream from:', downloadUrl);

        const destDir = path.join(__dirname, '..', 'data', 'uploads');
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        const destPath = path.join(destDir, 'horimiya.mp4');

        const fileStream = fs.createWriteStream(destPath);
        https.get(downloadUrl, (streamRes) => {
          console.log('Status Code:', streamRes.statusCode);
          console.log('Content-Type:', streamRes.headers['content-type']);
          console.log('Content-Length:', streamRes.headers['content-length']);

          let downloaded = 0;
          streamRes.on('data', chunk => {
            downloaded += chunk.length;
            if (downloaded % (50 * 1024 * 1024) < chunk.length) {
              console.log(`Downloaded ${Math.round(downloaded / (1024 * 1024))} MB...`);
            }
          });

          streamRes.pipe(fileStream);

          fileStream.on('finish', () => {
            console.log('Download complete! File saved to:', destPath);
          });
        });
      }
    });
  });
}

downloadHorimiya();
