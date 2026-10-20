// localStorage can throw (private windows, blocked site data), so every access falls back instead of failing.
const PREFIX = 'bhi.';

export function read(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function remove(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* storage unavailable: nothing to remove */
  }
}

export function uid(prefix) {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// Mock adapters wait a moment so loading states are visible and code paths stay async, as with a real API.
export const latency = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));
