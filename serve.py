"""Tiny local dev server.

Serves the repo root so index.html loads style.css / palette.js / app.js over
http:// instead of file://. Opening index.html directly works too, but a real
origin keeps local behaviour identical to the deployed site.

Resolves the directory from this file's own location rather than a hardcoded
path, so it works for anyone who clones the repo.

Usage:  python3 serve.py   ->  http://localhost:8934
"""

import functools
import http.server
import pathlib
import socketserver

DIRECTORY = str(pathlib.Path(__file__).parent.resolve())
PORT = 8934

handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=DIRECTORY)
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("", PORT), handler) as httpd:
    print(f"serving {DIRECTORY} at http://localhost:{PORT}")
    httpd.serve_forever()
