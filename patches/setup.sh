#!/bin/bash
# Setup fold UI support with auto-apply on git pull

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

echo "=== Setting up fold UI support ==="
echo ""

# 1. Apply patch if not already applied
echo "1. Checking patch status..."
if git apply --reverse --check patches/fold-ui-support.patch 2>/dev/null; then
    echo "   ✅ Patch already applied"
else
    echo "   Applying patch..."
    ./patches/apply-patches.sh
fi

echo ""

# 2. Install git hook
echo "2. Installing git post-merge hook..."
HOOK_FILE=".git/hooks/post-merge"

if [ -f "$HOOK_FILE" ]; then
    if grep -q "apply-patches.sh" "$HOOK_FILE"; then
        echo "   ✅ Hook already installed"
    else
        echo "   ⚠️  Hook exists but doesn't call apply-patches.sh"
        echo "   Please manually add this line to $HOOK_FILE:"
        echo "   $REPO_ROOT/patches/apply-patches.sh"
    fi
else
    cat > "$HOOK_FILE" << 'EOF'
#!/bin/bash
# Post-merge hook: auto-apply patches after git pull

REPO_ROOT="$(git rev-parse --show-toplevel)"
PATCH_SCRIPT="$REPO_ROOT/patches/apply-patches.sh"

if [ -f "$PATCH_SCRIPT" ]; then
    echo ""
    echo "🔧 Auto-applying patches..."
    "$PATCH_SCRIPT"
fi
EOF
    chmod +x "$HOOK_FILE"
    echo "   ✅ Hook installed"
fi

echo ""

# 3. Verify fold extension
echo "3. Checking fold extension..."
FOLD_EXT="$HOME/.pi/agent/extensions/fold.ts"
if [ -f "$FOLD_EXT" ]; then
    if grep -q "ctx.reload()" "$FOLD_EXT"; then
        echo "   ✅ Fold extension is up to date"
    else
        echo "   ⚠️  Fold extension needs update (ctx.ui.clearChat -> ctx.reload)"
        echo "   Run: cp pi-config/agent/extensions/fold.ts ~/.pi/agent/extensions/"
    fi
else
    echo "   ⚠️  Fold extension not found at $FOLD_EXT"
fi

echo ""
echo "=== Setup complete! ==="
echo ""
echo "Usage:"
echo "  - /fold   : Fold/hide earlier messages in UI"
echo "  - /unfold : Restore all messages"
echo ""
echo "After 'git pull', patches will auto-apply via post-merge hook."
