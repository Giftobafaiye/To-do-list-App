/* A tiny test runner: test('name', () => { expect(actual).toBe(expected) }) */

const results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, message: err.message });
  }
}

function expect(actual) {
  const show = (v) => JSON.stringify(v);
  return {
    toBe(expected) {
      if (actual !== expected) throw new Error(`expected ${show(expected)}, got ${show(actual)}`);
    },
    toEqual(expected) {
      if (show(actual) !== show(expected)) throw new Error(`expected ${show(expected)}, got ${show(actual)}`);
    },
    toContain(part) {
      if (!String(actual).includes(part)) throw new Error(`expected ${show(actual)} to contain ${show(part)}`);
    },
  };
}

// A fixed "now" keeps the tests stable: Wednesday 1 October 2025, 10:00
const NOW = new Date(2025, 9, 1, 10, 0);
const task = (fields) => ({
  id: 'task_test', title: 'Test', notes: '', priority: 4, dueDate: null, dueTime: null, reminder: 15,
  tags: [], subtasks: [], checklist: [], completed: false, ...fields,
});

// ---------- QuickAdd ----------

test('parses date, time, priority and tag together', () => {
  const r = QuickAdd.parse('Call Sam tomorrow at 3pm !high #work', NOW);
  expect(r.title).toBe('Call Sam');
  expect(r.dueDate).toBe('2025-10-02');
  expect(r.dueTime).toBe('15:00');
  expect(r.priority).toBe(2);
  expect(r.tags).toEqual(['work']);
});

test('plain text stays the title', () => {
  const r = QuickAdd.parse('Water the plants', NOW);
  expect(r.title).toBe('Water the plants');
  expect(r.dueDate).toBe(null);
  expect(r.priority).toBe(null);
});

test('numeric priorities !1 to !4', () => {
  expect(QuickAdd.parse('Fix bug !1', NOW).priority).toBe(1);
  expect(QuickAdd.parse('Tidy desk !p4', NOW).priority).toBe(4);
});

test('weekday means the next one, never today', () => {
  expect(QuickAdd.parse('Gym friday', NOW).dueDate).toBe('2025-10-03');
  expect(QuickAdd.parse('Standup wednesday', NOW).dueDate).toBe('2025-10-08');
  expect(QuickAdd.parse('Report on mon', NOW).dueDate).toBe('2025-10-06');
});

test('short day names alone are not treated as dates', () => {
  const r = QuickAdd.parse('Fix the sun roof', NOW);
  expect(r.title).toBe('Fix the sun roof');
  expect(r.dueDate).toBe(null);
});

test('12am and 12pm convert correctly', () => {
  expect(QuickAdd.parse('Launch 12am', NOW).dueTime).toBe('00:00');
  expect(QuickAdd.parse('Lunch 12:30pm', NOW).dueTime).toBe('12:30');
});

test('24-hour time needs "at"', () => {
  expect(QuickAdd.parse('Call at 18:45', NOW).dueTime).toBe('18:45');
  expect(QuickAdd.parse('Read 20:00 book', NOW).dueTime).toBe(null);
});

test('"in 3 days" and "next week"', () => {
  expect(QuickAdd.parse('Pay rent in 3 days', NOW).dueDate).toBe('2025-10-04');
  expect(QuickAdd.parse('Review next week', NOW).dueDate).toBe('2025-10-08');
});

test('"tonight" sets 8pm unless a time is given', () => {
  expect(QuickAdd.parse('Call mum tonight', NOW).dueTime).toBe('20:00');
  expect(QuickAdd.parse('Call mum tonight 9pm', NOW).dueTime).toBe('21:00');
});

test('duplicate tags are removed and lower-cased', () => {
  expect(QuickAdd.parse('Plan #Trip #trip', NOW).tags).toEqual(['trip']);
});

// ---------- Utils ----------

test('escapeHtml neutralises HTML', () => {
  expect(Utils.escapeHtml('<img src=x onerror="alert(1)">')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
});

test('tasks without a time are due at the end of the day', () => {
  const due = Utils.dueDateTime(task({ dueDate: '2025-10-01' }));
  expect(due.getHours()).toBe(23);
  expect(Utils.isOverdue(task({ dueDate: '2025-10-01' }), NOW)).toBe(false);
});

test('overdue detection respects the time and completion', () => {
  expect(Utils.isOverdue(task({ dueDate: '2025-10-01', dueTime: '09:00' }), NOW)).toBe(true);
  expect(Utils.isOverdue(task({ dueDate: '2025-10-01', dueTime: '09:00', completed: true }), NOW)).toBe(false);
});

test('daysBetween handles month ends', () => {
  expect(Utils.daysBetween('2025-01-30', '2025-02-02')).toBe(3);
});

test('cleanTag normalises user input', () => {
  expect(Utils.cleanTag('#Big Launch!')).toBe('big-launch');
});

test('formatTime uses a 12-hour clock', () => {
  expect(Utils.formatTime('00:05')).toBe('12:05 AM');
  expect(Utils.formatTime('13:30')).toBe('1:30 PM');
});

// ---------- Calendar ----------

test('.ics contains a timed event with an alarm', () => {
  const ics = CalendarLink.toICS([task({ title: 'Demo, day', dueDate: '2025-10-02', dueTime: '15:00', reminder: 30 })]);
  expect(ics).toContain('BEGIN:VCALENDAR');
  expect(ics).toContain('DTSTART:20251002T150000');
  expect(ics).toContain('DTEND:20251002T153000');
  expect(ics).toContain('SUMMARY:Demo\\, day');
  expect(ics).toContain('TRIGGER:-PT30M');
});

test('.ics all-day events remind relative to 9am', () => {
  const ics = CalendarLink.toICS([task({ dueDate: '2025-10-02', reminder: 60 })]);
  expect(ics).toContain('DTSTART;VALUE=DATE:20251002');
  expect(ics).toContain('DTEND;VALUE=DATE:20251003');
  expect(ics).toContain('TRIGGER:PT480M');
});

test('.ics skips tasks without a due date and alarms when reminder is off', () => {
  const ics = CalendarLink.toICS([task({ title: 'No date' }), task({ dueDate: '2025-10-02', reminder: null })]);
  expect(ics.split('BEGIN:VEVENT').length - 1).toBe(1);
  expect(ics.includes('VALARM')).toBe(false);
});

test('.ics lines are folded to 75 characters', () => {
  const ics = CalendarLink.toICS([task({ dueDate: '2025-10-02', notes: 'x'.repeat(300) })]);
  expect(ics.split('\r\n').every((line) => line.length <= 75)).toBe(true);
});

test('Google Calendar link carries title and dates', () => {
  const url = new URL(CalendarLink.googleUrl(task({ title: 'Ship it', dueDate: '2025-10-02' })));
  expect(url.searchParams.get('text')).toBe('Ship it');
  expect(url.searchParams.get('dates')).toBe('20251002/20251003');
});

// ---------- Report ----------

const failed = results.filter((r) => !r.ok);
document.getElementById('summary').innerHTML = failed.length
  ? `<span class="fail">${failed.length} of ${results.length} tests failed</span>`
  : `<span class="pass">All ${results.length} tests passed ✓</span>`;
document.getElementById('results').innerHTML = results.map((r) =>
  `<li class="${r.ok ? 'pass' : 'fail'}">${r.ok ? '✓' : '✗'} ${Utils.escapeHtml(r.name)}${r.ok ? '' : `<pre>${Utils.escapeHtml(r.message)}</pre>`}</li>`).join('');
