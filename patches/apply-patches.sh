#!/bin/bash
# Auto-apply fold UI support patch after pulling updates

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PATCH_FILE="$SCRIPT_DIR/fold-ui-support.patch"

cd "$REPO_ROOT"

echo "=== Applying fold UI support patch ==="

# Check if patch is already applied
if git apply --check "$PATCH_FILE" 2>/dev/null; then
    echo "Applying patch..."
    git apply "$PATCH_FILE"
    echo "✅ Patch applied successfully"
elif git apply --reverse --check "$PATCH_FILE" 2>/dev/null; then
    echo "✅ Patch already applied"
else
    echo "⚠️  Patch cannot be applied cleanly. Manual merge may be needed."
    echo "    Run: git apply --reject --whitespace=fix $PATCH_FILE"
    exit 1
fi

echo ""
echo "=== Running type check ==="
npm run check 2>&1 | tail -20

echo ""
echo "Done! Fold UI support is active."
