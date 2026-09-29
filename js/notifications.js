/* ==========================================================================
   Notifier — reminders for due and overdue tasks.

   Every 30 seconds it looks at open tasks with a due date:
     - "Due soon"  when the task's reminder time has passed
     - "Overdue"   when the due time has passed
   Each alert is recorded in the in-app notification centre (the bell),
   shown as a toast, and — if the user allowed it — sent as a desktop
   notification. A key per task + due date makes sure each fires once;
   moving the due date re-arms the reminder.
   ========================================================================== */

const Notifier = (() => {
  const CHECK_EVERY_MS = 30 * 1000;
  const ALL_DAY_REMINDER_HOUR = 9;
  const supported = 'Notification' in window;
  let callbacks = {};

  function permission() {
    return supported ? Notification.permission : 'unsupported';
  }

  async function requestPermission() {
    if (!supported) return 'unsupported';
    try {
      return await Notification.requestPermission();
    } catch {
      return 'denied';
    }
  }

  // When the reminder should fire, or null if the task has none.
  function reminderAt(task) {
    if (!task.dueDate || task.reminder === null || task.reminder === undefined) return null;
    const base = task.dueTime ? Utils.dueDateTime(task) : Utils.fromDateKey(task.dueDate);
    if (!task.dueTime) base.setHours(ALL_DAY_REMINDER_HOUR, 0, 0, 0);
    return new Date(base.getTime() - task.reminder * 60000);
  }

  function check() {
    const now = new Date();
    const fresh = [];

    Store.get().tasks.forEach((task) => {
      if (task.completed || !task.dueDate) return;
      const stamp = `${task.id}:${task.dueDate}:${task.dueTime || 'allday'}`;

      if (Utils.dueDateTime(task) < now) {
        const key = `overdue:${stamp}`;
        if (!Store.wasNotified(key)) {
          fresh.push({ key, taskId: task.id, kind: 'overdue', title: `Overdue: ${task.title}`, body: `Was due ${Utils.formatDue(task)}` });
        }
        return;
      }

      const at = reminderAt(task);
      const key = `reminder:${stamp}:${task.reminder}`;
      if (at && at <= now && !Store.wasNotified(key)) {
        fresh.push({ key, taskId: task.id, kind: 'reminder', title: `Due soon: ${task.title}`, body: `Due ${Utils.formatDue(task)}` });
      }
    });

    if (!fresh.length) return;
    Store.addNotifications(fresh);
    fresh.forEach(showDesktop);
    callbacks.onNotify?.(fresh);
  }

  function showDesktop({ title, body, key, taskId }) {
    if (!Store.get().settings.desktopAlerts || permission() !== 'granted') return;
    try {
      const notification = new Notification(title, { body, tag: key, icon: 'assets/favicon.svg' });
      notification.onclick = () => {
        window.focus();
        callbacks.onOpenTask?.(taskId);
        notification.close();
      };
    } catch (err) {
      // Some browsers (e.g. Android Chrome) only allow notifications from a service worker.
      console.warn('Desktop notification failed.', err);
    }
  }

  function sendTest() {
    showDesktop({ title: 'Desktop alerts are on', body: "We'll let you know when tasks are due.", key: 'test' });
  }

  function start(options = {}) {
    callbacks = options;
    check();
    setInterval(check, CHECK_EVERY_MS);
    // Browsers slow down timers in background tabs, so check again when the tab comes back.
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  }

  return { start, check, permission, requestPermission, reminderAt, sendTest };
})();
