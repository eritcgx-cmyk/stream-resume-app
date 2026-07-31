import https from 'https';

async function testGdrive() {
  const fileId = '15eD6Bv7HXuhKEYFe9R2XWdRPbgG9cfWM';
  const initialUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download`;

  https.get(initialUrl, (res) => {
    let html = '';
    res.on('data', chunk => html += chunk);
    res.on('end', async () => {
      const uuidMatch = html.match(/name="uuid"\s+value="([^"]+)"/);
      const confirmMatch = html.match(/name="confirm"\s+value="([^"]+)"/);
      const titleMatch = html.match(/<span class="uc-name-size"><a[^>]*>(.*?)<\/a>/);

      console.log('Title:', titleMatch ? titleMatch[1] : 'Unknown');
      console.log('UUID:', uuidMatch ? uuidMatch[1] : 'None');
      console.log('Confirm:', confirmMatch ? confirmMatch[1] : 'None');

      if (uuidMatch && confirmMatch) {
        const downloadUrl = `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=${confirmMatch[1]}&uuid=${uuidMatch[1]}`;
        console.log('Fetching Direct Stream from:', downloadUrl);

        https.get(downloadUrl, (streamRes) => {
          console.log('Stream Status Code:', streamRes.statusCode);
          console.log('Content-Type:', streamRes.headers['content-type']);
          console.log('Content-Length (bytes):', streamRes.headers['content-length']);
          console.log('Content-Disposition:', streamRes.headers['content-disposition']);
        });
      }
    });
  });
}

testGdrive();
