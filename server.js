const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'jira-super-secret-key-998811';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Auth Middleware
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized. No token provided.' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

function requireManager(req, res, next) {
  if (req.user.role !== 'manager') {
    return res.status(403).json({ error: 'Access denied: Manager role required.' });
  }
  next();
}

// ----------------- AUTH ROUTES -----------------
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const token = jwt.sign(
    { id: user.id, name: user.name, email: user.email, role: user.role, avatar: user.avatar },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, avatar: user.avatar }
  });
});

app.get('/api/auth/me', authenticate, (req, res) => {
  const user = db.prepare('SELECT id, name, email, role, avatar FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

app.get('/api/users', authenticate, (req, res) => {
  const users = db.prepare('SELECT id, name, email, role, avatar, created_at FROM users ORDER BY name ASC').all();
  res.json(users);
});

// Delete user (or self delete profile)
app.delete('/api/profile', authenticate, (req, res) => {
  const userId = req.user.id;
  try {
    if (req.user.role === 'manager') {
      const remainingManagers = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'manager' AND id != ?").get(userId);
      if (remainingManagers.count === 0) {
        return res.status(400).json({ error: 'Cannot delete the sole manager account.' });
      }
    }

    const fallbackUser = db.prepare("SELECT id FROM users WHERE id != ? ORDER BY CASE WHEN role = 'manager' THEN 0 ELSE 1 END, id ASC LIMIT 1").get(userId);
    const fallbackId = fallbackUser ? fallbackUser.id : null;

    db.prepare('UPDATE issues SET assignee_id = NULL WHERE assignee_id = ?').run(userId);
    if (fallbackId) {
      db.prepare('UPDATE issues SET reporter_id = ? WHERE reporter_id = ?').run(fallbackId, userId);
    }
    db.prepare('UPDATE projects SET created_by = NULL WHERE created_by = ?').run(userId);
    db.prepare('UPDATE worklogs SET reviewed_by = NULL WHERE reviewed_by = ?').run(userId);
    db.prepare('DELETE FROM worklogs WHERE user_id = ?').run(userId);
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);

    res.json({ message: 'Profile deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manager route to add a team user
app.post('/api/users', authenticate, requireManager, (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required' });
  }
  const assignedRole = role === 'manager' ? 'manager' : 'member';
  const avatar = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name)}`;
  const hash = bcrypt.hashSync(password, 10);
  try {
    const stmt = db.prepare(`
      INSERT INTO users (name, email, password, role, avatar)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(name, email, hash, assignedRole, avatar);
    res.status(201).json({
      id: result.lastInsertRowid,
      name,
      email,
      role: assignedRole,
      avatar
    });
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'A user with this email already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ----------------- PROJECT & ISSUE ROUTES -----------------
app.get('/api/projects', (req, res) => {
  const projects = db.prepare(`
    SELECT p.*, u.name as creator_name,
    (SELECT COUNT(*) FROM issues WHERE project_id = p.id) as total_issues
    FROM projects p
    LEFT JOIN users u ON p.created_by = u.id
    ORDER BY p.id ASC
  `).all();
  res.json(projects);
});

app.post('/api/projects', (req, res) => {
  const { name, key, description } = req.body || {};
  if (!name) {
    return res.status(400).json({ error: 'Event name is required' });
  }
  let eventKey = (key || '').trim().toUpperCase();
  if (!eventKey) {
    const clean = name.replace(/[^a-zA-Z0-9\s]/g, '').trim().split(/\s+/);
    eventKey = clean.map(w => w.slice(0, 3)).join('').slice(0, 6).toUpperCase() || 'EVT';
  }

  try {
    const stmt = db.prepare('INSERT INTO projects (key, name, description, created_by) VALUES (?, ?, ?, ?)');
    const result = stmt.run(eventKey, name.trim(), (description || '').trim(), 1);
    res.status(201).json({ id: result.lastInsertRowid, key: eventKey, name: name.trim(), description });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/issues', authenticate, (req, res) => {
  const { status, assignee_id, priority, type, search } = req.query;
  let query = `
    SELECT i.*, 
      p.key as project_key,
      p.name as project_name,
      u1.name as assignee_name, u1.avatar as assignee_avatar,
      u2.name as reporter_name, u2.avatar as reporter_avatar,
      COALESCE((SELECT SUM(time_spent_hours) FROM worklogs WHERE issue_id = i.id), 0) as total_time_logged,
      COALESCE((SELECT SUM(time_spent_hours) FROM worklogs WHERE issue_id = i.id AND status = 'approved'), 0) as approved_time_logged
    FROM issues i
    JOIN projects p ON i.project_id = p.id
    LEFT JOIN users u1 ON i.assignee_id = u1.id
    LEFT JOIN users u2 ON i.reporter_id = u2.id
    WHERE 1=1
  `;
  const params = [];

  if (status) {
    query += ' AND i.status = ?';
    params.push(status);
  }
  if (assignee_id) {
    query += ' AND i.assignee_id = ?';
    params.push(assignee_id);
  }
  if (priority) {
    query += ' AND i.priority = ?';
    params.push(priority);
  }
  if (type) {
    query += ' AND i.type = ?';
    params.push(type);
  }
  if (search) {
    query += ' AND (i.title LIKE ? OR i.issue_key LIKE ? OR i.description LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  query += ' ORDER BY i.id DESC';
  const issues = db.prepare(query).all(...params);
  res.json(issues);
});

app.get('/api/issues/:id', authenticate, (req, res) => {
  const issue = db.prepare(`
    SELECT i.*, 
      p.key as project_key,
      p.name as project_name,
      u1.name as assignee_name, u1.avatar as assignee_avatar,
      u2.name as reporter_name, u2.avatar as reporter_avatar,
      COALESCE((SELECT SUM(time_spent_hours) FROM worklogs WHERE issue_id = i.id), 0) as total_time_logged,
      COALESCE((SELECT SUM(time_spent_hours) FROM worklogs WHERE issue_id = i.id AND status = 'approved'), 0) as approved_time_logged
    FROM issues i
    JOIN projects p ON i.project_id = p.id
    LEFT JOIN users u1 ON i.assignee_id = u1.id
    LEFT JOIN users u2 ON i.reporter_id = u2.id
    WHERE i.id = ?
  `).get(req.params.id);

  if (!issue) return res.status(404).json({ error: 'Issue not found' });

  const worklogs = db.prepare(`
    SELECT w.*, u.name as user_name, u.avatar as user_avatar,
           r.name as reviewer_name
    FROM worklogs w
    JOIN users u ON w.user_id = u.id
    LEFT JOIN users r ON w.reviewed_by = r.id
    WHERE w.issue_id = ?
    ORDER BY w.work_date DESC, w.id DESC
  `).all(issue.id);

  res.json({ ...issue, worklogs });
});

app.post('/api/issues', authenticate, (req, res) => {
  const { title, description, type, priority, assignee_id, original_estimate_hours, project_id } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  const proj = project_id ? db.prepare('SELECT * FROM projects WHERE id = ?').get(project_id) : db.prepare('SELECT * FROM projects LIMIT 1').get();
  if (!proj) return res.status(400).json({ error: 'Valid project required' });

  const nextSeq = db.prepare('SELECT count(*) + 101 as seq FROM issues WHERE project_id = ?').get(proj.id).seq;
  const issueKey = `${proj.key}-${nextSeq}`;

  const stmt = db.prepare(`
    INSERT INTO issues (issue_key, project_id, title, description, type, status, priority, assignee_id, reporter_id, original_estimate_hours)
    VALUES (?, ?, ?, ?, ?, 'TO DO', ?, ?, ?, ?)
  `);

  const result = stmt.run(
    issueKey,
    proj.id,
    title,
    description || '',
    type || 'Task',
    priority || 'Medium',
    assignee_id ? Number(assignee_id) : null,
    req.user.id,
    parseFloat(original_estimate_hours) || 0
  );

  res.status(201).json({ id: result.lastInsertRowid, issue_key: issueKey });
});

app.patch('/api/issues/:id', authenticate, (req, res) => {
  const { status, assignee_id, priority, title, description, original_estimate_hours } = req.body;
  const updates = [];
  const params = [];

  if (status !== undefined) { updates.push('status = ?'); params.push(status); }
  if (assignee_id !== undefined) { updates.push('assignee_id = ?'); params.push(assignee_id ? Number(assignee_id) : null); }
  if (priority !== undefined) { updates.push('priority = ?'); params.push(priority); }
  if (title !== undefined) { updates.push('title = ?'); params.push(title); }
  if (description !== undefined) { updates.push('description = ?'); params.push(description); }
  if (original_estimate_hours !== undefined) { updates.push('original_estimate_hours = ?'); params.push(parseFloat(original_estimate_hours) || 0); }

  if (updates.length === 0) return res.status(400).json({ error: 'No fields provided to update' });

  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(req.params.id);

  db.prepare(`UPDATE issues SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ message: 'Issue updated successfully' });
});

// ----------------- WORKLOG ROUTES -----------------
// Any authenticated user can log work (Members & Managers)
app.post('/api/worklogs', authenticate, (req, res) => {
  const { issue_id, time_spent_hours, work_date, description } = req.body;
  if (!issue_id || !time_spent_hours || !work_date) {
    return res.status(400).json({ error: 'issue_id, time_spent_hours, and work_date are required' });
  }

  const hours = parseFloat(time_spent_hours);
  if (isNaN(hours) || hours <= 0 || hours > 24) {
    return res.status(400).json({ error: 'Time spent must be between 0.1 and 24 hours' });
  }

  // Managers logging their own work can be auto-approved, or pending. Defaulting members to pending.
  const initialStatus = req.user.role === 'manager' ? 'approved' : 'pending';
  const reviewer = req.user.role === 'manager' ? req.user.id : null;
  const reviewedAt = req.user.role === 'manager' ? new Date().toISOString() : null;

  const stmt = db.prepare(`
    INSERT INTO worklogs (issue_id, user_id, time_spent_hours, work_date, description, status, reviewed_by, reviewed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const result = stmt.run(issue_id, req.user.id, hours, work_date, description || '', initialStatus, reviewer, reviewedAt);
  res.status(201).json({ id: result.lastInsertRowid, status: initialStatus });
});

// List worklogs with filters
app.get('/api/worklogs', authenticate, (req, res) => {
  const { user_id, status, start_date, end_date, issue_id } = req.query;
  let query = `
    SELECT w.*, 
           u.name as user_name, u.email as user_email, u.avatar as user_avatar, u.role as user_role,
           i.issue_key, i.title as issue_title, i.status as issue_status,
           p.key as project_key,
           r.name as reviewer_name
    FROM worklogs w
    JOIN users u ON w.user_id = u.id
    JOIN issues i ON w.issue_id = i.id
    JOIN projects p ON i.project_id = p.id
    LEFT JOIN users r ON w.reviewed_by = r.id
    WHERE 1=1
  `;
  const params = [];

  // If member, and not specified, they can view their own or all team logs if allowed.
  // Standard members can filter or see their own, Managers can see all or filter by user.
  if (req.user.role !== 'manager' && !user_id) {
    query += ' AND w.user_id = ?';
    params.push(req.user.id);
  } else if (user_id) {
    query += ' AND w.user_id = ?';
    params.push(user_id);
  }

  if (status) {
    query += ' AND w.status = ?';
    params.push(status);
  }
  if (start_date) {
    query += ' AND w.work_date >= ?';
    params.push(start_date);
  }
  if (end_date) {
    query += ' AND w.work_date <= ?';
    params.push(end_date);
  }
  if (issue_id) {
    query += ' AND w.issue_id = ?';
    params.push(issue_id);
  }

  query += ' ORDER BY w.work_date DESC, w.id DESC';
  const logs = db.prepare(query).all(...params);
  res.json(logs);
});

// MANAGER CONTROL: Approve, Reject, or Request Changes on a Worklog
app.patch('/api/worklogs/:id/review', authenticate, requireManager, (req, res) => {
  const { status, manager_note } = req.body;
  if (!['approved', 'rejected', 'pending'].includes(status)) {
    return res.status(400).json({ error: 'Status must be approved, rejected, or pending' });
  }

  const log = db.prepare('SELECT * FROM worklogs WHERE id = ?').get(req.params.id);
  if (!log) return res.status(404).json({ error: 'Worklog not found' });

  db.prepare(`
    UPDATE worklogs 
    SET status = ?, manager_note = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(status, manager_note || null, req.user.id, req.params.id);

  res.json({ message: `Worklog successfully marked as ${status}` });
});

// Member or Manager can delete their own pending worklogs; Managers can delete any
app.delete('/api/worklogs/:id', authenticate, (req, res) => {
  const log = db.prepare('SELECT * FROM worklogs WHERE id = ?').get(req.params.id);
  if (!log) return res.status(404).json({ error: 'Worklog not found' });

  if (req.user.role !== 'manager' && log.user_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only delete your own work logs' });
  }

  db.prepare('DELETE FROM worklogs WHERE id = ?').run(req.params.id);
  res.json({ message: 'Worklog deleted successfully' });
});

// ----------------- MANAGER ANALYTICS & TIMESHEET REPORTS -----------------
app.get('/api/analytics/timesheet-summary', authenticate, (req, res) => {
  const { start_date, end_date } = req.query;
  let filter = '';
  const params = [];

  if (start_date) {
    filter += ' AND work_date >= ?';
    params.push(start_date);
  }
  if (end_date) {
    filter += ' AND work_date <= ?';
    params.push(end_date);
  }

  // Summary per team member
  const userSummary = db.prepare(`
    SELECT u.id, u.name, u.email, u.avatar, u.role,
      COALESCE(SUM(CASE WHEN w.status = 'approved' THEN w.time_spent_hours ELSE 0 END), 0) as approved_hours,
      COALESCE(SUM(CASE WHEN w.status = 'pending' THEN w.time_spent_hours ELSE 0 END), 0) as pending_hours,
      COALESCE(SUM(CASE WHEN w.status = 'rejected' THEN w.time_spent_hours ELSE 0 END), 0) as rejected_hours,
      COALESCE(SUM(w.time_spent_hours), 0) as total_logged_hours,
      COUNT(w.id) as total_logs_count
    FROM users u
    LEFT JOIN worklogs w ON u.id = w.user_id ${filter}
    GROUP BY u.id
    ORDER BY total_logged_hours DESC
  `).all(...params);

  // Overall totals
  const totalStats = db.prepare(`
    SELECT 
      COALESCE(SUM(time_spent_hours), 0) as total_hours,
      COALESCE(SUM(CASE WHEN status = 'approved' THEN time_spent_hours ELSE 0 END), 0) as approved_hours,
      COALESCE(SUM(CASE WHEN status = 'pending' THEN time_spent_hours ELSE 0 END), 0) as pending_hours,
      COALESCE(SUM(CASE WHEN status = 'rejected' THEN time_spent_hours ELSE 0 END), 0) as rejected_hours,
      COUNT(*) as total_entries,
      COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_approval_count
    FROM worklogs
    WHERE 1=1 ${filter}
  `).get(...params);

  // Daily logged hours trend (last 14 days or filtered period)
  const dailyTrend = db.prepare(`
    SELECT work_date, 
      SUM(time_spent_hours) as total_hours,
      SUM(CASE WHEN status = 'approved' THEN time_spent_hours ELSE 0 END) as approved_hours,
      SUM(CASE WHEN status = 'pending' THEN time_spent_hours ELSE 0 END) as pending_hours
    FROM worklogs
    WHERE 1=1 ${filter}
    GROUP BY work_date
    ORDER BY work_date ASC
  `).all(...params);

  res.json({
    totalStats,
    userSummary,
    dailyTrend
  });
});

// Fallback to index.html for single page client
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Jira Worklog Server listening on http://localhost:${PORT}`);
});

