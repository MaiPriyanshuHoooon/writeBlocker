import os
import sys
import threading
from flask import Flask, jsonify, request, send_from_directory
import webview
import write_blocker

app = Flask(__name__, static_folder='static')

# Ensure we're running as admin on Windows (informational)
def is_admin():
    if os.name == 'nt':
        import ctypes
        try:
            return ctypes.windll.shell32.IsUserAnAdmin()
        except:
            return False
    return True # Non-windows systems we just pass

@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/api/system_info', methods=['GET'])
def system_info():
    return jsonify({
        "is_windows": write_blocker.is_windows(),
        "is_admin": is_admin()
    })

@app.route('/api/status', methods=['GET'])
def get_status():
    return jsonify(write_blocker.get_write_protect_status())

@app.route('/api/disks', methods=['GET'])
def get_disks():
    disks = write_blocker.get_all_disks()
    return jsonify(disks)

@app.route('/api/set_global', methods=['POST'])
def set_global():
    data = request.json
    enable = data.get('enable', False)
    result = write_blocker.set_write_protect(enable)
    return jsonify(result), 200 if result.get('success') else 400

@app.route('/api/set_disk', methods=['POST'])
def set_disk():
    data = request.json
    disk_number = data.get('disk_number')
    readonly = data.get('readonly', True)
    if disk_number is None:
        return jsonify({"success": False, "message": "Missing disk_number"}), 400
    
    result = write_blocker.set_disk_readonly(disk_number, readonly)
    return jsonify(result), 200 if result.get('success') else 400

@app.route('/api/cycle_disk', methods=['POST'])
def cycle_disk():
    data = request.json
    disk_number = data.get('disk_number')
    if disk_number is None:
        return jsonify({"success": False, "message": "Missing disk_number"}), 400
        
    result = write_blocker.reset_disk_offline_online(disk_number)
    return jsonify(result), 200 if result.get('success') else 400

def start_server():
    # Run flask in a separate thread so pywebview can run on the main thread
    app.run(host='127.0.0.1', port=5050, threaded=True, use_reloader=False)

if __name__ == '__main__':
    # Start the Flask app in a daemon thread
    t = threading.Thread(target=start_server)
    t.daemon = True
    t.start()
    
    # Create the native window
    webview.create_window(
        'Write Blocker - Forensic Write Blocker',
        'http://127.0.0.1:5050',
        width=1000,
        height=700,
        min_size=(800, 600),
        background_color='#0f172a'
    )
    webview.start()
