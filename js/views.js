/* ==========================================================================
   Views — functions that turn state into HTML strings.

   They never change data. Buttons carry `data-action="..."` attributes,
   and app.js decides what each action does. User text always goes
   through `e()` (escapeHtml) before it reaches the page.
   ========================================================================== */

const Views = (() => {
  const e = Utils.escapeHtml;
  const icon = Icons.get;
  const P = Utils.PRIORITIES;

  const REMINDERS = [
    ['', 'No reminder'], ['0', 'At due time'], ['5', '5 minutes before'], ['15', '15 minutes before'],
    ['30', '30 minutes before'], ['60', '1 hour before'], ['1440', '1 day before'],
  ];
  const SORTS = [['smart', 'Smart groups'], ['priority', 'Priority'], ['due', 'Due date'], ['created', 'Newest first'], ['alpha', 'A → Z']];
  const SWATCHES = ['#DD6031', '#B42318', '#EE9E7B', '#121212', '#6F6E69', '#C6C2B8'];

  const projectById = (state, id) => state.projects.find((p) => p.id === id);
  const labelById = (state, id) => state.labels.find((l) => l.id === id);
  const plural = Utils.plural;

  // ======================================================================
  // Choosing which tasks a view shows
  // ======================================================================

  function describeView(state, ui) {
    const today = Utils.todayKey();
    const open = state.tasks.filter((t) => !t.completed);
    const done = state.tasks.filter((t) => t.completed);
    const [kind, value] = ui.view.split(/:(.*)/s);

    if (kind === 'project') {
      const project = projectById(state, value);
      if (project) {
        const category = state.categories.find((c) => c.id === project.categoryId);
        const inProject = (t) => t.projectId === value;
        return {
          kind, title: project.name,
          eyebrow: `-project${category ? ` · ${category.name.toLowerCase()}` : ''}`,
          tasks: open.filter(inProject), completed: done.filter(inProject), mode: 'buckets',
          empty: 'Add the first task for this project above.',
        };
      }
    }
    if (kind === 'label') {
      const label = labelById(state, value);
      if (label) {
        const has = (t) => t.labelIds.includes(value);
        return { kind, title: label.name, eyebrow: '-label', tasks: open.filter(has), completed: done.filter(has), mode: 'buckets', empty: 'No open tasks have this label.' };
      }
    }
    if (kind === 'tag') {
      const has = (t) => t.tags.includes(value);
      return { kind, title: `#${value}`, eyebrow: '-tag', tasks: open.filter(has), completed: done.filter(has), mode: 'buckets', empty: 'No open tasks use this tag.' };
    }
    if (kind === 'today') {
      return {
        kind, title: 'Today', eyebrow: `-${Utils.formatLongDate(today).toLowerCase()}`,
        tasks: open.filter((t) => t.dueDate && t.dueDate <= today), mode: 'buckets', hero: true,
        empty: 'Nothing due today. Enjoy it, or plan ahead.',
      };
    }
    if (kind === 'upcoming') {
      return { kind, title: 'Upcoming', eyebrow: '-the week ahead and beyond', tasks: open.filter((t) => t.dueDate && t.dueDate > today), mode: 'days', empty: 'No tasks scheduled after today.' };
    }
    if (kind === 'completed') {
      return { kind, title: 'Completed', eyebrow: '-nice work', tasks: done, mode: 'flat', empty: 'Tasks you finish will show up here.' };
    }
    return {
      kind: 'all', title: Utils.greeting(), eyebrow: '-all your open tasks', tasks: open, mode: 'buckets', hero: true,
      empty: 'You have no open tasks. Add one above to get going.',
    };
  }

  function applyFilters(tasks, ui) {
    const q = ui.search.trim().toLowerCase();
    return tasks.filter((t) => {
      if (ui.priority !== 'all' && t.priority !== Number(ui.priority)) return false;
      if (!q) return true;
      return [t.title, t.notes, ...t.tags, ...t.subtasks.map((s) => s.text), ...t.checklist.map((c) => c.text)]
        .some((text) => text.toLowerCase().includes(q));
    });
  }

  const dueTs = (t) => (t.dueDate ? Utils.dueDateTime(t).getTime() : Number.MAX_SAFE_INTEGER);
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const SORTERS = {
    due: (a, b) => cmp(dueTs(a), dueTs(b)) || a.priority - b.priority || cmp(b.createdAt, a.createdAt),
    priority: (a, b) => a.priority - b.priority || cmp(dueTs(a), dueTs(b)),
    created: (a, b) => cmp(b.createdAt, a.createdAt),
    alpha: (a, b) => a.title.localeCompare(b.title),
    completed: (a, b) => cmp(b.completedAt || '', a.completedAt || ''),
  };
  const sortTasks = (tasks, by) => [...tasks].sort(SORTERS[by]);

  function bucketOf(task, today) {
    if (!task.dueDate) return 'nodate';
    if (Utils.isOverdue(task)) return 'overdue';
    const diff = Utils.daysBetween(today, task.dueDate);
    if (diff === 0) return 'today';
    if (diff === 1) return 'tomorrow';
    return diff < 7 ? 'week' : 'later';
  }

  const BUCKETS = [
    ['overdue', 'Overdue', 'danger'], ['today', 'Today'], ['tomorrow', 'Tomorrow'],
    ['week', 'Next 7 days'], ['later', 'Later'], ['nodate', 'No due date'],
  ];

  function groupTasks(tasks, view, sort) {
    if (view.kind === 'completed') return [{ id: 'done', tasks: sortTasks(tasks, sort === 'smart' ? 'completed' : sort) }];
    if (sort !== 'smart') return [{ id: 'all', tasks: sortTasks(tasks, sort) }];

    const today = Utils.todayKey();
    const sorted = sortTasks(tasks, 'due');

    if (view.mode === 'days') {
      const groups = new Map();
      sorted.forEach((t) => {
        const within = Utils.daysBetween(today, t.dueDate) < 7;
        const id = within ? t.dueDate : 'later';
        if (!groups.has(id)) {
          groups.set(id, within
            ? { id, title: Utils.formatDateLabel(t.dueDate), sub: Utils.fromDateKey(t.dueDate).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }), tasks: [] }
            : { id, title: 'Later', tasks: [] });
        }
        groups.get(id).tasks.push(t);
      });
      return [...groups.values()];
    }

    return BUCKETS
      .map(([id, title, tone]) => ({ id, title, tone, tasks: sorted.filter((t) => bucketOf(t, today) === id) }))
      .filter((g) => g.tasks.length);
  }

  function stats(state) {
    const today = Utils.todayKey();
    const dueToday = state.tasks.filter((t) => t.dueDate === today);
    const doneToday = dueToday.filter((t) => t.completed).length;
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    return {
      dueToday: dueToday.length,
      doneToday,
      left: dueToday.length - doneToday,
      overdue: state.tasks.filter((t) => Utils.isOverdue(t)).length,
      doneWeek: state.tasks.filter((t) => t.completed && Date.parse(t.completedAt) > weekAgo).length,
      open: state.tasks.filter((t) => !t.completed).length,
    };
  }

  // ======================================================================
  // Sidebar
  // ======================================================================

  function sidebar(state, ui) {
    const today = Utils.todayKey();
    const open = state.tasks.filter((t) => !t.completed);
    const count = (fn) => open.filter(fn).length;

    const navItem = (view, iconHtml, label, n) => `
      <button class="nav-item${ui.view === view ? ' is-active' : ''}" data-action="nav" data-view="${e(view)}"${ui.view === view ? ' aria-current="page"' : ''}>
        ${iconHtml}<span class="nav-label">${e(label)}</span>${n ? `<span class="nav-count">${n}</span>` : ''}
      </button>`;

    const projectRow = (p) => `
      <div class="nav-row">
        ${navItem(`project:${p.id}`, `<i class="dot" style="--dot:${e(p.color)}"></i>`, p.name, count((t) => t.projectId === p.id))}
        <button class="icon-btn sm row-edit" data-action="open-modal" data-type="project" data-id="${p.id}" aria-label="Edit project ${e(p.name)}">${icon('edit', 14)}</button>
      </div>`;

    const loose = state.projects.filter((p) => !state.categories.some((c) => c.id === p.categoryId));
    const categories = state.categories.map((c) => `
      <div class="side-cat">
        <span>${e(c.name)}</span>
        <button class="icon-btn sm" data-action="open-modal" data-type="category" data-id="${c.id}" aria-label="Edit category ${e(c.name)}">${icon('edit', 13)}</button>
      </div>
      ${state.projects.filter((p) => p.categoryId === c.id).map(projectRow).join('')}`).join('');

    const tagCounts = new Map();
    open.forEach((t) => t.tags.forEach((tag) => tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)));
    const tags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

    return `
      <div class="sidebar-inner" data-keep-scroll="sidebar">
        <div class="brand">
          ${Icons.shape('brand-mark')}
          <span>Doable<span class="cursor">_</span></span>
          <button class="icon-btn sidebar-close" data-action="close-sidebar" aria-label="Close menu">${icon('x', 20)}</button>
        </div>

        <nav class="nav" aria-label="Views">
          ${navItem('all', icon('list'), 'All tasks', open.length)}
          ${navItem('today', icon('sun'), 'Today', count((t) => t.dueDate && t.dueDate <= today))}
          ${navItem('upcoming', icon('forward'), 'Upcoming', count((t) => t.dueDate && t.dueDate > today))}
          ${navItem('completed', icon('check-circle'), 'Completed', state.tasks.length - open.length)}
        </nav>

        <section class="side-section" aria-label="Calendar">
          <div class="side-head"><span class="mono-tag">-plan ahead</span></div>
          ${navItem('calendar', icon('calendar'), 'Calendar', count((t) => t.dueDate))}
        </section>

        <section class="side-section" aria-label="Projects">
          <div class="side-head">
            <span class="mono-tag">-projects</span>
            <button class="icon-btn sm" data-action="open-modal" data-type="project" aria-label="New project">${icon('plus', 16)}</button>
          </div>
          ${loose.map(projectRow).join('')}
          ${categories}
          <button class="side-add" data-action="open-modal" data-type="category">${icon('folder', 15)} New category</button>
        </section>

        <section class="side-section" aria-label="Labels">
          <div class="side-head">
            <span class="mono-tag">-labels</span>
            <button class="icon-btn sm" data-action="open-modal" data-type="label" aria-label="New label">${icon('plus', 16)}</button>
          </div>
          ${state.labels.map((l) => `
            <div class="nav-row">
              ${navItem(`label:${l.id}`, `<i class="dot" style="--dot:${e(l.color)};border-radius:50%"></i>`, l.name, count((t) => t.labelIds.includes(l.id)))}
              <button class="icon-btn sm row-edit" data-action="open-modal" data-type="label" data-id="${l.id}" aria-label="Edit label ${e(l.name)}">${icon('edit', 14)}</button>
            </div>`).join('') || '<p class="hint" style="padding:0 10px">No labels yet.</p>'}
        </section>

        ${tags.length ? `
        <section class="side-section" aria-label="Tags">
          <div class="side-head"><span class="mono-tag">-tags</span></div>
          <div class="tag-cloud">
            ${tags.map(([tag, n]) => `<button class="tag-pill${ui.view === `tag:${tag}` ? ' is-active' : ''}" data-action="nav" data-view="tag:${e(tag)}" aria-label="#${e(tag)}, ${plural(n, 'task')}">#${e(tag)}</button>`).join('')}
          </div>
        </section>` : ''}

        <div class="side-foot">
          <button data-action="export-json">${icon('download', 14)} Backup</button>
          <button data-action="import-json">${icon('upload', 14)} Restore</button>
          <button data-action="reset-demo">${icon('refresh', 14)} Reset demo</button>
        </div>
      </div>`;
  }

  // ======================================================================
  // Top bar & notifications
  // ======================================================================

  function topbar(state, ui) {
    const unread = state.notifications.filter((n) => !n.read).length;
    const dark = ui.theme === 'dark';
    return `
      <header class="topbar">
        <button class="icon-btn menu-btn" data-action="toggle-sidebar" aria-label="Open menu">${icon('menu', 20)}</button>
        <label class="search">
          ${icon('search', 16)}
          <span class="visually-hidden">Search tasks</span>
          <input type="search" placeholder="Search tasks" value="${e(ui.search)}" data-control="search" data-focus-key="search" autocomplete="off">
          <kbd>/</kbd>
        </label>
        <div class="topbar-actions">
          <button class="icon-btn" data-action="toggle-theme" aria-label="Switch to ${dark ? 'light' : 'dark'} mode">${icon(dark ? 'sun' : 'moon')}</button>
          <div class="notif-wrap">
            <button class="icon-btn" data-action="toggle-notifs" aria-expanded="${ui.notifOpen}" aria-label="Notifications, ${unread} unread">
              ${icon('bell')}${unread ? `<span class="badge">${unread > 9 ? '9+' : unread}</span>` : ''}
            </button>
            ${ui.notifOpen ? notificationPanel(state) : ''}
          </div>
          <button class="btn-primary new-btn" data-action="focus-quick-add" aria-label="New task">${icon('plus', 16)}<span>New task</span></button>
        </div>
      </header>`;
  }

  function notificationPanel(state) {
    const permission = Notifier.permission();
    const on = state.settings.desktopAlerts && permission === 'granted';
    const status = {
      unsupported: "This browser can't show desktop alerts.",
      denied: 'Blocked. Allow notifications in your browser settings.',
    }[permission] || (on ? "You'll get alerts even when this tab is in the background." : 'Get alerts outside this tab when tasks are due.');
    const kindIcon = { overdue: 'alert', reminder: 'clock', invite: 'mail' };
    const list = state.notifications.slice(0, 30);

    return `
      <div class="popover" role="dialog" aria-label="Notifications">
        <div class="popover-head">
          <strong>Notifications</strong>
          ${list.some((n) => !n.read) ? '<button class="link-btn" data-action="mark-all-read">Mark all read</button>' : ''}
        </div>
        <div class="alert-toggle">
          ${icon('bell', 18)}
          <div><strong>Desktop alerts</strong><span>${status}</span></div>
          ${permission === 'unsupported' || permission === 'denied' ? '' : `<button class="btn-ghost sm" data-action="toggle-desktop">${on ? 'Turn off' : 'Turn on'}</button>`}
        </div>
        ${list.length ? `
          <ul class="notif-list">
            ${list.map((n) => `
              <li>
                <button class="notif kind-${n.kind}${n.read ? '' : ' is-unread'}" data-action="open-notification" data-id="${n.id}">
                  ${icon(kindIcon[n.kind] || 'bell', 16)}
                  <span><strong>${e(n.title)}</strong><small>${e(n.body)} · ${Utils.timeAgo(n.createdAt)}</small></span>
                </button>
              </li>`).join('')}
          </ul>
          <div class="popover-foot"><button class="link-btn" data-action="clear-notifications">Clear all</button></div>`
        : '<p class="empty-small">You\'re all caught up<span class="cursor">_</span></p>'}
      </div>`;
  }

  // ======================================================================
  // Main area
  // ======================================================================

  function main(state, ui) {
    return `
      ${topbar(state, ui)}
      <div class="content" data-keep-scroll="content-${e(ui.view)}">
        ${ui.view === 'calendar' ? calendarView(state, ui) : listView(state, ui)}
      </div>`;
  }

  function pageHead(eyebrow, title) {
    return `
      <div class="page-head">
        <p class="mono-tag">${e(eyebrow)}</p>
        <h1>${e(title)}<span class="cursor">_</span></h1>
      </div>`;
  }

  function hero(state) {
    const s = stats(state);
    const headline = s.dueToday === 0 ? 'Nothing due today'
      : s.left === 0 ? 'All done for today'
      : `${plural(s.left, 'task')} left today`;
    const pct = s.dueToday ? Math.round((s.doneToday / s.dueToday) * 100) : 0;
    return `
      <section class="hero" aria-label="Today at a glance">
        <div class="hero-text">
          <p class="mono-tag">-your focus for today</p>
          <h2>${headline}</h2>
          <p class="hero-sub">${s.dueToday ? `${pct}% of today's tasks complete` : 'Plan something, or take the win.'}</p>
          <div class="hero-progress" role="progressbar" aria-label="Today's progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div>
          <div class="hero-stats">
            <span class="hero-stat${s.overdue ? ' is-alert' : ''}"><strong>${s.overdue}</strong>overdue</span>
            <span class="hero-stat"><strong>${s.open}</strong>open</span>
            <span class="hero-stat"><strong>${s.doneWeek}</strong>done this week</span>
          </div>
        </div>
        ${Icons.shape('hero-shape')}
      </section>`;
  }

  function quickAddPreview(text) {
    if (!text.trim()) return '';
    const p = QuickAdd.parse(text);
    const chips = [];
    if (p.dueDate || p.dueTime) chips.push(`${icon('calendar', 12)}${e(Utils.formatDue({ dueDate: p.dueDate || Utils.todayKey(), dueTime: p.dueTime }))}`);
    if (p.priority) chips.push(`${icon('flag', 12)}${P[p.priority].label}`);
    p.tags.forEach((tag) => chips.push(`#${e(tag)}`));
    return chips.map((c) => `<span class="qa-chip">${c}</span>`).join('');
  }

  function quickAdd(ui, placeholder = 'Add a task, e.g. "Call Sam tomorrow 3pm !high #work"') {
    return `
      <form class="quick-add" data-form="quick-add" autocomplete="off">
        ${icon('plus', 18)}
        <label class="visually-hidden" for="quick-add-input">New task</label>
        <input id="quick-add-input" name="title" placeholder="${e(placeholder)}" value="${e(ui.quickAdd)}" data-control="quick-add" data-focus-key="quick-add" maxlength="300">
        <button class="btn-primary sm" type="submit">Add task</button>
        <div class="qa-preview" aria-live="polite">${quickAddPreview(ui.quickAdd)}</div>
      </form>`;
  }

  function toolbar(ui, view, completedCount) {
    const chip = (value, label, extra = '') => `<button class="chip" data-action="filter-priority" data-value="${value}" aria-pressed="${ui.priority === value}">${extra}${label}</button>`;
    return `
      <div class="toolbar">
        <div class="chip-group" role="group" aria-label="Filter by priority">
          ${chip('all', 'All')}
          ${[1, 2, 3, 4].map((n) => chip(String(n), P[n].label, `<i class="pdot prio-${n}"></i>`)).join('')}
        </div>
        <div class="toolbar-right">
          ${view.kind === 'completed' && completedCount ? `<button class="btn-ghost sm danger" data-action="clear-completed">${icon('trash', 14)} Clear all</button>` : ''}
          <label class="sort">Sort
            <select data-control="sort">
              ${SORTS.map(([value, label]) => `<option value="${value}"${ui.sort === value ? ' selected' : ''}>${label}</option>`).join('')}
            </select>
          </label>
        </div>
      </div>`;
  }

  function listView(state, ui) {
    const view = describeView(state, ui);
    const tasks = applyFilters(view.tasks, ui);
    const groups = groupTasks(tasks, view, ui.sort);
    const completed = view.completed ? applyFilters(view.completed, ui) : [];
    const filtering = ui.search.trim() || ui.priority !== 'all';

    const body = tasks.length
      ? groups.map((g) => `
          <section class="group${g.tone ? ` tone-${g.tone}` : ''}">
            ${g.title ? `<h2 class="group-title">${e(g.title)}${g.sub ? ` <small>${e(g.sub)}</small>` : ''} <span class="count">${g.tasks.length}</span></h2>` : ''}
            <ul class="task-list">${g.tasks.map((t) => taskRow(state, t, view)).join('')}</ul>
          </section>`).join('')
      : emptyState(filtering ? 'No matches' : 'All clear', filtering ? 'No tasks match your search or filter.' : view.empty, filtering);

    return `
      <div class="page">
        ${pageHead(view.eyebrow, view.title)}
        ${view.hero ? hero(state) : ''}
        ${view.kind !== 'completed' ? `${quickAdd(ui)}<p class="qa-help">Tip: type <b>tomorrow</b>, <b>fri 3pm</b>, <b>!high</b> or <b>#tag</b> · press <b>N</b> to add, <b>/</b> to search</p>` : ''}
        ${toolbar(ui, view, view.tasks.length)}
        ${body}
        ${completed.length ? `
          <button class="completed-toggle" data-action="toggle-completed" aria-expanded="${ui.showCompleted}">
            ${icon('chevron-right', 16)} Completed <span class="mono">${completed.length}</span>
          </button>
          ${ui.showCompleted ? `<ul class="task-list" style="margin-top:10px">${sortTasks(completed, 'completed').map((t) => taskRow(state, t, view)).join('')}</ul>` : ''}` : ''}
      </div>`;
  }

  function emptyState(title, text, showClear) {
    return `
      <div class="empty">
        ${Icons.shape('empty-shape')}
        <h3>${e(title)}<span class="cursor">_</span></h3>
        <p>${e(text)}</p>
        ${showClear ? '<button class="btn-ghost" data-action="clear-filters">Clear search & filters</button>' : ''}
      </div>`;
  }

  function avatars(people, max = 3) {
    const shown = people.slice(0, max);
    const names = people.map((c) => c.name || c.email).join(', ');
    return `<span class="avatars" title="Shared with ${e(names)}" aria-label="Shared with ${e(names)}">
      ${shown.map((c, i) => `<span class="avatar av-${i % 3}">${e(Utils.initials(c.name || c.email))}</span>`).join('')}
      ${people.length > max ? `<span class="avatar av-2">+${people.length - max}</span>` : ''}
    </span>`;
  }

  function taskRow(state, task, view = {}) {
    const overdue = Utils.isOverdue(task);
    const project = projectById(state, task.projectId);
    const meta = [];

    if (task.priority < 4) meta.push(`<span class="meta prio">${icon('flag', 13)}${P[task.priority].label}</span>`);
    if (task.dueDate) {
      const cls = overdue ? ' is-overdue' : task.dueDate === Utils.todayKey() && !task.completed ? ' is-today' : '';
      meta.push(`<span class="meta due${cls}">${icon('clock', 13)}${e(Utils.formatDue(task))}</span>`);
    }
    if (project && view.kind !== 'project') meta.push(`<span class="meta"><i class="dot" style="--dot:${e(project.color)}"></i>${e(project.name)}</span>`);
    task.labelIds.map((id) => labelById(state, id)).filter(Boolean)
      .forEach((l) => meta.push(`<span class="label-chip" style="--chip:${e(l.color)}">${e(l.name)}</span>`));
    task.tags.forEach((tag) => meta.push(`<span class="meta tag">#${e(tag)}</span>`));
    if (task.subtasks.length) {
      const n = task.subtasks.filter((s) => s.done).length;
      meta.push(`<span class="meta" title="Sub-tasks">${icon('subtasks', 13)}${n}/${task.subtasks.length}</span>`);
    }
    if (task.checklist.length) {
      const n = task.checklist.filter((c) => c.done).length;
      meta.push(`<span class="meta" title="Checklist">${icon('checklist', 13)}${n}/${task.checklist.length}</span>`);
    }
    if (task.notes.trim()) meta.push(`<span class="meta" title="Has notes">${icon('note', 13)}</span>`);
    if (task.collaborators.length) meta.push(avatars(task.collaborators));

    return `
      <li class="task p${task.priority}${task.completed ? ' is-done' : ''}">
        <button class="check" data-action="toggle-task" data-id="${task.id}" aria-pressed="${task.completed}" aria-label="Mark “${e(task.title)}” as ${task.completed ? 'not done' : 'done'}">${icon('check', 13)}</button>
        <div class="task-body" data-action="open-task" data-id="${task.id}" role="button" tabindex="0" aria-label="Open “${e(task.title)}”">
          <span class="task-title">${e(task.title)}</span>
          ${meta.length ? `<span class="task-meta">${meta.join('')}</span>` : ''}
        </div>
        <div class="task-actions">
          <button class="icon-btn sm" data-action="open-task" data-id="${task.id}" data-where="row-edit" aria-label="Edit “${e(task.title)}”">${icon('edit', 15)}</button>
          <button class="icon-btn sm danger" data-action="delete-task" data-id="${task.id}" aria-label="Delete “${e(task.title)}”">${icon('trash', 15)}</button>
        </div>
      </li>`;
  }

  // ======================================================================
  // Calendar
  // ======================================================================

  function calendarView(state, ui) {
    const month = Utils.fromDateKey(ui.calMonth);
    const today = Utils.todayKey();
    const startOffset = (month.getDay() + 6) % 7; // weeks start on Monday
    const gridStart = Utils.addDays(month, -startOffset);

    const byDay = new Map();
    applyFilters(state.tasks.filter((t) => t.dueDate), ui).forEach((t) => {
      if (!byDay.has(t.dueDate)) byDay.set(t.dueDate, []);
      byDay.get(t.dueDate).push(t);
    });
    byDay.forEach((list) => list.sort((a, b) => a.completed - b.completed || SORTERS.due(a, b)));

    const weekdays = Array.from({ length: 7 }, (_, i) =>
      Utils.addDays(new Date(2024, 0, 1), i).toLocaleDateString(undefined, { weekday: 'short' })); // 1 Jan 2024 was a Monday

    const cells = Array.from({ length: 42 }, (_, i) => {
      const date = Utils.addDays(gridStart, i);
      const key = Utils.toDateKey(date);
      const tasks = byDay.get(key) || [];
      const classes = ['cal-cell'];
      if (date.getMonth() !== month.getMonth()) classes.push('is-outside');
      if (key === today) classes.push('is-today');
      if (key === ui.selectedDay) classes.push('is-selected');
      const label = `${Utils.formatLongDate(key)}, ${plural(tasks.length, 'task')}`;
      return `
        <button class="${classes.join(' ')}" data-action="select-day" data-date="${key}" aria-label="${e(label)}" aria-pressed="${key === ui.selectedDay}">
          <span class="cal-num">${date.getDate()}</span>
          ${tasks.slice(0, 3).map((t) => `<span class="cal-chip prio-${t.priority}${t.completed ? ' is-done' : ''}${Utils.isOverdue(t) ? ' is-overdue' : ''}">${e(t.title)}</span>`).join('')}
          ${tasks.length > 3 ? `<span class="cal-more">+${tasks.length - 3} more</span>` : ''}
          ${tasks.length ? `<span class="cal-dots">${tasks.slice(0, 4).map((t) => `<i class="cal-dot prio-${t.priority}"></i>`).join('')}</span>` : ''}
        </button>`;
    }).join('');

    const dayTasks = byDay.get(ui.selectedDay) || [];
    return `
      <div class="page page-wide">
        ${pageHead('-plan by due date', 'Calendar')}
        <div class="cal-toolbar">
          <button class="icon-btn" data-action="cal-prev" aria-label="Previous month">${icon('chevron-left', 20)}</button>
          <h2 aria-live="polite">${month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
          <button class="icon-btn" data-action="cal-next" aria-label="Next month">${icon('chevron-right', 20)}</button>
          <button class="btn-ghost sm" data-action="cal-today">Today</button>
          <span class="spacer"></span>
          <button class="btn-ghost sm" data-action="export-ics" title="Download all dated tasks as a calendar file with reminders">${icon('download', 15)} Export to calendar (.ics)</button>
        </div>
        <div class="cal-layout">
          <div class="cal-grid">
            ${weekdays.map((d) => `<div class="cal-dow" aria-hidden="true">${e(d)}</div>`).join('')}
            ${cells}
          </div>
          <aside class="cal-day" aria-label="Selected day">
            <p class="mono-tag">-selected day</p>
            <h3>${e(Utils.formatDateLabel(ui.selectedDay))}</h3>
            <p class="hint" style="margin:-10px 0 14px">${e(Utils.formatLongDate(ui.selectedDay))}</p>
            ${quickAdd(ui, 'Add a task for this day')}
            ${dayTasks.length
              ? `<ul class="task-list">${dayTasks.map((t) => taskRow(state, t)).join('')}</ul>`
              : '<p class="empty-small">Nothing due this day.</p>'}
          </aside>
        </div>
      </div>`;
  }

  // ======================================================================
  // Task details drawer
  // ======================================================================

  function drawer(state, ui) {
    const task = state.tasks.find((t) => t.id === ui.openTaskId);
    if (!task) return '';
    const overdue = Utils.isOverdue(task);
    const animate = ui.justOpened === 'drawer' ? ' animate-in' : '';

    const status = task.completed
      ? `<span class="status-pill is-done">Completed ${e(Utils.formatTimestamp(task.completedAt))}</span>`
      : overdue ? '<span class="status-pill is-overdue">Overdue</span>'
      : task.dueDate ? `<span class="status-pill">Due ${e(Utils.formatDue(task))}</span>`
      : '<span class="status-pill">No due date</span>';

    const projectOptions = [
      `<option value="">No project</option>`,
      ...state.projects.filter((p) => !state.categories.some((c) => c.id === p.categoryId))
        .map((p) => `<option value="${p.id}"${p.id === task.projectId ? ' selected' : ''}>${e(p.name)}</option>`),
      ...state.categories.map((c) => {
        const inCat = state.projects.filter((p) => p.categoryId === c.id);
        return inCat.length ? `<optgroup label="${e(c.name)}">${inCat.map((p) => `<option value="${p.id}"${p.id === task.projectId ? ' selected' : ''}>${e(p.name)}</option>`).join('')}</optgroup>` : '';
      }),
    ].join('');

    const reminderValue = task.reminder === null || task.reminder === undefined ? '' : String(task.reminder);

    return `
      <div class="drawer-backdrop${animate}" data-action="close-task"></div>
      <aside class="drawer${animate}" role="dialog" aria-modal="true" aria-label="Task details" tabindex="-1">
        <header class="drawer-head">
          <button class="icon-btn" data-action="close-task" aria-label="Close details">${icon('x', 20)}</button>
          <span class="mono-tag">-task details</span>
          <button class="icon-btn danger" data-action="delete-task" data-id="${task.id}" data-where="drawer" aria-label="Delete task">${icon('trash')}</button>
        </header>

        <div class="drawer-body" data-keep-scroll="drawer-${task.id}">
          <div class="detail-title-row">
            <button class="check lg p${task.priority} prio-${task.priority}" style="--prio:var(--p${task.priority})" data-action="toggle-task" data-id="${task.id}" data-where="drawer" aria-pressed="${task.completed}" aria-label="Mark as ${task.completed ? 'not done' : 'done'}">${icon('check', 16)}</button>
            <label class="visually-hidden" for="detail-title">Task title</label>
            <textarea id="detail-title" class="title-input" rows="1" data-field="title" data-focus-key="detail-title" maxlength="300">${e(task.title)}</textarea>
          </div>

          <div class="status-row">
            ${status}
            <button class="btn-ghost sm" data-action="toggle-task" data-id="${task.id}" data-where="drawer-btn">${icon(task.completed ? 'refresh' : 'check', 14)} ${task.completed ? 'Mark as not done' : 'Mark as done'}</button>
          </div>

          <div>
            <span class="field-label" id="prio-label">Priority</span>
            <div class="segmented" role="group" aria-labelledby="prio-label">
              ${[1, 2, 3, 4].map((n) => `<button class="prio-${n}" data-action="set-priority" data-value="${n}" aria-pressed="${task.priority === n}">${icon('flag', 14)}${P[n].label}</button>`).join('')}
            </div>
          </div>

          <div class="field-grid">
            <div>
              <label class="field-label" for="detail-date">Due date</label>
              <input id="detail-date" class="input" type="date" value="${task.dueDate || ''}" data-field="dueDate" data-focus-key="detail-date">
            </div>
            <div>
              <label class="field-label" for="detail-time">Time</label>
              <input id="detail-time" class="input" type="time" value="${task.dueTime || ''}" data-field="dueTime" data-focus-key="detail-time">
            </div>
            <div>
              <label class="field-label" for="detail-reminder">Reminder</label>
              <select id="detail-reminder" class="input" data-field="reminder" data-focus-key="detail-reminder">
                ${REMINDERS.map(([v, label]) => `<option value="${v}"${v === reminderValue ? ' selected' : ''}>${label}</option>`).join('')}
              </select>
            </div>
            <div>
              <label class="field-label" for="detail-project">Project</label>
              <select id="detail-project" class="input" data-field="projectId" data-focus-key="detail-project">${projectOptions}</select>
            </div>
          </div>
          ${task.dueDate && !task.dueTime && task.reminder !== null ? '<p class="hint" style="margin-top:-12px">All-day task: the reminder counts back from 9:00 AM.</p>' : ''}

          <div>
            <span class="field-label" id="labels-label">Labels</span>
            <div class="chips" role="group" aria-labelledby="labels-label">
              ${state.labels.map((l) => `<button class="toggle-chip" style="--chip:${e(l.color)}" data-action="toggle-label" data-label="${l.id}" aria-pressed="${task.labelIds.includes(l.id)}">${e(l.name)}</button>`).join('')}
              <button class="chip-add" data-action="open-modal" data-type="label">+ New label</button>
            </div>
          </div>

          <div>
            <label class="field-label" for="detail-tag">Tags</label>
            <div class="tag-input">
              ${task.tags.map((tag) => `<span class="tag-chip">#${e(tag)}<button data-action="remove-tag" data-tag="${e(tag)}" aria-label="Remove tag ${e(tag)}">${icon('x', 12)}</button></span>`).join('')}
              <form data-form="add-tag"><input id="detail-tag" name="tag" placeholder="${task.tags.length ? 'Add tag' : 'Type a tag and press Enter'}" data-focus-key="detail-tag" autocomplete="off"></form>
            </div>
          </div>

          <div>
            <label class="field-label" for="detail-notes">Notes</label>
            <textarea id="detail-notes" class="input notes" data-field="notes" data-focus-key="detail-notes" placeholder="Add details, links or context…">${e(task.notes)}</textarea>
          </div>

          ${itemSection(task, 'subtasks')}
          ${itemSection(task, 'checklist')}
          ${collaboratorSection(task)}

          <section class="detail-section">
            <div class="section-head"><h3>${icon('calendar')} Add to calendar</h3></div>
            ${task.dueDate ? `
              <div class="cal-links">
                <button class="btn-ghost sm" data-action="cal-google">${icon('external', 14)} Google</button>
                <button class="btn-ghost sm" data-action="cal-outlook">${icon('external', 14)} Outlook</button>
                <button class="btn-ghost sm" data-action="cal-ics">${icon('download', 14)} Apple / .ics</button>
              </div>
              <p class="hint" style="margin-top:8px">The .ics file includes your reminder, so your calendar alerts you too.</p>`
            : '<p class="hint">Set a due date to add this task to your calendar.</p>'}
          </section>

          <footer class="detail-foot">
            <span>Created ${e(Utils.formatTimestamp(task.createdAt))}</span>
            ${task.updatedAt ? `<span>Updated ${e(Utils.timeAgo(task.updatedAt))}</span>` : ''}
          </footer>
        </div>
      </aside>`;
  }

  function itemSection(task, list) {
    const isSub = list === 'subtasks';
    const items = task[list];
    const done = items.filter((i) => i.done).length;
    const noun = isSub ? 'sub-task' : 'checklist item';
    return `
      <section class="detail-section">
        <div class="section-head">
          <h3>${icon(isSub ? 'subtasks' : 'checklist')} ${isSub ? 'Sub-tasks' : 'Checklist'}</h3>
          ${items.length ? `<span class="mono hint">${done}/${items.length}</span>` : ''}
        </div>
        ${items.length ? `<div class="progress" role="progressbar" aria-label="${isSub ? 'Sub-tasks' : 'Checklist'} progress" aria-valuemin="0" aria-valuemax="${items.length}" aria-valuenow="${done}"><span style="width:${Math.round((done / items.length) * 100)}%"></span></div>` : ''}
        <ul class="item-list">
          ${items.map((item) => `
            <li class="item${item.done ? ' is-done' : ''}">
              <button class="check sm" data-action="toggle-item" data-list="${list}" data-item="${item.id}" aria-pressed="${item.done}" aria-label="Mark “${e(item.text)}” as ${item.done ? 'not done' : 'done'}">${icon('check', 11)}</button>
              <input class="item-text" value="${e(item.text)}" data-item-field="text" data-list="${list}" data-item="${item.id}" data-focus-key="${list}-${item.id}" aria-label="Edit ${noun}">
              ${isSub ? `<input class="item-date" type="date" value="${item.dueDate || ''}" data-item-field="dueDate" data-list="${list}" data-item="${item.id}" data-focus-key="${list}-date-${item.id}" aria-label="Due date for “${e(item.text)}”">` : ''}
              <button class="icon-btn sm danger" data-action="remove-item" data-list="${list}" data-item="${item.id}" aria-label="Remove “${e(item.text)}”">${icon('x', 14)}</button>
            </li>`).join('')}
        </ul>
        <form class="add-inline" data-form="add-item" data-list="${list}" autocomplete="off">
          ${icon('plus', 16)}
          <input name="text" placeholder="Add a ${noun}" data-focus-key="add-${list}" aria-label="Add a ${noun}" maxlength="200">
        </form>
      </section>`;
  }

  function collaboratorSection(task) {
    const role = (value, selected) => `<option value="${value}"${value === selected ? ' selected' : ''}>${value === 'editor' ? 'Can edit' : 'Can view'}</option>`;
    return `
      <section class="detail-section">
        <div class="section-head">
          <h3>${icon('users')} Collaborators</h3>
          ${task.collaborators.length ? `<span class="mono hint">${task.collaborators.length}</span>` : ''}
        </div>
        ${task.collaborators.length ? `
          <ul class="collab-list">
            ${task.collaborators.map((c, i) => `
              <li class="collab">
                <span class="avatar lg av-${i % 3}" aria-hidden="true">${e(Utils.initials(c.name || c.email))}</span>
                <div class="collab-info">
                  <strong>${e(c.name || c.email.split('@')[0])}</strong>
                  <span>${e(c.email)} · ${c.status === 'pending' ? 'Invite pending' : 'Joined'}</span>
                </div>
                <select data-collab-field="role" data-collab="${c.id}" aria-label="Permission for ${e(c.email)}">${role('editor', c.role)}${role('viewer', c.role)}</select>
                <button class="icon-btn sm" data-action="email-collab" data-collab="${c.id}" aria-label="Email ${e(c.email)} again">${icon('mail', 15)}</button>
                <button class="icon-btn sm danger" data-action="remove-collab" data-collab="${c.id}" aria-label="Remove ${e(c.email)}">${icon('x', 15)}</button>
              </li>`).join('')}
          </ul>` : '<p class="hint">Invite teammates to work on this task with you.</p>'}
        <form class="invite-form" data-form="invite" autocomplete="off" novalidate>
          <label class="visually-hidden" for="invite-email">Email address</label>
          <input id="invite-email" class="input" type="email" name="email" placeholder="teammate@email.com" data-focus-key="invite-email">
          <select name="role" aria-label="Permission">${role('editor', 'editor')}${role('viewer', 'editor')}</select>
          <button class="btn-primary sm" type="submit">Invite</button>
        </form>
      </section>`;
  }

  // ======================================================================
  // Modal: create / edit projects, categories and labels
  // ======================================================================

  function modal(state, ui) {
    const { type, id } = ui.modal;
    const collections = { project: state.projects, label: state.labels, category: state.categories };
    const item = id ? collections[type].find((x) => x.id === id) : null;
    const noun = { project: 'project', label: 'label', category: 'category' }[type];
    const color = item?.color || SWATCHES[0];
    const animate = ui.justOpened === 'modal' ? ' animate-in' : '';

    const colorField = type === 'category' ? '' : `
      <fieldset style="border:0;padding:0;margin:0">
        <legend class="field-label">Colour</legend>
        <div class="swatches">
          ${SWATCHES.map((c) => `<label class="swatch"><input type="radio" name="color" value="${c}"${c === color ? ' checked' : ''} aria-label="${c}"><span style="--swatch:${c}"></span></label>`).join('')}
        </div>
      </fieldset>`;

    const categoryField = type !== 'project' ? '' : `
      <div>
        <label class="field-label" for="modal-category">Category</label>
        <select id="modal-category" class="input" name="categoryId">
          <option value="">No category</option>
          ${state.categories.map((c) => `<option value="${c.id}"${c.id === item?.categoryId ? ' selected' : ''}>${e(c.name)}</option>`).join('')}
        </select>
      </div>`;

    return `
      <div class="modal-backdrop${animate}" data-action="close-modal"></div>
      <div class="modal${animate}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <form data-form="modal" autocomplete="off">
          <h2 id="modal-title">${item ? 'Edit' : 'New'} ${noun}<span class="cursor">_</span></h2>
          <div>
            <label class="field-label" for="modal-name">Name</label>
            <input id="modal-name" class="input" name="name" value="${e(item?.name || '')}" required maxlength="60" placeholder="${type === 'label' ? 'e.g. Waiting on' : type === 'category' ? 'e.g. Work' : 'e.g. Final year project'}">
          </div>
          ${colorField}
          ${categoryField}
          <footer>
            ${item ? '<button type="button" class="btn-ghost sm danger" data-action="modal-delete">Delete</button>' : ''}
            <span class="spacer"></span>
            <button type="button" class="btn-ghost sm" data-action="close-modal">Cancel</button>
            <button type="submit" class="btn-primary sm">${item ? 'Save' : 'Create'}</button>
          </footer>
        </form>
      </div>`;
  }

  return { sidebar, main, drawer, modal, quickAddPreview, describeView };
})();
