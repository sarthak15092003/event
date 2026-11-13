// CMR Personalized Workbench & Deliverables Logic
let currentUser = null;
let currentToken = localStorage.getItem('jira_token') || 'ankit.parashar@jira.local';
let allIssues = [];
let allUsers = [];
let activeWorkbenchFilter = 'ALL';

document.addEventListener('DOMContentLoaded', async () => {
  const today = new Date().toISOString().split('T')[0];
  const dateInput = document.getElementById('logWorkDate');
  if (dateInput) dateInput.value = today;

  await loadUsers();
  
  // Safe login fallback to Ankit or first user
  let targetEmail = currentToken;
  const exists = allUsers.some(u => u.email.toLowerCase() === (targetEmail || '').toLowerCase());
  if (!exists && allUsers.length > 0) {
    targetEmail = allUsers[0].email;
  }
  await loginAs(targetEmail || 'ankit.parashar@jira.local');
  
  await loadIssues();
  switchNav('my-tasks');
});

function showToast(msg, isError = false) {
  const toast = document.getElementById('toast');
  const icon = document.getElementById('toastIcon');
  const text = document.getElementById('toastMsg');
  if (!toast) return;

  text.textContent = msg;
  icon.className = isError ? 'fa-solid fa-circle-exclamation text-rose-400' : 'fa-solid fa-circle-check text-emerald-400';
  toast.classList.remove('translate-y-20', 'opacity-0');
  setTimeout(() => toast.classList.add('translate-y-20', 'opacity-0'), 3000);
}

function getInitials(name) {
  if (!name) return 'U';
  const parts = name.trim().split(' ');
  return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : name.slice(0, 2).toUpperCase();
}

async function loadUsers() {
  try {
    const res = await fetch('/api/users');
    if (res.ok) {
      allUsers = await res.json();
      
      // Update dropdown lists
      const personaList = document.getElementById('personaList');
      const createAssignee = document.getElementById('createIssueAssignee');
      const createReporter = document.getElementById('createIssueReporter');

      if (personaList) personaList.innerHTML = '';
      if (createAssignee) createAssignee.innerHTML = '<option value="">Unassigned</option>';
      if (createReporter) createReporter.innerHTML = '';

      allUsers.forEach(u => {
        if (personaList) {
          personaList.innerHTML += `
            <button onclick="loginAs('${u.email}')" class="w-full text-left px-3.5 py-2 text-xs hover:bg-slate-50 flex items-center space-x-2.5">
              <div class="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-[10px]">${getInitials(u.name)}</div>
              <div class="truncate">
                <div class="font-bold text-slate-800 text-xs">${u.name} <span class="text-[9px] px-1 rounded uppercase ${u.role === 'manager' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}">${u.role}</span></div>
                <div class="text-[10px] text-slate-400 truncate">${u.email}</div>
              </div>
            </button>
          `;
        }
        if (createAssignee) createAssignee.innerHTML += `<option value="${u.id}">${u.name}</option>`;
        if (createReporter) createReporter.innerHTML += `<option value="${u.id}">${u.name}</option>`;
      });
    }
  } catch (err) {
    console.error('Users load error:', err);
  }
}

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
      renderWorkbenchDeliverables();
      if (!document.getElementById('view-manager').classList.contains('hidden')) {
        loadManagerData();
      }
    }
  } catch (err) {
    console.error('Login error:', err);
  }
}

function updateUserUI() {
  if (!currentUser) return;
  const initials = getInitials(currentUser.name);
  const roleName = currentUser.role === 'manager' ? 'Manager' : 'Employee';

  // Header
  document.getElementById('headerUserInitials').textContent = initials;
  document.getElementById('headerUserName').textContent = currentUser.name;
  document.getElementById('headerUserRole').textContent = roleName;

  // Sidebar
  document.getElementById('sideUserInitials').textContent = initials;
  document.getElementById('sideUserName').textContent = currentUser.name;
  document.getElementById('sideUserRole').textContent = roleName;

  // Workbench Header
  document.getElementById('workbenchUserTitle').textContent = `${currentUser.name} (You)`;
  document.getElementById('activeWorkbenchName').textContent = currentUser.name;
  document.getElementById('activeWorkbenchRole').textContent = roleName;

  // Profile
  const profileAvatar = document.getElementById('profileAvatarBig');
  if (profileAvatar) profileAvatar.textContent = initials;
  const pName = document.getElementById('profileTitleName');
  if (pName) pName.textContent = currentUser.name;
  const pRole = document.getElementById('profileTitleRole');
  if (pRole) pRole.textContent = roleName;
  const pInName = document.getElementById('profileInputName');
  if (pInName) pInName.value = currentUser.name;
  const pInEmail = document.getElementById('profileInputEmail');
  if (pInEmail) pInEmail.value = currentUser.email;

  // Reporter select default
  const repSelect = document.getElementById('createIssueReporter');
  if (repSelect) repSelect.value = currentUser.id;
}

// Navigation Switcher
function switchNav(viewId) {
  ['my-tasks', 'all-deliverables', 'manager', 'automation', 'profile'].forEach(id => {
    const view = document.getElementById(`view-${id}`);
    const sideBtn = document.getElementById(`side-${id}`);
    if (id === viewId) {
      if (view) view.classList.remove('hidden');
      if (sideBtn) {
        sideBtn.className = 'w-full text-left px-3 py-2 rounded-lg text-xs font-bold flex items-center space-x-2.5 transition bg-blue-600 text-white shadow-xs';
      }
    } else {
      if (view) view.classList.add('hidden');
      if (sideBtn) {
        sideBtn.className = 'w-full text-left px-3 py-2 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 flex items-center space-x-2.5 transition';
      }
    }
  });

  if (viewId === 'my-tasks') renderWorkbenchDeliverables();
  if (viewId === 'all-deliverables') renderBoard();
  if (viewId === 'manager') loadManagerData();
}

async function loadIssues() {
  try {
    const res = await fetch('/api/issues');
    if (res.ok) {
      allIssues = await res.json();
      renderWorkbenchDeliverables();
      renderBoard();
      updateLogWorkSelect();
    }
  } catch (err) {
    showToast('Failed to load issues', true);
  }
}

// Filter Workbench by Status Pill
function setWorkbenchFilter(filterName) {
  activeWorkbenchFilter = filterName;
  ['ALL', 'REVIEW', 'PENDING', 'IN PROGRESS', 'DONE'].forEach(f => {
    const btn = document.getElementById(`filter-btn-${f}`);
    if (btn) {
      if (f === filterName) {
        btn.className = 'px-3 py-1 rounded-full bg-blue-600 text-white shadow-xs';
      } else {
        btn.className = 'px-3 py-1 rounded-full bg-white border border-slate-200 text-slate-600 hover:bg-slate-100';
      }
    }
  });
  renderWorkbenchDeliverables();
}

function resetWorkbenchFilters() {
  document.getElementById('workbenchSearch').value = '';
  setWorkbenchFilter('ALL');
}

// Render Personalized Deliverables
function renderWorkbenchDeliverables() {
  if (!currentUser) return;
  const container = document.getElementById('workbenchListContainer');
  const emptyState = document.getElementById('workbenchEmptyState');
  const search = (document.getElementById('workbenchSearch').value || '').toLowerCase();

  // Filter tasks assigned to current user
  const myAssigned = allIssues.filter(i => i.assignee_id === currentUser.id);

  // Compute Metrics
  let awaitingApprovalCount = 0;
  let doneCount = 0;
  let inProgressCount = 0;
  let pendingCount = 0;

  myAssigned.forEach(i => {
    if (i.status === 'IN REVIEW') awaitingApprovalCount++;
    else if (i.status === 'DONE') doneCount++;
    else if (i.status === 'IN PROGRESS') inProgressCount++;
    else pendingCount++;
  });

  // Update Metric Numbers
  document.getElementById('metricTotalAssigned').textContent = `${myAssigned.length} Deliverables`;
  document.getElementById('deliverableCountBadge').textContent = `${myAssigned.length} Deliverables`;
  document.getElementById('metricAwaitingApproval').textContent = `${awaitingApprovalCount} Need Review`;
  document.getElementById('metricCompleted').textContent = `${doneCount} Verified`;
  document.getElementById('metricInProgress').textContent = `${inProgressCount} Active`;
  document.getElementById('metricPendingBacklog').textContent = `${pendingCount} Pending`;

  // Update Pill Badges
  document.getElementById('pill-count-all').textContent = myAssigned.length;
  document.getElementById('pill-count-review').textContent = awaitingApprovalCount;
  document.getElementById('pill-count-pending').textContent = pendingCount;
  document.getElementById('pill-count-progress').textContent = inProgressCount;
  document.getElementById('pill-count-done').textContent = doneCount;

  // Filter list by selected tab & search
  const filtered = myAssigned.filter(item => {
    const matchesSearch = !search || item.title.toLowerCase().includes(search) || item.issue_key.toLowerCase().includes(search);
    let matchesStatus = true;
    if (activeWorkbenchFilter === 'REVIEW') matchesStatus = item.status === 'IN REVIEW';
    else if (activeWorkbenchFilter === 'PENDING') matchesStatus = item.status === 'TO DO';
    else if (activeWorkbenchFilter === 'IN PROGRESS') matchesStatus = item.status === 'IN PROGRESS';
    else if (activeWorkbenchFilter === 'DONE') matchesStatus = item.status === 'DONE';
    return matchesSearch && matchesStatus;
  });

  if (filtered.length === 0) {
    container.innerHTML = '';
    emptyState.classList.remove('hidden');
  } else {
    emptyState.classList.add('hidden');
    container.innerHTML = filtered.map(item => `
      <div class="bg-white border border-slate-200 rounded-xl p-4 shadow-xs hover:border-blue-300 transition flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div class="flex items-start space-x-3.5">
          <div class="w-8 h-8 rounded-lg ${getStatusBg(item.status)} flex items-center justify-center text-sm font-bold mt-0.5 shrink-0">
            ${getStatusIcon(item.status)}
          </div>
          <div>
            <div class="flex items-center space-x-2">
              <span class="font-bold text-xs text-blue-600">${item.issue_key}</span>
              <span class="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded font-medium">${item.category || 'Operations'}</span>
              <select onchange="updateDeliverableStatus(${item.id}, this.value)" class="text-[10px] font-bold px-2 py-0.5 rounded uppercase border border-slate-200 cursor-pointer outline-none transition ${getStatusBadgeClass(item.status)}">
                <option value="TO DO" ${item.status === 'TO DO' ? 'selected' : ''}>TO DO</option>
                <option value="IN PROGRESS" ${item.status === 'IN PROGRESS' ? 'selected' : ''}>IN PROGRESS</option>
                <option value="IN REVIEW" ${item.status === 'IN REVIEW' ? 'selected' : ''}>IN REVIEW</option>
                <option value="DONE" ${item.status === 'DONE' ? 'selected' : ''}>DONE</option>
              </select>
            </div>
            <h4 class="font-bold text-sm text-slate-900 mt-0.5">${escapeHtml(item.title)}</h4>
            ${item.remarks ? `<p class="text-[11px] text-amber-700 mt-0.5">Note: ${escapeHtml(item.remarks)}</p>` : ''}
          </div>
        </div>

        <div class="flex items-center space-x-3 text-xs border-t md:border-t-0 pt-2 md:pt-0 justify-between md:justify-end">
          <div class="text-right">
            <span class="text-slate-400 text-[10px] uppercase font-bold block">Logged</span>
            <span class="font-bold text-slate-800">${item.total_time_logged || 0} hrs</span>
          </div>
          <button onclick="openLogWorkModal(${item.id})" class="bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold px-3 py-1.5 rounded-lg border border-blue-200 transition">
            + Log Time
          </button>
        </div>
      </div>
    `).join('');
  }
}

function getStatusBg(status) {
  switch (status) {
    case 'DONE': return 'bg-emerald-50 text-emerald-600';
    case 'IN PROGRESS': return 'bg-blue-50 text-blue-600';
    case 'IN REVIEW': return 'bg-purple-50 text-purple-600';
    default: return 'bg-slate-100 text-slate-600';
  }
}

function getStatusIcon(status) {
  switch (status) {
    case 'DONE': return '<i class="fa-solid fa-check"></i>';
    case 'IN PROGRESS': return '<i class="fa-solid fa-spinner"></i>';
    case 'IN REVIEW': return '<i class="fa-solid fa-eye"></i>';
    default: return '<i class="fa-solid fa-clock"></i>';
  }
}

function getStatusBadgeClass(status) {
  switch (status) {
    case 'DONE': return 'bg-emerald-100 text-emerald-800';
    case 'IN PROGRESS': return 'bg-blue-100 text-blue-800';
    case 'IN REVIEW': return 'bg-purple-100 text-purple-800';
    default: return 'bg-slate-100 text-slate-700';
  }
}

// Render Kanban Board
function renderBoard() {
  const columns = {
    'TO DO': { el: document.getElementById('col-todo'), count: document.getElementById('col-count-todo'), list: [] },
    'IN PROGRESS': { el: document.getElementById('col-inprogress'), count: document.getElementById('col-count-inprogress'), list: [] },
    'IN REVIEW': { el: document.getElementById('col-inreview'), count: document.getElementById('col-count-inreview'), list: [] },
    'DONE': { el: document.getElementById('col-done'), count: document.getElementById('col-count-done'), list: [] }
  };

  document.getElementById('boardTotalCount').textContent = `${allIssues.length} tasks`;
  Object.values(columns).forEach(col => col.el.innerHTML = '');

  allIssues.forEach(issue => {
    const target = columns[issue.status] || columns['TO DO'];
    target.list.push(issue);
    
    const card = document.createElement('div');
    card.className = 'bg-white rounded-xl p-3 border border-slate-200 shadow-xs hover:shadow-sm transition select-none text-xs space-y-1.5 cursor-grab';
    card.draggable = true;
    card.ondragstart = (e) => e.dataTransfer.setData('text/plain', issue.id);

    card.innerHTML = `
      <div class="flex items-center justify-between text-[11px]">
        <span class="font-bold text-blue-600">${issue.issue_key}</span>
        <span class="text-[10px] text-slate-400 font-semibold truncate max-w-[100px]">${issue.category || 'Operations'}</span>
      </div>
      <div class="font-bold text-slate-800 line-clamp-2">${escapeHtml(issue.title)}</div>
      <div class="flex items-center justify-between pt-1 text-[11px] text-slate-400">
        <span><i class="fa-regular fa-clock mr-1"></i>${issue.total_time_logged || 0}h</span>
        <span class="font-semibold text-slate-700">${issue.assignee_name ? issue.assignee_name.split(' ')[0] : 'Unassigned'}</span>
      </div>
    `;
    target.el.appendChild(card);
  });

  Object.values(columns).forEach(col => {
    col.count.textContent = col.list.length;
  });
}

function allowDrop(ev) { ev.preventDefault(); }

async function updateDeliverableStatus(issueId, newStatus) {
  try {
    const res = await fetch(`/api/issues/${issueId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
      body: JSON.stringify({ status: newStatus })
    });
    if (res.ok) {
      showToast(`Status updated to ${newStatus}`);
      await loadIssues();
    } else {
      showToast('Failed to update status', true);
    }
  } catch (err) {
    showToast('Failed to update status', true);
  }
}

async function handleDrop(ev, newStatus) {
  ev.preventDefault();
  const issueId = ev.dataTransfer.getData('text/plain');
  if (!issueId) return;

  try {
    const res = await fetch(`/api/issues/${issueId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
      body: JSON.stringify({ status: newStatus })
    });
    if (res.ok) {
      showToast(`Status updated to ${newStatus}`);
      await loadIssues();
    }
  } catch (err) {
    showToast('Failed to update status', true);
  }
}

// Worklog Submissions
function openLogWorkModal(preselectedId = null) {
  const select = document.getElementById('logWorkIssueSelect');
  if (preselectedId) select.value = preselectedId;
  document.getElementById('logWorkHours').value = '';
  document.getElementById('logWorkDesc').value = '';
  openModal('logWorkModal');
}

function updateLogWorkSelect() {
  const select = document.getElementById('logWorkIssueSelect');
  select.innerHTML = '<option value="">-- Choose Deliverable --</option>';
  allIssues.forEach(i => {
    select.innerHTML += `<option value="${i.id}">[${i.issue_key}] ${i.title}</option>`;
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
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
      body: JSON.stringify({ issue_id, time_spent_hours, work_date, description })
    });
    if (res.ok) {
      closeModal('logWorkModal');
      showToast('Work logged successfully!');
      await loadIssues();
    }
  } catch (err) {
    showToast('Failed to save log', true);
  }
}

// Manager Data
async function loadManagerData() {
  try {
    const summaryRes = await fetch('/api/analytics/timesheet-summary', {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    if (summaryRes.ok) {
      const data = await summaryRes.json();
      const stats = data.totalStats || {};
      document.getElementById('mgrTotalHours').textContent = `${(stats.total_hours || 0).toFixed(1)}h`;
      document.getElementById('mgrPendingHours').textContent = `${(stats.pending_hours || 0).toFixed(1)}h`;
      document.getElementById('mgrApprovedHours').textContent = `${(stats.approved_hours || 0).toFixed(1)}h`;
      document.getElementById('mgrRejectedHours').textContent = `${(stats.rejected_hours || 0).toFixed(1)}h`;
      
      const badge = document.getElementById('sidebarPendingBadge');
      if (stats.pending_approval_count > 0) {
        badge.textContent = stats.pending_approval_count;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    }

    const logsRes = await fetch('/api/worklogs', {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    if (logsRes.ok) {
      const logs = await logsRes.json();
      const pending = logs.filter(l => l.status === 'pending');
      document.getElementById('reviewQueueCountBadge').textContent = `${pending.length} Pending`;

      const tbody = document.getElementById('mgrWorklogsTableBody');
      tbody.innerHTML = logs.map(l => `
        <tr class="hover:bg-slate-50 transition">
          <td class="py-3 px-4 font-bold">${escapeHtml(l.user_name)}</td>
          <td class="py-3 px-4 font-mono text-slate-500">${l.work_date}</td>
          <td class="py-3 px-4"><span class="font-bold text-blue-600">[${l.issue_key}]</span> ${escapeHtml(l.issue_title)}</td>
          <td class="py-3 px-4 font-bold text-slate-800">${l.time_spent_hours}h</td>
          <td class="py-3 px-4 text-slate-600 max-w-xs truncate">${escapeHtml(l.description || '-')}</td>
          <td class="py-3 px-4"><span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase ${getStatusBadgeClass(l.status.toUpperCase())}">${l.status}</span></td>
          <td class="py-3 px-4 text-center">
            ${l.status === 'pending' ? `
              <button onclick="approveWorklog(${l.id})" class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-bold">Approve</button>
            ` : '-'}
          </td>
        </tr>
      `).join('');
    }
  } catch (err) {
    console.error('Manager data error:', err);
  }
}

async function approveWorklog(id) {
  try {
    const res = await fetch(`/api/worklogs/${id}/review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
      body: JSON.stringify({ status: 'approved', manager_note: 'Approved by Manager' })
    });
    if (res.ok) {
      showToast('Worklog Approved!');
      loadManagerData();
      loadIssues();
    }
  } catch (err) {
    showToast('Failed to approve', true);
  }
}

function exportTimesheetCSV() {
  fetch('/api/worklogs', { headers: { 'Authorization': `Bearer ${currentToken}` } })
    .then(r => r.json())
    .then(logs => {
      let csv = 'Date,Member,Email,Task,Hours,Status,Description\n';
      logs.forEach(l => {
        csv += `"${l.work_date}","${l.user_name}","${l.user_email}","${l.issue_key}",${l.time_spent_hours},"${l.status}","${(l.description||'').replace(/"/g, '""')}"\n`;
      });
      const blob = new Blob([csv], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `timesheet-${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
    });
}

// Sheet Sync Trigger
async function triggerSheetSync() {
  const icon = document.getElementById('syncIcon');
  if (icon) icon.classList.add('fa-spin');
  try {
    const res = await fetch('/api/sync/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    const data = await res.json();
    if (data.status === 'success') {
      showToast(`Synced ${data.imported} new, ${data.updated} updated!`);
      await loadUsers();
      await loadIssues();
    }
  } catch (err) {
    showToast('Sync error', true);
  } finally {
    if (icon) icon.classList.remove('fa-spin');
  }
}

// Modals
function openCreateIssueModal() { openModal('createIssueModal'); }

async function submitNewIssue(e) {
  e.preventDefault();
  const title = document.getElementById('createIssueTitle').value;
  const category = document.getElementById('createIssueCategory').value;
  const priority = document.getElementById('createIssuePriority').value;
  const assignee_id = document.getElementById('createIssueAssignee').value;
  const reporter_id = document.getElementById('createIssueReporter').value;

  try {
    const res = await fetch('/api/issues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
      body: JSON.stringify({ title, category, priority, assignee_id, reporter_id })
    });
    if (res.ok) {
      closeModal('createIssueModal');
      showToast('Deliverable created successfully');
      await loadIssues();
    }
  } catch (err) {
    showToast('Error creating deliverable', true);
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
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
      body: JSON.stringify({ name, email, password })
    });
    const data = await res.json();
    if (res.ok) {
      showToast('Profile updated!');
      currentUser = data.user;
      currentToken = data.user.email;
      localStorage.setItem('jira_token', currentToken);
      updateUserUI();
    } else {
      showToast(data.error || 'Failed to update profile', true);
    }
  } catch (err) {
    showToast('Failed to update profile', true);
  }
}

async function confirmDeleteProfile() {
  if (!currentUser) return;
  const confirmed = confirm(`Are you sure you want to permanently delete profile "${currentUser.name}" (${currentUser.email})? This action cannot be undone.`);
  if (!confirmed) return;

  try {
    const res = await fetch('/api/profile', {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error || 'Failed to delete profile', true);
      return;
    }

    showToast('Profile successfully deleted');
    localStorage.removeItem('jira_token');
    currentToken = null;
    currentUser = null;

    // Refresh user list and switch to another active user
    await loadUsers();
    if (allUsers.length > 0) {
      await loginAs(allUsers[0].email);
    } else {
      window.location.reload();
    }
    switchNav('my-tasks');
  } catch (err) {
    console.error('Delete profile error:', err);
    showToast('Failed to delete profile', true);
  }
}

function openModal(id) { const el = document.getElementById(id); if (el) el.classList.remove('hidden'); }
function closeModal(id) { const el = document.getElementById(id); if (el) el.classList.add('hidden'); }

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

