/* ==========================================================================
   App — connects the Store (data), the Views (HTML) and the browser.

   How it works:
     1. `ui` holds screen-only state (current view, search text, open task...).
     2. render() rebuilds the page from Store data + ui.
     3. One listener per event type (click, change, input, submit, keydown)
        looks at the `data-action` / `data-form` attribute on the element
        and runs the matching handler. This pattern is called event delegation.
   ========================================================================== */

(() => {
  const UI_KEY = 'doable.ui';
  const $ = (selector) => document.querySelector(selector);

  const saved = (() => {
    try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch { return {}; }
  })();

  const ui = {
    view: saved.view || 'all',
    sort: saved.sort || 'smart',
    priority: 'all',
    search: '',
    quickAdd: '',
    openTaskId: null,
    modal: null, // { type: 'project' | 'label' | 'category', id }
    notifOpen: false,
    sidebarOpen: false,
    showCompleted: false,
    calMonth: `${Utils.todayKey().slice(0, 8)}01`,
    selectedDay: Utils.todayKey(),
    justOpened: null, // 'drawer' | 'modal', so entry animations play only once
    theme: 'light',
  };

  const els = {
    sidebar: $('#sidebar'),
    main: $('#main'),
    drawer: $('#drawer-root'),
    modal: $('#modal-root'),
    toasts: $('#toasts'),
    importFile: $('#import-file'),
  };

  function persistUi() {
    try { localStorage.setItem(UI_KEY, JSON.stringify({ view: ui.view, sort: ui.sort })); } catch { /* private mode */ }
  }

  // ---------- Theme ----------

  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  function applyTheme() {
    ui.theme = Store.get().settings.theme || (systemDark.matches ? 'dark' : 'light');
    document.documentElement.dataset.theme = ui.theme;
  }
  systemDark.addEventListener?.('change', render);

  // ---------- Rendering ----------

  function render() {
    const state = Store.get();
    applyTheme();
    if (ui.openTaskId && !Store.getTask(ui.openTaskId)) ui.openTaskId = null;

    const snapshot = captureView();
    els.sidebar.innerHTML = Views.sidebar(state, ui);
    els.main.innerHTML = Views.main(state, ui);
    els.drawer.innerHTML = ui.openTaskId ? Views.drawer(state, ui) : '';
    els.modal.innerHTML = ui.modal ? Views.modal(state, ui) : '';
    document.body.classList.toggle('sidebar-open', ui.sidebarOpen);
    restoreView(snapshot);

    ui.justOpened = null;
    const overdue = state.tasks.filter((t) => Utils.isOverdue(t)).length;
    document.title = overdue ? `(${overdue} overdue) Doable_` : 'Doable_ — To-do list';
  }

  // Re-rendering replaces the HTML, so remember focus, cursor position and
  // scroll positions first and put them back afterwards.
  function selectorFor(el) {
    if (!el || !el.dataset) return null;
    if (el.dataset.focusKey) return `[data-focus-key="${CSS.escape(el.dataset.focusKey)}"]`;
    if (!el.dataset.action) return null;
    return Object.entries(el.dataset)
      .map(([key, value]) => `[data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${CSS.escape(value)}"]`)
      .join('');
  }

  function captureView() {
    const el = document.activeElement;
    const scroll = {};
    document.querySelectorAll('[data-keep-scroll]').forEach((node) => { scroll[node.dataset.keepScroll] = node.scrollTop; });
    let caret = null;
    try { caret = el && typeof el.selectionStart === 'number' ? [el.selectionStart, el.selectionEnd] : null; } catch { /* not a text field */ }
    return { scroll, focus: selectorFor(el), caret };
  }

  function restoreView({ scroll, focus, caret }) {
    document.querySelectorAll('[data-keep-scroll]').forEach((node) => {
      if (scroll[node.dataset.keepScroll] !== undefined) node.scrollTop = scroll[node.dataset.keepScroll];
    });
    const el = focus && document.querySelector(focus);
    if (!el) return;
    el.focus({ preventScroll: true });
    if (caret) { try { el.setSelectionRange(...caret); } catch { /* not a text field */ } }
  }

  // ---------- Toasts ----------

  function toast(message, { action, onAction, icon = 'check', duration = 5000 } = {}) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    el.innerHTML = `${Icons.get(icon, 16)}<span>${Utils.escapeHtml(message)}</span>${action ? `<button type="button">${Utils.escapeHtml(action)}</button>` : ''}`;
    const close = () => {
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 200);
    };
    el.querySelector('button')?.addEventListener('click', (event) => {
      event.stopPropagation(); // don't let the document click handler close what we open
      onAction();
      close();
    });
    els.toasts.append(el);
    while (els.toasts.children.length > 3) els.toasts.firstElementChild.remove();
    setTimeout(close, duration);
  }

  // ---------- Task helpers ----------

  const currentTask = () => Store.getTask(ui.openTaskId);

  function openTask(id) {
    if (!Store.getTask(id)) return;
    ui.openTaskId = id;
    ui.justOpened = 'drawer';
    ui.notifOpen = false;
    ui.sidebarOpen = false;
    render();
    $('.drawer')?.focus();
  }

  function closeTask() {
    const id = ui.openTaskId;
    document.activeElement?.blur(); // fires "change" so the last edit is saved
    ui.openTaskId = null;
    render();
    document.querySelector(`.task-body[data-id="${CSS.escape(id || '')}"]`)?.focus();
  }

  function toggleTask(id) {
    const task = Store.getTask(id);
    if (!task) return;
    const completing = !task.completed;
    Store.toggleTask(id);
    if (completing) toast(`Completed “${task.title}”`, { action: 'Undo', onAction: () => Store.toggleTask(id) });
  }

  function deleteTask(id) {
    if (ui.openTaskId === id) ui.openTaskId = null;
    const removed = Store.deleteTask(id);
    if (removed) toast(`Deleted “${removed.task.title}”`, { icon: 'trash', action: 'Undo', onAction: () => Store.restoreTask(removed) });
  }

  // Tasks added from a project, label, tag, Today or a calendar day inherit that context.
  function viewDefaults() {
    const [kind, value] = ui.view.split(/:(.*)/s);
    if (kind === 'project') return { projectId: value };
    if (kind === 'label') return { labelIds: [value] };
    if (kind === 'tag') return { tags: [value] };
    if (kind === 'today') return { dueDate: Utils.todayKey() };
    if (kind === 'calendar') return { dueDate: ui.selectedDay };
    return {};
  }

  function addFromQuickAdd(form) {
    const raw = (ui.quickAdd || form.elements.title.value).trim();
    if (!raw) return;
    const parsed = QuickAdd.parse(raw);
    const defaults = viewDefaults();
    const fields = {
      title: parsed.title,
      priority: parsed.priority ?? 4,
      dueDate: parsed.dueDate ?? defaults.dueDate ?? null,
      dueTime: parsed.dueTime,
      tags: [...new Set([...(defaults.tags || []), ...parsed.tags])],
      labelIds: defaults.labelIds || [],
      projectId: defaults.projectId ?? null,
    };
    if (fields.dueTime && !fields.dueDate) fields.dueDate = Utils.todayKey();
    ui.quickAdd = '';
    const task = Store.createTask(fields);
    toast(`Added “${task.title}”`, { icon: 'plus', action: 'Open', onAction: () => openTask(task.id) });
  }

  function focusQuickAdd() {
    if (ui.view === 'completed') ui.view = 'all';
    ui.sidebarOpen = false;
    ui.notifOpen = false;
    if (ui.openTaskId) ui.openTaskId = null;
    render();
    $('[data-control="quick-add"]')?.focus();
  }

  function sendInviteEmail(task, person) {
    const lines = [
      'Hi,',
      '',
      `I'd like you to ${person.role === 'editor' ? 'help me with' : 'follow along on'} this task in Doable_:`,
      '',
      `• ${task.title}`,
      task.dueDate ? `• Due: ${Utils.formatDue(task)}` : null,
      `• Priority: ${Utils.PRIORITIES[task.priority].label}`,
      task.notes ? `• Notes: ${task.notes}` : null,
      '',
      'Thanks!',
    ].filter((line) => line !== null);
    const link = document.createElement('a');
    link.href = `mailto:${encodeURIComponent(person.email)}?subject=${encodeURIComponent(`Can you help with “${task.title}”?`)}&body=${encodeURIComponent(lines.join('\n'))}`;
    link.click();
  }

  function invite(form) {
    const email = form.elements.email.value.trim().toLowerCase();
    const task = currentTask();
    if (!Utils.isValidEmail(email)) {
      toast('Enter a valid email address', { icon: 'alert' });
      form.elements.email.focus();
      return;
    }
    if (task.collaborators.some((c) => c.email === email)) {
      toast(`${email} is already on this task`, { icon: 'alert' });
      return;
    }
    const person = Store.inviteCollaborator(task.id, { email, role: form.elements.role.value });
    sendInviteEmail(task, person);
    toast(`Invite created for ${email}`, { icon: 'mail' });
  }

  function submitModal(form) {
    const data = Object.fromEntries(new FormData(form));
    const name = (data.name || '').trim();
    if (!name) return;
    const { type, id } = ui.modal;
    ui.modal = null;

    if (type === 'project') {
      const fields = { name, color: data.color, categoryId: data.categoryId || null };
      if (id) Store.updateProject(id, fields);
      else {
        const project = Store.addProject(fields);
        ui.view = `project:${project.id}`;
        persistUi();
      }
    } else if (type === 'label') {
      if (id) Store.updateLabel(id, { name, color: data.color });
      else Store.addLabel({ name, color: data.color });
    } else if (type === 'category') {
      if (id) Store.updateCategory(id, { name });
      else Store.addCategory(name);
    }
    render();
    toast(`${type[0].toUpperCase()}${type.slice(1)} ${id ? 'saved' : 'created'}`);
  }

  function importBackup(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data.tasks)) throw new Error('No tasks in file');
        if (!confirm(`Replace your current data with ${Utils.plural(data.tasks.length, 'task')} from this backup?`)) return;
        ui.openTaskId = null;
        Store.replace(data);
        toast('Backup restored');
      } catch {
        toast("That file isn't a Doable_ backup", { icon: 'alert' });
      } finally {
        els.importFile.value = '';
      }
    };
    reader.readAsText(file);
  }

  function shiftMonth(delta) {
    const month = Utils.fromDateKey(ui.calMonth);
    month.setMonth(month.getMonth() + delta);
    ui.calMonth = Utils.toDateKey(month);
    render();
  }

  // ---------- Click actions ----------

  const actions = {
    nav(el) {
      ui.view = el.dataset.view;
      ui.sidebarOpen = false;
      ui.showCompleted = false;
      persistUi();
      render();
    },
    'toggle-sidebar'() { ui.sidebarOpen = !ui.sidebarOpen; render(); },
    'close-sidebar'() { ui.sidebarOpen = false; render(); },
    'toggle-theme'() { Store.setSetting('theme', ui.theme === 'dark' ? 'light' : 'dark'); },

    'toggle-task'(el) { toggleTask(el.dataset.id); },
    'open-task'(el) { openTask(el.dataset.id); },
    'close-task'() { closeTask(); },
    'delete-task'(el) { deleteTask(el.dataset.id); },
    'focus-quick-add'() { focusQuickAdd(); },

    'filter-priority'(el) { ui.priority = el.dataset.value; render(); },
    'clear-filters'() { ui.search = ''; ui.priority = 'all'; render(); },
    'toggle-completed'() { ui.showCompleted = !ui.showCompleted; render(); },
    'clear-completed'() {
      const count = Store.get().tasks.filter((t) => t.completed).length;
      if (!confirm(`Delete ${Utils.plural(count, 'completed task')}? This can't be undone.`)) return;
      Store.clearCompleted();
      toast(`Cleared ${Utils.plural(count, 'task')}`, { icon: 'trash' });
    },

    // Task details
    'set-priority'(el) { Store.updateTask(ui.openTaskId, { priority: Number(el.dataset.value) }); },
    'toggle-label'(el) {
      const task = currentTask();
      const id = el.dataset.label;
      const labelIds = task.labelIds.includes(id) ? task.labelIds.filter((x) => x !== id) : [...task.labelIds, id];
      Store.updateTask(task.id, { labelIds });
    },
    'remove-tag'(el) {
      const task = currentTask();
      Store.updateTask(task.id, { tags: task.tags.filter((t) => t !== el.dataset.tag) });
    },
    'toggle-item'(el) {
      const item = currentTask()[el.dataset.list].find((i) => i.id === el.dataset.item);
      Store.updateItem(ui.openTaskId, el.dataset.list, item.id, { done: !item.done });
    },
    'remove-item'(el) { Store.removeItem(ui.openTaskId, el.dataset.list, el.dataset.item); },
    'remove-collab'(el) {
      Store.removeCollaborator(ui.openTaskId, el.dataset.collab);
      toast('Collaborator removed', { icon: 'users' });
    },
    'email-collab'(el) {
      const task = currentTask();
      sendInviteEmail(task, task.collaborators.find((c) => c.id === el.dataset.collab));
    },

    // Calendar
    'cal-google'() { window.open(CalendarLink.googleUrl(currentTask()), '_blank', 'noopener'); },
    'cal-outlook'() { window.open(CalendarLink.outlookUrl(currentTask()), '_blank', 'noopener'); },
    'cal-ics'() {
      const task = currentTask();
      CalendarLink.download([task], Utils.slugify(task.title));
      toast('Calendar file downloaded. Open it to add the event.', { icon: 'download' });
    },
    'export-ics'() {
      const tasks = Store.get().tasks.filter((t) => !t.completed && t.dueDate);
      if (!tasks.length) return toast('No open tasks with due dates to export', { icon: 'alert' });
      CalendarLink.download(tasks, 'doable-tasks');
      toast(`Exported ${Utils.plural(tasks.length, 'task')} with reminders`, { icon: 'download' });
    },
    'cal-prev'() { shiftMonth(-1); },
    'cal-next'() { shiftMonth(1); },
    'cal-today'() {
      ui.selectedDay = Utils.todayKey();
      ui.calMonth = `${ui.selectedDay.slice(0, 8)}01`;
      render();
    },
    'select-day'(el) {
      ui.selectedDay = el.dataset.date;
      if (ui.selectedDay.slice(0, 7) !== ui.calMonth.slice(0, 7)) ui.calMonth = `${ui.selectedDay.slice(0, 8)}01`;
      render();
    },

    // Notifications
    'toggle-notifs'() { ui.notifOpen = !ui.notifOpen; render(); },
    'open-notification'(el) {
      const notification = Store.get().notifications.find((n) => n.id === el.dataset.id);
      ui.notifOpen = false;
      if (!notification) return render();
      Store.markNotificationRead(notification.id);
      if (Store.getTask(notification.taskId)) openTask(notification.taskId);
      else render();
    },
    'mark-all-read'() { Store.markAllNotificationsRead(); },
    'clear-notifications'() { Store.clearNotifications(); },
    async 'toggle-desktop'() {
      if (Store.get().settings.desktopAlerts && Notifier.permission() === 'granted') {
        Store.setSetting('desktopAlerts', false);
        return toast('Desktop alerts turned off', { icon: 'bell' });
      }
      const result = await Notifier.requestPermission();
      if (result === 'granted') {
        Store.setSetting('desktopAlerts', true);
        Notifier.sendTest();
        toast('Desktop alerts are on', { icon: 'bell' });
      } else if (result === 'denied') {
        render();
        toast('Notifications are blocked in your browser settings', { icon: 'alert' });
      }
    },

    // Projects, categories, labels
    'open-modal'(el) {
      ui.modal = { type: el.dataset.type, id: el.dataset.id || null };
      ui.justOpened = 'modal';
      render();
      $('#modal-name')?.focus();
    },
    'close-modal'() { ui.modal = null; render(); },
    'modal-delete'() {
      const { type, id } = ui.modal;
      const message = {
        project: 'Delete this project? Its tasks will be kept, with no project.',
        label: 'Delete this label? It will be removed from every task.',
        category: 'Delete this category? Its projects will be kept.',
      }[type];
      if (!confirm(message)) return;
      ui.modal = null;
      if (type === 'project') {
        if (ui.view === `project:${id}`) ui.view = 'all';
        Store.deleteProject(id);
      } else if (type === 'label') {
        if (ui.view === `label:${id}`) ui.view = 'all';
        Store.deleteLabel(id);
      } else {
        Store.deleteCategory(id);
      }
      persistUi();
      render();
    },

    // Data
    'export-json'() {
      const stamp = Utils.todayKey();
      const { notified, ...data } = Store.get();
      Utils.downloadFile(`doable-backup-${stamp}.json`, JSON.stringify(data, null, 2), 'application/json');
      toast('Backup downloaded', { icon: 'download' });
    },
    'import-json'() { els.importFile.click(); },
    'reset-demo'() {
      if (!confirm('Replace all your tasks with the demo data?')) return;
      ui.openTaskId = null;
      ui.view = 'all';
      persistUi();
      Store.reset();
      toast('Demo data restored', { icon: 'refresh' });
    },
  };

  // ---------- Event listeners ----------

  document.addEventListener('click', (event) => {
    // Clicking anywhere outside the notification panel closes it.
    if (ui.notifOpen && !event.target.closest('.notif-wrap')) {
      ui.notifOpen = false;
      render();
    }
    const el = event.target.closest('[data-action]');
    if (el && actions[el.dataset.action]) actions[el.dataset.action](el, event);
  });

  document.addEventListener('input', (event) => {
    const el = event.target;
    if (el.dataset.control === 'search') {
      ui.search = el.value;
      render();
    } else if (el.dataset.control === 'quick-add') {
      // Update only the preview chips, so typing stays smooth.
      ui.quickAdd = el.value;
      el.form.querySelector('.qa-preview').innerHTML = Views.quickAddPreview(el.value);
    } else if (el.dataset.field === 'title' || el.dataset.field === 'notes') {
      // Save silently while typing; the "change" event re-renders when done.
      Store.updateTask(ui.openTaskId, { [el.dataset.field]: el.value }, { silent: true });
    } else if (el.dataset.itemField === 'text') {
      Store.updateItem(ui.openTaskId, el.dataset.list, el.dataset.item, { text: el.value }, { silent: true });
    }
  });

  document.addEventListener('change', (event) => {
    const el = event.target;

    // Text fields fire "change" when they lose focus, often because the user
    // is clicking a button. Re-rendering then would swallow that click, so
    // text is saved silently; the next render picks it up.
    if (el.dataset.field) {
      const task = currentTask();
      if (!task) return;
      const field = el.dataset.field;
      let value = el.value;
      if (field === 'title') {
        value = value.trim() || 'Untitled task';
        el.value = value;
      }
      if (field === 'notes') value = value.trimEnd();
      if (field === 'dueDate' || field === 'dueTime' || field === 'projectId') value = value || null;
      if (field === 'reminder') value = value === '' ? null : Number(value);
      const patch = { [field]: value };
      if (field === 'dueDate' && !value) patch.dueTime = null;
      if (field === 'dueTime' && value && !task.dueDate) patch.dueDate = Utils.todayKey();
      Store.updateTask(task.id, patch, { silent: field === 'title' || field === 'notes' });
    } else if (el.dataset.itemField) {
      const field = el.dataset.itemField;
      let value = el.value;
      if (field === 'text') {
        value = value.trim();
        if (!value) return Store.removeItem(ui.openTaskId, el.dataset.list, el.dataset.item);
      }
      if (field === 'dueDate') value = value || null;
      Store.updateItem(ui.openTaskId, el.dataset.list, el.dataset.item, { [field]: value }, { silent: field === 'text' });
    } else if (el.dataset.collabField) {
      Store.updateCollaborator(ui.openTaskId, el.dataset.collab, { [el.dataset.collabField]: el.value });
    } else if (el.dataset.control === 'sort') {
      ui.sort = el.value;
      persistUi();
      render();
    } else if (el === els.importFile) {
      importBackup(el.files[0]);
    }
  });

  document.addEventListener('submit', (event) => {
    const form = event.target;
    const type = form.dataset.form;
    if (!type) return;
    event.preventDefault();

    if (type === 'quick-add') addFromQuickAdd(form);
    else if (type === 'invite') invite(form);
    else if (type === 'modal') submitModal(form);
    else if (type === 'add-item') {
      const text = form.elements.text.value.trim();
      if (text) Store.addItem(ui.openTaskId, form.dataset.list, text);
    } else if (type === 'add-tag') {
      const task = currentTask();
      const tags = form.elements.tag.value.split(',').map(Utils.cleanTag).filter(Boolean);
      if (tags.length) Store.updateTask(task.id, { tags: [...new Set([...task.tags, ...tags])] });
    }
  });

  document.addEventListener('keydown', (event) => {
    const el = event.target;
    const typing = el.matches('input, textarea, select, [contenteditable="true"]');

    if (event.key === 'Escape') {
      if (ui.modal) { ui.modal = null; render(); }
      else if (ui.notifOpen) { ui.notifOpen = false; render(); }
      else if (ui.openTaskId) closeTask();
      else if (ui.sidebarOpen) { ui.sidebarOpen = false; render(); }
      else if (typing) el.blur();
      return;
    }
    // Enter in the title box saves instead of adding a new line.
    if (event.key === 'Enter' && el.classList.contains('title-input')) {
      event.preventDefault();
      el.blur();
      return;
    }
    // Keyboard support for the clickable task rows.
    if ((event.key === 'Enter' || event.key === ' ') && el.matches('[role="button"][data-action]')) {
      event.preventDefault();
      el.click();
      return;
    }
    if (typing || event.metaKey || event.ctrlKey || event.altKey || ui.modal) return;
    if (event.key === 'n' || event.key === 'N') {
      event.preventDefault();
      focusQuickAdd();
    } else if (event.key === '/') {
      event.preventDefault();
      $('[data-control="search"]')?.focus();
    }
  });

  // ---------- Start ----------

  Store.subscribe(render);
  render();

  Notifier.start({
    onOpenTask: openTask,
    onNotify(list) {
      if (list.length > 2) {
        toast(`${list.length} tasks need your attention`, {
          icon: 'bell', action: 'View', onAction: () => { ui.notifOpen = true; render(); },
        });
      } else {
        list.forEach((n) => toast(n.title, {
          icon: n.kind === 'overdue' ? 'alert' : 'bell', action: 'Open', onAction: () => openTask(n.taskId),
        }));
      }
    },
  });

  // Refresh once a minute so "Today", "Overdue" and times stay accurate.
  // Skipped while a dropdown is focused, since re-rendering would close it.
  setInterval(() => {
    if (!document.activeElement?.matches('select')) render();
  }, 60 * 1000);
})();
