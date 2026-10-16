const byId = (id) => document.getElementById(id);

const messagesEl = byId('messages');
const skeletonEl = byId('skeleton');
const statusEl = byId('status');
const statusTextEl = byId('statusText');
const onlineCountEl = byId('onlineCount');
const typingEl = byId('typing');
const typingNameEl = byId('typingName');
const composerEl = byId('composer');
const inputEl = byId('input');
const sendBtn = byId('send');
const newBtn = byId('new');

const isTouch = matchMedia('(hover: none)').matches;

const statusLabels = {
  connecting: 'Connecting',
  waiting: 'Searching for a partner',
  offline: 'Offline. Reconnecting',
};

let socket = null;
let state = 'connecting';
let partnerName = 'Stranger';
let searchedBefore = false;
let searchingNotice = null;
let searchingTimer = null;
let typingShown = false;
let typingHideTimer = null;
let typingSendTimer = null;
let typingSent = false;
let retries = 0;
let retryTimer = null;

const open = () => Boolean(socket) && socket.readyState === WebSocket.OPEN;

const send = (payload) => {
  if (open()) socket.send(JSON.stringify(payload));
};

const append = (el, force = false) => {
  const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 140;
  messagesEl.append(el);
  if (force || nearBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
};

const addBubble = (text, side) => {
  const bubble = document.createElement('div');
  bubble.className = `msg ${side}`;
  const body = document.createElement('span');
  body.className = 'msgText';
  body.textContent = text;
  const time = document.createElement('span');
  time.className = 'msgTime';
  time.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  bubble.append(body, time);
  append(bubble);
};

const addNotice = (text) => {
  const notice = document.createElement('div');
  notice.className = 'notice';
  notice.textContent = text;
  append(notice, true);
};

const clearSearching = () => {
  searchingNotice?.remove();
  searchingNotice = null;
};

const showSearching = (text) => {
  clearSearching();
  const pill = document.createElement('div');
  pill.className = 'notice searching';
  const spinner = document.createElement('span');
  spinner.className = 'spinner';
  const label = document.createElement('span');
  label.textContent = text;
  pill.append(spinner, label);
  searchingNotice = pill;
  append(pill, true);
};

const setState = (next) => {
  state = next;
  statusEl.className = `status ${next}`;
  statusTextEl.textContent = next === 'chatting' ? `Chatting with ${partnerName}` : statusLabels[next];
  const chatting = next === 'chatting';
  inputEl.disabled = !chatting;
  inputEl.placeholder = chatting ? `Message ${partnerName}` : next === 'offline' ? 'Reconnecting' : 'Searching for a partner';
  sendBtn.disabled = !chatting || inputEl.value.trim() === '';
  newBtn.disabled = !chatting;
};

const enterWaiting = (text) => {
  setState('waiting');
  clearTimeout(searchingTimer);
  searchingTimer = setTimeout(() => {
    if (state === 'waiting') showSearching(text);
  }, 150);
};

const setTyping = (active) => {
  clearTimeout(typingHideTimer);
  if (active) {
    typingShown = true;
    typingEl.hidden = false;
    typingHideTimer = setTimeout(() => setTyping(false), 4000);
  } else if (typingShown) {
    typingShown = false;
    typingEl.hidden = true;
  }
};

const hideTyping = () => setTyping(false);

const focusInput = () => {
  if (isTouch) return;
  setTimeout(() => {
    if (state === 'chatting') inputEl.focus();
  }, 60);
};

const handle = (msg) => {
  if (msg.type === 'online') {
    onlineCountEl.textContent = msg.count;
    return;
  }

  if (msg.type === 'waiting') {
    partnerName = 'Stranger';
    enterWaiting(searchedBefore ? 'Finding you a new partner' : 'Looking for someone random');
    return;
  }

  if (msg.type === 'matched') {
    partnerName = msg.partner || 'Stranger';
    typingNameEl.textContent = partnerName;
    clearTimeout(searchingTimer);
    clearSearching();
    hideTyping();
    searchedBefore = true;
    setState('chatting');
    addNotice(`Matched with ${partnerName}. Say hi`);
    focusInput();
    return;
  }

  if (msg.type === 'message') {
    hideTyping();
    addBubble(msg.text, 'theirs');
    return;
  }

  if (msg.type === 'typing') {
    setTyping(Boolean(msg.active));
    return;
  }

  if (msg.type === 'strangerLeft') {
    hideTyping();
    addNotice(`${partnerName} left the chat. Finding someone new`);
    partnerName = 'Stranger';
    return;
  }

  if (msg.type === 'error') {
    addNotice(msg.message || 'Something went wrong');
  }
};

const connect = () => {
  clearTimeout(retryTimer);
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}`);
  socket = ws;
  setState('connecting');

  ws.addEventListener('open', () => {
    if (socket !== ws) return;
    retries = 0;
    skeletonEl.remove();
    enterWaiting(searchedBefore ? 'Finding you a new partner' : 'Looking for someone random');
  });

  ws.addEventListener('message', (event) => {
    if (socket !== ws) return;
    let msg = null;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (msg) handle(msg);
  });

  ws.addEventListener('close', () => {
    if (socket !== ws) return;
    socket = null;
    const wasOffline = state === 'offline';
    hideTyping();
    clearSearching();
    setState('offline');
    if (!wasOffline) addNotice('Connection lost. Trying to reconnect');
    const delay = Math.min(10000, 500 * 2 ** retries++);
    retryTimer = setTimeout(connect, delay);
  });

  ws.addEventListener('error', () => ws.close());
};

const signalTyping = (active) => {
  clearTimeout(typingSendTimer);
  if (state !== 'chatting') active = false;
  if (active) {
    if (!typingSent) {
      send({ type: 'typing', active: true });
      typingSent = true;
    }
    typingSendTimer = setTimeout(() => signalTyping(false), 1800);
  } else if (typingSent) {
    typingSent = false;
    send({ type: 'typing', active: false });
  }
};

composerEl.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = inputEl.value.trim();
  if (!text || state !== 'chatting') return;
  addBubble(text, 'mine');
  send({ type: 'message', text });
  inputEl.value = '';
  sendBtn.disabled = true;
  signalTyping(false);
});

inputEl.addEventListener('input', () => {
  sendBtn.disabled = state !== 'chatting' || inputEl.value.trim() === '';
  signalTyping(inputEl.value.trim() !== '');
});

newBtn.addEventListener('click', () => {
  if (state !== 'chatting') return;
  hideTyping();
  signalTyping(false);
  inputEl.value = '';
  sendBtn.disabled = true;
  send({ type: 'skip' });
  enterWaiting('Finding you a new partner');
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (!socket || socket.readyState > WebSocket.OPEN) {
    retries = 0;
    connect();
  }
});

window.addEventListener('online', () => {
  if (!open()) {
    retries = 0;
    connect();
  }
});

setInterval(() => send({ type: 'ping' }), 25000);

connect();
