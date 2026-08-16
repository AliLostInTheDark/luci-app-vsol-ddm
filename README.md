<div align="center">

# luci-app-vsol-ddm
## Made with Claude Code as a personal fun project, expect bugs.

Optical diagnostics for the VSOL V2802RH XPON ONT and other Realtek-based XPON ONUs, in OpenWrt LuCI. DDM telemetry is read straight off the ONT's telnet CLI and rendered live — no external libraries, no frameworks, and no compiled component.

[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Release](https://img.shields.io/github/v/release/AliLostInTheDark/luci-app-vsol-ddm?label=release)](https://github.com/AliLostInTheDark/luci-app-vsol-ddm/releases)
[![OpenWrt](https://img.shields.io/badge/OpenWrt-any%20target-1f6feb.svg)](https://openwrt.org)

</div>

---

An ONT reports far more than the four numbers a typical DDM page shows. This dashboard reads the optical power budget, the transceiver's own identity, the OMCI activation state machine, the T-CONT and GEM port allocations, and the Ethernet counters — and it refuses to display anything the hardware did not actually report.

## Contents

- [Highlights](#highlights)
- [Installation](#installation)
- [Supported devices](#supported-devices)
- [Dashboard cards](#dashboard-cards)
- [Settings](#settings)
- [How it works](#how-it-works)
- [License](#license)

## Highlights

- **Nothing is invented.** A value the ONT did not report shows as `--`, never as a plausible default and never as a fake alarm. Earlier revisions printed an invented vendor, a hardcoded model and a connector the CLI cannot even report; all three now come from the device or are omitted.
- **The optic states its own class.** A V2802RH returns a vendor string of `ONU_B+_G`, so the ITU-T G.984.2 power budget class is read from the hardware rather than assumed. Where an optic says nothing, the class is labelled as assumed instead of presented as confirmed.
- **Limits follow the datasheet, not the class minimum.** The V2802RH transmit window is 0 to +4 dBm — narrower than G.984.2 permits a Class B+ ONU in general — and grading against the vendor figure is what tells you whether *this* optic is in spec.
- **Loss of Signal on both sides of the window.** Below sensitivity there is no framing; above overload the receiver is saturated and there is likewise none.
- **The OMCI managed entities, as the OLT provisioned them.** Six managed entities read straight from the ONT and rendered one card each, so the VLANs, the tagging rules and the OLT's own identity are visible without a telnet session.
- **Twenty-four hours of history, in RAM.** A circular buffer and a background collector feed charts for receive power, transmit power, temperature and bias, with a 1h/6h/12h/24h range switcher and threshold bands drawn behind the trace.
- **Nothing is contacted until you say what to contact.** The address and credentials have no defaults anywhere in the package; until all three are set the dashboard stays empty and no connection is attempted.
- **Instant page load.** A cached reading paints immediately and refreshes behind the response, bounded so a link that died minutes ago cannot masquerade as healthy.
- **One package, every architecture.** No compiled component, so a single `.apk` installs anywhere.

## Installation

### One line, key and package together (recommended)

Installs the signing key, then fetches and installs the current release. Nothing to download by hand:

```sh
wget -qO /etc/apk/keys/luci-app-vsol-ddm.pem https://raw.githubusercontent.com/AliLostInTheDark/luci-app-vsol-ddm/main/keys/luci-app-vsol-ddm.pem && wget -qO /tmp/vsol.apk "$(wget -qO- https://api.github.com/repos/AliLostInTheDark/luci-app-vsol-ddm/releases/latest | sed -n 's/.*"browser_download_url": *"\([^"]*\.apk\)".*/\1/p' | head -1)" && apk add /tmp/vsol.apk && rm -f /tmp/vsol.apk
```

Run the same line again whenever you want to upgrade — the version is resolved from the Releases API each time, not baked into the URL, so it does not go stale. Each step is chained with `&&`, so a failed download can never leave you installing a truncated file.

### Manually, or from the LuCI Software page

**Install the signing key first — once per router.** Every release is signed, and with the key in place `apk` accepts the package normally: no `--allow-untrusted`, and uploading the file on LuCI's **System → Software** page just works.

```sh
wget -qO /etc/apk/keys/luci-app-vsol-ddm.pem https://raw.githubusercontent.com/AliLostInTheDark/luci-app-vsol-ddm/main/keys/luci-app-vsol-ddm.pem
```

Then grab the latest `.apk` from the [Releases](https://github.com/AliLostInTheDark/luci-app-vsol-ddm/releases) page and install it — by dropping it on the Software page, or:

```sh
apk add ./luci-app-vsol-ddm-<version>.apk
```

<details>
<summary>What that key is, and what trusting it means</summary>

`keys/luci-app-vsol-ddm.pem` is the **public** half of the EC keypair this project's firmware build signs with; the private half never leaves the build machine. Verify it before trusting it if you like — its SHA-256 is `09069032 22035518 95a5ab10 96e7abee 6a005144 8c423fd4 8315d15f e17b0e0c`.

Installing it into `/etc/apk/keys/` tells `apk` to accept any package signed by that key, which is the same trust model every OpenWrt package feed uses. It does not grant access to anything else, and removing the file revokes it.

If you flashed a firmware image built from the same tree, you already have this key as `/etc/apk/keys/public-key.pem` and can skip this step — a second copy under a different filename is harmless, since `apk` matches on the signature rather than the filename.

Still want the old behaviour? `apk add --allow-untrusted ./luci-app-vsol-ddm-<version>.apk` continues to work and skips verification entirely.

</details>

### From source

```sh
git clone https://github.com/AliLostInTheDark/luci-app-vsol-ddm
cp -r luci-app-vsol-ddm <openwrt>/package/luci-app-vsol-ddm
make package/luci-app-vsol-ddm/compile V=s
```

There is no compiled component, so this is a `PKGARCH:=all` package: one build installs on every architecture.

## Supported devices

Built for and tested against the **VSOL V2802RH** (1×XPON + 1×2.5GbE + 1×GE), verified on firmware `V1.1.8`, hardware `8671x`, under OpenWrt 25.12.

It should work with other Realtek-based XPON ONUs exposing the same telnet CLI — the parser needs `pon get transceiver …` and `gpon get …` to behave as they do on the V2802RH.

## Dashboard cards

**Received Optical Power (RX)** — current level, the usable receiver window (sensitivity to overload, which are the Loss of Signal assert points), signal quality and wavelength.

**Transmitted Optical Power (TX)** — launch power against the datasheet window, transmitter state and wavelength.

**Operating Temperature** — transceiver temperature, supply voltage and laser bias current. The datasheet ambient rating is shown for reference but deliberately not used for grading: the DDM reading is the transceiver's *internal* temperature, which normally sits above ambient, so grading it against an ambient rating would raise alarms that mean nothing. Alarm bands follow SFF-8472.

**OMCI Management** — activation state machine, registration, GPON serial number, OMCI vendor identifier, organisationally unique identifier, equipment identifier, manufacturer, registration password, equalisation delay, upstream PLOAM state, remote defect indication, downstream OMCI PTI, T-CONT allocations and GEM ports.

**BOSA Laser & Optics** — optic model and vendor as reported, optical class, wavelengths, interface connector, supply voltage, laser bias, FEC and optical alarms.

**Ethernet & Packet Statistics** — port status, MAC address, and packet, byte, error and dropped counters per direction.

**System Information** — device model, firmware, hardware revision, CPU load, uptime and standards compliance.

Those four lower cards do not overlap: each covers one subsystem and nothing else.

**Diagnostic Threshold Limits** — every reading against its low alarm, low warning, high warning and high alarm. The limits come from the backend payload, so the table and the status badges cannot disagree.

### Historical charts

Receive power, transmit power, temperature and bias current are sampled into a 24-hour circular buffer held in RAM, and drawn as full-width time-series cards. The range switcher covers 1h, 6h, 12h and 24h, with subdivisions that follow the window rather than being fixed, and sample dots at a consistent interval. The optimal and warning bands are painted behind the trace, so a reading that is merely inside its alarm limits is still visibly distinct from one sitting in the middle of its range. Nothing is written to flash.

### OMCI managed entities

Read on demand from the ONT's own `omcicli`, one card per managed entity:

| ME | Card | What it shows |
| :-- | :--- | :--- |
| 11 | Ethernet UNI | the physical Ethernet user network interfaces |
| 84 | VLAN Tag Filter | the VLANs the ONT is provisioned to accept |
| 131 | OLT-G Identification | the upstream OLT's vendor and time of day |
| 171 | Extended VLAN Tagging | the tagging and translation rules, as a table of filter and treatment tuples |
| 329 | VEIP | the virtual Ethernet interface point |

Vendor identifiers arrive as four packed ASCII bytes in a hex word and are decoded beside the raw value, so `0x414c434c` also reads as `ALCL`. Administrative and operational state are printed as reported, with the ITU-T G.988 meaning stated alongside rather than translated into a coloured badge — this firmware does not report those two consistently between its ports, and a badge would have been a guess.

These are provisioning state rather than telemetry: they change when the OLT reconfigures the ONT, not between polls, so they are fetched on demand and cached rather than driven from the polling loop.

### Restarting the ONT

A restart control sits at the top of the page. It asks for confirmation first, reports what the ONT actually returned, and drops the caches so the dashboard repopulates from the rebooted device.

## Settings

Under **Status → VSOL V2802RH DDM → Settings**: ONT address, telnet port, credentials, polling interval, connection timeout, unit system (dual, metric or imperial) and optical class.

**The address, username and password are required and have no defaults.** They identify and authenticate against one specific ONT, so shipping a value would either be wrong for your hardware or write someone else's credential into every router that installs this. Until all three are set the backend reports itself as unconfigured, every card stays empty, and no connection is attempted — which is a different state from a device that failed to answer, and the dashboard says so.

The optical class setting is a fallback. When the optic states its own class — as the V2802RH does — the hardware wins and the setting is ignored.

Settings survive both package upgrade (`conffiles`) and firmware reflash (`/lib/upgrade/keep.d`).

## How it works

The backend is shell and `awk`. `/usr/libexec/rpcd/vsol_ddm` opens one telnet session to the ONT with BusyBox `nc`, pipelines every diagnostic command into it, strips the telnet control bytes, and hands the transcript to `/usr/share/vsol_ddm/parse.awk`, which emits the dashboard JSON.

Commands are pipelined rather than issued one at a time because the ONT accepts only about **two concurrent telnet sessions** — a third connect times out. Two browser tabs polling independently were enough to starve any other caller and produce a spurious "unreachable" against a perfectly healthy ONT. Device access is therefore serialised behind a lock, and callers arriving during an in-flight query collapse onto its result rather than opening another session.

The OMCI read is a second, separate session at the ONT's top-level CLI prompt, where `omcicli` lives, rather than the diagnostic shell the telemetry path enters. Its output needs real parsing rather than field scraping: instances are delimited by runs of `=`, every line is separated by a blank one, ME 171 nests a repeating filter and treatment table, and some fields carry raw bytes rather than text — the `Version` field on this firmware is `0x06 0x02 0x04`, which would otherwise emit control characters into the JSON. `/usr/share/vsol_ddm/omci.awk` handles the structure and sanitises to printable ASCII, walking the string because BusyBox `awk` rejects octal ranges inside bracket expressions. It produces identical output under gawk, mawk and BusyBox awk.

History is collected by a small background service, kept in a circular buffer under `/tmp`, and capped at 24 hours. It lives in RAM deliberately: a telemetry chart is not worth flash wear on a router.

Optical limits come from the V2802RH datasheet: receiver sensitivity −27 dBm, overload −8 dBm on GPON and −3 dBm on EPON, transmit window 0 to +4 dBm, wavelengths 1310 nm upstream and 1490 nm downstream. The ONT reports its PON port as EPON PX20+ and GPON Class B+. Transceiver temperature, voltage and bias limits follow SFF-8472. Warning bands are derived 1.0 dB inside each receiver alarm limit and 0.5 dB inside each transmitter one, so a warning band can never drift outside its own alarm band.

The connector is not reported by the ONT — its CLI exposes only `bias-current`, `part-number`, `rx-power`, `sn`, `temperature`, `tx-power`, `vendor-name` and `voltage` — and the unit ships with either polish, so it is stated plainly rather than guessed.

## License

Apache-2.0. See [LICENSE](LICENSE).
