import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const configuredPort = process.env.PORT;
const port = configuredPort ? Number(configuredPort) : 3000;

const maxMessageLength = 2000;
const minMessageInterval = 150;
const maxWaiting = 10000;

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('ok');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }

  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(publicDir, relative);

  if (file !== publicDir && !file.startsWith(publicDir + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  try {
    const data = await readFile(file);
    const ext = path.extname(file).toLowerCase();
    const revalidate = ext === '.html' || ext === '.css' || ext === '.js';
    res.writeHead(200, {
      'Content-Type': mimeTypes[ext] ?? 'application/octet-stream',
      'Cache-Control': revalidate ? 'no-cache' : 'public, max-age=86400',
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

const wss = new WebSocketServer({ server, maxPayload: 32768 });

const clients = new Set();
let waiting = [];

const adjectives = ['Quiet', 'Cosmic', 'Neon', 'Midnight', 'Velvet', 'Crimson', 'Silver', 'Golden', 'Lucky', 'Wandering', 'Mellow', 'Electric', 'Frozen', 'Sunny', 'Shadow', 'Gentle', 'Wild', 'Hidden', 'Dancing', 'Sapphire', 'Amber', 'Jade', 'Nimble', 'Brave'];
const animals = ['Otter', 'Fox', 'Panda', 'Falcon', 'Wolf', 'Koala', 'Tiger', 'Lynx', 'Raven', 'Dolphin', 'Hedgehog', 'Mongoose', 'Raccoon', 'Puffin', 'Cobra', 'Gecko', 'Walrus', 'Heron', 'Lemur', 'Badger', 'Flamingo', 'Beaver', 'Narwhal'];

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const randomName = () => `${pick(adjectives)} ${pick(animals)} ${10 + Math.floor(Math.random() * 90)}`;

class Client {
  constructor(ws) {
    this.ws = ws;
    this.name = randomName();
    this.partner = null;
    this.state = 'idle';
    this.responding = true;
    this.lastMessageAt = 0;
  }
}

const send = (ws, payload) => {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
};

const isOpen = (client) => client.ws.readyState === WebSocket.OPEN;

const broadcastOnline = () => {
  for (const client of clients) send(client.ws, { type: 'online', count: clients.size });
};

const pruneWaiting = () => {
  waiting = waiting.filter((client) => isOpen(client) && client.state === 'waiting');
};

const takeRandomWaiting = (exclude) => {
  pruneWaiting();
  const pool = waiting.filter((client) => client !== exclude);
  if (pool.length === 0) return null;
  const chosen = pick(pool);
  waiting = waiting.filter((client) => client !== chosen);
  return chosen;
};

const pair = (a, b) => {
  a.partner = b;
  b.partner = a;
  a.state = 'chatting';
  b.state = 'chatting';
  send(a.ws, { type: 'matched', partner: b.name });
  send(b.ws, { type: 'matched', partner: a.name });
};

const unpair = (client, { notify = true, requeue = true } = {}) => {
  const partner = client.partner;
  client.partner = null;
  if (client.state === 'chatting') client.state = 'idle';
  if (!partner) return;

  partner.partner = null;
  if (partner.state === 'chatting') partner.state = 'idle';
  if (!isOpen(partner)) return;

  if (notify) send(partner.ws, { type: 'strangerLeft' });
  if (requeue) enqueue(partner, client);
};

const enqueue = (client, exclude = null) => {
  if (!isOpen(client)) return;

  const previous = client.partner;
  if (previous) unpair(client);

  waiting = waiting.filter((other) => other !== client);

  const partner = takeRandomWaiting(exclude ?? previous);
  if (partner) {
    pair(client, partner);
    return;
  }

  if (waiting.length >= maxWaiting) {
    send(client.ws, { type: 'error', message: 'The server is very busy right now. Please try again in a moment.' });
    return;
  }

  client.state = 'waiting';
  waiting.push(client);
  send(client.ws, { type: 'waiting' });
};

wss.on('connection', (ws) => {
  const client = new Client(ws);
  clients.add(client);

  ws.on('pong', () => {
    client.responding = true;
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;

    if (msg.type === 'message') {
      const text = typeof msg.text === 'string' ? msg.text.trim() : '';
      if (!text) return;
      if (text.length > maxMessageLength) {
        send(ws, { type: 'error', message: 'Your message is too long.' });
        return;
      }
      const now = Date.now();
      if (now - client.lastMessageAt < minMessageInterval) {
        send(ws, { type: 'error', message: 'You are sending messages too fast.' });
        return;
      }
      client.lastMessageAt = now;
      if (client.partner && isOpen(client.partner)) send(client.partner.ws, { type: 'message', text });
      return;
    }

    if (msg.type === 'typing') {
      if (client.partner && isOpen(client.partner)) send(client.partner.ws, { type: 'typing', active: Boolean(msg.active) });
      return;
    }

    if (msg.type === 'skip') enqueue(client);
  });

  ws.on('close', () => {
    unpair(client);
    waiting = waiting.filter((other) => other !== client);
    clients.delete(client);
    broadcastOnline();
  });

  ws.on('error', () => ws.close());

  send(ws, { type: 'hello', name: client.name });
  broadcastOnline();
  enqueue(client);
});

setInterval(() => {
  for (const client of clients) {
    if (!isOpen(client)) continue;
    if (!client.responding) {
      client.ws.terminate();
      continue;
    }
    client.responding = false;
    client.ws.ping();
  }
}, 30000).unref();

server.listen(port, () => {
  console.log(`RandomChat is running at http://localhost:${server.address().port}`);
});

server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE' ? `Port ${port} is already in use. Try setting the PORT variable to something else.` : error);
  process.exit(1);
});
