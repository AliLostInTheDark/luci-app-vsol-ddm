# luci-app-vsol-ddm

LuCI optical diagnostics for the **VSOL V2802RH** XPON ONT and other Realtek-based
XPON ONUs. Reads DDM telemetry over the ONT's telnet CLI and renders it as a
dashboard under **Status → VSOL V2802RH DDM**.

## Contents

- [Highlights](#highlights)
- [Installation](#installation)
- [Supported devices](#supported-devices)
- [Dashboard cards](#dashboard-cards)
- [Settings](#settings)
- [How it works](#how-it-works)
- [Optical limits](#optical-limits)
- [Development](#development)
- [License](#license)

## Highlights

- Receive and transmit optical power, transceiver temperature, supply voltage and
  laser bias current, read live from the ONT.
- Loss of Signal asserted on **both** sides of the receiver window — below
  sensitivity and above overload — because a saturated receiver loses framing just
  as thoroughly as a dark one.
- The optical class is taken from what the optic reports about itself. A V2802RH
  returns a vendor string of `ONU_B+_G`, so the class is read from the hardware
  rather than assumed; when an optic says nothing, the dashboard labels the class
  *assumed* rather than presenting it as confirmed.
- Optical limits follow the **V2802RH datasheet**, not the class minima. The
  datasheet's transmit window of 0…+4 dBm is narrower than the +0.5…+5 dBm that
  ITU-T G.984.2 allows a Class B+ ONU in general, and grading against the vendor
  figure is what tells you whether *this* optic is in spec.
- A value the ONT did not report is shown as `--`, never as a plausible default
  and never as a fake alarm.
- Instant page load: a cached reading paints immediately and refreshes behind the
  response, bounded so a dead link cannot masquerade as a healthy one.

## Installation

### One line, key and package together

Installs the signing key, then fetches and installs the current release:

```sh
wget -qO /etc/apk/keys/luci-app-vsol-ddm.pem https://raw.githubusercontent.com/AliLostInTheDark/luci-app-vsol-ddm/main/keys/luci-app-vsol-ddm.pem && wget -qO /tmp/vsol.apk "$(wget -qO- https://api.github.com/repos/AliLostInTheDark/luci-app-vsol-ddm/releases/latest | sed -n 's/.*"browser_download_url": *"\([^"]*\.apk\)".*/\1/p' | head -1)" && apk add /tmp/vsol.apk && rm -f /tmp/vsol.apk
```

### Manually, or from the LuCI Software page

**Install the signing key first — once per router.** Every release is signed, so
with the key in place `apk` accepts the package normally: no `--allow-untrusted`,
and uploading the file on **System → Software** just works.

```sh
wget -qO /etc/apk/keys/luci-app-vsol-ddm.pem https://raw.githubusercontent.com/AliLostInTheDark/luci-app-vsol-ddm/main/keys/luci-app-vsol-ddm.pem
```

Then install the latest `.apk` from the Releases page:

```sh
apk add ./luci-app-vsol-ddm-<version>.apk
```

<details>
<summary>What that key is, and what trusting it means</summary>

`keys/luci-app-vsol-ddm.pem` is the **public** half of the EC keypair this
project signs with; the private half never leaves the build machine. Its SHA-256
is `09069032 22035518 95a5ab10 96e7abee 6a005144 8c423fd4 8315d15f e17b0e0c`.

Installing it into `/etc/apk/keys/` tells `apk` to accept packages signed by that
key, which is the same trust model every OpenWrt package feed uses. It grants
nothing else, and removing the file revokes it.

`apk add --allow-untrusted ./luci-app-vsol-ddm-<version>.apk` still works and
skips verification entirely.

</details>

### From source

```sh
git clone https://github.com/AliLostInTheDark/luci-app-vsol-ddm
cp -r luci-app-vsol-ddm <openwrt>/package/luci-app-vsol-ddm
make package/luci-app-vsol-ddm/compile V=s
```

There is no compiled component, so this is a `PKGARCH:=all` package: one build
installs on every architecture.

## Supported devices

Built for and tested against the **VSOL V2802RH** (1×XPON + 1×2.5GbE + 1×GE).
It should work with other Realtek-based XPON ONUs exposing the same telnet CLI —
the parser needs `pon get transceiver …` and `gpon get …` to behave as they do on
the V2802RH.

Verified against firmware `V1.1.8`, hardware `8671x`, on OpenWrt 25.12.

## Dashboard cards

**Received Optical Power (RX)** — current level, the usable receiver window
(sensitivity to overload, which are the LOS assert points), signal quality and
wavelength.

**Transmitted Optical Power (TX)** — launch power against the datasheet window,
transmitter state and wavelength.

**Operating Temperature** — transceiver temperature, supply voltage and laser bias
current. The datasheet ambient rating is shown for reference but is deliberately
not used for grading: the DDM reading is the transceiver's *internal* temperature,
which normally sits above ambient, so grading it against an ambient rating would
raise alarms that mean nothing. Alarm bands follow SFF-8472.

**OMCI Management** — activation state machine, registration, GPON serial number,
OMCI vendor identifier, organisationally unique identifier, equipment identifier,
manufacturer, registration password, equalisation delay, upstream PLOAM state,
remote defect indication, downstream OMCI PTI, T-CONT allocations and GEM ports.

**BOSA Laser & Optics** — optic model and vendor as reported, optical class,
wavelengths, interface connector, supply voltage, laser bias, FEC and optical
alarms.

**Ethernet & Packet Statistics** — port status, MAC address, and packet, byte,
error and dropped counters per direction.

**System Information** — device model, firmware, hardware revision, CPU load,
uptime and standards compliance.

The four cards do not overlap: each covers one subsystem and nothing else.

**SFF-8472 Diagnostic Threshold Limits** — every reading against its low alarm,
low warning, high warning and high alarm. These come from the backend payload, so
the table and the status badges cannot disagree.

## Settings

Under **Status → VSOL V2802RH DDM → Settings**: ONT address, telnet port,
credentials, polling interval, connection timeout, unit system (dual, metric or
imperial) and optical class.

The optical class setting is a fallback. When the optic states its own class — as
the V2802RH does — the hardware wins and the setting is ignored.

Settings survive both package upgrade (`conffiles`) and firmware reflash
(`/lib/upgrade/keep.d`).

## How it works

The backend is shell and `awk`. `/usr/libexec/rpcd/vsol_ddm` opens one telnet
session to the ONT with BusyBox `nc`, pipelines every diagnostic command into it,
strips the telnet control bytes, and hands the transcript to
`/usr/share/vsol_ddm/parse.awk`, which emits the dashboard JSON. There is no
compiled component, so a single package installs on every architecture.

Commands are pipelined rather than issued one at a time because the ONT accepts
only about **two concurrent telnet sessions** — a third connect times out. Two
browser tabs polling independently were enough to starve any other caller and
produce a spurious "unreachable" against a perfectly healthy ONT. Device access
is therefore serialised behind a lock, and callers arriving during an in-flight
query collapse onto its result rather than opening another session.

## Optical limits

| | value | source |
|---|---|---|
| RX sensitivity (LOS floor) | −27 dBm | V2802RH datasheet |
| RX overload (LOS ceiling) | −8 dBm (GPON), −3 dBm (EPON) | V2802RH datasheet |
| TX launch window | 0 … +4 dBm | V2802RH datasheet |
| Wavelengths | TX 1310 nm, RX 1490 nm | V2802RH datasheet |
| Temperature, voltage, bias | SFF-8472 | SFF-8472 |

The ONT reports the PON port as **EPON PX20+ & GPON Class B+**. Warning bands are
derived 1.0 dB inside each receiver alarm limit and 0.5 dB inside each transmitter
alarm limit, so a warning band can never drift outside its own alarm band.

The connector is **not** reported by the ONT — its CLI exposes only
`bias-current`, `part-number`, `rx-power`, `sn`, `temperature`, `tx-power`,
`vendor-name` and `voltage` — and the unit ships with either polish, so the
dashboard states that it is unreported rather than guessing.

## Development

```sh
./deploy.sh <router-ip>     # build, package and install over SSH
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the check regime. The short version:
every layer is a different language, each has been broken by an "obviously safe"
edit, and CI parses each with the interpreter that will actually run it.

## License

Apache-2.0. See [LICENSE](LICENSE).
