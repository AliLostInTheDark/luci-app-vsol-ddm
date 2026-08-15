# Changelog

## 1.0.0-r1

Correctness pass over the whole package. Several of these were producing wrong
readings on working hardware rather than merely being untidy.

### Fixed — wrong values

- **Uptime was misread whenever the ONT reported no day field.** `sscanf` was
  allowed to partially succeed and write the day count before failing on the
  colon, and the fallback parse then inherited it. `SysUpTime: 12:34:56` rendered
  as `12d 12h 34m`. The dashboard's own regex had the same class of fault from the
  opposite direction: an optional day group with an optional `days` keyword let it
  steal a digit from the hours, so `18:07` rendered as `1d 8h 7m`.

- **The transceiver vendor string was discarded and replaced with an invention.**
  The V2802RH reports `Vendor Name: ONU_B+_G` — the optic states its own ITU-T
  G.984.2 power budget class. The code threw that away and substituted the literal
  `VSOL (Class B+)`. The reported string is now passed through unchanged, and the
  optical class is derived from it, with `optical_class_source` recording whether
  the class came from the hardware or is only assumed.

- **Unread values were emitted as plausible defaults.** Receive power defaulted to
  `-40.0`, temperature to `45.0`, voltage to `3.30`. A device that answered
  nothing produced a healthy-looking dashboard. Every value is now JSON `null`
  when it was not read, and renders as `--`.

- **The transmit window used the class minimum rather than the vendor figure.**
  The V2802RH datasheet specifies `TX optical power: 0 ~ +4 dBm`, narrower than
  the `+0.5 ~ +5 dBm` that G.984.2 permits a Class B+ ONU in general. Grading
  against the vendor figure is what tells you whether *this* optic is in spec.

- **The connector was asserted, twice, without evidence.** It read `SC-APC`, was
  corrected to `SC/UPC` from the datasheet, and is now stated plainly as
  `Single-core, single-mode (SC)` — the unit ships in both polishes and the CLI
  exposes no connector field at all, so neither was ever knowable.

- **The device model was a hardcoded literal.** `V2802RH (XPON+1GE+2.5GE)` was
  printed regardless of what the unit reported. The `ModelName` the ONT states is
  now used, which is also correct on other Realtek ONUs sharing this CLI.

### Fixed — failures disguised as data

- **An unreachable ONT left the last good reading on screen indefinitely.** The
  dashboard bailed out early on an error response and simply did not update, so
  stale telemetry kept rendering as live. Errors now surface, and cache replay is
  bounded.

- **A lock that could not be taken was reported as a connection failure.**
  BusyBox `flock` does not support `-w`; it exits with a usage error. The script
  treated that as a failed query and reported *"unable to connect to the ONT"*
  about a device that was answering perfectly.

### Fixed — concurrency

- **The ONT accepts about two concurrent telnet sessions; the third times out.**
  With a 1-second cache against a 2-second poll, almost every dashboard poll
  opened its own session, so a second viewer or any manual query became the third
  and failed. Device access is now serialised behind a lock, and callers that
  arrive during an in-flight query collapse onto its result.

### Added

- **Instant page load.** A cached reading is served immediately and refreshed
  behind the response: roughly 250 ms down to 6 ms on a warm cache. Staleness is
  capped at 30 seconds — beyond that the caller waits for a real answer, because
  replaying older data would render a link that died minutes ago as healthy.

- **Thresholds now flow from the backend to the UI.** The backend already emitted
  twenty threshold values that the dashboard ignored while hardcoding different
  ones, so the table could advertise a limit the badge disagreed with. Both now
  derive from one payload.

- **Loss of Signal is asserted on both sides of the receiver window** — below
  sensitivity and above overload — since a saturated receiver loses framing just
  as thoroughly as a dark one.

- Settings survive sysupgrade via `/lib/upgrade/keep.d`, alongside the existing
  `conffiles` handling for package upgrade. The uci-defaults script is additive
  and idempotent, so new options are seeded on upgrade without overwriting values
  already set.

### Changed — one package for every architecture

- **The compiled C telnet helper is gone.** It forced a build per architecture
  and, along the way, hardcoded a vendor, a model and a connector the hardware
  never reported. The backend is now shell and `awk` driving BusyBox `nc`, so a
  single `PKGARCH:=all` package installs on every target. Contract parity was
  verified field by field against the old helper: 87 of 87 fields, none missing,
  none extra, no nulls, at 354 ms against 420 ms before.
- The parser ships as `/usr/share/vsol_ddm/parse.awk` rather than embedded in a
  quoted shell string, and is checked under gawk, mawk and BusyBox awk.

### Added — data the ONT reported but nothing displayed

- The eight Ethernet counters, reported per direction with byte figures scaled.
- The equalisation delay, which was parsed and emitted but never rendered.
- Manufacturer OUI, equipment identifier and manufacturer, all already present in
  the `show version` reply and simply not read.
- Upstream PLOAM state, remote defect indication, downstream OMCI PTI,
  registration password, T-CONT allocations and GEM ports, added from the CLI.

### Changed — card layout

- Four cards with no overlapping subject matter: OMCI management, BOSA laser and
  optics, Ethernet and packet statistics, and system information. Previously FEC,
  optical alarms and standards compliance sat in the OMCI card, the hardware
  revision sat in the optical card, and the model, firmware, CPU and uptime sat in
  the Ethernet card.

### Interface

- Layout no longer truncates on phones: fixed row heights that clipped wrapped
  text are gone, and the threshold matrix scrolls horizontally inside its own
  container instead of forcing the page sideways.
- Device-derived strings are escaped before being interpolated into JSON. One
  stray quote from a device previously produced invalid JSON, which failed the
  RPC call and froze the dashboard on stale data.
