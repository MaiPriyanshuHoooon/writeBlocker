document.addEventListener('DOMContentLoaded', () => {
    
    // --- State ---
    let isWindows = false;
    let isAdmin = false;
    let globalEnabled = false;

    // --- DOM Elements ---
    const osTypeEl = document.getElementById('osType');
    const adminStatusEl = document.getElementById('adminStatus');
    
    const globalStatusBanner = document.getElementById('globalStatusBanner');
    const globalStatusIndicator = document.getElementById('globalStatusIndicator');
    const globalStatusText = document.getElementById('globalStatusText');
    
    const globalBlockToggle = document.getElementById('globalBlockToggle');
    const globalToggleLabel = document.getElementById('globalToggleLabel');
    const refreshGlobalBtn = document.getElementById('refreshGlobalBtn');
    
    const diskTableBody = document.getElementById('diskTableBody');
    const refreshDisksBtn = document.getElementById('refreshDisksBtn');
    
    const toastEl = document.getElementById('toast');
    const toastMessage = document.getElementById('toastMessage');

    // --- Initialization ---
    init();

    async function init() {
        await checkSystemInfo();
        await fetchGlobalStatus();
        await fetchDisks();

        // Polling
        setInterval(fetchDisks, 10000); // Poll disks every 10s
    }

    // --- Event Listeners ---
    refreshGlobalBtn.addEventListener('click', fetchGlobalStatus);
    refreshDisksBtn.addEventListener('click', fetchDisks);
    
    globalBlockToggle.addEventListener('change', async (e) => {
        const enable = e.target.checked;
        globalBlockToggle.disabled = true;
        
        try {
            const res = await fetch('/api/set_global', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enable })
            });
            const data = await res.json();
            
            if (data.success) {
                showToast(data.message, 'success');
                await fetchGlobalStatus();
            } else {
                showToast(data.message, 'error');
                globalBlockToggle.checked = !enable; // Revert
            }
        } catch (err) {
            showToast('Failed to communicate with server', 'error');
            globalBlockToggle.checked = !enable;
        } finally {
            globalBlockToggle.disabled = false;
        }
    });

    // --- Core Functions ---
    async function checkSystemInfo() {
        try {
            const res = await fetch('/api/system_info');
            const data = await res.json();
            
            isWindows = data.is_windows;
            isAdmin = data.is_admin;

            osTypeEl.textContent = isWindows ? 'Windows' : 'Unix/Mac';
            osTypeEl.className = isWindows ? 'status-value text-success' : 'status-value text-warning';

            adminStatusEl.textContent = isAdmin ? 'Elevated (Admin)' : 'Standard User';
            adminStatusEl.className = isAdmin ? 'status-value text-success' : 'status-value text-danger';

            if (!isWindows) {
                showToast('Not running on Windows. Simulation mode only.', 'error');
            } else if (!isAdmin) {
                showToast('Administrator rights required for full functionality.', 'error');
                globalBlockToggle.disabled = true;
            }

        } catch (err) {
            console.error(err);
        }
    }

    async function fetchGlobalStatus() {
        refreshGlobalBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Refreshing';
        refreshGlobalBtn.disabled = true;

        try {
            const res = await fetch('/api/status');
            const data = await res.json();
            
            if (data.enabled === true) {
                globalEnabled = true;
                updateGlobalBanner(true, 'System Write Protection ENABLED');
                globalBlockToggle.checked = true;
                globalToggleLabel.textContent = "Global Block Active";
                globalToggleLabel.className = "toggle-label text-success";
            } else if (data.enabled === false) {
                globalEnabled = false;
                updateGlobalBanner(false, 'System Write Protection DISABLED');
                globalBlockToggle.checked = false;
                globalToggleLabel.textContent = "Global Block Inactive";
                globalToggleLabel.className = "toggle-label text-danger";
            } else {
                updateGlobalBanner(null, data.error || 'Unknown Error');
                globalBlockToggle.disabled = true;
            }
            
            if(isWindows && isAdmin) {
                globalBlockToggle.disabled = false;
            }

        } catch (err) {
            updateGlobalBanner(null, 'Connection Error');
        } finally {
            refreshGlobalBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Refresh';
            refreshGlobalBtn.disabled = false;
        }
    }

    async function fetchDisks() {
        refreshDisksBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Scanning';
        refreshDisksBtn.disabled = true;

        try {
            const res = await fetch('/api/disks');
            const disks = await res.json();
            
            diskTableBody.innerHTML = '';
            
            if (!disks || disks.length === 0) {
                diskTableBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No USB disks detected</td></tr>`;
                return;
            }

            disks.forEach(disk => {
                const tr = document.createElement('tr');
                
                const statusBadge = disk.is_readonly 
                    ? '<span class="badge badge-safe"><i class="fa-solid fa-lock"></i> Write-Blocked</span>'
                    : '<span class="badge badge-danger"><i class="fa-solid fa-lock-open"></i> Read-Write (Vulnerable)</span>';

                const actionBtn = disk.is_readonly
                    ? `<button class="btn btn-sm btn-danger unblock-btn" data-num="${disk.number}"><i class="fa-solid fa-unlock"></i> Unblock</button>`
                    : `<button class="btn btn-sm btn-success block-btn" data-num="${disk.number}"><i class="fa-solid fa-lock"></i> Block</button>`;

                tr.innerHTML = `
                    <td><strong>#${disk.number}</strong></td>
                    <td>${disk.name}</td>
                    <td>${disk.size_gb} GB</td>
                    <td>${statusBadge}</td>
                    <td>
                        <div style="display:flex; gap: 8px;">
                            ${actionBtn}
                            <button class="btn btn-sm btn-secondary cycle-btn" data-num="${disk.number}" title="Cycle Offline/Online to apply changes"><i class="fa-solid fa-power-off"></i></button>
                        </div>
                    </td>
                `;
                diskTableBody.appendChild(tr);
            });

            // Attach event listeners to new buttons
            document.querySelectorAll('.block-btn').forEach(btn => {
                btn.addEventListener('click', () => setDiskReadonly(btn.dataset.num, true));
            });
            document.querySelectorAll('.unblock-btn').forEach(btn => {
                btn.addEventListener('click', () => setDiskReadonly(btn.dataset.num, false));
            });
            document.querySelectorAll('.cycle-btn').forEach(btn => {
                btn.addEventListener('click', () => cycleDisk(btn.dataset.num));
            });

        } catch (err) {
            diskTableBody.innerHTML = `<tr><td colspan="5" class="text-center text-danger">Error fetching disks</td></tr>`;
        } finally {
            refreshDisksBtn.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Scan Disks';
            refreshDisksBtn.disabled = false;
        }
    }

    async function setDiskReadonly(diskNumber, readonly) {
        try {
            const res = await fetch('/api/set_disk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ disk_number: parseInt(diskNumber), readonly })
            });
            const data = await res.json();
            
            if (data.success) {
                showToast(data.message, 'success');
                await fetchDisks(); // Refresh list immediately
            } else {
                showToast(data.message, 'error');
            }
        } catch (err) {
            showToast('Request failed', 'error');
        }
    }

    async function cycleDisk(diskNumber) {
        try {
            showToast(`Cycling disk #${diskNumber} offline/online...`, 'success');
            const res = await fetch('/api/cycle_disk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ disk_number: parseInt(diskNumber) })
            });
            const data = await res.json();
            
            if (data.success) {
                showToast(data.message, 'success');
                setTimeout(fetchDisks, 1000);
            } else {
                showToast(data.message, 'error');
            }
        } catch (err) {
            showToast('Cycle request failed', 'error');
        }
    }

    // --- UI Helpers ---
    function updateGlobalBanner(isSafe, text) {
        globalStatusText.textContent = text;
        globalStatusBanner.style.border = isSafe === true ? '1px solid var(--success)' : 
                                          isSafe === false ? '1px solid var(--danger)' : '1px solid var(--warning)';
        
        globalStatusIndicator.className = 'status-indicator ' + 
            (isSafe === true ? 'safe' : isSafe === false ? 'danger' : '');
    }

    let toastTimeout;
    function showToast(msg, type = 'info') {
        toastMessage.textContent = msg;
        toastEl.className = `toast glass show ${type}`;
        
        // Icon update
        const icon = toastEl.querySelector('.toast-icon');
        if(type === 'success') icon.className = 'fa-solid fa-circle-check toast-icon';
        else if(type === 'error') icon.className = 'fa-solid fa-triangle-exclamation toast-icon';
        else icon.className = 'fa-solid fa-circle-info toast-icon';

        clearTimeout(toastTimeout);
        toastTimeout = setTimeout(() => {
            toastEl.classList.remove('show');
        }, 5000);
    }
});
