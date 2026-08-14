#!/bin/bash
# Deploy luci-app-vsol-ddm to live OpenWrt router over SSH
set -e

ROUTER_IP="${1:-192.168.10.1}"
echo "==> Deploying luci-app-vsol-ddm to ${ROUTER_IP}..."

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

# Copy tree
mkdir -p "$TMP_DIR/www/luci-static/resources/view/vsol_ddm"
mkdir -p "$TMP_DIR/etc/config"
mkdir -p "$TMP_DIR/etc/uci-defaults"
mkdir -p "$TMP_DIR/usr/libexec/rpcd"
mkdir -p "$TMP_DIR/usr/bin"
mkdir -p "$TMP_DIR/usr/share/luci/menu.d"
mkdir -p "$TMP_DIR/usr/share/rpcd/acl.d"

cp -r htdocs/luci-static/resources/view/vsol_ddm/* "$TMP_DIR/www/luci-static/resources/view/vsol_ddm/"
cp -r root/etc/config/* "$TMP_DIR/etc/config/"
cp -r root/etc/uci-defaults/* "$TMP_DIR/etc/uci-defaults/"
cp -r root/usr/libexec/rpcd/* "$TMP_DIR/usr/libexec/rpcd/"
cp -r root/usr/share/luci/menu.d/* "$TMP_DIR/usr/share/luci/menu.d/"
cp -r root/usr/share/rpcd/acl.d/* "$TMP_DIR/usr/share/rpcd/acl.d/"

# If compiled binary exists
if [ -f "src/vsol_query" ]; then
	cp "src/vsol_query" "$TMP_DIR/usr/bin/vsol_query"
fi

tar -C "$TMP_DIR" -czf "$TMP_DIR/payload.tar.gz" .
ssh root@"$ROUTER_IP" "tar -xzf - -C /" < "$TMP_DIR/payload.tar.gz"

echo "==> Setting permissions and restarting services..."
ssh root@"$ROUTER_IP" "
	chmod 0755 /usr/libexec/rpcd/vsol_ddm /etc/uci-defaults/80_luci-app-vsol-ddm 2>/dev/null || true
	[ -f /usr/bin/vsol_query ] && chmod 0755 /usr/bin/vsol_query 2>/dev/null || true
	/etc/uci-defaults/80_luci-app-vsol-ddm 2>/dev/null || true
	/etc/init.d/rpcd reload
	/etc/init.d/uhttpd restart
"

echo "==> Done! Navigate to http://${ROUTER_IP}/cgi-bin/luci/admin/status/vsol_ddm"
