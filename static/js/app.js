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
    const internalDiskTableBody = document.getElementById('internalDiskTableBody');
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
            internalDiskTableBody.innerHTML = '';
            
            if (!disks || disks.length === 0) {
                diskTableBody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No external disks detected</td></tr>`;
                internalDiskTableBody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No internal disks detected</td></tr>`;
                return;
            }

            let externalCount = 0;
            let internalCount = 0;

            disks.forEach(disk => {
                const tr = document.createElement('tr');
                
                const statusBadge = disk.is_readonly 
                    ? '<span class="badge badge-safe"><i class="fa-solid fa-lock"></i> Write-Blocked</span>'
                    : '<span class="badge badge-danger"><i class="fa-solid fa-lock-open"></i> Read-Write (Vulnerable)</span>';

                const actionBtn = disk.is_readonly
                    ? `<button class="btn btn-sm btn-danger unblock-btn" data-num="${disk.number}"><i class="fa-solid fa-unlock"></i> Unblock</button>`
                    : `<button class="btn btn-sm btn-success block-btn" data-num="${disk.number}"><i class="fa-solid fa-lock"></i> Block</button>`;

                const letterBadge = disk.letters ? `<span class="badge" style="background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2)">${disk.letters}</span>` : '<span class="text-muted">-</span>';

                tr.innerHTML = `
                    <td><strong>#${disk.number}</strong></td>
                    <td>${letterBadge}</td>
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
                
                if (disk.bus.toLowerCase() === 'usb' || disk.bus.toLowerCase() === '1394') {
                    diskTableBody.appendChild(tr);
                    externalCount++;
                } else {
                    internalDiskTableBody.appendChild(tr);
                    internalCount++;
                }
            });
            
            if (externalCount === 0) diskTableBody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No external drives detected</td></tr>`;
            if (internalCount === 0) internalDiskTableBody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No internal drives detected</td></tr>`;

            // Attach event listeners to new buttons
            document.querySelectorAll('.block-btn').forEach(btn => {
                btn.addEventListener('click', (e) => setDiskReadonly(btn.dataset.num, true, e.currentTarget));
            });
            document.querySelectorAll('.unblock-btn').forEach(btn => {
                btn.addEventListener('click', (e) => setDiskReadonly(btn.dataset.num, false, e.currentTarget));
            });
            document.querySelectorAll('.cycle-btn').forEach(btn => {
                btn.addEventListener('click', (e) => cycleDisk(btn.dataset.num, e.currentTarget));
            });

        } catch (err) {
            diskTableBody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">Error fetching disks</td></tr>`;
            internalDiskTableBody.innerHTML = `<tr><td colspan="6" class="text-center text-danger">Error fetching disks</td></tr>`;
        } finally {
            refreshDisksBtn.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Refresh Drives';
            refreshDisksBtn.disabled = false;
        }
    }

    async function setDiskReadonly(diskNumber, readonly, btnElement) {
        if (btnElement) {
            btnElement.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Processing...';
            btnElement.disabled = true;
        }
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
                if (btnElement) {
                    btnElement.innerHTML = readonly ? '<i class="fa-solid fa-lock"></i> Block' : '<i class="fa-solid fa-unlock"></i> Unblock';
                    btnElement.disabled = false;
                }
            }
        } catch (err) {
            showToast('Request failed', 'error');
            if (btnElement) {
                btnElement.innerHTML = readonly ? '<i class="fa-solid fa-lock"></i> Block' : '<i class="fa-solid fa-unlock"></i> Unblock';
                btnElement.disabled = false;
            }
        }
    }

    async function cycleDisk(diskNumber, btnElement) {
        if (btnElement) {
            btnElement.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            btnElement.disabled = true;
        }
        try {
            showToast(`Cycling disk #${diskNumber} offline/online...`, 'info');
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
                if (btnElement) {
                    btnElement.innerHTML = '<i class="fa-solid fa-power-off"></i>';
                    btnElement.disabled = false;
                }
            }
        } catch (err) {
            showToast('Cycle request failed', 'error');
            if (btnElement) {
                btnElement.innerHTML = '<i class="fa-solid fa-power-off"></i>';
                btnElement.disabled = false;
            }
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
