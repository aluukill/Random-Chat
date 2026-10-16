import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const startServer = () =>
  new Promise((resolve, reject) => {
    const server = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: { ...process.env, PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timeout = setTimeout(() => reject(new Error('Server did not start in time')), 10000);
    let output = '';
    server.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(/localhost:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve({ server, http: `http://localhost:${match[1]}`, ws: `ws://localhost:${match[1]}` });
      }
    });
    server.stderr.on('data', (chunk) => process.stderr.write(chunk));
    server.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited early with code ${code}`));
    });
  });

const browser = (url) => {
  const socket = new WebSocket(url);
  const queue = [];
  const waiters = [];

  socket.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    const index = waiters.findIndex((waiter) => waiter.match(msg));
    if (index === -1) {
      queue.push(msg);
      return;
    }
    const [waiter] = waiters.splice(index, 1);
    clearTimeout(waiter.timer);
    waiter.resolve(msg);
  });

  return {
    open: () =>
      new Promise((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      }),
    waitFor(match, label, timeout = 5000) {
      const index = queue.findIndex(match);
      if (index !== -1) return Promise.resolve(queue.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {
        const waiter = { match, resolve };
        waiter.timer = setTimeout(() => {
          const i = waiters.indexOf(waiter);
          if (i !== -1) waiters.splice(i, 1);
          reject(new Error(`Timed out waiting for ${label}`));
        }, timeout);
        waiters.push(waiter);
      });
    },
    send: (payload) => socket.send(JSON.stringify(payload)),
    drain: () => queue.splice(0, queue.length),
    close: () => socket.close(),
  };
};

const is = (type) => (msg) => msg.type === type;

const main = async () => {
  const { server, http, ws } = await startServer();

  try {
    const page = await fetch(http);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.ok(html.includes('RandomChat'));
    console.log('Page is served');

    const alice = browser(ws);
    const bob = browser(ws);

    await Promise.all([alice.open(), bob.open()]);
    const aliceHello = await alice.waitFor(is('hello'), 'hello for alice');
    const bobHello = await bob.waitFor(is('hello'), 'hello for bob');
    const aliceMatch = await alice.waitFor(is('matched'), 'match for alice');
    const bobMatch = await bob.waitFor(is('matched'), 'match for bob');
    assert.equal(aliceMatch.partner, bobHello.name);
    assert.equal(bobMatch.partner, aliceHello.name);
    console.log('Two visitors got matched');

    alice.send({ type: 'message', text: 'hello there' });
    const relayed = await bob.waitFor(is('message'), 'relayed message');
    assert.equal(relayed.text, 'hello there');
    console.log('Messages are relayed');

    bob.send({ type: 'typing', active: true });
    const typing = await alice.waitFor(is('typing'), 'typing signal');
    assert.equal(typing.active, true);
    console.log('Typing signals are relayed');

    alice.drain();
    bob.drain();
    alice.send({ type: 'skip' });
    await bob.waitFor(is('strangerLeft'), 'strangerLeft for bob');
    await alice.waitFor(is('waiting'), 'waiting for alice');
    await bob.waitFor(is('waiting'), 'waiting for bob');
    console.log('Skip requeues both visitors');

    const carol = browser(ws);
    await carol.open();
    const carolHello = await carol.waitFor(is('hello'), 'hello for carol');
    const carolMatch = await carol.waitFor(is('matched'), 'match for carol');
    const options = [
      { name: aliceHello.name, client: alice },
      { name: bobHello.name, client: bob },
    ];
    const winner = await Promise.race(
      options.map((option) =>
        option.client
          .waitFor(is('matched'), `match for ${option.name}`, 8000)
          .then((msg) => ({ ...option, msg }))
          .catch(() => null),
      ),
    );
    assert.ok(winner, 'a waiting visitor should match carol');
    assert.equal(carolMatch.partner, winner.name);
    assert.equal(winner.msg.partner, carolHello.name);
    console.log('A new visitor matched with a waiting visitor');

    alice.close();
    bob.close();
    carol.close();
    console.log('All checks passed');
  } finally {
    server.kill();
  }
};

main()
  .then(() => setTimeout(() => process.exit(0), 100))
  .catch((error) => {
    console.error(error);
    setTimeout(() => process.exit(1), 100);
  });
