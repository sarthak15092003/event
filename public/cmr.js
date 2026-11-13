// CMR Personalized Workbench & Deliverables Logic
let currentUser = null;
let currentToken = localStorage.getItem('jira_token') || 'ankit.parashar@jira.local';
let allIssues = [];
let allUsers = [];
let allProjects = [];
let activeWorkbenchFilter = 'ALL';
let selectedTaskIds = new Set();

document.addEventListener('DOMContentLoaded', async () => {
  const today = new Date().toISOString().split('T')[0];
  const dateInput = document.getElementById('logWorkDate');
  if (dateInput) dateInput.value = today;

  await loadUsers();
  await loadProjects();
  await loadIssues();
  await loadSyncSettings();
  
  // Safe login fallback
  let targetEmail = currentToken;
  const exists = allUsers.some(u => u.email.toLowerCase() === (targetEmail || '').toLowerCase());
  if (!exists && allUsers.length > 0) {
    targetEmail = allUsers[0].email;
  }
  await loginAs(targetEmail || (allUsers.length > 0 ? allUsers[0].email : ''));
  
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

async function loadProjects() {
  try {
    const res = await fetch('/api/projects');
    if (res.ok) {
      allProjects = await res.json();
      const projSelect = document.getElementById('createIssueProject');
      if (projSelect) {
        projSelect.innerHTML = allProjects.map(p => `
          <option value="${p.id}">${escapeHtml(p.name)} (${p.key})</option>
        `).join('');
      }
    }
  } catch (err) {
    console.error('Projects load error:', err);
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

  // Filter tasks assigned to current user (or co-owned in remarks)
  const myAssigned = allIssues.filter(i => {
    if (i.assignee_id === currentUser.id) return true;
    if (currentUser.name && i.remarks && i.remarks.toLowerCase().includes(currentUser.name.toLowerCase())) return true;
    return false;
  });

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
      <div class="bg-white border ${selectedTaskIds.has(item.id) ? 'border-blue-500 bg-blue-50/20 shadow-sm' : 'border-slate-200'} rounded-xl p-4 shadow-xs hover:border-blue-300 transition flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div class="flex items-start space-x-3.5">
          <!-- Selection Checkbox -->
          <div class="pt-1.5 shrink-0">
            <input type="checkbox" ${selectedTaskIds.has(item.id) ? 'checked' : ''} onchange="toggleTaskSelection(${item.id}, this.checked)" class="w-4 h-4 rounded text-blue-600 border-slate-300 cursor-pointer focus:ring-blue-500">
          </div>
          <div class="w-8 h-8 rounded-lg ${getStatusBg(item.status)} flex items-center justify-center text-sm font-bold mt-0.5 shrink-0">
            ${getStatusIcon(item.status)}
          </div>
          <div>
            <div class="flex items-center space-x-2 flex-wrap gap-y-1">
              <span class="font-bold text-xs text-blue-600">${item.issue_key}</span>
              ${item.project_name ? `<span class="text-[10px] bg-blue-50 text-blue-700 font-semibold px-1.5 py-0.2 rounded border border-blue-100">${escapeHtml(item.project_name)}</span>` : ''}
              <span class="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded font-medium">${item.category || 'Operations'}</span>
              <select onchange="updateDeliverableStatus(${item.id}, this.value)" class="text-[10px] font-bold px-2 py-0.5 rounded uppercase border border-slate-200 cursor-pointer outline-none transition ${getStatusBadgeClass(item.status)}">
                <option value="TO DO" ${item.status === 'TO DO' ? 'selected' : ''}>TO DO</option>
                <option value="IN PROGRESS" ${item.status === 'IN PROGRESS' ? 'selected' : ''}>IN PROGRESS</option>
                <option value="IN REVIEW" ${item.status === 'IN REVIEW' ? 'selected' : ''}>IN REVIEW</option>
                <option value="DONE" ${item.status === 'DONE' ? 'selected' : ''}>DONE</option>
              </select>
            </div>
            <h4 onclick="openTaskDetails(${item.id})" class="font-bold text-sm text-slate-900 mt-0.5 hover:text-blue-600 cursor-pointer flex items-center group">
              <span>${escapeHtml(item.title)}</span>
              <i class="fa-solid fa-arrow-up-right-from-square text-[10px] text-slate-400 group-hover:text-blue-600 ml-1.5 opacity-0 group-hover:opacity-100 transition"></i>
            </h4>
            ${item.remarks ? `<p class="text-[11px] text-amber-700 mt-0.5">Note: ${escapeHtml(item.remarks)}</p>` : ''}
          </div>
        </div>

        <div class="flex items-center space-x-2 text-xs border-t md:border-t-0 pt-2 md:pt-0 justify-between md:justify-end">
          <div class="text-right mr-2">
            <span class="text-slate-400 text-[10px] uppercase font-bold block">Logged</span>
            <span class="font-bold text-slate-800">${item.total_time_logged || 0} hrs</span>
          </div>
          <button onclick="openTaskDetails(${item.id})" class="bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold px-2.5 py-1.5 rounded-lg border border-slate-200 transition flex items-center">
            <i class="fa-regular fa-eye mr-1 text-slate-500"></i> Details
          </button>
          <button onclick="openLogWorkModal(${item.id})" class="bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold px-3 py-1.5 rounded-lg border border-blue-200 transition">
            + Log Time
          </button>
          <!-- Individual Quick Actions Dropdown / Buttons -->
          <button onclick="singleDuplicateTask(${item.id})" title="Duplicate Task" class="p-1.5 text-slate-400 hover:text-blue-600 rounded-lg hover:bg-slate-100 transition">
            <i class="fa-regular fa-copy"></i>
          </button>
          <button onclick="singleDeleteTask(${item.id})" title="Delete Task" class="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-100 transition">
            <i class="fa-regular fa-trash-can"></i>
          </button>
        </div>
      </div>
    `).join('');
    updateBulkBarUI();
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
    card.className = 'bg-white rounded-xl p-3 border border-slate-200 shadow-xs hover:shadow-sm hover:border-blue-300 transition select-none text-xs space-y-1.5 cursor-pointer';
    card.draggable = true;
    card.ondragstart = (e) => e.dataTransfer.setData('text/plain', issue.id);
    card.onclick = (e) => {
      // Don't trigger modal if dragging or clicking buttons
      if (e.target.closest('button') || e.target.closest('select')) return;
      openTaskDetails(issue.id);
    };

    card.innerHTML = `
      <div class="flex items-center justify-between text-[11px]">
        <span class="font-bold text-blue-600">${issue.issue_key}</span>
        <span class="text-[10px] text-slate-400 font-semibold truncate max-w-[100px]">${issue.category || 'Operations'}</span>
      </div>
      <div class="font-bold text-slate-800 line-clamp-2 hover:text-blue-600">${escapeHtml(issue.title)}</div>
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

// Bulk Selection and Execution logic
function toggleTaskSelection(id, isChecked) {
  if (isChecked) {
    selectedTaskIds.add(id);
  } else {
    selectedTaskIds.delete(id);
  }
  updateBulkBarUI();
}

function toggleSelectAllVisible() {
  if (!currentUser) return;
  const search = (document.getElementById('workbenchSearch').value || '').toLowerCase();
  const myAssigned = allIssues.filter(i => i.assignee_id === currentUser.id);
  const visible = myAssigned.filter(item => {
    const matchesSearch = !search || item.title.toLowerCase().includes(search) || item.issue_key.toLowerCase().includes(search);
    let matchesStatus = true;
    if (activeWorkbenchFilter === 'REVIEW') matchesStatus = item.status === 'IN REVIEW';
    else if (activeWorkbenchFilter === 'PENDING') matchesStatus = item.status === 'TO DO';
    else if (activeWorkbenchFilter === 'IN PROGRESS') matchesStatus = item.status === 'IN PROGRESS';
    else if (activeWorkbenchFilter === 'DONE') matchesStatus = item.status === 'DONE';
    return matchesSearch && matchesStatus;
  });

  const allVisibleSelected = visible.length > 0 && visible.every(i => selectedTaskIds.has(i.id));
  if (allVisibleSelected) {
    visible.forEach(i => selectedTaskIds.delete(i.id));
  } else {
    visible.forEach(i => selectedTaskIds.add(i.id));
  }
  renderWorkbenchDeliverables();
}

function clearBulkSelection() {
  selectedTaskIds.clear();
  renderWorkbenchDeliverables();
}

function updateBulkBarUI() {
  const bar = document.getElementById('bulkActionBar');
  const countEl = document.getElementById('bulkSelectedCount');
  const selectAllBtn = document.getElementById('btnSelectAll');
  const count = selectedTaskIds.size;

  if (countEl) countEl.textContent = count;
  if (bar) {
    if (count > 0) {
      bar.classList.remove('hidden');
    } else {
      bar.classList.add('hidden');
    }
  }

  if (selectAllBtn) {
    selectAllBtn.innerHTML = count > 0 ? `<i class="fa-solid fa-square-check mr-1.5 text-blue-600"></i> Selected (${count})` : `<i class="fa-regular fa-square-check mr-1.5 text-slate-400"></i> Select All`;
  }
}

async function singleDuplicateTask(id) {
  selectedTaskIds.clear();
  selectedTaskIds.add(id);
  await executeBulkAction('duplicate');
}

async function singleDeleteTask(id) {
  selectedTaskIds.clear();
  selectedTaskIds.add(id);
  await executeBulkAction('delete');
}

async function executeBulkAction(action) {
  const ids = Array.from(selectedTaskIds);
  if (ids.length === 0) return;

  if (action === 'delete') {
    const ok = confirm(`Are you sure you want to permanently delete ${ids.length} task(s)? This cannot be undone.`);
    if (!ok) return;
  }

  try {
    const res = await fetch('/api/issues/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
      body: JSON.stringify({ action, issue_ids: ids })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message || 'Action executed successfully');
      selectedTaskIds.clear();
      await loadIssues();
    } else {
      showToast(data.error || 'Bulk action failed', true);
    }
  } catch (err) {
    showToast('Failed to execute bulk action', true);
  }
}

function openBulkChangeEventModal() {
  const ids = Array.from(selectedTaskIds);
  if (ids.length === 0) return;

  document.getElementById('bulkModalTaskCount').textContent = ids.length;
  const select = document.getElementById('bulkTargetProjectSelect');
  if (select && allProjects.length > 0) {
    select.innerHTML = allProjects.map(p => `
      <option value="${p.id}">${escapeHtml(p.name)} (${p.key})</option>
    `).join('');
  }
  openModal('bulkChangeEventModal');
}

async function confirmBulkChangeEvent() {
  const ids = Array.from(selectedTaskIds);
  const targetProjectId = parseInt(document.getElementById('bulkTargetProjectSelect').value);
  if (ids.length === 0 || !targetProjectId) return;

  try {
    const res = await fetch('/api/issues/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
      body: JSON.stringify({ action: 'change_event', issue_ids: ids, project_id: targetProjectId })
    });
    const data = await res.json();
    if (res.ok) {
      closeModal('bulkChangeEventModal');
      showToast(data.message || 'Tasks moved to new event');
      selectedTaskIds.clear();
      await loadIssues();
    } else {
      showToast(data.error || 'Failed to move tasks', true);
    }
  } catch (err) {
    showToast('Failed to change event', true);
  }
}

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

// Sheet Sync Trigger & State Toggle
let isSyncActive = false;

async function loadSyncSettings() {
  try {
    const res = await fetch('/api/sync/status');
    if (res.ok) {
      const data = await res.json();
      isSyncActive = data.auto_sync_enabled === 1;
      updateSyncToggleUI();

      const autoSheetUrl = document.getElementById('autoSheetUrl');
      const autoSyncCheckbox = document.getElementById('autoSyncCheckbox');
      if (autoSheetUrl && data.sheet_url) autoSheetUrl.value = data.sheet_url;
      if (autoSyncCheckbox) autoSyncCheckbox.checked = isSyncActive;
    }
  } catch (e) {
    console.error('Error loading sync settings:', e);
  }
}

function updateSyncToggleUI() {
  const btn = document.getElementById('syncToggleBtn');
  const dot = document.getElementById('syncStatusDot');
  const txt = document.getElementById('syncStatusText');
  const quickBtn = document.getElementById('quickSyncBtn');

  if (isSyncActive) {
    if (btn) btn.className = 'flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold transition bg-emerald-100 text-emerald-800 hover:bg-emerald-200';
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse';
    if (txt) txt.textContent = 'Sync: Active';
    if (quickBtn) quickBtn.classList.remove('opacity-50', 'pointer-events-none');
  } else {
    if (btn) btn.className = 'flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold transition bg-slate-200 text-slate-600 hover:bg-slate-300';
    if (dot) dot.className = 'w-2 h-2 rounded-full bg-slate-400';
    if (txt) txt.textContent = 'Sync: Paused';
  }
}

let pendingSyncAction = null; // 'toggle' or 'trigger'

function openSyncPasswordModal(action) {
  pendingSyncAction = action;
  const input = document.getElementById('syncPasswordInput');
  const errorEl = document.getElementById('syncPasswordError');
  const promptEl = document.getElementById('syncPasswordPrompt');
  if (input) input.value = '';
  if (errorEl) {
    errorEl.textContent = '';
    errorEl.classList.add('hidden');
  }
  if (promptEl) {
    promptEl.textContent = action === 'toggle' 
      ? `Enter admin password to ${isSyncActive ? 'pause' : 'activate'} sheet synchronization:` 
      : 'Enter admin password to trigger instant sheet sync:';
  }
  openModal('syncPasswordModal');
  setTimeout(() => { if (input) input.focus(); }, 150);
}

async function handleSyncPasswordSubmit(e) {
  e.preventDefault();
  const password = document.getElementById('syncPasswordInput').value;
  const errorEl = document.getElementById('syncPasswordError');
  const submitBtn = document.getElementById('syncPasswordSubmitBtn');

  if (submitBtn) submitBtn.disabled = true;

  try {
    if (pendingSyncAction === 'toggle') {
      const newState = !isSyncActive;
      const res = await fetch('/api/sync/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_sync_enabled: newState ? 1 : 0, password })
      });
      const data = await res.json();
      if (res.ok) {
        closeModal('syncPasswordModal');
        isSyncActive = newState;
        updateSyncToggleUI();
        showToast(isSyncActive ? 'Google Sheet synchronization activated!' : 'Sheet synchronization paused.');
      } else {
        if (errorEl) {
          errorEl.textContent = data.error || 'Incorrect password. Access denied.';
          errorEl.classList.remove('hidden');
        }
      }
    } else if (pendingSyncAction === 'trigger') {
      const icon = document.getElementById('syncIcon');
      if (icon) icon.classList.add('fa-spin');
      const res = await fetch('/api/sync/trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      const data = await res.json();
      if (res.ok && data.status === 'success') {
        closeModal('syncPasswordModal');
        showToast('All deliverables synchronized successfully!');
        await loadUsers();
        await loadIssues();
      } else {
        if (errorEl) {
          errorEl.textContent = data.message || data.error || 'Incorrect password. Access denied.';
          errorEl.classList.remove('hidden');
        }
      }
      if (icon) icon.classList.remove('fa-spin');
    }
  } catch (err) {
    if (errorEl) {
      errorEl.textContent = 'Network or server error occurred.';
      errorEl.classList.remove('hidden');
    }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

async function toggleSyncMasterState() {
  openSyncPasswordModal('toggle');
}

async function triggerSheetSync() {
  openSyncPasswordModal('trigger');
}

async function saveSyncSettings(e) {
  e.preventDefault();
  const sheet_url = document.getElementById('autoSheetUrl').value.trim();
  const auto_sync_enabled = document.getElementById('autoSyncCheckbox').checked;

  try {
    const res = await fetch('/api/sync/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sheet_url, auto_sync_enabled })
    });
    if (res.ok) {
      showToast('Sheet Automation settings saved!');
      await loadSyncSettings();
    }
  } catch (err) {
    showToast('Error saving sync settings', true);
  }
}

// Modals
function openNewProjectModal() {
  document.getElementById('newProjectName').value = '';
  document.getElementById('newProjectKey').value = '';
  document.getElementById('newProjectDesc').value = '';
  openModal('newProjectModal');
}

async function submitNewProject(e) {
  e.preventDefault();
  const name = document.getElementById('newProjectName').value.trim();
  const key = document.getElementById('newProjectKey').value.trim().toUpperCase();
  const description = document.getElementById('newProjectDesc').value.trim();

  if (!name) return;

  try {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
      body: JSON.stringify({ name, key, description })
    });
    const data = await res.json();
    if (res.ok) {
      showToast(`Event "${name}" added!`);
      closeModal('newProjectModal');
      await loadProjects();
      const projSelect = document.getElementById('createIssueProject');
      if (projSelect && data.id) {
        projSelect.value = data.id;
      }
    } else {
      showToast(data.error || 'Failed to add event', true);
    }
  } catch (err) {
    showToast('Failed to add event', true);
  }
}

function openCreateIssueModal() {
  const projSelect = document.getElementById('createIssueProject');
  if (projSelect && allProjects.length > 0 && projSelect.children.length === 0) {
    projSelect.innerHTML = allProjects.map(p => `
      <option value="${p.id}">${escapeHtml(p.name)} (${p.key})</option>
    `).join('');
  }
  openModal('createIssueModal');
}

let isSubmittingIssue = false;

async function submitNewIssue(e) {
  e.preventDefault();
  if (isSubmittingIssue) return;

  const submitBtn = document.getElementById('createIssueSubmitBtn');
  const btnText = document.getElementById('createIssueBtnText');

  const titleInput = document.getElementById('createIssueTitle');
  const title = titleInput ? titleInput.value.trim() : '';
  if (!title) {
    showToast('Task title is required', true);
    return;
  }

  const project_id = document.getElementById('createIssueProject').value;
  const category = document.getElementById('createIssueCategory').value;
  const priority = document.getElementById('createIssuePriority').value;
  const assignee_id = document.getElementById('createIssueAssignee').value;
  const reporter_id = document.getElementById('createIssueReporter').value;
  const itype = document.getElementById('createIssueType') ? document.getElementById('createIssueType').value : 'Task';
  const original_estimate_hours = document.getElementById('createIssueEstimate') ? parseFloat(document.getElementById('createIssueEstimate').value) || 0 : 0;
  const description = document.getElementById('createIssueDesc') ? document.getElementById('createIssueDesc').value : '';

  isSubmittingIssue = true;
  if (submitBtn) submitBtn.disabled = true;
  if (btnText) btnText.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i> Creating...';

  try {
    const res = await fetch('/api/issues', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${currentToken}` },
      body: JSON.stringify({
        title,
        project_id,
        category,
        priority,
        assignee_id,
        reporter_id,
        type: itype,
        original_estimate_hours,
        description
      })
    });
    if (res.ok) {
      closeModal('createIssueModal');
      showToast('Task created successfully');
      // Reset form fields
      if (titleInput) titleInput.value = '';
      const descEl = document.getElementById('createIssueDesc');
      if (descEl) descEl.value = '';
      await loadIssues();
    } else {
      const err = await res.json();
      showToast(err.error || 'Failed to create task', true);
    }
  } catch (err) {
    showToast('Error creating task', true);
  } finally {
    isSubmittingIssue = false;
    if (submitBtn) submitBtn.disabled = false;
    if (btnText) btnText.textContent = 'Create Task';
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

function openAddUserModal() {
  document.getElementById('addUserName').value = '';
  document.getElementById('addUserEmail').value = '';
  openModal('addUserModal');
}

async function submitNewUser(e) {
  e.preventDefault();
  const name = document.getElementById('addUserName').value.trim();
  const email = document.getElementById('addUserEmail').value.trim();
  const role = document.getElementById('addUserRole').value;

  if (!name) return;

  try {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify({ name, email, role })
    });
    const data = await res.json();
    if (res.ok) {
      closeModal('addUserModal');
      showToast(`User ${name} added successfully!`);
      await loadUsers();
      // Auto select in Create Modal if open
      const createAssignee = document.getElementById('createIssueAssignee');
      if (createAssignee && data.id) {
        createAssignee.value = data.id;
      }
    } else {
      showToast(data.error || 'Failed to add user', true);
    }
  } catch (err) {
    showToast('Network error creating user', true);
  }
}

// ----------------- TASK DETAILS MODAL -----------------
let currentSelectedTaskId = null;

async function openTaskDetails(taskId) {
  currentSelectedTaskId = taskId;
  try {
    const res = await fetch(`/api/issues/${taskId}`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    if (!res.ok) {
      // Fallback: try finding issue from in-memory allIssues list if live endpoint returns not found
      const localIssue = allIssues.find(i => i.id == taskId);
      if (localIssue) {
        populateTaskDetailModal(localIssue);
        openModal('taskDetailModal');
        return;
      }
      return showToast('Failed to load task details', true);
    }

    const issue = await res.json();
    populateTaskDetailModal(issue);
    openModal('taskDetailModal');
  } catch (err) {
    // Fallback on network/fetch error
    const localIssue = allIssues.find(i => i.id == taskId);
    if (localIssue) {
      populateTaskDetailModal(localIssue);
      openModal('taskDetailModal');
      return;
    }
    showToast('Failed to load task details', true);
  }
}

function populateTaskDetailModal(issue) {
  document.getElementById('taskDetailKey').textContent = issue.issue_key;
  document.getElementById('taskDetailCategory').textContent = issue.category || 'General';
  document.getElementById('taskDetailProject').textContent = issue.project_name || 'Event Project';
  document.getElementById('taskDetailTitle').textContent = issue.title;
  document.getElementById('taskDetailRemarks').textContent = issue.remarks || issue.description || 'No additional remarks.';
  
  const prioritySelect = document.getElementById('taskDetailPrioritySelect');
  if (prioritySelect) prioritySelect.value = issue.priority || 'Medium';

  document.getElementById('taskDetailEstimate').textContent = `${issue.original_estimate_hours || 0} hrs`;
  document.getElementById('taskDetailLogged').textContent = `${issue.total_time_logged || 0} hrs`;
  document.getElementById('taskDetailApproved').textContent = `${issue.approved_time_logged || 0} hrs`;
  document.getElementById('taskDetailStatusSelect').value = issue.status;

  // Populate Assignee Select
  const assigneeSelect = document.getElementById('taskDetailAssigneeSelect');
  if (assigneeSelect) {
    assigneeSelect.innerHTML = '<option value="">Unassigned</option>' + allUsers.map(u => `
      <option value="${u.id}" ${issue.assignee_id == u.id ? 'selected' : ''}>${escapeHtml(u.name)}</option>
    `).join('');
  }

  // Populate Reporter Select
  const reporterSelect = document.getElementById('taskDetailReporterSelect');
  if (reporterSelect) {
    reporterSelect.innerHTML = allUsers.map(u => `
      <option value="${u.id}" ${issue.reporter_id == u.id ? 'selected' : ''}>${escapeHtml(u.name)}</option>
    `).join('');
  }

  // Render Worklogs
  const logListEl = document.getElementById('taskDetailWorklogsList');
  if (!issue.worklogs || issue.worklogs.length === 0) {
    logListEl.innerHTML = '<div class="text-xs text-slate-400 italic py-2 text-center bg-slate-50 rounded-lg">No time logged on this task yet.</div>';
  } else {
    logListEl.innerHTML = issue.worklogs.map(log => `
      <div class="p-3 rounded-lg border border-slate-200 bg-white flex items-start justify-between text-xs hover:border-slate-300 transition">
        <div class="flex items-start space-x-2.5">
          <div class="w-6 h-6 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-[10px] mt-0.5">
            ${getInitials(log.user_name)}
          </div>
          <div>
            <div class="font-bold text-slate-800">${escapeHtml(log.user_name)} <span class="font-bold text-blue-600">logged ${log.time_spent_hours} hrs</span> on ${log.work_date}</div>
            <p class="text-slate-600 mt-0.5">${escapeHtml(log.description || 'No comment provided')}</p>
            ${log.manager_note ? `<div class="mt-1 text-[11px] bg-amber-50 border-l-2 border-amber-400 pl-2 py-0.5 text-amber-800 rounded-r"><strong>Manager Feedback:</strong> ${escapeHtml(log.manager_note)}</div>` : ''}
          </div>
        </div>
        <span class="text-[10px] px-2 py-0.5 rounded font-bold uppercase ${log.status === 'approved' ? 'bg-emerald-100 text-emerald-800' : (log.status === 'rejected' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800')}">
          ${log.status}
        </span>
      </div>
    `).join('');
  }
}

async function updateTaskFieldFromDetailModal(fieldName, val) {
  if (!currentSelectedTaskId) return;

  const payload = {};
  if (fieldName === 'assignee_id') payload.assignee_id = val ? parseInt(val) : null;
  else if (fieldName === 'reporter_id') payload.reporter_id = val ? parseInt(val) : null;
  else payload[fieldName] = val;

  try {
    const res = await fetch(`/api/issues/${currentSelectedTaskId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`
      },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      showToast(`Deliverable updated successfully!`);
      await loadIssues();
    } else {
      showToast('Failed to update field', true);
    }
  } catch (err) {
    showToast('Network error updating field', true);
  }
}

async function updateTaskStatusFromDetailModal() {
  const newStatus = document.getElementById('taskDetailStatusSelect').value;
  await updateTaskFieldFromDetailModal('status', newStatus);
}

function openLogWorkFromTaskDetail() {
  if (currentSelectedTaskId) {
    closeModal('taskDetailModal');
    openLogWorkModal(currentSelectedTaskId);
  }
}

function openModal(id) { const el = document.getElementById(id); if (el) el.classList.remove('hidden'); }
function closeModal(id) { const el = document.getElementById(id); if (el) el.classList.add('hidden'); }

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

