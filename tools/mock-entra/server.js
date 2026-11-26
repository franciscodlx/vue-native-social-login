// HTTP wrapper around handler.js:  node server.js   (port 4700)
// The one-time passcode is printed at start-up.
const http = require('http');
const { createMockEntra } = require('./handler');

function createServer(options) {
  const entra = createMockEntra(options);
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
    }
    const { status, body } =
      req.method === 'POST'
        ? entra.handle(
            new URL(req.url, 'http://placeholder').pathname,
            Object.fromEntries(new URLSearchParams(raw))
          )
        : { status: 404, body: { error: 'not_found' } };
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify(body));
  });
  return { server, entra };
}

if (require.main === module) {
  const port = Number(process.env.PORT ?? 4700);
  const { server, entra } = createServer({
    log: (line) => console.log(`[mock-entra] ${line}`),
  });
  server.listen(port, () => {
    console.log(`[mock-entra] http://localhost:${port}`);
    console.log(`[mock-entra] client id: ${entra.clientId}`);
    console.log(`[mock-entra] one-time passcode: ${entra.otp}`);
  });
}

module.exports = { createServer };
