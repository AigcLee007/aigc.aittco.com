const axios = require('axios');
const http = require('http');

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    console.log('Headers:', req.headers);
    console.log('Body length:', body.length);
    console.log('Body preview:\n', body.substring(0, 500));
    res.end('OK');
    server.close();
  });
});

server.listen(3326, async () => {
  try {
    const formData = new FormData();
    formData.append('model', 'test-model');
    formData.append('prompt', 'test-prompt');
    const imgBuffer = Buffer.from('hello world', 'utf8');
    formData.append('image', new Blob([imgBuffer], { type: 'image/png' }), 'image.png');

    await axios.post('http://localhost:3326', formData, {
      headers: {
        Authorization: 'testing',
      }
    });
  } catch (e) {
    console.error(e.message);
    server.close();
  }
});
