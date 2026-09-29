/* ==========================================================================
   Seed — demo data shown on the first visit, so the app never opens empty.
   Dates are relative to today, so the demo always has something overdue,
   something due today and something coming up.
   ========================================================================== */

const Seed = (() => {
  function items(texts, doneCount = 0) {
    return texts.map((text, i) => ({ id: Utils.uid('item'), text, done: i < doneCount }));
  }

  function create() {
    const now = new Date();
    const day = (offset) => Utils.toDateKey(Utils.addDays(now, offset));
    const ago = (hours) => new Date(now.getTime() - hours * 3600 * 1000).toISOString();

    const categories = [
      { id: 'cat_work', name: 'Work' },
      { id: 'cat_personal', name: 'Personal' },
    ];

    const projects = [
      { id: 'proj_internship', name: 'Internship', color: '#DD6031', categoryId: 'cat_work' },
      { id: 'proj_portfolio', name: 'Portfolio site', color: '#121212', categoryId: 'cat_work' },
      { id: 'proj_home', name: 'Home', color: '#6F6E69', categoryId: 'cat_personal' },
    ];

    const labels = [
      { id: 'lab_focus', name: 'Deep focus', color: '#DD6031' },
      { id: 'lab_waiting', name: 'Waiting on', color: '#9A988F' },
      { id: 'lab_quick', name: 'Quick win', color: '#121212' },
    ];

    const tasks = [
      {
        title: 'Submit to-do app for internship review',
        priority: 1, dueDate: day(1), dueTime: '17:00', reminder: 60,
        projectId: 'proj_internship', labelIds: ['lab_focus'], tags: ['deadline'],
        notes: 'Deploy to GitHub Pages and send the live link together with the repository link.',
        subtasks: items(['Write the README', 'Test on mobile', 'Deploy to GitHub Pages'], 1),
        checklist: items(['Screenshots in README', 'No console errors', 'Dark mode checked'], 2),
        collaborators: [{ id: Utils.uid('col'), name: 'Mentor', email: 'mentor@example.com', role: 'viewer', status: 'pending', invitedAt: ago(20) }],
        createdAt: ago(48),
      },
      {
        title: 'Reply to the recruiter email',
        priority: 2, dueDate: day(-1), dueTime: '10:00',
        projectId: 'proj_internship', labelIds: ['lab_quick'],
        createdAt: ago(40),
      },
      {
        title: 'Sketch dashboard wireframes',
        priority: 2, dueDate: day(0), dueTime: '18:00', reminder: 30,
        projectId: 'proj_portfolio', labelIds: ['lab_focus'], tags: ['design'],
        subtasks: items(['Mobile layout', 'Desktop layout']),
        collaborators: [
          { id: Utils.uid('col'), name: 'Ada Lovelace', email: 'ada@example.com', role: 'editor', status: 'accepted', invitedAt: ago(30) },
          { id: Utils.uid('col'), name: 'Kofi Mensah', email: 'kofi@example.com', role: 'viewer', status: 'pending', invitedAt: ago(4) },
        ],
        createdAt: ago(30),
      },
      {
        title: 'Buy groceries',
        priority: 3, dueDate: day(0),
        projectId: 'proj_home', tags: ['errands'],
        checklist: items(['Eggs', 'Oat milk', 'Coffee beans', 'Spinach'], 1),
        createdAt: ago(10),
      },
      {
        title: 'Book dentist appointment',
        priority: 4, dueDate: day(4),
        projectId: 'proj_home', labelIds: ['lab_waiting'],
        createdAt: ago(8),
      },
      {
        title: 'Read chapter 3 of "Refactoring UI"',
        priority: 3, dueDate: day(6), tags: ['learning'],
        notes: 'Focus on the section about hierarchy and colour.',
        createdAt: ago(6),
      },
      {
        title: 'Plan weekend trip',
        priority: 4, tags: ['ideas'],
        createdAt: ago(3),
      },
      {
        title: 'Set up project repository',
        priority: 2, dueDate: day(-2), completed: true, completedAt: ago(26),
        projectId: 'proj_internship',
        createdAt: ago(72),
      },
    ];

    return { tasks, projects, categories, labels, notifications: [], notified: {} };
  }

  return { create };
})();
