#!/usr/bin/env python3
"""Static server for the character builder, with caching turned off.

`python3 -m http.server` sends no Cache-Control, so a browser is free to guess how
long a file stays fresh — and it guesses from the file's own age. After an edit that
touches both an old shared module and a new one, it will happily serve the old module
from cache while fetching the new one. When the new module imports something the
cached copy doesn't export yet, the ES module graph fails to *link*, so no code on the
page runs at all: buttons render but nothing responds. A hard reload clears it, but
only once you've worked out that's what happened.

Same interface as http.server, so nothing else about running the app changes:

    python3 serve.py [port]
"""

import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    print(f"Serving on http://localhost:{port} (caching disabled)")
    HTTPServer(("", port), NoCacheHandler).serve_forever()
