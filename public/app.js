// Jira WorkLog Application Logic
let currentUser = null;
let currentToken = localStorage.getItem('jira_token') || '';
let allIssues = [];
let allUsers = [];
let activeReviewLogId = null;
let currentSelectedIssueId = null;
let draggedIssueId = null;

// Initialization
document.addEventListener('DOMContentLoaded', async () => {
  const today = new Date().toISOString().split('T')[0];
  const dateInput = document.getElementById('logWorkDate');
  if (dateInput) dateInput.value = today;

  try {
    // 1. First fetch team users
    await loadUsers();
    
    // 2. Resolve initial active user safely
    let targetEmail = currentToken;
    const exists = allUsers.some(u => u.email.toLowerCase() === (targetEmail || '').toLowerCase());
    if (!exists) {
      // Default to Ankit Parashar or first available user
      const ankit = allUsers.find(u => u.name.toLowerCase().includes('ankit'));
      targetEmail = ankit ? ankit.email : (allUsers[0] ? allUsers[0].email : 'ankit.parashar@jira.local');
    }
    
    await loginAs(targetEmail);
    await loadBoardData();
    await loadSyncSettings();
  } catch (err) {
    console.error('Initialization error:', err);
  }
  switchTab('board');
});

// Toast notification
function showToast(msg, isError = false) {
  const toast = document.getElementById('toast');
  const icon = document.getElementById('toastIcon');
  const text = document.getElementById('toastMsg');
  if (!toast) return;
  
  text.textContent = msg;
  if (isError) {
    icon.className = 'fa-solid fa-circle-exclamation text-rose-400';
  } else {
    icon.className = 'fa-solid fa-circle-check text-emerald-400';
  }

  toast.classList.remove('translate-y-20', 'opacity-0');
  setTimeout(() => {
    toast.classList.add('translate-y-20', 'opacity-0');
  }, 3400);
}

// Switch between tabs
function switchTab(tabId) {
  ['board', 'worklogs', 'manager', 'automation', 'profile', 'team'].forEach(t => {
    const section = document.getElementById(`tab-${t}`);
    const navBtn = document.getElementById(`nav-${t}`);
    if (section) {
      if (t === tabId) {
        section.classList.remove('hidden');
        if (navBtn) {
          navBtn.classList.add('bg-blue-600', 'text-white');
          navBtn.classList.remove('hover:bg-gray-700');
        }
      } else {
        section.classList.add('hidden');
        if (navBtn) {
          navBtn.classList.remove('bg-blue-600', 'text-white');
          navBtn.classList.add('hover:bg-gray-700');
        }
      }
    }
  });

  if (tabId === 'board') loadBoardData();
  if (tabId === 'worklogs') loadMyWorklogs();
  if (tabId === 'manager') loadManagerData();
  if (tabId === 'automation') loadSyncSettings();
  if (tabId === 'profile') loadProfileData();
  if (tabId === 'team') loadTeamDirectory();
}

// Authentication
async function loginAs(email) {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (res.ok) {
      currentToken = data.token;
      currentUser = data.user;
      localStorage.setItem('jira_token', currentToken);
      updateUserUI();
      showToast(`Active User: ${currentUser.name} (${currentUser.role.toUpperCase()})`);
      
      // Update reporter selection if open
      const repSelect = document.getElementById('createIssueReporter');
      if (repSelect && currentUser) repSelect.value = currentUser.id;

      loadBoardData();
      if (!document.getElementById('tab-manager').classList.contains('hidden')) {
        loadManagerData();
      }
      if (!document.getElementById('tab-worklogs').classList.contains('hidden')) {
        loadMyWorklogs();
      }
    } else {
      console.warn('Login response not ok:', data);
      // Fallback to first available user
      if (allUsers && allUsers.length > 0 && email !== allUsers[0].email) {
        loginAs(allUsers[0].email);
      }
    }
  } catch (err) {
    console.error(err);
  }
}

function updateUserUI() {
  if (!currentUser) return;
  document.getElementById('currentUserName').textContent = currentUser.name;
  document.getElementById('currentUserAvatar').src = currentUser.avatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=user';
  
  const roleBadge = document.getElementById('currentUserRoleBadge');
  if (currentUser.role === 'manager') {
    roleBadge.textContent = 'Manager';
    roleBadge.className = 'text-[10px] px-1.5 py-0.5 rounded uppercase font-bold tracking-wider bg-amber-400 text-black';
  } else {
    roleBadge.textContent = 'Member';
    roleBadge.className = 'text-[10px] px-1.5 py-0.5 rounded uppercase font-bold tracking-wider bg-gray-600 text-gray-200';
  }
}

// Load Users
async function loadUsers() {
  try {
    const res = await fetch('/api/users', {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    if (res.ok) {
      allUsers = await res.json();
      
      const boardAssignee = document.getElementById('boardAssigneeFilter');
      const createAssignee = document.getElementById('createIssueAssignee');
      const createReporter = document.getElementById('createIssueReporter');
      const mgrUserFilter = document.getElementById('mgrFilterUser');
      const switchList = document.getElementById('quickUserSwitchList');

      if (boardAssignee) boardAssignee.innerHTML = '<option value="">All Owners</option>';
      if (createAssignee) createAssignee.innerHTML = '<option value="">Unassigned</option>';
      if (createReporter) createReporter.innerHTML = '';
      if (mgrUserFilter) mgrUserFilter.innerHTML = '<option value="">All Team Members</option>';
      if (switchList) switchList.innerHTML = '';

      allUsers.forEach(u => {
        if (boardAssignee) boardAssignee.innerHTML += `<option value="${u.id}">${u.name} (${u.role})</option>`;
        if (createAssignee) createAssignee.innerHTML += `<option value="${u.id}">${u.name}</option>`;
        if (createReporter) {
          const isCurrent = currentUser && currentUser.id === u.id;
          createReporter.innerHTML += `<option value="${u.id}" ${isCurrent ? 'selected' : ''}>${u.name} (${u.role})</option>`;
        }
        if (mgrUserFilter) mgrUserFilter.innerHTML += `<option value="${u.id}">${u.name}</option>`;
        
        if (switchList) {
          switchList.innerHTML += `
            <button onclick="loginAs('${u.email}')" class="w-full text-left px-3 py-2 text-xs hover:bg-blue-50 flex items-center space-x-2 border-b border-gray-50">
              <img src="${u.avatar}" class="w-5 h-5 rounded-full">
              <div class="truncate">
                <div class="font-bold text-gray-800 text-xs">${escapeHtml(u.name)} <span class="text-[9px] ${u.role === 'manager' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700'} px-1 rounded">${u.role}</span></div>
                <div class="text-[10px] text-gray-400 truncate">${escapeHtml(u.email)}</div>
              </div>
            </button>
          `;
        }
      });
    }
  } catch (err) {
    console.error(err);
  }
}

// ----------------- BOARD LOGIC -----------------
async function loadBoardData() {
  try {
    const res = await fetch('/api/issues', {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    if (res.ok) {
      allIssues = await res.json();
      populateCategoryFilter(allIssues);
      renderBoard(allIssues);
      updateIssueSelectInLogModal();
    }
  } catch (err) {
    showToast('Could not load board tasks', true);
  }
}

function populateCategoryFilter(issues) {
  const catFilter = document.getElementById('boardCategoryFilter');
  if (!catFilter) return;
  const currentVal = catFilter.value;
  const categories = Array.from(new Set(issues.map(i => i.category || 'General').filter(Boolean))).sort();
  catFilter.innerHTML = '<option value="">All Categories</option>';
  categories.forEach(c => {
    catFilter.innerHTML += `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`;
  });
  if (categories.includes(currentVal)) {
    catFilter.value = currentVal;
  }
}

function filterBoard() {
  const searchInput = document.getElementById('boardSearchInput');
  const catFilter = document.getElementById('boardCategoryFilter');
  const assigneeFilter = document.getElementById('boardAssigneeFilter');

  const search = searchInput ? searchInput.value.toLowerCase() : '';
  const category = catFilter ? catFilter.value : '';
  const assignee = assigneeFilter ? assigneeFilter.value : '';

  const filtered = allIssues.filter(item => {
    const matchesSearch = !search || item.title.toLowerCase().includes(search) || item.issue_key.toLowerCase().includes(search) || (item.remarks || '').toLowerCase().includes(search);
    const matchesCategory = !category || item.category === category;
    const matchesAssignee = !assignee || String(item.assignee_id) === String(assignee);
    return matchesSearch && matchesCategory && matchesAssignee;
  });

  renderBoard(filtered);
}

function renderBoard(issues) {
  document.getElementById('issueCountBadge').textContent = `${issues.length} tasks`;

  const columns = {
    'TO DO': { el: document.getElementById('col-todo'), count: document.getElementById('col-count-todo'), list: [] },
    'IN PROGRESS': { el: document.getElementById('col-inprogress'), count: document.getElementById('col-count-inprogress'), list: [] },
    'IN REVIEW': { el: document.getElementById('col-inreview'), count: document.getElementById('col-count-inreview'), list: [] },
    'DONE': { el: document.getElementById('col-done'), count: document.getElementById('col-count-done'), list: [] }
  };

  Object.values(columns).forEach(col => col.el.innerHTML = '');

  issues.forEach(issue => {
    const target = columns[issue.status] || columns['TO DO'];
    target.list.push(issue);
    target.el.appendChild(createIssueCard(issue));
  });

  Object.values(columns).forEach(col => {
    col.count.textContent = col.list.length;
    if (col.list.length === 0) {
      col.el.innerHTML = '<div class="text-center py-8 text-gray-400 text-xs italic">No tickets in this column</div>';
    }
  });
}

function getTypeIcon(type) {
  switch (type) {
    case 'Story': return '<span class="text-emerald-500 font-bold"><i class="fa-solid fa-bookmark"></i></span>';
    case 'Bug': return '<span class="text-red-500 font-bold"><i class="fa-solid fa-circle-dot"></i></span>';
    default: return '<span class="text-blue-500 font-bold"><i class="fa-solid fa-square-check"></i></span>';
  }
}

function createIssueCard(issue) {
  const card = document.createElement('div');
  card.className = 'bg-white rounded-lg p-3 border border-gray-200 shadow-sm hover:shadow-md transition cursor-pointer select-none space-y-2';
  card.draggable = true;
  card.ondragstart = (e) => {
    draggedIssueId = issue.id;
    e.dataTransfer.setData('text/plain', issue.id);
  };
  card.onclick = () => openIssueDetails(issue.id);

  const totalLogged = issue.total_time_logged || 0;
  const category = issue.category || 'General';

  card.innerHTML = `
    <div class="flex items-center justify-between">
      <div class="flex items-center space-x-1.5">
        ${getTypeIcon(issue.type)}
        <span class="text-[11px] font-bold text-gray-500">${issue.issue_key}</span>
      </div>
      <span class="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-medium max-w-[120px] truncate" title="${escapeHtml(category)}">
        ${escapeHtml(category)}
      </span>
    </div>

    <div class="font-medium text-xs text-gray-800 line-clamp-2">${escapeHtml(issue.title)}</div>

    ${issue.remarks ? `<div class="text-[11px] text-amber-700 bg-amber-50/70 p-1 rounded italic truncate">Note: ${escapeHtml(issue.remarks)}</div>` : ''}

    <div class="flex items-center justify-between pt-2 border-t border-gray-100 text-[11px]">
      <span class="text-xs text-emerald-600 hover:underline font-semibold" onclick="event.stopPropagation(); quickLogTime(${issue.id})">
        <i class="fa-solid fa-plus-circle mr-0.5"></i> ${totalLogged > 0 ? `${totalLogged}h` : 'Log Work'}
      </span>
      <div class="flex items-center space-x-1">
        ${issue.assignee_name ? `
          <img src="${issue.assignee_avatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + issue.assignee_name}" class="w-5 h-5 rounded-full border border-gray-200" title="${escapeHtml(issue.assignee_name)}" />
          <span class="text-[11px] text-gray-600 font-medium">${escapeHtml(issue.assignee_name.split(' ')[0])}</span>
        ` : `
          <span class="text-gray-400 text-[11px] italic">Unassigned</span>
        `}
      </div>
    </div>
  `;
  return card;
}

// Drag & Drop
function allowDrop(ev) { ev.preventDefault(); }

async function handleDrop(ev, newStatus) {
  ev.preventDefault();
  if (!draggedIssueId) return;

  try {
    const res = await fetch(`/api/issues/${draggedIssueId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ status: newStatus })
    });
    if (res.ok) {
      showToast(`Moved to ${newStatus}`);
      loadBoardData();
    }
  } catch (err) {
    showToast('Failed to update ticket status', true);
  } finally {
    draggedIssueId = null;
  }
}

// ----------------- ISSUE DETAILS -----------------
async function openIssueDetails(issueId) {
  currentSelectedIssueId = issueId;
  try {
    const res = await fetch(`/api/issues/${issueId}`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    if (!res.ok) return showToast('Failed to load issue', true);

    const issue = await res.json();
    document.getElementById('modalIssueKey').textContent = issue.issue_key;
    document.getElementById('modalIssueCategory').textContent = issue.category || 'General';
    document.getElementById('modalIssueTitle').textContent = issue.title;
    document.getElementById('modalIssueDesc').textContent = issue.description || issue.remarks || 'No additional remarks';
    document.getElementById('modalIssueTypeIcon').innerHTML = getTypeIcon(issue.type);
    document.getElementById('modalIssuePriority').textContent = issue.priority;
    document.getElementById('modalIssueEstimate').textContent = `${issue.original_estimate_hours || 0} hrs`;
    document.getElementById('modalIssueLogged').textContent = `${issue.total_time_logged || 0} hrs`;
    document.getElementById('modalIssueApproved').textContent = `${issue.approved_time_logged || 0} hrs`;
    document.getElementById('modalIssueStatusSelect').value = issue.status;

    // Assignee
    const assigneeEl = document.getElementById('modalIssueAssignee');
    if (issue.assignee_name) {
      assigneeEl.innerHTML = `
        <img src="${issue.assignee_avatar}" class="w-4 h-4 rounded-full">
        <span>${escapeHtml(issue.assignee_name)}</span>
      `;
    } else {
      assigneeEl.innerHTML = '<span class="text-gray-400 italic">Unassigned</span>';
    }

    // Reporter
    const reporterEl = document.getElementById('modalIssueReporter');
    if (reporterEl) {
      if (issue.reporter_name) {
        reporterEl.innerHTML = `
          <img src="${issue.reporter_avatar || 'https://api.dicebear.com/7.x/avataaars/svg?seed=' + issue.reporter_name}" class="w-4 h-4 rounded-full">
          <span>${escapeHtml(issue.reporter_name)}</span>
        `;
      } else {
        reporterEl.innerHTML = '<span class="text-gray-400 italic">Unassigned</span>';
      }
    }

    // Worklogs
    const logListEl = document.getElementById('modalWorklogsList');
    if (!issue.worklogs || issue.worklogs.length === 0) {
      logListEl.innerHTML = '<div class="text-xs text-gray-400 italic py-2">No work logs recorded yet.</div>';
    } else {
      logListEl.innerHTML = issue.worklogs.map(log => `
        <div class="p-2.5 rounded border border-gray-200 bg-white flex items-start justify-between text-xs">
          <div class="flex items-start space-x-2">
            <img src="${log.user_avatar}" class="w-6 h-6 rounded-full mt-0.5">
            <div>
              <div class="font-bold text-gray-800">${escapeHtml(log.user_name)} <span class="font-medium text-blue-600">logged ${log.time_spent_hours} hrs</span> on ${log.work_date}</div>
              <p class="text-gray-600 mt-0.5">${escapeHtml(log.description || 'No comment')}</p>
              ${log.manager_note ? `<div class="mt-1 text-[11px] bg-gray-50 border-l-2 border-amber-400 pl-2 text-gray-600"><strong>Manager Feedback:</strong> ${escapeHtml(log.manager_note)}</div>` : ''}
            </div>
          </div>
          <div>${getStatusBadge(log.status)}</div>
        </div>
      `).join('');
    }

    openModal('issueDetailModal');
  } catch (err) {
    showToast('Failed to fetch ticket info', true);
  }
}

async function updateIssueStatusFromModal() {
  const newStatus = document.getElementById('modalIssueStatusSelect').value;
  if (!currentSelectedIssueId) return;

  try {
    const res = await fetch(`/api/issues/${currentSelectedIssueId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ status: newStatus })
    });
    if (res.ok) {
      showToast(`Status updated to ${newStatus}`);
      loadBoardData();
    }
  } catch (err) {
    showToast('Error updating status', true);
  }
}

// ----------------- WORKLOGS SECTION -----------------
function openLogWorkModal(preselectedIssueId = null) {
  const select = document.getElementById('logWorkIssueSelect');
  if (preselectedIssueId) {
    select.value = preselectedIssueId;
  }
  document.getElementById('logWorkHours').value = '';
  document.getElementById('logWorkDesc').value = '';
  openModal('logWorkModal');
}

function openLogWorkModalFromIssue() {
  closeModal('issueDetailModal');
  openLogWorkModal(currentSelectedIssueId);
}

function quickLogTime(issueId) {
  openLogWorkModal(issueId);
}

function updateIssueSelectInLogModal() {
  const select = document.getElementById('logWorkIssueSelect');
  select.innerHTML = '<option value="">-- Choose Task --</option>';
  allIssues.forEach(i => {
    select.innerHTML += `<option value="${i.id}">[${i.issue_key}] (${i.category || 'General'}) ${i.title}</option>`;
  });
}

async function submitWorklog(e) {
  e.preventDefault();
  const issue_id = document.getElementById('logWorkIssueSelect').value;
  const time_spent_hours = document.getElementById('logWorkHours').value;
  const work_date = document.getElementById('logWorkDate').value;
  const description = document.getElementById('logWorkDesc').value;

  try {
    const res = await fetch('/api/worklogs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ issue_id, time_spent_hours, work_date, description })
    });
    const data = await res.json();
    if (res.ok) {
      closeModal('logWorkModal');
      showToast(`Work logged! Status: ${data.status.toUpperCase()}`);
      loadBoardData();
      if (!document.getElementById('tab-worklogs').classList.contains('hidden')) {
        loadMyWorklogs();
      }
      if (!document.getElementById('tab-manager').classList.contains('hidden')) {
        loadManagerData();
      }
    } else {
      showToast(data.error || 'Failed to submit worklog', true);
    }
  } catch (err) {
    showToast('Network error while saving worklog', true);
  }
}

async function loadMyWorklogs() {
  const statusFilter = document.getElementById('myLogStatusFilter').value;
  let url = `/api/worklogs?user_id=${currentUser.id}`;
  if (statusFilter) url += `&status=${statusFilter}`;

  try {
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    if (res.ok) {
      const logs = await res.json();
      renderMyWorklogs(logs);
    }
  } catch (err) {
    showToast('Failed to load worklogs', true);
  }
}

function renderMyWorklogs(logs) {
  let totalH = 0, approvedH = 0, pendingH = 0;

  logs.forEach(l => {
    totalH += l.time_spent_hours;
    if (l.status === 'approved') approvedH += l.time_spent_hours;
    if (l.status === 'pending') pendingH += l.time_spent_hours;
  });

  document.getElementById('myTotalHours').textContent = `${totalH.toFixed(1)}h`;
  document.getElementById('myApprovedHours').textContent = `${approvedH.toFixed(1)}h`;
  document.getElementById('myPendingHours').textContent = `${pendingH.toFixed(1)}h`;

  const tbody = document.getElementById('myWorklogsTableBody');
  if (logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-gray-400">No worklogs found. Click "Log Work" to add one.</td></tr>';
    return;
  }

  tbody.innerHTML = logs.map(l => `
    <tr class="hover:bg-gray-50/80 transition">
      <td class="py-3 px-4 font-mono font-medium text-gray-600">${l.work_date}</td>
      <td class="py-3 px-4">
        <span class="font-bold text-blue-600">[${l.issue_key}]</span>
        <span class="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded ml-1">${escapeHtml(l.issue_category || 'General')}</span>
        <div class="text-gray-700 truncate max-w-xs font-medium">${escapeHtml(l.issue_title)}</div>
      </td>
      <td class="py-3 px-4 font-bold text-gray-800">${l.time_spent_hours} hrs</td>
      <td class="py-3 px-4 text-gray-600 max-w-md">${escapeHtml(l.description || '-')}</td>
      <td class="py-3 px-4">${getStatusBadge(l.status)}</td>
      <td class="py-3 px-4 text-gray-500">
        ${l.reviewed_by ? `
          <div class="text-[11px] font-semibold text-gray-700">by ${escapeHtml(l.reviewer_name || 'Manager')}</div>
          ${l.manager_note ? `<div class="italic text-gray-500 text-[11px]">"${escapeHtml(l.manager_note)}"</div>` : ''}
        ` : '<span class="text-gray-400 text-[11px]">Awaiting review</span>'}
      </td>
      <td class="py-3 px-4 text-right">
        ${l.status === 'pending' || currentUser.role === 'manager' ? `
          <button onclick="deleteWorklog(${l.id})" class="text-rose-500 hover:text-rose-700 p-1 font-semibold" title="Delete">
            <i class="fa-solid fa-trash"></i>
          </button>
        ` : '-'}
      </td>
    </tr>
  `).join('');
}

async function deleteWorklog(id) {
  if (!confirm('Are you sure you want to delete this worklog entry?')) return;
  try {
    const res = await fetch(`/api/worklogs/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    if (res.ok) {
      showToast('Worklog removed');
      loadMyWorklogs();
      loadBoardData();
      if (!document.getElementById('tab-manager').classList.contains('hidden')) {
        loadManagerData();
      }
    }
  } catch (err) {
    showToast('Network error', true);
  }
}

// ----------------- MANAGER PORTAL -----------------
async function loadManagerData() {
  try {
    const summaryRes = await fetch('/api/analytics/timesheet-summary', {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    if (summaryRes.ok) {
      const summary = await summaryRes.json();
      renderManagerAnalytics(summary);
    }

    const userFilter = document.getElementById('mgrFilterUser').value;
    const statusFilter = document.getElementById('mgrFilterStatus').value;
    let url = `/api/worklogs?1=1`;
    if (userFilter) url += `&user_id=${userFilter}`;
    if (statusFilter) url += `&status=${statusFilter}`;

    const logsRes = await fetch(url, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    if (logsRes.ok) {
      const logs = await logsRes.json();
      renderManagerQueue(logs);
    }
  } catch (err) {
    showToast('Failed to load manager portal', true);
  }
}

function renderManagerAnalytics(data) {
  const stats = data.totalStats || {};
  document.getElementById('mgrTotalHours').textContent = `${(stats.total_hours || 0).toFixed(1)}h`;
  document.getElementById('mgrTotalEntries').textContent = `${stats.total_entries || 0} entries`;
  document.getElementById('mgrPendingHours').textContent = `${(stats.pending_hours || 0).toFixed(1)}h`;
  document.getElementById('mgrPendingCount').textContent = `${stats.pending_approval_count || 0} pending actions`;
  document.getElementById('mgrApprovedHours').textContent = `${(stats.approved_hours || 0).toFixed(1)}h`;
  document.getElementById('mgrRejectedHours').textContent = `${(stats.rejected_hours || 0).toFixed(1)}h`;

  const badge = document.getElementById('pendingBadge');
  if (stats.pending_approval_count > 0) {
    badge.textContent = stats.pending_approval_count;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }

  const grid = document.getElementById('teamMemberBreakdownGrid');
  grid.innerHTML = (data.userSummary || []).map(u => `
    <div class="bg-gray-50 border border-gray-200 rounded p-3 flex items-center space-x-3">
      <img src="${u.avatar}" class="w-10 h-10 rounded-full border border-gray-300">
      <div class="flex-1 min-w-0">
        <div class="font-bold text-gray-800 text-xs truncate">${escapeHtml(u.name)}</div>
        <div class="text-[11px] text-gray-500">${u.role.toUpperCase()}</div>
        <div class="flex items-center space-x-2 mt-1 text-[11px]">
          <span class="text-emerald-700 font-semibold">${u.approved_hours.toFixed(1)}h apprv</span>
          <span class="text-amber-600 font-semibold">${u.pending_hours.toFixed(1)}h pend</span>
          <span class="text-gray-400">Total: ${u.total_logged_hours.toFixed(1)}h</span>
        </div>
      </div>
    </div>
  `).join('');
}

function renderManagerQueue(logs) {
  const pendingCount = logs.filter(l => l.status === 'pending').length;
  document.getElementById('reviewQueueBadge').textContent = `${pendingCount} Pending`;

  const tbody = document.getElementById('mgrWorklogsTableBody');
  if (logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-gray-400">No worklogs matched this filter.</td></tr>';
    return;
  }

  tbody.innerHTML = logs.map(l => `
    <tr class="hover:bg-gray-50/80 transition">
      <td class="py-3 px-4">
        <div class="flex items-center space-x-2">
          <img src="${l.user_avatar}" class="w-6 h-6 rounded-full">
          <div>
            <div class="font-bold text-gray-800">${escapeHtml(l.user_name)}</div>
            <div class="text-[11px] text-gray-400">${l.user_role}</div>
          </div>
        </div>
      </td>
      <td class="py-3 px-4 font-mono text-gray-600">${l.work_date}</td>
      <td class="py-3 px-4">
        <span class="font-bold text-blue-600">[${l.issue_key}]</span>
        <span class="text-[10px] bg-gray-100 text-gray-600 px-1 rounded">${escapeHtml(l.issue_category || 'General')}</span>
        <div class="text-gray-700 font-medium truncate max-w-xs">${escapeHtml(l.issue_title)}</div>
      </td>
      <td class="py-3 px-4 font-black text-gray-800 text-sm">${l.time_spent_hours} hrs</td>
      <td class="py-3 px-4 text-gray-600 max-w-sm">
        <div>${escapeHtml(l.description || '-')}</div>
        ${l.manager_note ? `<div class="mt-1 text-[11px] text-amber-700 bg-amber-50 p-1 rounded">Note: ${escapeHtml(l.manager_note)}</div>` : ''}
      </td>
      <td class="py-3 px-4">${getStatusBadge(l.status)}</td>
      <td class="py-3 px-4 text-center">
        ${currentUser.role === 'manager' ? `
          <div class="flex items-center justify-center space-x-1.5">
            <button onclick="quickApproveWorklog(${l.id})" class="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-semibold transition" title="Quick Approve">
              <i class="fa-solid fa-check"></i>
            </button>
            <button onclick="openReviewDecisionModal(${l.id}, '${escapeHtml(l.user_name)}', '${l.issue_key}', ${l.time_spent_hours})" class="px-2 py-1 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded text-[11px] font-semibold transition" title="Add Note & Review">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
          </div>
        ` : `
          <span class="text-gray-400 text-[11px]">Manager role required</span>
        `}
      </td>
    </tr>
  `).join('');
}

async function quickApproveWorklog(logId) {
  try {
    const res = await fetch(`/api/worklogs/${logId}/review`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ status: 'approved', manager_note: 'Approved' })
    });
    if (res.ok) {
      showToast('Worklog approved!');
      loadManagerData();
      loadBoardData();
    }
  } catch (err) {
    showToast('Network error', true);
  }
}

function openReviewDecisionModal(logId, userName, issueKey, hours) {
  activeReviewLogId = logId;
  const summaryBox = document.getElementById('reviewTargetSummary');
  summaryBox.innerHTML = `
    <div class="font-bold text-gray-800">Reviewing: ${userName}</div>
    <div class="text-xs text-gray-500 mt-0.5">Logged <strong class="text-blue-600">${hours} hours</strong> for ticket <strong class="text-gray-700">${issueKey}</strong></div>
  `;
  document.getElementById('reviewManagerNote').value = '';
  openModal('managerReviewModal');
}

async function submitManagerDecision(status) {
  if (!activeReviewLogId) return;
  const note = document.getElementById('reviewManagerNote').value;

  try {
    const res = await fetch(`/api/worklogs/${activeReviewLogId}/review`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ status, manager_note: note })
    });
    if (res.ok) {
      closeModal('managerReviewModal');
      showToast(`Worklog marked as ${status.toUpperCase()}`);
      loadManagerData();
      loadBoardData();
    }
  } catch (err) {
    showToast('Network error', true);
  }
}

function exportTimesheetCSV() {
  fetch('/api/worklogs', {
    headers: { 'Authorization': `Bearer ${currentToken}` }
  })
  .then(res => res.json())
  .then(logs => {
    let csv = 'Work Date,Member,Email,Task Key,Category,Task Title,Hours Logged,Status,Reviewed By,Manager Feedback,Description\n';
    logs.forEach(l => {
      csv += `"${l.work_date}","${l.user_name}","${l.user_email}","${l.issue_key}","${(l.issue_category || '').replace(/"/g, '""')}","${(l.issue_title || '').replace(/"/g, '""')}",${l.time_spent_hours},"${l.status}","${l.reviewer_name || ''}","${(l.manager_note || '').replace(/"/g, '""')}","${(l.description || '').replace(/"/g, '""')}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `timesheet-report-${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    showToast('Timesheet exported to CSV');
  });
}

// ----------------- AUTOMATION & SYNC LOGIC -----------------
async function loadSyncSettings() {
  try {
    const res = await fetch('/api/sync/status');
    if (res.ok) {
      const data = await res.json();
      document.getElementById('autoSheetUrl').value = data.sheet_url || '';
      document.getElementById('autoSyncInterval').value = data.sync_interval_mins || 10;
      document.getElementById('autoSyncCheckbox').checked = data.auto_sync_enabled === 1;
      
      const lastSyncEl = document.getElementById('autoLastSyncTime');
      const countEl = document.getElementById('autoSyncCount');
      const bannerLast = document.getElementById('syncBannerLast');

      if (data.last_sync_at) {
        lastSyncEl.textContent = `${data.last_sync_at} (${data.last_sync_status || 'OK'})`;
        bannerLast.textContent = `Last sync: ${data.last_sync_at.split(' ')[1] || data.last_sync_at}`;
      }
      if (data.last_sync_count !== undefined) {
        countEl.textContent = `${data.last_sync_count} Tasks Synced`;
      }
    }
  } catch (e) {
    console.error(e);
  }
}

async function triggerSheetSync() {
  const icon = document.getElementById('syncIcon');
  if (icon) icon.classList.add('fa-spin');

  try {
    const sheet_url = document.getElementById('autoSheetUrl') ? document.getElementById('autoSheetUrl').value : '';
    const res = await fetch('/api/sync/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet_url })
    });
    const data = await res.json();
    if (data.status === 'success') {
      showToast(`Sheet Synced: ${data.imported} new, ${data.updated} updated tasks!`);
      await loadUsers();
      await loadBoardData();
      await loadSyncSettings();
      if (!document.getElementById('tab-manager').classList.contains('hidden')) {
        loadManagerData();
      }
    } else {
      showToast(data.message || 'Sync error', true);
    }
  } catch (err) {
    showToast('Sync request failed', true);
  } finally {
    if (icon) icon.classList.remove('fa-spin');
  }
}

async function saveSyncSettings(e) {
  e.preventDefault();
  const sheet_url = document.getElementById('autoSheetUrl').value;
  const sync_interval_mins = document.getElementById('autoSyncInterval').value;
  const auto_sync_enabled = document.getElementById('autoSyncCheckbox').checked;

  try {
    const res = await fetch('/api/sync/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet_url, sync_interval_mins, auto_sync_enabled })
    });
    if (res.ok) {
      showToast('Automation settings saved! Background polling active.');
      triggerSheetSync();
    }
  } catch (err) {
    showToast('Failed to save settings', true);
  }
}

// ----------------- CREATE TASK & USERS -----------------
function openCreateIssueModal() {
  document.getElementById('createIssueTitle').value = '';
  document.getElementById('createIssueCategory').value = 'General';
  document.getElementById('createIssueDesc').value = '';
  document.getElementById('createIssueEstimate').value = '4';
  
  const reporterSelect = document.getElementById('createIssueReporter');
  if (reporterSelect && currentUser) {
    reporterSelect.value = currentUser.id;
  }
  
  openModal('createIssueModal');
}

async function submitNewIssue(e) {
  e.preventDefault();
  const title = document.getElementById('createIssueTitle').value;
  const category = document.getElementById('createIssueCategory').value;
  const type = document.getElementById('createIssueType') ? document.getElementById('createIssueType').value : 'Task';
  const priority = document.getElementById('createIssuePriority').value;
  const assignee_id = document.getElementById('createIssueAssignee').value;
  const reporter_id = document.getElementById('createIssueReporter') ? document.getElementById('createIssueReporter').value : (currentUser ? currentUser.id : null);
  const original_estimate_hours = document.getElementById('createIssueEstimate').value;
  const description = document.getElementById('createIssueDesc').value;

  try {
    const res = await fetch('/api/issues', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ title, category, type, priority, assignee_id, reporter_id, original_estimate_hours, description })
    });
    const data = await res.json();
    if (res.ok) {
      closeModal('createIssueModal');
      showToast(`Created task ${data.issue_key} by Reporter`);
      loadBoardData();
    } else {
      showToast(data.error || 'Failed to create task', true);
    }
  } catch (err) {
    showToast('Error saving task', true);
  }
}

async function loadTeamDirectory() {
  await loadUsers();
  const grid = document.getElementById('teamDirectoryGrid');
  grid.innerHTML = allUsers.map(u => `
    <div class="bg-white border border-gray-200 rounded-lg p-4 shadow-sm flex items-start space-x-3.5">
      <img src="${u.avatar}" class="w-12 h-12 rounded-full border border-gray-200">
      <div class="flex-1">
        <div class="flex items-center justify-between">
          <h4 class="font-bold text-sm text-gray-800">${escapeHtml(u.name)}</h4>
          <span class="text-[10px] font-bold px-2 py-0.5 rounded uppercase ${u.role === 'manager' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'}">
            ${u.role}
          </span>
        </div>
        <div class="text-xs text-gray-500 mt-0.5">${escapeHtml(u.email)}</div>
        <div class="mt-3 flex items-center space-x-2">
          <button onclick="loginAs('${u.email}')" class="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-2.5 py-1 rounded transition font-medium">
            Switch Persona
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

function openAddUserModal() { openModal('addUserModal'); }

async function submitNewUser(e) {
  e.preventDefault();
  const name = document.getElementById('addUserName').value;
  const email = document.getElementById('addUserEmail').value;
  const role = document.getElementById('addUserRole').value;

  try {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ name, email, role })
    });
    if (res.ok) {
      closeModal('addUserModal');
      showToast(`User ${name} added!`);
      loadTeamDirectory();
    }
  } catch (err) {
    showToast('Network error creating user', true);
  }
}

// ----------------- PROFILE & CREDENTIALS -----------------
let actualRevealedPassword = '';

async function loadProfileData() {
  try {
    const res = await fetch('/api/profile', {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    if (res.ok) {
      const data = await res.json();
      document.getElementById('profileInputName').value = data.name || '';
      document.getElementById('profileInputEmail').value = data.email || '';
      document.getElementById('profileInputPassword').value = '';
      document.getElementById('profilePageAvatar').src = data.avatar || '';
      document.getElementById('profilePageNameHeading').textContent = data.name || 'My Profile';
      
      const badge = document.getElementById('profilePageRoleBadge');
      if (data.role === 'manager') {
        badge.textContent = 'Manager';
        badge.className = 'ml-2.5 text-[11px] px-2 py-0.5 rounded font-bold uppercase tracking-wider bg-amber-400 text-black';
      } else {
        badge.textContent = 'Member';
        badge.className = 'ml-2.5 text-[11px] px-2 py-0.5 rounded font-bold uppercase tracking-wider bg-gray-600 text-gray-200';
      }

      actualRevealedPassword = data.password || 'password123';
      document.getElementById('profileCurrentPasswordHint').value = '••••••••';
      document.getElementById('togglePassIcon').className = 'fa-solid fa-eye';
    }
  } catch (err) {
    showToast('Failed to load profile details', true);
  }
}

function togglePasswordView() {
  const input = document.getElementById('profileCurrentPasswordHint');
  const icon = document.getElementById('togglePassIcon');
  if (input.value === '••••••••') {
    input.value = actualRevealedPassword;
    icon.className = 'fa-solid fa-eye-slash';
  } else {
    input.value = '••••••••';
    icon.className = 'fa-solid fa-eye';
  }
}

async function saveProfileChanges(e) {
  e.preventDefault();
  const name = document.getElementById('profileInputName').value;
  const email = document.getElementById('profileInputEmail').value;
  const password = document.getElementById('profileInputPassword').value;

  try {
    const res = await fetch('/api/profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ name, email, password })
    });
    const data = await res.json();
    if (res.ok) {
      showToast('Profile and credentials updated successfully!');
      currentUser = data.user;
      currentToken = data.user.email;
      localStorage.setItem('jira_token', currentToken);
      updateUserUI();
      await loadProfileData();
      await loadUsers();
      await loadBoardData();
    } else {
      showToast(data.error || 'Failed to update profile', true);
    }
  } catch (err) {
    showToast('Network error while saving profile', true);
  }
}

// Helpers
function getStatusBadge(status) {
  switch (status) {
    case 'approved':
      return '<span class="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full inline-flex items-center"><i class="fa-solid fa-check mr-1"></i> Approved</span>';
    case 'rejected':
      return '<span class="bg-rose-100 text-rose-800 text-[10px] font-bold px-2 py-0.5 rounded-full inline-flex items-center"><i class="fa-solid fa-xmark mr-1"></i> Rejected</span>';
    default:
      return '<span class="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-full inline-flex items-center"><i class="fa-solid fa-clock mr-1"></i> Pending</span>';
  }
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.remove('hidden');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (modal) modal.classList.add('hidden');
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
}
