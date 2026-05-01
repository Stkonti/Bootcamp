const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { URL } = require('node:url');

const rootDir = __dirname;
const envPath = path.join(rootDir, '.env');
const port = Number(process.env.PORT || 3000);

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      return;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      return;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  });
}

loadEnvFile(envPath);

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8'
  });
  response.end(text);
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    default: return 'application/octet-stream';
  }
}

function resolveStaticFile(requestPath) {
  const pathname = requestPath === '/' ? '/index.html' : requestPath;
  const normalized = path.normalize(pathname).replace(/^([.][.][/\\])+/, '');
  const filePath = path.join(rootDir, normalized);
  if (!filePath.startsWith(rootDir)) {
    return null;
  }
  if (path.basename(filePath).startsWith('.')) {
    return null;
  }
  return filePath;
}

async function proxyFaceit(requestUrl, response) {
  const apiKey = (process.env.FACEIT_API_KEY || '').trim();
  if (!apiKey) {
    sendJson(response, 500, { message: 'FACEIT_API_KEY puuttuu palvelimen .env-tiedostosta.' });
    return;
  }

  const upstreamPath = requestUrl.pathname.replace(/^\/api\/faceit/, '') || '/';
  const upstreamUrl = new URL('https://open.faceit.com/data/v4' + upstreamPath);
  requestUrl.searchParams.forEach((value, key) => {
    upstreamUrl.searchParams.set(key, value);
  });

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      headers: {
        Accept: 'application/json',
        Authorization: /^bearer\s+/i.test(apiKey) ? apiKey : 'Bearer ' + apiKey
      }
    });

    const bodyText = await upstreamResponse.text();
    response.writeHead(upstreamResponse.status, {
      'Content-Type': upstreamResponse.headers.get('content-type') || 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    response.end(bodyText);
  } catch (error) {
    sendJson(response, 502, { message: 'Yhteys FACEIT APIin epaonnistui.', details: error.message });
  }
}

const server = http.createServer(async (request, response) => {
  if (!request.url) {
    sendText(response, 400, 'Bad Request');
    return;
  }

  const requestUrl = new URL(request.url, 'http://localhost:' + port);

  if (request.method !== 'GET') {
    sendText(response, 405, 'Method Not Allowed');
    return;
  }

  if (requestUrl.pathname.startsWith('/api/faceit')) {
    await proxyFaceit(requestUrl, response);
    return;
  }

  const filePath = resolveStaticFile(requestUrl.pathname);
  if (!filePath) {
    sendText(response, 404, 'Not Found');
    return;
  }

  try {
    const data = await fsp.readFile(filePath);
    response.writeHead(200, {
      'Content-Type': contentTypeFor(filePath)
    });
    response.end(data);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      sendText(response, 404, 'Not Found');
      return;
    }
    sendText(response, 500, 'Internal Server Error');
  }
});

server.listen(port, () => {
  console.log('Server running at http://localhost:' + port);
});