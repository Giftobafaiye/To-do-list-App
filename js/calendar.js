/* ==========================================================================
   CalendarLink — connects tasks to real calendars.

   - googleUrl / outlookUrl: open a pre-filled "new event" page.
   - toICS / download: build a standard .ics file (Apple Calendar, Outlook,
     Google import...). Each event includes an alarm (VALARM), so the
     user's own calendar also reminds them when a task is due.
   ========================================================================== */

const CalendarLink = (() => {
  const EVENT_MINUTES = 30; // length of the calendar block for timed tasks
  const ALL_DAY_REMINDER_HOUR = 9; // all-day tasks remind relative to 9:00 AM
  const { pad } = Utils;

  const compactDate = (key) => key.replace(/-/g, '');
  const compactDateTime = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;

  // Start and end of the event, in local time.
  function eventRange(task) {
    if (task.dueTime) {
      const start = Utils.dueDateTime(task);
      return { allDay: false, start, end: new Date(start.getTime() + EVENT_MINUTES * 60000) };
    }
    const start = Utils.fromDateKey(task.dueDate);
    return { allDay: true, start, end: Utils.addDays(start, 1) };
  }

  function description(task) {
    const lines = [];
    if (task.notes) lines.push(task.notes, '');
    lines.push(`Priority: ${Utils.PRIORITIES[task.priority].label}`);
    if (task.subtasks.length) {
      lines.push('', 'Sub-tasks:', ...task.subtasks.map((s) => `${s.done ? '[x]' : '[ ]'} ${s.text}`));
    }
    if (task.checklist.length) {
      lines.push('', 'Checklist:', ...task.checklist.map((c) => `${c.done ? '[x]' : '[ ]'} ${c.text}`));
    }
    lines.push('', 'Added from Doable_');
    return lines.join('\n');
  }

  function googleUrl(task) {
    const { allDay, start, end } = eventRange(task);
    const dates = allDay
      ? `${compactDate(Utils.toDateKey(start))}/${compactDate(Utils.toDateKey(end))}`
      : `${compactDateTime(start)}/${compactDateTime(end)}`;
    const params = new URLSearchParams({ action: 'TEMPLATE', text: task.title, dates, details: description(task) });
    if (!allDay) params.set('ctz', Intl.DateTimeFormat().resolvedOptions().timeZone);
    return `https://calendar.google.com/calendar/render?${params}`;
  }

  function outlookUrl(task) {
    const { allDay, start, end } = eventRange(task);
    const params = new URLSearchParams({
      path: '/calendar/action/compose',
      rru: 'addevent',
      subject: task.title,
      body: description(task),
      startdt: allDay ? Utils.toDateKey(start) : isoLocal(start),
      enddt: allDay ? Utils.toDateKey(end) : isoLocal(end),
      allday: String(allDay),
    });
    return `https://outlook.live.com/calendar/0/deeplink/compose?${params}`;
  }

  // ---------- .ics (iCalendar, RFC 5545) ----------

  function escapeText(text) {
    return String(text).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }

  // Lines longer than 75 characters must be split, with a leading space on each continuation.
  function fold(line) {
    const parts = [];
    for (let i = 0; i < line.length; i += 73) parts.push(line.slice(i, i + 73));
    return parts.join('\r\n ');
  }

  function alarmTrigger(task, allDay) {
    // Minutes from the event start to the reminder (negative = before).
    const offset = allDay ? ALL_DAY_REMINDER_HOUR * 60 - task.reminder : -task.reminder;
    return `${offset < 0 ? '-' : ''}PT${Math.abs(offset)}M`;
  }

  function toICS(tasks) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const icsPriority = { 1: 1, 2: 3, 3: 5, 4: 9 };
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Doable//To-do list//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];

    tasks.filter((task) => task.dueDate).forEach((task) => {
      const { allDay, start, end } = eventRange(task);
      lines.push(
        'BEGIN:VEVENT',
        `UID:${task.id}@doable.app`,
        `DTSTAMP:${stamp}`,
        allDay ? `DTSTART;VALUE=DATE:${compactDate(Utils.toDateKey(start))}` : `DTSTART:${compactDateTime(start)}`,
        allDay ? `DTEND;VALUE=DATE:${compactDate(Utils.toDateKey(end))}` : `DTEND:${compactDateTime(end)}`,
        `SUMMARY:${escapeText(task.title)}`,
        `DESCRIPTION:${escapeText(description(task))}`,
        `PRIORITY:${icsPriority[task.priority]}`,
      );
      if (task.tags.length) lines.push(`CATEGORIES:${task.tags.map(escapeText).join(',')}`);
      if (task.reminder !== null && task.reminder !== undefined) {
        lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(task.title)}`, `TRIGGER:${alarmTrigger(task, allDay)}`, 'END:VALARM');
      }
      lines.push('END:VEVENT');
    });

    lines.push('END:VCALENDAR');
    return lines.map(fold).join('\r\n');
  }

  function download(tasks, name) {
    Utils.downloadFile(`${name}.ics`, toICS(tasks), 'text/calendar;charset=utf-8');
  }

  return { googleUrl, outlookUrl, toICS, download };
})();
