/* ==========================================================================
   Store — the single source of truth for app data.

   - All data lives in one `state` object, saved to localStorage.
   - The only way to change data is through the functions returned below.
   - Every change calls the subscribed listeners, which re-render the UI.
   ========================================================================== */

const Store = (() => {
  const STORAGE_KEY = 'doable.v1';
  const MAX_NOTIFICATIONS = 50;
  const listeners = new Set();

  function emptyState() {
    return {
      tasks: [],
      projects: [],
      categories: [],
      labels: [],
      notifications: [],
      notified: {}, // keys of reminders already sent, so each one fires only once
      settings: { theme: null, desktopAlerts: false },
    };
  }

  // Fills in any missing fields so older or imported data always has the full shape.
  function normalizeTask(task) {
    return {
      id: Utils.uid('task'),
      title: 'Untitled task',
      notes: '',
      priority: 4,
      dueDate: null,
      dueTime: null,
      reminder: 15, // minutes before the due time (all-day tasks: before 9:00 AM)
      projectId: null,
      labelIds: [],
      tags: [],
      subtasks: [],
      checklist: [],
      collaborators: [],
      completed: false,
      completedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: null,
      ...task,
    };
  }

  function normalize(data) {
    const base = emptyState();
    return {
      ...base,
      ...data,
      settings: { ...base.settings, ...(data.settings || {}) },
      tasks: (data.tasks || []).map(normalizeTask),
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return normalize(JSON.parse(raw));
    } catch (err) {
      console.warn('Could not read saved data, loading the demo instead.', err);
    }
    return normalize(Seed.create());
  }

  let state = load();

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('Could not save data.', err);
    }
  }

  // Apply a change, save it, and tell the UI (unless `silent`, used while typing).
  function commit(mutate, { silent = false } = {}) {
    mutate(state);
    save();
    if (!silent) listeners.forEach((listener) => listener(state));
  }

  const now = () => new Date().toISOString();
  const getTask = (id) => state.tasks.find((task) => task.id === id);

  // ---------- Tasks ----------

  function createTask(fields = {}) {
    const task = normalizeTask({ ...fields, id: Utils.uid('task'), createdAt: now() });
    commit((s) => s.tasks.unshift(task));
    return task;
  }

  function updateTask(id, patch, options) {
    if (!getTask(id)) return;
    commit(() => Object.assign(getTask(id), patch, { updatedAt: now() }), options);
  }

  function toggleTask(id) {
    const task = getTask(id);
    if (!task) return;
    updateTask(id, { completed: !task.completed, completedAt: task.completed ? null : now() });
  }

  // Returns what was removed so the UI can offer "Undo".
  function deleteTask(id) {
    const index = state.tasks.findIndex((task) => task.id === id);
    if (index === -1) return null;
    const task = state.tasks[index];
    commit((s) => s.tasks.splice(index, 1));
    return { task, index };
  }

  function restoreTask({ task, index }) {
    commit((s) => s.tasks.splice(Math.min(index, s.tasks.length), 0, task));
  }

  function clearCompleted() {
    commit((s) => { s.tasks = s.tasks.filter((task) => !task.completed); });
  }

  // ---------- Sub-tasks & checklist items ----------
  // Both lists hold items shaped { id, text, done }; sub-tasks may also have a dueDate.

  function addItem(taskId, list, text) {
    const task = getTask(taskId);
    if (!task) return;
    const item = { id: Utils.uid('item'), text, done: false };
    if (list === 'subtasks') item.dueDate = null;
    commit(() => { task[list].push(item); task.updatedAt = now(); });
  }

  function updateItem(taskId, list, itemId, patch, options) {
    const item = getTask(taskId)?.[list].find((i) => i.id === itemId);
    if (item) commit(() => Object.assign(item, patch), options);
  }

  function removeItem(taskId, list, itemId) {
    const task = getTask(taskId);
    if (task) commit(() => { task[list] = task[list].filter((i) => i.id !== itemId); });
  }

  // ---------- Collaborators ----------

  function inviteCollaborator(taskId, { email, role }) {
    const task = getTask(taskId);
    if (!task) return null;
    const collaborator = {
      id: Utils.uid('col'),
      name: '',
      email,
      role,
      status: 'pending',
      invitedAt: now(),
    };
    commit((s) => {
      task.collaborators.push(collaborator);
      pushNotifications(s, [{ taskId, kind: 'invite', title: `Invite sent to ${email}`, body: task.title }]);
    });
    return collaborator;
  }

  function updateCollaborator(taskId, collaboratorId, patch) {
    const person = getTask(taskId)?.collaborators.find((c) => c.id === collaboratorId);
    if (person) commit(() => Object.assign(person, patch));
  }

  function removeCollaborator(taskId, collaboratorId) {
    const task = getTask(taskId);
    if (task) commit(() => { task.collaborators = task.collaborators.filter((c) => c.id !== collaboratorId); });
  }

  // ---------- Projects & categories ----------

  function addProject({ name, color, categoryId }) {
    const project = { id: Utils.uid('proj'), name, color, categoryId: categoryId || null };
    commit((s) => s.projects.push(project));
    return project;
  }

  function updateProject(id, patch) {
    const project = state.projects.find((p) => p.id === id);
    if (project) commit(() => Object.assign(project, patch));
  }

  // Tasks in a deleted project move to the Inbox rather than being lost.
  function deleteProject(id) {
    commit((s) => {
      s.projects = s.projects.filter((p) => p.id !== id);
      s.tasks.forEach((task) => { if (task.projectId === id) task.projectId = null; });
    });
  }

  function addCategory(name) {
    const category = { id: Utils.uid('cat'), name };
    commit((s) => s.categories.push(category));
    return category;
  }

  function updateCategory(id, patch) {
    const category = state.categories.find((c) => c.id === id);
    if (category) commit(() => Object.assign(category, patch));
  }

  function deleteCategory(id) {
    commit((s) => {
      s.categories = s.categories.filter((c) => c.id !== id);
      s.projects.forEach((project) => { if (project.categoryId === id) project.categoryId = null; });
    });
  }

  // ---------- Labels ----------

  function addLabel({ name, color }) {
    const label = { id: Utils.uid('lab'), name, color };
    commit((s) => s.labels.push(label));
    return label;
  }

  function updateLabel(id, patch) {
    const label = state.labels.find((l) => l.id === id);
    if (label) commit(() => Object.assign(label, patch));
  }

  function deleteLabel(id) {
    commit((s) => {
      s.labels = s.labels.filter((l) => l.id !== id);
      s.tasks.forEach((task) => { task.labelIds = task.labelIds.filter((labelId) => labelId !== id); });
    });
  }

  // ---------- Notifications ----------

  function pushNotifications(s, list) {
    list.forEach(({ key, ...fields }) => {
      if (key) s.notified[key] = true;
      s.notifications.unshift({ id: Utils.uid('ntf'), read: false, createdAt: now(), ...fields });
    });
    s.notifications = s.notifications.slice(0, MAX_NOTIFICATIONS);
  }

  function addNotifications(list) {
    commit((s) => pushNotifications(s, list));
  }

  const wasNotified = (key) => Boolean(state.notified[key]);

  function markNotificationRead(id) {
    const notification = state.notifications.find((n) => n.id === id);
    if (notification && !notification.read) commit(() => { notification.read = true; });
  }

  function markAllNotificationsRead() {
    commit((s) => s.notifications.forEach((n) => { n.read = true; }));
  }

  function clearNotifications() {
    commit((s) => { s.notifications = []; });
  }

  // ---------- Settings, backup & reset ----------

  function setSetting(key, value) {
    commit((s) => { s.settings[key] = value; });
  }

  function replace(data) {
    commit((s) => {
      const fresh = normalize(data);
      fresh.settings = s.settings; // keep this device's theme and alert settings
      Object.keys(s).forEach((key) => delete s[key]);
      Object.assign(s, fresh);
    });
  }

  function reset() {
    replace(Seed.create());
  }

  return {
    get: () => state,
    subscribe: (listener) => listeners.add(listener),
    getTask,
    createTask, updateTask, toggleTask, deleteTask, restoreTask, clearCompleted,
    addItem, updateItem, removeItem,
    inviteCollaborator, updateCollaborator, removeCollaborator,
    addProject, updateProject, deleteProject,
    addCategory, updateCategory, deleteCategory,
    addLabel, updateLabel, deleteLabel,
    addNotifications, wasNotified, markNotificationRead, markAllNotificationsRead, clearNotifications,
    setSetting, replace, reset,
  };
})();
