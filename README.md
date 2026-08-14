# `luci-app-vsol-ddm`

**VSOL V2802RH 2.5G XPON ONT DDM & Optical Diagnostics Dashboard for OpenWrt LuCI**

A responsive hardware telemetry dashboard for OpenWrt routers to monitor VSOL V2802RH and Realtek RTL960x-based 2.5G XPON / GPON ONTs over fast Telnet CLI diagnostics.

---

## Features

- **Live DDM Telemetry**: Real-time Optical RX Power (dBm / µW), TX Power, Operating Temperature (°C / °F), Supply Voltage (VCC), and Laser Bias Current.
- **Dual Measurement Engine**: Seamless toggle between `Dual (Metric / Imperial)`, `Metric (°C, dBm)`, and `Imperial (°F, µW)`.
- **GPON & OMCI Identification**: Extracts GPON Serial Number (SN), MAC Address, Hardware Revision (`8671x`), Firmware Version (`V1.1.8`), and ITU-T G.984 ONU registration states (`O1` to `O7` / `Operation State (O5)`).
- **Network & Traffic Monitoring**: LAN 2.5G & LAN 1G link speeds, Module CPU load (`1%`), and live status counters.
- **SFF-8472 Diagnostic Limits Matrix**: Comprehensive threshold compliance table tracking High/Low Alarm and Warning bounds.
- **Universal Multi-Theme Adaptability**: Designed with standard CSS variables for seamless compatibility across all LuCI themes (Argon, Bootstrap, Material, Rosy, OpenWrt 2020) in both Dark and Light modes.
- **High-Performance Caching**: Instantaneous 0 ms initial dashboard rendering with client-side hydration and server-side rpcd session caching.
- **Native LuCI Polling**: Integrated with LuCI's master `poll.add` lifecycle engine.

---

## Installation (OpenWrt `apk`)

Modern OpenWrt snapshot and master releases use Alpine Package Keeper (`apk`).

### Trusted Installation with Signature Verification

Import the project's public signing key to enable standard trusted verification:

```bash
# 1. Trust the signing key
wget -qO /etc/apk/keys/luci-app-vsol-ddm.pem https://raw.githubusercontent.com/AliLostInTheDark/luci-app-vsol-ddm/main/keys/luci-app-vsol-ddm.pem

# 2. Install the package
apk add luci-app-vsol-ddm-1.0.0-r1.apk
```

#### Key Verification
`keys/luci-app-vsol-ddm.pem` is the **public** half of the EC keypair this package is signed with. You can verify its SHA-256 fingerprint before trusting:
```
090690322203551895a5ab1096e7abee6a0051448c423fd48315d15fe17b0e0c
```

---

## Development Deployment

Deploy directly over SSH from this repository:

```bash
./deploy.sh <router-ip>
# Example: ./deploy.sh 192.168.10.1
```

---

## Architecture & File Hierarchy

```
luci-app-vsol-ddm/
├── Makefile                                     # OpenWrt package build definition
├── deploy.sh                                    # Quick SSH synchronization script
├── LICENSE                                      # Apache-2.0 License
├── README.md                                    # Documentation
├── keys/
│   └── luci-app-vsol-ddm.pem                    # Verified public signing key
├── src/
│   └── vsol_query.c                             # Ultra-fast POSIX socket Telnet client
├── htdocs/
│   └── luci-static/resources/view/vsol_ddm/
│       ├── dashboard.js                         # Main LuCI flexbox dashboard view
│       └── settings.js                          # Configuration & connectivity view
└── root/
    ├── etc/
    │   ├── config/vsol_ddm                      # UCI configuration file
    │   └── uci-defaults/80_luci-app-vsol-ddm    # LuCI default permission bootstrap
    ├── usr/
    │   ├── libexec/rpcd/vsol_ddm                # Backend telemetry & session engine
    │   └── share/
    │       ├── luci/menu.d/luci-app-vsol-ddm.json # LuCI top navigation menu entry
    │       └── rpcd/acl.d/luci-app-vsol-ddm.json  # ubus RPC access permissions
```

---

## UCI Configuration (`/etc/config/vsol_ddm`)

```uci
config vsol_ddm 'main'
	option enabled '1'
	option host '192.168.100.1'
	option port '23'
	option username 'admin'
	option password 'Admin@123'
	option poll_interval '3'
	option timeout '3'
	option unit_system 'dual'
```

---

## Backend RPC Interface (`ubus`)

```bash
# Query complete telemetry data
ubus call vsol_ddm get_status

# Test connection to VSOL ONT
ubus call vsol_ddm test_connection
```

---

## License

Licensed under the **Apache License, Version 2.0**.
