#!/bin/sh
# Deploy luci-app-vsol-ddm to live OpenWrt router using APK ADD ONLY
# Usage: ./deploy.sh [ROUTER_IP] (default: 172.16.1.1)
set -e

ROUTER_IP="${1:-172.16.1.1}"
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
HOST_APK="/home/ali/openwrt-jidu6j11/staging_dir/host/bin/apk"

echo "==> Deploying luci-app-vsol-ddm to OpenWrt router at $ROUTER_IP via APK package manager..."

# No compiled component, so there is nothing to detect: one package serves
# every architecture.
TARGET_ARCH="noarch"
echo "==> Building architecture-independent package"

TMP_DIR="/tmp/apk_build_vsol_${TARGET_ARCH}"
rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR/www/luci-static/resources/view/vsol_ddm" \
         "$TMP_DIR/usr/share/vsol_ddm" \
         "$TMP_DIR/usr/libexec/rpcd" \
         "$TMP_DIR/usr/share/luci/menu.d" \
         "$TMP_DIR/usr/share/rpcd/acl.d" \
         "$TMP_DIR/etc/config" \
         "$TMP_DIR/etc/uci-defaults" \
         "$TMP_DIR/lib/upgrade/keep.d"


cp -r "$SCRIPT_DIR/htdocs/luci-static/resources/view/vsol_ddm/"* "$TMP_DIR/www/luci-static/resources/view/vsol_ddm/" 2>/dev/null || true
cp -r "$SCRIPT_DIR/root/etc/config/"* "$TMP_DIR/etc/config/" 2>/dev/null || true
cp -r "$SCRIPT_DIR/root/etc/uci-defaults/"* "$TMP_DIR/etc/uci-defaults/" 2>/dev/null || true
cp -r "$SCRIPT_DIR/root/usr/libexec/rpcd/"* "$TMP_DIR/usr/libexec/rpcd/" 2>/dev/null || true
cp -r "$SCRIPT_DIR/root/usr/share/luci/menu.d/"* "$TMP_DIR/usr/share/luci/menu.d/" 2>/dev/null || true
cp -r "$SCRIPT_DIR/root/usr/share/rpcd/acl.d/"* "$TMP_DIR/usr/share/rpcd/acl.d/" 2>/dev/null || true
# Sysupgrade retention list. Unconditional: if this is missing the package still
# installs, but /etc/config survives a reflash only by base-files' default list.
cp "$SCRIPT_DIR/root/lib/upgrade/keep.d/luci-app-vsol-ddm" "$TMP_DIR/lib/upgrade/keep.d/luci-app-vsol-ddm"
cp "$SCRIPT_DIR/root/usr/share/vsol_ddm/parse.awk" "$TMP_DIR/usr/share/vsol_ddm/parse.awk"

chmod -R u=rwX,go=rX "$TMP_DIR"
chmod 0755 "$TMP_DIR/usr/libexec/rpcd/"* "$TMP_DIR/etc/uci-defaults/"* 2>/dev/null || true

APK_FILE="/tmp/luci-app-vsol-ddm-1.0.0-r1_noarch.apk"
"$HOST_APK" mkpkg \
    --info "name:luci-app-vsol-ddm" \
    --info "version:1.0.0-r1" \
    --info "arch:noarch" \
    --info "description:LuCI support for VSOL V2802RH Optical DDM Telemetry" \
    --files "$TMP_DIR" \
    -o "$APK_FILE"

cp "$APK_FILE" "/home/ali/Desktop/luci-app-vsol-ddm-1.0.0-r1_noarch.apk" 2>/dev/null || true
rm -rf "$TMP_DIR"

# 3. Transfer and install
echo "==> Streaming $APK_FILE to root@$ROUTER_IP:/tmp/..."
cat "$APK_FILE" | ssh -o StrictHostKeyChecking=no "root@$ROUTER_IP" "cat > /tmp/luci-app-vsol-ddm.apk && apk add --allow-untrusted /tmp/luci-app-vsol-ddm.apk && rm -f /tmp/luci-app-vsol-ddm.apk && rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache* /tmp/vsol_ddm_cache.json /tmp/luci-sessions/* && /etc/init.d/rpcd restart && /etc/init.d/uhttpd restart"

echo "==> [SUCCESS] Package successfully installed via apk add!"
echo "==> Access dashboard at: http://$ROUTER_IP/cgi-bin/luci/admin/status/vsol_ddm"
exit 0
