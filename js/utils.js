/* ==========================================================================
   Utils — small helpers used across the app.

   Dates are stored as "YYYY-MM-DD" strings and times as "HH:MM" (24h),
   both in the user's local time zone. Strings are easy to save, compare
   and put into <input type="date"> / <input type="time">.
   ========================================================================== */

const Utils = (() => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  const PRIORITIES = {
    1: { label: 'Urgent' },
    2: { label: 'High' },
    3: { label: 'Medium' },
    4: { label: 'Low' },
  };

  const pad = (n) => String(n).padStart(2, '0');

  function uid(prefix = 'id') {
    return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  }

  // Always escape user text before putting it into HTML, to prevent XSS.
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ---------- Dates ----------

  function toDateKey(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function fromDateKey(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  const todayKey = () => toDateKey(new Date());

  function addDays(date, days) {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + days);
    return copy;
  }

  // Whole days from one date key to another (Math.round absorbs daylight-saving shifts).
  function daysBetween(fromKey, toKey) {
    return Math.round((fromDateKey(toKey) - fromDateKey(fromKey)) / DAY_MS);
  }

  // The moment a task is due. Tasks without a time are due at the end of the day.
  function dueDateTime(task) {
    if (!task.dueDate) return null;
    const date = fromDateKey(task.dueDate);
    if (task.dueTime) {
      const [h, m] = task.dueTime.split(':').map(Number);
      date.setHours(h, m, 0, 0);
    } else {
      date.setHours(23, 59, 59, 999);
    }
    return date;
  }

  function isOverdue(task, now = new Date()) {
    return !task.completed && Boolean(task.dueDate) && dueDateTime(task) < now;
  }

  function formatTime(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    return `${((h + 11) % 12) + 1}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`;
  }

  // "Today", "Tomorrow", "Friday", "Mon, 6 Oct"...
  function formatDateLabel(key) {
    const diff = daysBetween(todayKey(), key);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
    const date = fromDateKey(key);
    if (diff > 1 && diff < 7) return date.toLocaleDateString(undefined, { weekday: 'long' });
    const options = { weekday: 'short', day: 'numeric', month: 'short' };
    if (date.getFullYear() !== new Date().getFullYear()) options.year = 'numeric';
    return date.toLocaleDateString(undefined, options);
  }

  function formatLongDate(key) {
    return fromDateKey(key).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }

  function formatDue(task) {
    if (!task.dueDate) return '';
    const label = formatDateLabel(task.dueDate);
    return task.dueTime ? `${label}, ${formatTime(task.dueTime)}` : label;
  }

  function formatTimestamp(iso) {
    return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }

  function timeAgo(iso) {
    const seconds = Math.round((Date.now() - Date.parse(iso)) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  }

  function greeting() {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  }

  // ---------- Text ----------

  function initials(text) {
    const parts = String(text).split(/[\s@._-]+/).filter(Boolean);
    return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
  }

  const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

  const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

  function slugify(text) {
    return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'task';
  }

  // Normalises a tag typed by the user: "#Big Launch" -> "big-launch"
  function cleanTag(text) {
    return String(text).trim().replace(/^#+/, '').toLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '');
  }

  // ---------- Files ----------

  function downloadFile(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return {
    PRIORITIES, pad, uid, escapeHtml,
    toDateKey, fromDateKey, todayKey, addDays, daysBetween, dueDateTime, isOverdue,
    formatTime, formatDateLabel, formatLongDate, formatDue, formatTimestamp, timeAgo, greeting,
    initials, isValidEmail, plural, slugify, cleanTag, downloadFile,
  };
})();
