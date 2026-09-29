/* ==========================================================================
   QuickAdd — turns a typed sentence into a task.

     "Call Sam tomorrow at 3pm !high #work"
       -> title "Call Sam", due tomorrow 15:00, priority High, tag "work"

   Supported:
     dates     today, tonight, tomorrow, next week, in 3 days, monday / mon ...
     times     3pm, 3:30pm, at 15:00
     priority  !urgent !high !medium !low  or  !1 !2 !3 !4  (also !p1 ...)
     tags      #anything
   ========================================================================== */

const QuickAdd = (() => {
  const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const PRIORITY_WORDS = {
    urgent: 1, p1: 1, 1: 1,
    high: 2, p2: 2, 2: 2,
    medium: 3, med: 3, p3: 3, 3: 3,
    low: 4, p4: 4, 4: 4,
  };

  function parse(input, now = new Date()) {
    // Padding with spaces lets every pattern require whitespace on both sides.
    let text = ` ${input} `;
    const result = { title: '', priority: null, tags: [], dueDate: null, dueTime: null };
    const dateIn = (days) => Utils.toDateKey(Utils.addDays(now, days));

    // Runs a pattern, hands each match to `handle`, and removes it from the title.
    const take = (pattern, handle) => {
      text = text.replace(pattern, (...match) => { handle(...match); return ' '; });
    };

    take(/\s!(urgent|high|medium|med|low|p?[1-4])(?=\s)/gi, (_, word) => {
      result.priority = PRIORITY_WORDS[word.toLowerCase()];
    });

    take(/\s#([\p{L}\p{N}_-]+)(?=\s)/giu, (_, tag) => {
      const clean = Utils.cleanTag(tag);
      if (clean && !result.tags.includes(clean)) result.tags.push(clean);
    });

    // Times: "3pm", "3:30 pm", "at 9am"
    take(/\s(?:at\s+)?(\d{1,2})(?::([0-5]\d))?\s?(am|pm)(?=\s)/gi, (_, h, m = '00', meridiem) => {
      const hour = Number(h);
      if (hour < 1 || hour > 12) return;
      result.dueTime = `${Utils.pad((hour % 12) + (meridiem.toLowerCase() === 'pm' ? 12 : 0))}:${m}`;
    });
    // 24-hour times need "at" so a number in the title isn't mistaken for a time: "at 15:00"
    take(/\sat\s+([01]?\d|2[0-3]):([0-5]\d)(?=\s)/gi, (_, h, m) => {
      result.dueTime = `${Utils.pad(Number(h))}:${m}`;
    });

    take(/\s(today|tonight)(?=\s)/gi, (_, word) => {
      result.dueDate = dateIn(0);
      if (word.toLowerCase() === 'tonight' && !result.dueTime) result.dueTime = '20:00';
    });
    take(/\s(tomorrow|tmrw|tmr)(?=\s)/gi, () => { result.dueDate = dateIn(1); });
    take(/\snext\s+week(?=\s)/gi, () => { result.dueDate = dateIn(7); });
    take(/\sin\s+(\d{1,3})\s+days?(?=\s)/gi, (_, n) => { result.dueDate = dateIn(Number(n)); });

    // Weekdays: the next one after today ("monday" on a Monday means next week).
    // Short forms need "on"/"next" in front, so "fix the sun roof" stays a title.
    const toWeekday = (_, word) => {
      const target = WEEKDAYS.findIndex((day) => day.startsWith(word.toLowerCase().slice(0, 3)));
      result.dueDate = dateIn((target - now.getDay() + 7) % 7 || 7);
    };
    take(/\s(?:on\s+|next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?=\s)/gi, toWeekday);
    take(/\s(?:on|next)\s+(sun|mon|tues?|wed|thu(?:rs?)?|fri|sat)(?=\s)/gi, toWeekday);

    result.title = text.replace(/\s+/g, ' ').trim() || input.trim();
    return result;
  }

  return { parse };
})();
