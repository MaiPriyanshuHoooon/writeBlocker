"""
Write Blocker Module (Windows Only)
=====================================
Provides software-level write blocking for USB/external storage devices
on Windows systems using:
  - Registry: HKLM\SYSTEM\CurrentControlSet\Control\StorageDevicePolicies
  - PowerShell: Set-Disk -IsReadOnly $true / $false
  - PnP device enumeration via PowerShell

All operations require Administrator privileges.
"""

import subprocess
import sys
import platform

# ── Windows-only guard ─────────────────────────────────────────────────────────
def is_windows() -> bool:
    return platform.system() == "Windows"


# ── Registry helpers ──────────────────────────────────────────────────────────
REG_PATH = r"SYSTEM\CurrentControlSet\Control\StorageDevicePolicies"

def _open_winreg():
    """Lazy import winreg so the module loads fine on macOS/Linux."""
    import winreg  # noqa: PLC0415
    return winreg


def get_write_protect_status() -> dict:
    """
    Returns:
        {
            'enabled': bool | None,   # None if key does not exist
            'key_exists': bool,
            'error': str | None
        }
    """
    if not is_windows():
        return {"enabled": None, "key_exists": False, "error": "Not a Windows system"}

    try:
        winreg = _open_winreg()
        key = winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE,
            REG_PATH,
            0,
            winreg.KEY_READ
        )
        value, _ = winreg.QueryValueEx(key, "WriteProtect")
        winreg.CloseKey(key)
        return {"enabled": bool(value), "key_exists": True, "error": None}
    except FileNotFoundError:
        return {"enabled": False, "key_exists": False, "error": None}
    except PermissionError:
        return {"enabled": None, "key_exists": False, "error": "Access denied — run as Administrator"}
    except Exception as e:
        return {"enabled": None, "key_exists": False, "error": str(e)}


def set_write_protect(enable: bool) -> dict:
    """
    Enable or disable global USB write protection via the registry.
    """
    if not is_windows():
        return {"success": False, "message": "Not a Windows system"}

    try:
        winreg = _open_winreg()
        if enable:
            key = winreg.CreateKeyEx(
                winreg.HKEY_LOCAL_MACHINE,
                REG_PATH,
                0,
                winreg.KEY_SET_VALUE
            )
            winreg.SetValueEx(key, "WriteProtect", 0, winreg.REG_DWORD, 1)
            winreg.CloseKey(key)
            return {
                "success": True,
                "message": "USB Write Protection ENABLED.\nA USB device plugged in after this point will be write-blocked.\nFor already-connected drives, use 'Block Selected Disk'."
            }
        else:
            errors = []
            try:
                key = winreg.OpenKey(
                    winreg.HKEY_LOCAL_MACHINE,
                    REG_PATH,
                    0,
                    winreg.KEY_SET_VALUE
                )
                winreg.SetValueEx(key, "WriteProtect", 0, winreg.REG_DWORD, 0)
                winreg.CloseKey(key)
            except FileNotFoundError:
                pass
            except Exception as e:
                errors.append(f"set-to-0: {e}")

            try:
                key = winreg.OpenKey(
                    winreg.HKEY_LOCAL_MACHINE,
                    REG_PATH,
                    0,
                    winreg.KEY_SET_VALUE
                )
                winreg.DeleteValue(key, "WriteProtect")
                winreg.CloseKey(key)
            except FileNotFoundError:
                pass
            except Exception as e:
                errors.append(f"delete-value: {e}")

            if errors:
                return {"success": False, "message": f"Registry error while disabling: {'; '.join(errors)}"}

            return {
                "success": True,
                "message": "USB Write Protection DISABLED.\nRegistry key removed. You may need to re-plug your device or restart for full effect.\nUse 'Unblock Selected Disk' to immediately release already-connected drives."
            }
    except PermissionError:
        return {"success": False, "message": "Access denied — run as Administrator"}
    except Exception as e:
        return {"success": False, "message": f"Registry error: {e}"}


# ── PowerShell helpers ────────────────────────────────────────────────────────
def _run_ps(script: str) -> tuple[str, str]:
    """Run a PowerShell snippet and return (stdout, stderr)."""
    # Force use of single quotes for PS commands internally where needed or bypass profile
    kwargs = {
        "capture_output": True,
        "text": True
    }
    if is_windows():
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW

    result = subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script],
        **kwargs
    )
    return result.stdout.strip(), result.stderr.strip()


def get_all_disks() -> list[dict]:
    """
    Returns a list of all connected disks:
        [{'number': int, 'name': str, 'bus': str, 'size_gb': float, 'is_readonly': bool, 'letters': str}]
    """
    if not is_windows():
        return []

    ps = (
        "Get-Disk | "
        "Select-Object Number, FriendlyName, BusType, Size, IsReadOnly, "
        "@{Name='DriveLetters';Expression={(Get-Partition -DiskNumber $_.Number | Where-Object DriveLetter | Select-Object -ExpandProperty DriveLetter) -join ','}} | "
        "ConvertTo-Csv -NoTypeInformation"
    )
    out, err = _run_ps(ps)
    if not out:
        return []

    disks = []
    lines = out.splitlines()
    if len(lines) < 2:
        return []

    # Skip header
    for line in lines[1:]:
        parts = [p.strip('"') for p in line.split(",")]
        if len(parts) < 6:
            continue
        try:
            size_bytes = int(parts[3]) if parts[3].isdigit() else 0
            disks.append({
                "number": int(parts[0]),
                "name": parts[1],
                "bus": parts[2],
                "size_gb": round(size_bytes / (1024 ** 3), 2),
                "is_readonly": parts[4].lower() == "true",
                "letters": parts[5]
            })
        except (ValueError, IndexError):
            continue
    
    # Sort disks by number ascending (0, 1, 2...)
    disks.sort(key=lambda x: x["number"])
    return disks


def get_usb_pnp_devices() -> list[dict]:
    """
    Returns all present USB Mass Storage devices via PnP enumeration.
    """
    if not is_windows():
        return []

    ps = (
        "Get-PnpDevice -PresentOnly -Class USB | "
        "Where-Object {$_.FriendlyName -like '*Mass Storage*'} | "
        "Select-Object FriendlyName, InstanceId, Status | "
        "ConvertTo-Csv -NoTypeInformation"
    )
    out, _ = _run_ps(ps)
    if not out:
        return []

    devices = []
    lines = out.splitlines()
    for line in lines[1:]:
        parts = [p.strip('"') for p in line.split(",")]
        if len(parts) < 3:
            continue
        devices.append({
            "name": parts[0],
            "instance_id": parts[1],
            "status": parts[2]
        })
    return devices


def set_disk_readonly(disk_number: int, readonly: bool) -> dict:
    """
    Use Set-Disk -IsReadOnly to hardware-lock a specific disk number.
    """
    if not is_windows():
        return {"success": False, "message": "Not a Windows system"}

    flag = "$true" if readonly else "$false"
    ps = f"Set-Disk -Number {disk_number} -IsReadOnly {flag}"
    out, err = _run_ps(ps)

    if err:
        return {"success": False, "message": f"PowerShell error: {err}"}
    state = "read-only (write-blocked)" if readonly else "read-write (write-block removed)"
    return {"success": True, "message": f"Disk {disk_number} set to {state}"}


def reset_disk_offline_online(disk_number: int) -> dict:
    """Cycle disk offline → online to recover from Error state."""
    if not is_windows():
        return {"success": False, "message": "Not a Windows system"}

    ps = (
        f"Set-Disk -Number {disk_number} -IsOffline $true; "
        f"Start-Sleep -Seconds 2; "
        f"Set-Disk -Number {disk_number} -IsOffline $false"
    )
    out, err = _run_ps(ps)
    if err:
        return {"success": False, "message": f"Error: {err}"}
    return {"success": True, "message": f"Disk {disk_number} cycled offline/online successfully"}
