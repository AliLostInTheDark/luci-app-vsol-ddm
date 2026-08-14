#
# Copyright (C) 2026 OpenWrt.org
#
# This is free software, licensed under the Apache License, Version 2.0 .
#

include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-vsol-ddm
PKG_VERSION:=1.0.0
PKG_RELEASE:=1

PKG_LICENSE:=Apache-2.0
PKG_MAINTAINER:=OpenWrt LuCI community

PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)

include $(INCLUDE_DIR)/package.mk

define Package/luci-app-vsol-ddm
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=VSOL V2802RH Optical Diagnostics & DDM Monitor
  DEPENDS:=+luci-base
  PKGARCH:=all
endef

define Package/luci-app-vsol-ddm/description
  LuCI hardware telemetry dashboard for VSOL V2802RH and Realtek-based 2.5G XPON ONTs.
endef

define Package/luci-app-vsol-ddm/conffiles
/etc/config/vsol_ddm
endef

define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
	$(CP) ./src/* $(PKG_BUILD_DIR)/ 2>/dev/null || true
endef

define Build/Compile
	$(TARGET_CC) $(TARGET_CFLAGS) -O2 -Wall $(PKG_BUILD_DIR)/vsol_query.c -o $(PKG_BUILD_DIR)/vsol_query
endef

define Package/luci-app-vsol-ddm/install
	$(INSTALL_DIR) $(1)/usr/bin
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/vsol_query $(1)/usr/bin/vsol_query

	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/vsol_ddm
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/vsol_ddm/* $(1)/www/luci-static/resources/view/vsol_ddm/

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./root/etc/config/vsol_ddm $(1)/etc/config/vsol_ddm

	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./root/etc/uci-defaults/* $(1)/etc/uci-defaults/

	$(INSTALL_DIR) $(1)/usr/libexec/rpcd
	$(INSTALL_BIN) ./root/usr/libexec/rpcd/* $(1)/usr/libexec/rpcd/

	$(INSTALL_DIR) $(1)/usr/share/luci/menu.d
	$(INSTALL_DATA) ./root/usr/share/luci/menu.d/* $(1)/usr/share/luci/menu.d/

	$(INSTALL_DIR) $(1)/usr/share/rpcd/acl.d
	$(INSTALL_DATA) ./root/usr/share/rpcd/acl.d/* $(1)/usr/share/rpcd/acl.d/
endef

define Package/luci-app-vsol-ddm/postinst
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	/etc/init.d/rpcd reload 2>/dev/null || true
	/etc/init.d/uhttpd restart 2>/dev/null || true
}
exit 0
endef

$(eval $(call BuildPackage,luci-app-vsol-ddm))
