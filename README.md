# RandomChat

A small website for anonymous random chat. Every visitor is paired automatically with a random stranger. There are no accounts and no message history.

## Features

- Automatic matching. You join the waiting pool the moment the page loads.
- Random partners, picked from everyone who is waiting.
- A New partner button to leave a chat and get matched again.
- If your partner leaves or disconnects, you are requeued automatically.
- Typing indicators, online count and matching animations.
- Automatic reconnect when the connection drops.
- Dark, mobile friendly layout.

## Run it

```
npm install
npm start
```

Open http://localhost:3000. Anyone on your network can join through http://yourIp:3000.

## Test

```
npm test
```

This starts a temporary server and simulates three visitors: matching, message relay, typing, skip and matching again.

## How it works

The server keeps a pool of waiting visitors. When two people are in the pool, they are paired at random and messages are relayed between the two sockets only. Static files are served from the public folder.

## Configuration

Set the `PORT` environment variable to run on a different port.

## Deploying

Run the app behind a reverse proxy with TLS so the page loads over https and the chat socket uses wss. A single process keeps the pool in memory, so run one instance, or add sticky sessions and a shared channel when you scale out. Public random chat attracts spam, so add rate limits and reporting tools before opening it to the world.
