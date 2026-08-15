---
name: Bug report
about: Something reports the wrong value, or does not work
labels: bug
---

## What happened

<!-- What the dashboard showed, and what you expected instead. -->

## What the device itself reports

This is the most useful thing you can attach. Run on the router:

```sh
ubus call vsol_ddm get_status
```

<!-- Paste the JSON. Redact the serial number and MAC if you would rather not
     share them; everything else is diagnostic. -->

Also useful, since it shows what the ONT reported before any parsing:

```sh
# on the router - the raw transcript, before any parsing
{ printf 'admin\r\nAdmin@123\r\ndiag\r\npon get transceiver rx-power\r\nexit\r\nexit\r\n'; sleep 2; } \
  | nc <ont-ip> 23 | tr -d '\377\376\375\374\373\372\371\r'
```


## Environment

- OpenWrt version: <!-- cat /etc/os-release -->
- Router model / architecture:
- Package version: <!-- apk info luci-app-vsol-ddm   or   opkg list-installed | grep luci-app-vsol-ddm -->
- ONT firmware version:

## Notes

If a reading looks wrong rather than missing, please say what you believe the
correct value is and how you know. A reading that disagrees with the vendor's own
web interface is a much stronger report than one that merely looks surprising.
