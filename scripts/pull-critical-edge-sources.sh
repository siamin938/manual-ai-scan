#!/usr/bin/env bash
set -euo pipefail

PROJECT_REF="qoirkwmnyolquvsgbian"

# Source-of-truth recovery only. This script intentionally contains no deploy command.
# Requires an authenticated Supabase CLI session.
FUNCTIONS=(
  "process-measurement-job"
  "reparse-measurements"
  "visibility-postprocess"
)

if ! command -v supabase >/dev/null 2>&1; then
  echo "Supabase CLI is required. Install/authenticate it before running this recovery script." >&2
  exit 1
fi

for fn in "${FUNCTIONS[@]}"; do
  echo "Downloading live source: ${fn}"
  supabase functions download "${fn}" --project-ref "${PROJECT_REF}"
done

echo
printf '%s\n' \
  "Live critical Edge sources were downloaded into supabase/functions." \
  "Do NOT deploy from this script." \
  "Next: compare downloaded content with supabase/EDGE_RUNTIME_CONTRACT.json and review the diff before committing."
