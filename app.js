let currentDonorsData = [];
let searchDebounceTimer = null;
let isAdminLoggedIn = false;

document.addEventListener('DOMContentLoaded', () => {
    fetch('/api/visit', { method: 'POST' });
    fetchEmergencyBroadcast();
    loadDonors();

    const filterGroup = document.getElementById('filter-blood-group');
    const searchInput = document.getElementById('search-input');

    if (filterGroup) {
        filterGroup.addEventListener('change', () => searchDonors());
    }

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            clearTimeout(searchDebounceTimer);
            searchDebounceTimer = setTimeout(() => { searchDonors(); }, 300);
        });
    }

    const form = document.getElementById('registration-form');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const formData = {
                full_name: document.getElementById('full_name').value,
                blood_group: document.getElementById('blood_group').value,
                contact_preference: document.getElementById('contact_preference').value,
                phone: document.getElementById('phone').value,
                email: document.getElementById('email').value,
                last_donated_date: document.getElementById('last_donated_date').value,
                consent: document.getElementById('consent').checked
            };

            try {
                const response = await fetch('/api/donors', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                });

                const result = await response.json();

                if (response.ok) {
                    showRegistrationSlip(result.donor, false);
                    form.reset();
                    loadDonors();
                } else {
                    showAlert(result.error || 'Failed to register donor.', 'error');
                }
            } catch (err) {
                showAlert('Network error. Please try again.', 'error');
            }
        });
    }
});

function switchTab(pageId) {
    document.querySelectorAll('.page-view').forEach(view => view.classList.remove('active-view'));
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));

    const targetView = document.getElementById(pageId);
    if (targetView) targetView.classList.add('active-view');

    const activeBtn = document.querySelector(`.nav-btn[onclick*="'${pageId}'"]`);
    if (activeBtn) {
        activeBtn.classList.add('active');
    }

    if (pageId === 'directory-page') {
        searchDonors();
    }
}

async function loadDonors() {
    searchDonors();
}

async function fetchEmergencyBroadcast() {
    try {
        const res = await fetch('/api/alert');
        const data = await res.json();
        const banner = document.getElementById('emergency-banner');
        const switchEl = document.getElementById('broadcast-toggle-switch');
        const msgInput = document.getElementById('broadcast-msg-input');

        if (switchEl) switchEl.checked = !!data.active;
        if (msgInput && data.alert) msgInput.value = data.alert;

        if (data.active && data.alert && data.alert.trim() !== '') {
            document.getElementById('alert-text').textContent = data.alert;
            banner.style.display = 'flex';
        } else {
            banner.style.display = 'none';
        }
    } catch (e) { console.error(e); }
}

async function updateEmergencyBroadcast() {
    const text = document.getElementById('broadcast-msg-input').value;
    const isActive = document.getElementById('broadcast-toggle-switch').checked;

    try {
        const res = await fetch('/api/admin/alert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: text, active: isActive })
        });
        if (res.ok) {
            showAlert('Broadcast alert updated successfully!', 'success');
            fetchEmergencyBroadcast();
        }
    } catch (e) { alert('Broadcast update failed.'); }
}

async function searchDonors() {
    const searchEl = document.getElementById('search-input');
    const groupEl = document.getElementById('filter-blood-group');

    const search = searchEl ? searchEl.value.trim() : '';
    const bloodGroup = groupEl ? groupEl.value.trim() : '';

    const url = new URL('/api/donors/search', window.location.origin);
    if (search) url.searchParams.append('search', search);
    if (bloodGroup) url.searchParams.append('blood_group', bloodGroup);

    const tbody = document.getElementById('donors-list');
    if (!tbody) return;

    try {
        const response = await fetch(url);
        let fetchedDonors = await response.json();

        if (!Array.isArray(fetchedDonors)) {
            fetchedDonors = [];
        }

        if (bloodGroup && bloodGroup !== '') {
            fetchedDonors = fetchedDonors.filter(d => d && String(d.blood_group).toUpperCase() === String(bloodGroup).toUpperCase());
        }

        currentDonorsData = fetchedDonors;
        tbody.innerHTML = '';

        if (currentDonorsData.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" style="text-align:center; padding: 25px; color: var(--gray-text); font-weight: 600;">
                        <i class="fa-solid fa-circle-exclamation" style="font-size: 1.5em; color: var(--primary-red); margin-bottom: 8px; display: block;"></i>
                        No verified donors found matching criteria.
                    </td>
                </tr>`;
            return;
        }

        currentDonorsData.forEach(donor => {
            const tr = document.createElement('tr');

            let availabilityBadge = '<span class="badge badge-eligible"><i class="fa-solid fa-check-circle"></i> Eligible Now</span>';
            if (donor.last_donated_date) {
                const lastDate = new Date(donor.last_donated_date);
                const diffDays = Math.floor((new Date() - lastDate) / (1000 * 60 * 60 * 24));
                if (diffDays < 90) {
                    availabilityBadge = `<span class="badge badge-cooldown"><i class="fa-solid fa-clock"></i> Cooldown (${90 - diffDays}d left)</span>`;
                }
            }

            const rawPhone = donor.phone || '';
            const phoneClean = rawPhone.replace(/[^0-9]/g, '');
            const phoneAction = rawPhone ? `<a href="tel:${phoneClean}" class="btn btn-small" style="padding:5px 10px;"><i class="fa-solid fa-phone"></i> Call</a>` : '';
            const waAction = rawPhone ? `<a href="https://wa.me/234${phoneClean.slice(-10)}?text=Emergency%20Blood%20Request" target="_blank" class="btn btn-small btn-wa" style="padding:5px 10px;"><i class="fa-brands fa-whatsapp"></i> WhatsApp</a>` : '';
            const safeDonorJson = JSON.stringify(donor).replace(/'/g, "'");
            const passAction = `<button class="btn btn-navy btn-small" style="padding:5px 10px;" onclick='showRegistrationSlip(${safeDonorJson}, true)'><i class="fa-solid fa-id-card"></i> Pass</button>`;

            tr.innerHTML = `
                <td><strong>${escapeHtml(donor.full_name)}</strong></td>
                <td><span class="badge badge-approved">${escapeHtml(donor.blood_group)}</span></td>
                <td>${availabilityBadge}</td>
                <td>${escapeHtml(donor.contact_preference)}</td>
                <td>${phoneAction} ${waAction} ${passAction}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error('Error fetching donors:', err);
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: var(--primary-red);">Error loading directory records.</td></tr>';
    }
}

async function loginAdmin() {
    const usernameInput = document.getElementById('admin-username').value;
    const passwordInput = document.getElementById('admin-password').value;

    try {
        const response = await fetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: usernameInput, password: passwordInput })
        });

        if (response.ok) {
            isAdminLoggedIn = true;
            document.getElementById('admin-toggle-btn').style.display = 'none';
            document.getElementById('admin-active-btn').style.display = 'inline-block';
            switchTab('admin-dashboard-page');
            loadAdminDonors();
            loadAdminUsers();
            loadLogs();
        } else {
            alert('Invalid credentials. Use admin / admin123');
        }
    } catch (err) { alert('Login failed.'); }
}

async function loadAdminDonors() {
    try {
        const response = await fetch('/api/admin/donors');
        const data = await response.json();
        const donors = data.donors || [];

        if (data.stats) {
            document.getElementById('stat-total').textContent = data.stats.total;
            document.getElementById('stat-approved').textContent = data.stats.approved;
            document.getElementById('stat-pending').textContent = data.stats.pending;
            document.getElementById('stat-top-group').textContent = data.stats.topGroup;
        }

        const tbody = document.getElementById('admin-donors-list');
        tbody.innerHTML = '';

        if (donors.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">No donor applications available.</td></tr>';
            return;
        }

        donors.forEach(donor => {
            const tr = document.createElement('tr');
            const statusLower = (donor.status || '').toLowerCase();
            const isApproved = statusLower === 'approved' || statusLower === 'active';

            const approveBtn = !isApproved ? `<button class="btn btn-green btn-small" onclick="updateDonorStatus(${donor.id}, 'approved')"><i class="fa-solid fa-check"></i> Approve</button>` : '';
            const deactivateBtn = isApproved ? `<button class="btn btn-small" style="background:#f39c12;" onclick="updateDonorStatus(${donor.id}, 'deactivated')"><i class="fa-solid fa-pause"></i> Deactivate</button>` : '';
            const deleteBtn = `<button class="btn btn-small" style="background:#e74c3c;" onclick="deleteDonorRecord(${donor.id}, '${escapeHtml(donor.full_name)}')"><i class="fa-solid fa-trash"></i> Delete</button>`;

            tr.innerHTML = `
                <td>${escapeHtml(donor.full_name)}</td>
                <td><strong>${escapeHtml(donor.blood_group)}</strong></td>
                <td>${escapeHtml(donor.phone || donor.email || 'N/A')}</td>
                <td><span class="badge badge-${statusLower}">${escapeHtml(donor.status)}</span></td>
                <td>${approveBtn} ${deactivateBtn} ${deleteBtn}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) { console.error(err); }
}

async function updateDonorStatus(id, newStatus) {
    try {
        const response = await fetch(`/api/admin/donors/${id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: newStatus })
        });
        if (response.ok) {
            showAlert(`Donor status updated to '${newStatus}'.`, 'success');
            loadAdminDonors();
            searchDonors();
        }
    } catch (err) { showAlert('Network error.', 'error'); }
}

async function deleteDonorRecord(id, name) {
    if (!confirm(`Are you sure you want to permanently delete the donor record for '${name}'? This cannot be undone.`)) return;

    try {
        const response = await fetch(`/api/admin/donors/${id}`, {
            method: 'DELETE'
        });

        if (response.ok) {
            showAlert(`Donor record '${name}' permanently deleted.`, 'success');
            loadAdminDonors();
            searchDonors();
        } else {
            const result = await response.json();
            showAlert(result.error || 'Failed to delete donor record.', 'error');
        }
    } catch (err) {
        showAlert('Network error.', 'error');
    }
}

async function loadAdminUsers() {
    try {
        const response = await fetch('/api/admin/users');
        const admins = await response.json();

        const tbody = document.getElementById('admin-users-list');
        if (!tbody) return;
        tbody.innerHTML = '';

        admins.forEach(admin => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${admin.id}</td>
                <td><strong>${escapeHtml(admin.username)}</strong></td>
                <td>${new Date(admin.created_at).toLocaleDateString()}</td>
                <td>
                    <button class="btn btn-small" style="background:#e74c3c;" onclick="removeAdmin(${admin.id}, '${escapeHtml(admin.username)}')">
                        <i class="fa-solid fa-trash"></i> Remove
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error('Error fetching admins:', err);
    }
}

async function addNewAdmin() {
    const usernameInput = document.getElementById('new-admin-username');
    const passwordInput = document.getElementById('new-admin-password');

    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();

    if (!username || !password) {
        alert('Please enter both username and password.');
        return;
    }

    try {
        const response = await fetch('/api/admin/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const result = await response.json();

        if (response.ok) {
            showAlert(`Admin '${username}' added successfully!`, 'success');
            usernameInput.value = '';
            passwordInput.value = '';
            loadAdminUsers();
        } else {
            alert(result.error || 'Failed to add admin.');
        }
    } catch (err) {
        alert('Network error.');
    }
}

async function removeAdmin(id, username) {
    if (!confirm(`Are you sure you want to remove admin account '${username}'?`)) return;

    try {
        const response = await fetch(`/api/admin/users/${id}`, {
            method: 'DELETE'
        });

        const result = await response.json();

        if (response.ok) {
            showAlert(`Admin '${username}' removed successfully.`, 'success');
            loadAdminUsers();
        } else {
            alert(result.error || 'Failed to remove admin.');
        }
    } catch (err) {
        alert('Network error.');
    }
}

async function exportToCSV() {
    let recordsToExport = currentDonorsData;

    if (!Array.isArray(recordsToExport) || recordsToExport.length === 0) {
        try {
            const res = await fetch('/api/donors/search');
            recordsToExport = await res.json();
        } catch (e) {
            alert('Failed to retrieve records for export.');
            return;
        }
    }

    if (!Array.isArray(recordsToExport) || recordsToExport.length === 0) {
        alert('No approved donor records available to export.');
        return;
    }

    let csvRows = [
        "Name,Blood Group,Contact Preference,Phone,Email,Status"
    ];

    recordsToExport.forEach(d => {
        const name = `"${(d.full_name || '').replace(/"/g, '""')}"`;
        const group = `"${d.blood_group || ''}"`;
        const pref = `"${d.contact_preference || ''}"`;
        const phone = d.phone ? `="${d.phone}"` : '""';
        const email = `"${(d.email || '').replace(/"/g, '""')}"`;
        const status = `"VERIFIED"`;

        csvRows.push([name, group, pref, phone, email, status].join(','));
    });

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'Approved_Blood_Donors_Export.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

async function printAdminReport() {
    let records = currentDonorsData;
    if (!Array.isArray(records) || records.length === 0) {
        const res = await fetch('/api/donors/search');
        records = await res.json();
    }

    document.getElementById('report-print-date').textContent = 'Date: ' + new Date().toLocaleDateString();
    const tbody = document.getElementById('print-report-tbody');
    tbody.innerHTML = '';

    records.forEach(d => {
        tbody.innerHTML += `
            <tr>
                <td>#${d.id}</td>
                <td><strong>${escapeHtml(d.full_name)}</strong></td>
                <td>${escapeHtml(d.blood_group)}</td>
                <td>${escapeHtml(d.contact_preference)}</td>
                <td>${escapeHtml(d.phone || 'N/A')}</td>
                <td>${escapeHtml(d.email || 'N/A')}</td>
            </tr>
        `;
    });

    document.body.classList.add('printing-report');
    window.print();
    document.body.classList.remove('printing-report');
}

function showRegistrationSlip(donor, isApproved = false) {
    document.getElementById('slip-id').textContent = '#' + (donor.id || '101');
    document.getElementById('slip-name').textContent = donor.full_name || '-';
    document.getElementById('slip-group').textContent = donor.blood_group || '-';
    document.getElementById('slip-pref').textContent = donor.contact_preference || 'Phone';
    document.getElementById('slip-date').textContent = new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });

    const statusContainer = document.getElementById('slip-status-badge');
    if (statusContainer) {
        if (isApproved) {
            statusContainer.innerHTML = `<span class="badge badge-approved"><i class="fa-solid fa-circle-check"></i> VERIFIED & APPROVED</span>`;
        } else {
            statusContainer.innerHTML = `<span class="badge badge-pending">Pending Verification</span>`;
        }
    }
    
    document.getElementById('receipt-modal').style.display = 'flex';
}

function closeModal() {
    document.getElementById('receipt-modal').style.display = 'none';
}

async function loadLogs() {
    try {
        const response = await fetch('/api/admin/logs');
        const logs = await response.json();
        const tbody = document.getElementById('logs-list');
        tbody.innerHTML = '';
        logs.forEach(log => {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td>${log.id}</td><td>${escapeHtml(log.action)}</td><td>${escapeHtml(log.ip_address)}</td><td>${new Date(log.created_at).toLocaleString()}</td>`;
            tbody.appendChild(tr);
        });
    } catch (err) { console.error(err); }
}

function logoutAdmin() {
    isAdminLoggedIn = false;
    document.getElementById('admin-username').value = '';
    document.getElementById('admin-password').value = '';
    document.getElementById('admin-toggle-btn').style.display = 'inline-block';
    document.getElementById('admin-active-btn').style.display = 'none';
    switchTab('register-page');
}

function showAlert(message, type) {
    const box = document.getElementById('alert-box');
    if (!box) return;
    box.textContent = message;
    box.className = `alert alert-${type}`;
    box.style.display = 'block';
    setTimeout(() => { box.style.display = 'none'; }, 4000);
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&')
        .replace(/</g, '<')
        .replace(/>/g, '>')
        .replace(/"/g, '"')
        .replace(/'/g, ',');
}