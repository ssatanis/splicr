#!/usr/bin/env sh
# Removes Next.js dev lock and frees port 3000 so `pnpm dev` can start.
# Run when you see: "Unable to acquire lock at .next/dev/lock, is another instance of next dev running?"

set -e
LOCK_FILE=".next/dev/lock"
[ -d .next ] || { echo "No .next directory."; exit 0; }
if [ -f "$LOCK_FILE" ]; then
  rm -f "$LOCK_FILE"
  echo "Removed $LOCK_FILE"
fi
# Free port 3000 (Unix/macOS)
if command -v lsof >/dev/null 2>&1; then
  PID=$(lsof -ti:3000 2>/dev/null) || true
  if [ -n "$PID" ]; then
    kill -9 $PID 2>/dev/null && echo "Stopped process on port 3000 (PID $PID)" || true
  fi
fi
echo "Done. You can run 'pnpm dev' now."
