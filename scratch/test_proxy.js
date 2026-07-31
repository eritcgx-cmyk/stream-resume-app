import https from 'https';

async function testProxy() {
  const fileId = '15eD6Bv7HXuhKEYFe9R2XWdRPbgG9cfWM';
  const initialUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download`;

  https.get(initialUrl, (res) => {
    let html = '';
    res.on('data', chunk => html += chunk);
    res.on('end', () => {
      const uuidMatch = html.match(/name="uuid"\s+value="([^"]+)"/);
      const confirmMatch = html.match(/name="confirm"\s+value="([^"]+)"/);

      if (uuidMatch && confirmMatch) {
        const directUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=${confirmMatch[1]}&uuid=${uuidMatch[1]}`;
        console.log('Testing Range proxy request to:', directUrl);

        https.get(directUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Range': 'bytes=0-1024'
          }
        }, (rangeRes) => {
          console.log('Proxy Range Status Code:', rangeRes.statusCode);
          console.log('Proxy Content-Range:', rangeRes.headers['content-range']);
          console.log('Proxy Content-Length:', rangeRes.headers['content-length']);
          console.log('Proxy Content-Type:', rangeRes.headers['content-type']);
        });
      }
    });
  });
}

testProxy();
