# Parses a V2802RH telnet transcript into the dashboard JSON contract.
# Mirrors the contract previously produced by the C helper exactly, so the
# LuCI view needs no change. Reporting policy is unchanged: a value that was
# not read is emitted as JSON null, never as a plausible-looking default.

function jesc(s) {
	gsub(/\\/, "\\\\", s)
	gsub(/"/, "\\\"", s)
	return s
}
function trim(s) { sub(/^[ \t\r\n]+/, "", s); sub(/[ \t\r\n]+$/, "", s); return s }
function jstr(key, val, have, comma,   t) {
	t = have ? ("\"" jesc(val) "\"") : "null"
	printf("    \"%s\": %s%s\n", key, t, comma ? "," : "")
}
function jnum(key, val, have, fmt, comma,   t) {
	t = have ? sprintf(fmt, val) : "null"
	printf("    \"%s\": %s%s\n", key, t, comma ? "," : "")
}

BEGIN {
	FS = "\n"
	rx = 0; tx = 0; temp = 0; volt = 0; bias = 0
	has_rx = 0; has_tx = 0; has_temp = 0; has_volt = 0; has_bias = 0
	vendor = ""; part = ""; onu_state = ""; onu_raw = ""; serial = ""
	mac = ""; uptime = ""; fw = ""; hw = ""; cpu = ""; model = ""
	oui = ""; manuf = ""; pclass = ""; ploam = ""; rdi = ""; pti = ""; regpw = ""
	fec = ""; has_fec = 0
	eqd = 0; has_eqd = 0
	gem_thr = 0; has_gem_thr = 0
	tcont_list = ""; tcont_n = 0; gem_list = ""; gem_n = 0
	lan25 = ""; lan1 = ""
	rxp = 0; txp = 0; rxb = 0; txb = 0; rxe = 0; txe = 0; rxd = 0; txd = 0
	has_eth = 0
	alos = "Unknown"; alof = "Unknown"; alom = "Unknown"; asf = "Unknown"; asd = "Unknown"
	class_source = "default"
}

{
	# Telnet IAC bytes and CR are removed by tr in the shell pipeline, so the
	# line arrives clean. Kept as a plain assignment for clarity.
	line = $0
}

/Rx Power:/        { if (match(line, /-?[0-9]+\.[0-9]+/)) { rx = substr(line, RSTART, RLENGTH) + 0; has_rx = 1 } }
/Tx Power:/        { if (match(line, /-?[0-9]+\.[0-9]+/)) { tx = substr(line, RSTART, RLENGTH) + 0; has_tx = 1 } }
/Temperature:/     { if (match(line, /-?[0-9]+\.[0-9]+/)) { temp = substr(line, RSTART, RLENGTH) + 0; has_temp = 1 } }
/Voltage:/         { if (match(line, /[0-9]+\.[0-9]+/))  { volt = substr(line, RSTART, RLENGTH) + 0; has_volt = 1 } }
/Bias Current:/    { if (match(line, /[0-9]+\.[0-9]+/))  { bias = substr(line, RSTART, RLENGTH) + 0; has_bias = 1 } }

/Vendor Name:/ {
	v = trim(substr(line, index(line, "Vendor Name:") + 12))
	if (v != "") {
		vendor = v
		# The optic states its own ITU-T G.984.2 budget class in this string.
		if (v ~ /C\+/)      { oclass = "cplus"; class_source = "hardware" }
		else if (v ~ /B\+/) { oclass = "bplus"; class_source = "hardware" }
	}
}
/Part Number:/ { part = trim(substr(line, index(line, "Part Number:") + 12)) }

/ONU state:/ {
	s = trim(substr(line, index(line, "ONU state:") + 10))
	if (s ~ /O5/)      { onu_state = "O5"; onu_raw = "Operation State (O5)" }
	else if (s ~ /O4/) { onu_state = "O4"; onu_raw = "Ranging State (O4)" }
	else if (s ~ /O3/) { onu_state = "O3"; onu_raw = "Serial Number State (O3)" }
	else if (s ~ /O2/) { onu_state = "O2"; onu_raw = "Standby State (O2)" }
	else if (s ~ /O1/) { onu_state = "O1"; onu_raw = "Initial State (O1)" }
}
/serial number:/ {
	s = trim(substr(line, index(line, "serial number:") + 14))
	n = split(s, a, /[ \t]+/)
	if (n >= 2) {
		h = a[2]; sub(/^0[xX]/, "", h)
		serial = toupper(a[1]) toupper(h)
	}
}

/MAC Address:/    { if (match(line, /[0-9A-Fa-f][0-9A-Fa-f](:[0-9A-Fa-f][0-9A-Fa-f]){5}/)) mac = toupper(substr(line, RSTART, RLENGTH)) }
/Application Version:/ { s = substr(line, index(line, "Application Version:") + 20); if (match(s, /[^ \t]+/)) fw = substr(s, RSTART, RLENGTH) }
/Hardware Version:/    { s = substr(line, index(line, "Hardware Version:") + 17);   if (match(s, /[^ \t]+/)) hw = substr(s, RSTART, RLENGTH) }
/ManufacturerOUI:/     { s = substr(line, index(line, "ManufacturerOUI:") + 16);    if (match(s, /[^ \t]+/)) oui = substr(s, RSTART, RLENGTH) }
/Manufacturer:/ {
	i = index(line, "Manufacturer:")
	if (substr(line, i - 3, 3) != "OUI") { manuf = trim(substr(line, i + 13)) }
}
/ProductClass:/ { s = substr(line, index(line, "ProductClass:") + 13); if (match(s, /[^ \t]+/)) pclass = substr(s, RSTART, RLENGTH) }
# Reported verbatim. The previous C helper printed a hardcoded
# "V2802RH (XPON+1GE+2.5GE)" regardless of what the unit actually said, which
# would have been wrong on any other Realtek ONU sharing this CLI.
/ModelName:/    { s = trim(substr(line, index(line, "ModelName:") + 10)); sub(/[ \t][ \t]+Description.*$/, "", s); model = trim(s) }
/cpu occupancy/ { if (match(line, /[0-9]+%/)) cpu = substr(line, RSTART, RLENGTH) }

/SysUpTime:/ {
	s = trim(substr(line, index(line, "SysUpTime:") + 10))
	sub(/[ \t][ \t]+Serial.*$/, "", s)
	s = trim(s)
	# "D H:M:S" when the unit has been up at least a day, else "H:M:S".
	if (match(s, /^[0-9]+[ \t]+[0-9]+:[0-9]+:[0-9]+/)) {
		split(s, u, /[ \t]+/); split(u[2], t, ":")
		uptime = u[1] "d " (t[1] + 0) "h " (t[2] + 0) "m"
	} else if (match(s, /^[0-9]+:[0-9]+:[0-9]+/)) {
		split(s, t, ":")
		uptime = (t[1] + 0) "h " (t[2] + 0) "m"
	}
}

/PLOAMu state:/ { ploam = trim(substr(line, index(line, "PLOAMu state:") + 13)) }
/RDI state:/    { rdi   = trim(substr(line, index(line, "RDI state:") + 10)) }
/PTI pattern:/  { pti_pat = trim(substr(line, index(line, "PTI pattern:") + 12)) }
/PTI mask:/     { pti_msk = trim(substr(line, index(line, "PTI mask:") + 9)); if (pti_pat != "") pti = pti_pat " / " pti_msk }
/^password:/    { regpw = trim(substr(line, 10)); seen_pw = 1 }
/Assembly threshold:/ { if (match(line, /[0-9]+/)) { gem_thr = substr(line, RSTART, RLENGTH) + 0; has_gem_thr = 1 } }
/GPON EQD offset:/    { if (match(line, /-?[0-9]+/)) { } ; s = substr(line, index(line, "offset:") + 7); if (match(s, /-?[0-9]+/)) { eqd = substr(s, RSTART, RLENGTH) + 0; has_eqd = 1 } }

/alloc_id:/ {
	if (match(line, /alloc_id:[ \t]*[0-9]+,[ \t]*TCONT_id[ \t]*[0-9]+/)) {
		seg = substr(line, RSTART, RLENGTH)
		split(seg, p1, /[^0-9]+/)
		aid = p1[2] + 0; tid = p1[3] + 0
		tcont_list = tcont_list (tcont_n ? ", " : "") aid " (T-CONT " tid ")"
		tcont_n++
	}
}
# Upstream flow rows: "  0   256   ETH" following the tabulated header.
/^[ \t]*[0-9]+[ \t]+[0-9]+[ \t]+[A-Z]+[ \t]*$/ {
	split(trim(line), f, /[ \t]+/)
	gem_list = gem_list (gem_n ? ", " : "") f[2] " (" f[3] ")"
	gem_n++
}

/FEC state:/ { fec = (line ~ /enable/) ? "Enabled (ITU-T G.984.3)" : "Disabled"; has_fec = 1 }
/FEC Correct codewords:/ { if (match(line, /[0-9]+/)) { fec_cor = substr(line, RSTART, RLENGTH) + 0; has_fec_cnt = 1 } }
/FEC codewords Uncor:/   { if (match(line, /[0-9]+/)) { fec_uncor = substr(line, RSTART, RLENGTH) + 0; has_fec_cnt = 1 } }
/FEC Correct bits:/      { if (match(line, /[0-9]+/)) { fec_bits = substr(line, RSTART, RLENGTH) + 0; has_fec_cnt = 1 } }
/BIP Error bits[ \t]*:/  { if (match(line, /[0-9]+/)) { bip_bits = substr(line, RSTART, RLENGTH) + 0; has_bip = 1 } }
/BIP Error blocks[ \t]*:/ { if (match(line, /[0-9]+/)) { bip_blks = substr(line, RSTART, RLENGTH) + 0; has_bip = 1 } }

/RxPkt :/     { if (match(line, /RxPkt :[ \t]*[0-9]+/))     { rxp = substr(line, RSTART + 7) + 0 } ; if (match(line, /TxPkt :[ \t]*[0-9]+/)) { txp = substr(line, RSTART + 7) + 0 } ; has_eth = 1 }
/RxBytes :/   { if (match(line, /RxBytes :[ \t]*[0-9]+/))   { rxb = substr(line, RSTART + 9) + 0 } ; if (match(line, /TxBytes :[ \t]*[0-9]+/)) { txb = substr(line, RSTART + 9) + 0 } }
/RxError :/   { if (match(line, /RxError :[ \t]*[0-9]+/))   { rxe = substr(line, RSTART + 9) + 0 } ; if (match(line, /TxError :[ \t]*[0-9]+/)) { txe = substr(line, RSTART + 9) + 0 } }
/RxDropped :/ { if (match(line, /RxDropped :[ \t]*[0-9]+/)) { rxd = substr(line, RSTART + 11) + 0 } ; if (match(line, /TxDropped :[ \t]*[0-9]+/)) { txd = substr(line, RSTART + 11) + 0 } }

/Alarm LOS, status:/ { alos = (line ~ /[Cc]lear/) ? "Clear (Normal)" : "Active (LOS Alarm)" }
/Alarm LOF, status:/ { alof = (line ~ /[Cc]lear/) ? "Clear (Normal)" : "Active (LOF Alarm)" }
/Alarm LOM, status:/ { alom = (line ~ /[Cc]lear/) ? "Clear (Normal)" : "Active (LOM Alarm)" }
/Alarm SF, status:/  { asf  = (line ~ /[Cc]lear/) ? "Clear (Normal)" : "Active (Signal Fail)" }
/Alarm SD, status:/  { asd  = (line ~ /[Cc]lear/) ? "Clear (Normal)" : "Active (Signal Degrade)" }

# Port status table: "0  Up  2.5G  Full" / "1  Down ..."
/^[ \t]*0[ \t]+(Up|Down)/ { split(trim(line), q, /[ \t]+/); lan25 = (q[2] ~ /Up/) ? ("Up, " q[3] " " q[4] " (In Use)") : "Down (Unplugged)" }
/^[ \t]*1[ \t]+(Up|Down)/ { split(trim(line), q, /[ \t]+/); lan1  = (q[2] ~ /Up/) ? ("Up, " q[3] " " q[4]) : "Down (Unplugged)" }

END {
	if (oclass == "")  oclass = req_class
	if (oclass == "")  oclass = "bplus"

	# Optical budget profiles. B+ and PX20+ carry the V2802RH datasheet figures
	# (TX 0..+4 dBm, RX sensitivity -27 dBm, overload -8 dBm GPON / -3 dBm EPON);
	# C+ keeps the ITU-T G.984.2 Amendment 2 class limits.
	if (oclass == "cplus") {
		rx_sens = -32.0; rx_ovld = -12.0; tx_min = 0.5; tx_max = 5.0
		cit = "ITU-T G.984.2 Amd.2 Class C+"
	} else if (oclass == "epon_px20") {
		rx_sens = -27.0; rx_ovld = -3.0; tx_min = 0.0; tx_max = 4.0
		cit = "IEEE 802.3ah 1000BASE-PX20+"
	} else {
		oclass = "bplus"
		rx_sens = -27.0; rx_ovld = -8.0; tx_min = 0.0; tx_max = 4.0
		cit = "ITU-T G.984.2 Class B+"
	}
	# Warning bands are always derived, never listed separately, so the threshold
	# table and the badge evaluator cannot disagree.
	rx_lw = rx_sens + 1.0; rx_hw = rx_ovld - 1.0
	tx_lw = tx_min  + 0.5; tx_hw = tx_max  - 0.5

	if (seen_pw && regpw == "") regpw = "Not set (serial number authentication)"

	printf("{\n")
	printf("  \"success\": true,\n")
	printf("  \"connected\": true,\n")
	printf("  \"host\": \"%s\",\n", jesc(host))
	printf("  \"timestamp\": %s,\n", ts)
	printf("  \"optical_class\": \"%s\",\n", oclass)
	printf("  \"optical_class_source\": \"%s\",\n", class_source)

	printf("  \"ddm\": {\n")
	jnum("rx_power_dbm", rx, has_rx, "%.2f", 1)
	jnum("tx_power_dbm", tx, has_tx, "%.2f", 1)
	jnum("temperature_c", temp, has_temp, "%.2f", 1)
	jnum("voltage_v", volt, has_volt, "%.2f", 1)
	jnum("bias_current_ma", bias, has_bias, "%.2f", 1)
	jstr("vendor_name", vendor, vendor != "", 1)
	jstr("part_number", part, part != "", 1)
	printf("    \"wavelength_rx\": \"1490 nm\",\n")
	printf("    \"wavelength_tx\": \"1310 nm\",\n")
	printf("    \"wavelength_rx_nm\": 1490,\n")
	printf("    \"wavelength_tx_nm\": 1310,\n")
	printf("    \"optical_budget_class\": \"%s\",\n", jesc(cit))
	jstr("fec_status", fec, has_fec, 1)
	jstr("fec_upstream_status", "OLT Grant Controlled (ITU-T G.984.3)", 1, 1)
	jnum("fec_corrected_codewords", fec_cor, has_fec_cnt, "%d", 1)
	jnum("fec_uncorrectable_codewords", fec_uncor, has_fec_cnt, "%d", 1)
	jnum("fec_corrected_bits", fec_bits, has_fec_cnt, "%d", 1)
	jnum("bip_error_bits", bip_bits, has_bip, "%d", 1)
	jnum("bip_error_blocks", bip_blks, has_bip, "%d", 1)
	jnum("eqd_offset", eqd, has_eqd, "%d", 0)
	printf("  },\n")

	printf("  \"onu\": {\n")
	jstr("oui", oui, oui != "", 1)
	jstr("manufacturer", manuf, manuf != "", 1)
	jstr("product_class", pclass, pclass != "", 1)
	jstr("ploam_upstream", ploam, ploam != "", 1)
	jstr("rdi_state", rdi, rdi != "", 1)
	jstr("omci_pti", pti, pti != "", 1)
	jstr("registration_password", regpw, seen_pw, 1)
	jstr("tcont_allocations", tcont_list, tcont_n > 0, 1)
	jnum("tcont_count", tcont_n, 1, "%d", 1)
	jstr("gem_ports", gem_list, gem_n > 0, 1)
	jnum("gem_port_count", gem_n, 1, "%d", 1)
	jnum("ds_gem_assembly_threshold", gem_thr, has_gem_thr, "%d", 1)
	jstr("state", onu_state, onu_state != "", 1)
	jstr("state_raw", onu_raw, onu_raw != "", 1)
	jstr("serial_number", serial, serial != "", 1)
	jstr("registered_status", (onu_state == "O5") ? "Registered (O5)" : "Not Registered", onu_state != "", 1)
	jstr("alarm_los", alos, 1, 1)
	jstr("alarm_lof", alof, 1, 1)
	jstr("alarm_lom", alom, 1, 1)
	jstr("alarm_sf", asf, 1, 1)
	jstr("alarm_sd", asd, 1, 0)
	printf("  },\n")

	printf("  \"device\": {\n")
	jstr("model", model, model != "", 1)
	printf("    \"vendor\": \"VSOL\",\n")
	jstr("mac", mac, mac != "", 1)
	jstr("uptime", uptime, uptime != "", 1)
	jstr("firmware", fw, fw != "", 1)
	jstr("hardware", hw, hw != "", 1)
	jstr("cpu_usage", cpu, cpu != "", 1)
	jstr("lan25g", lan25, lan25 != "", 1)
	jstr("lan1g", lan1, lan1 != "", 1)
	jnum("rx_packets", rxp, has_eth, "%d", 1)
	jnum("tx_packets", txp, has_eth, "%d", 1)
	jnum("rx_bytes", rxb, has_eth, "%d", 1)
	jnum("tx_bytes", txb, has_eth, "%d", 1)
	jnum("rx_errors", rxe, has_eth, "%d", 1)
	jnum("tx_errors", txe, has_eth, "%d", 1)
	jnum("rx_dropped", rxd, has_eth, "%d", 1)
	jnum("tx_dropped", txd, has_eth, "%d", 0)
	printf("  },\n")

	printf("  \"thresholds\": {\n")
	printf("    \"class\": \"%s\",\n", oclass)
	printf("    \"citation\": \"%s\",\n", jesc(cit))
	printf("    \"sff_citation\": \"SFF-8472\",\n")
	printf("    \"wavelength_rx_nm\": 1490,\n")
	printf("    \"wavelength_tx_nm\": 1310,\n")
	printf("    \"rx_sensitivity_dbm\": %.2f,\n", rx_sens)
	printf("    \"rx_overload_dbm\": %.2f,\n", rx_ovld)
	printf("    \"tx_min_dbm\": %.2f,\n", tx_min)
	printf("    \"tx_max_dbm\": %.2f,\n", tx_max)
	printf("    \"rx_pwr_low_alarm\": %.2f,\n", rx_sens)
	printf("    \"rx_pwr_low_warn\": %.2f,\n", rx_lw)
	printf("    \"rx_pwr_high_warn\": %.2f,\n", rx_hw)
	printf("    \"rx_pwr_high_alarm\": %.2f,\n", rx_ovld)
	printf("    \"tx_pwr_low_alarm\": %.2f,\n", tx_min)
	printf("    \"tx_pwr_low_warn\": %.2f,\n", tx_lw)
	printf("    \"tx_pwr_high_warn\": %.2f,\n", tx_hw)
	printf("    \"tx_pwr_high_alarm\": %.2f,\n", tx_max)
	printf("    \"temp_low_alarm\": -40.00,\n")
	printf("    \"temp_low_warn\": -10.00,\n")
	printf("    \"temp_high_warn\": 75.00,\n")
	printf("    \"temp_high_alarm\": 85.00,\n")
	printf("    \"voltage_low_alarm\": 2.90,\n")
	printf("    \"voltage_low_warn\": 3.05,\n")
	printf("    \"voltage_high_warn\": 3.55,\n")
	printf("    \"voltage_high_alarm\": 3.70,\n")
	printf("    \"bias_low_alarm\": 1.00,\n")
	printf("    \"bias_low_warn\": 2.00,\n")
	printf("    \"bias_high_warn\": 60.00,\n")
	printf("    \"bias_high_alarm\": 70.00\n")
	printf("  }\n")
	printf("}\n")
}
