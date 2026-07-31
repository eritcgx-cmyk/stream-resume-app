import https from 'https';

function fetchGoogleDriveDirectInfo(fileId, targetUrl = null, redirects = 5) {
  return new Promise((resolve, reject) => {
    if (redirects <= 0) return reject(new Error('Too many redirects'));

    const url = targetUrl || `https://drive.google.com/uc?export=download&id=${fileId}`;

    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith('http')) {
          redirectUrl = `https://drive.google.com${redirectUrl}`;
        }
        return fetchGoogleDriveDirectInfo(fileId, redirectUrl, redirects - 1).then(resolve).catch(reject);
      }

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
          resolve({ title, directUrl: url });
        }
      });
    }).on('error', reject);
  });
}

async function run() {
  const info = await fetchGoogleDriveDirectInfo('15eD6Bv7HXuhKEYFe9R2XWdRPbgG9cfWM');
  console.log('Result Title:', info.title);
  console.log('Result Direct URL:', info.directUrl);
}

run();
