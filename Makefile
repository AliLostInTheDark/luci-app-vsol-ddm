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
PKG_LICENSE_FILES:=LICENSE
PKG_MAINTAINER:=OpenWrt LuCI community
PKG_URL:=https://github.com/AliLostInTheDark/luci-app-vsol-ddm

PKG_BUILD_DIR:=$(BUILD_DIR)/$(PKG_NAME)

include $(INCLUDE_DIR)/package.mk

# This package is architecture-independent. The telemetry helper used to be a
# compiled C telnet client, which forced a per-architecture build; it is now
# shell and awk driving BusyBox nc, so one package installs on every target -
# the same arrangement luci-app-hw-dashboard uses.
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

# Retained across package upgrade. Sysupgrade retention is handled separately by
# /lib/upgrade/keep.d/luci-app-vsol-ddm, installed below.
define Package/luci-app-vsol-ddm/conffiles
/etc/config/vsol_ddm
endef

# Unconditional on purpose: a missing source file must fail the build here,
# rather than being hidden by "|| true" and resurfacing as a confusing
# compiler error in the next step.
define Build/Prepare
	mkdir -p $(PKG_BUILD_DIR)
endef

# -lm: the helper uses isnan()/isinf() from <math.h>. GCC inlines both at -O2,
# which is why an -O2 build links without it, but that is a compiler
# optimisation and not a guarantee -- at -O0, or with a toolchain that emits
# real calls, the link fails. deploy.sh links with -lm too; keep the two in step.
define Build/Compile
endef

define Package/luci-app-vsol-ddm/install
	$(INSTALL_DIR) $(1)/usr/share/vsol_ddm
	$(INSTALL_DATA) ./root/usr/share/vsol_ddm/* $(1)/usr/share/vsol_ddm/

	$(INSTALL_DIR) $(1)/www/luci-static/resources/view/vsol_ddm
	$(INSTALL_DATA) ./htdocs/luci-static/resources/view/vsol_ddm/* $(1)/www/luci-static/resources/view/vsol_ddm/

	$(INSTALL_DIR) $(1)/etc/config
	$(INSTALL_CONF) ./root/etc/config/vsol_ddm $(1)/etc/config/vsol_ddm

	$(INSTALL_DIR) $(1)/etc/uci-defaults
	$(INSTALL_BIN) ./root/etc/uci-defaults/* $(1)/etc/uci-defaults/

	$(INSTALL_DIR) $(1)/lib/upgrade/keep.d
	$(INSTALL_DATA) ./root/lib/upgrade/keep.d/luci-app-vsol-ddm $(1)/lib/upgrade/keep.d/luci-app-vsol-ddm

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
	rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache* /tmp/vsol_ddm_cache.json /tmp/luci-sessions/*
	/etc/init.d/rpcd reload 2>/dev/null || true
	/etc/init.d/rpcd restart 2>/dev/null || true
	/etc/init.d/uhttpd restart 2>/dev/null || true
}
exit 0
endef

define Package/luci-app-vsol-ddm/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	rm -rf /tmp/luci-indexcache* /tmp/luci-modulecache* /tmp/vsol_ddm_cache.json /tmp/luci-sessions/*
	/etc/init.d/rpcd reload 2>/dev/null || true
	/etc/init.d/uhttpd restart 2>/dev/null || true
}
exit 0
endef

$(eval $(call BuildPackage,luci-app-vsol-ddm))
