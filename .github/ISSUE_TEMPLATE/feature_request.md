---
name: Feature request
about: Suggest a capability or an additional reading
labels: enhancement
---

## What you want

## Does the hardware actually report it?

The dashboard only shows values the device reports. Before requesting a new
reading, it helps to confirm the hardware exposes it at all:

```sh
# list every transceiver field the ONT CLI exposes
# (telnet in, then: diag, then "pon get transceiver " and press tab/enter)
```

On a V2802RH the complete list is: `bias-current`, `part-number`, `rx-power`,
`sn`, `temperature`, `tx-power`, `vendor-name`, `voltage`. There is no connector,
identifier or EEPROM command, so SFF-8472 threshold bytes are not reachable.

If the device does not report it, it cannot be displayed, and a plausible-looking
placeholder is worse than an honest omission.

## Why it matters

<!-- What decision or diagnosis this would let you make. -->
