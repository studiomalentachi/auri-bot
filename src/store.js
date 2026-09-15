import fs from 'node:fs';
import path from 'node:path';

const BASE_DIR = process.env.PERSIST_DIR ? path.resolve(process.env.PERSIST_DIR) : path.resolve('.');
const DATA_DIR = path.join(BASE_DIR, 'data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');

function defaults() {
  return {
    queue: [],
    sent: [],
    paused: false,
    targetGroupJid: null,
    targetGroupName: null,
    createdAt: new Date().toISOString()
  };
}

function ensure() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) {
    fs.writeFileSync(STORE_PATH, JSON.stringify(defaults(), null, 2));
  }
}

export function readStore() {
  ensure();
  try {
    return { ...defaults(), ...JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')) };
  } catch {
    const fresh = defaults();
    fs.writeFileSync(STORE_PATH, JSON.stringify(fresh, null, 2));
    return fresh;
  }
}

export function writeStore(next) {
  ensure();
  fs.writeFileSync(STORE_PATH, JSON.stringify(next, null, 2));
}

export function updateStore(mutator) {
  const s = readStore();
  const next = mutator(structuredClone(s)) || s;
  writeStore(next);
  return next;
}

export function enqueue(item) {
  return updateStore((s) => {
    s.queue.push({
      id: item.id,
      text: item.text,
      link: item.link,
      photoPath: item.photoPath || null,
      createdAt: new Date().toISOString()
    });
    return s;
  });
}

export function peekNext() {
  return readStore().queue[0] || null;
}

export function markSent(id) {
  return updateStore((s) => {
    const idx = s.queue.findIndex((x) => x.id === id);
    if (idx >= 0) {
      const [item] = s.queue.splice(idx, 1);
      s.sent.unshift({ ...item, sentAt: new Date().toISOString() });
      s.sent = s.sent.slice(0, 500);
    }
    return s;
  });
}

export function removeFromQueue(id) {
  return updateStore((s) => {
    s.queue = s.queue.filter((x) => x.id !== id);
    return s;
  });
}
