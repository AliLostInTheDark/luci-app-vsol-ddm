# Contributing

## The one rule

**Never show a value the hardware did not report.**

A parse miss, an unreachable device or a timeout must surface as `--`/unknown, or
as an error banner. It must never appear as a plausible-looking reading, and it
must never appear as a fake alarm. Both of those have shipped here before:

- the backend emitted `-100.0` for an unread temperature, which the dashboard
  then graded as a red cryogenic alarm — a scrape failure displayed as a hardware
  fault;
- the ONT vendor string `ONU_B+_G` was discarded and replaced with the literal
  `VSOL (Class B+)`, inventing a vendor the optic never claimed;
- a lock that could not be taken was reported as *"unable to connect to the ONT"*,
  which is a statement about this script, not about the device.

If you cannot determine something, say so in the UI. `(assumed - not reported by
optic)` is a good outcome. A confident wrong number is not.

## Checks before you open a pull request

Every layer here is a different language, and each has been broken at least once
by an edit that "obviously" could not break anything. Run all of them:

```sh
# Telemetry parser - must run under BusyBox awk, which is the strictest
for a in "awk" "mawk" "busybox awk"; do
  echo "" | $a -v host=h -v ts=1 -v req_class=bplus \
    -f root/usr/share/vsol_ddm/parse.awk | python3 -m json.tool >/dev/null
done

# Shell - the router runs BusyBox ash, so dash matters more than bash
for f in deploy.sh root/usr/libexec/rpcd/vsol_ddm root/etc/uci-defaults/*; do
  sh -n "$f" && bash -n "$f" && dash -n "$f"
done

# LuCI views - top-level `return`, so wrap before parsing
for f in htdocs/luci-static/resources/view/vsol_ddm/*.js; do
  node -e "new Function('return (function(){'+require('fs').readFileSync('$f','utf8')+'})')"
done

# ACL and menu
for f in root/usr/share/rpcd/acl.d/*.json root/usr/share/luci/menu.d/*.json; do
  python3 -m json.tool "$f" >/dev/null
done
```

CI runs the same set. Two traps worth knowing:

- **Apostrophes inside an embedded `awk` program.** The program lives inside a
  single-quoted shell string, so one apostrophe in a comment ends it and the
  whole script breaks somewhere else entirely. Write "the module identity",
  never "the module's identity".
- **`flock -w`.** util-linux supports it; BusyBox does not, and errors out. Detect
  the capability, and treat a failure to lock as "carry on", never as a device
  error.
- **BusyBox `awk`** rejects octal ranges inside bracket expressions, so telnet
  control bytes are stripped with `tr` in the shell rather than in the parser.
- **Feeding commands through a FIFO deadlocks.** Opening a FIFO for reading
  blocks until a writer opens it, so `nc` and the writer race on the open. Use a
  plain pipe with a trailing `sleep` to hold it open.

## Testing against hardware

There is no substitute. Deploy with `./deploy.sh <router-ip>` and check:

```sh
ubus call vsol_ddm get_status | python3 -m json.tool
```

Confirm the reading matches the ONT's own web interface or CLI. A value that
merely looks reasonable is not verified.

Note that the ONT accepts only about **two concurrent telnet sessions**; a third
connect times out. The backend serialises access behind a lock for this reason.
If you add another caller, it must take the same lock.

## Style

- UK English in user-facing strings and comments.
- Keep user-facing strings inside `_()`.
- Match the surrounding indentation: tabs in shell, awk and JavaScript.
- No new build steps, bundlers, frameworks or dependencies, and no compiled
  component: the package is architecture-independent and should stay that way.
- Cite the governing standard where the code encodes a figure from one, and cite
  the datasheet where a vendor figure differs from the class minimum. Do not
  invent specification numbers — if you cannot verify a figure, say so rather
  than writing a plausible one.
