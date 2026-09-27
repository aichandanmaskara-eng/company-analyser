"""Run Company Analyser Online on this computer so phones and PCs on the same Wi-Fi can use it.

    python run_local.py              (opens your browser)
    python run_local.py --no-browser
    python run_local.py --port 9000
"""
import os
import socket
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path

HERE = Path(__file__).resolve().parent
os.chdir(HERE)
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

try:
    import fastapi, uvicorn, curl_cffi  # noqa: F401
except ImportError:
    print("📦 Installing the required packages (one-time)...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "--quiet", "-r", str(HERE / "requirements.txt")])
    import uvicorn  # noqa: F401


def free_port(start: int) -> int:
    for p in range(start, start + 20):
        with socket.socket() as s:
            try:
                s.bind(("0.0.0.0", p))
                return p
            except OSError:
                continue
    sys.exit("No free port found.")


def wifi_ip() -> str | None:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))  # no packet is sent; picks the active network interface
            ip = s.getsockname()[0]
        return None if ip.startswith("127.") else ip
    except OSError:
        return None


port = int(sys.argv[sys.argv.index("--port") + 1]) if "--port" in sys.argv else 8000
port = free_port(port)
os.environ["PORT"] = str(port)
os.environ["CA_LOCAL"] = "1"
ip = wifi_ip()

print("=" * 64)
print("  📊 Company Analyser Online is running")
print(f"  💻 This computer : http://localhost:{port}/")
if ip:
    print(f"  📱 Phones on the same Wi-Fi : http://{ip}:{port}/")
    print("     (or click the 📱 Phone button in the app for a QR code)")
print("  If Windows asks about network access, allow it on PRIVATE networks.")
print("  Keep this window open. Press Ctrl+C to stop.")
print("=" * 64)

if "--no-browser" not in sys.argv:
    threading.Timer(1.5, lambda: webbrowser.open(f"http://localhost:{port}/")).start()

import uvicorn  # noqa: E402

uvicorn.run("app.main:app", host="0.0.0.0", port=port, log_level="warning")
