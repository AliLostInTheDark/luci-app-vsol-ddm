# Parse `omcicli mib get <class>` output from the VSOL CLI into JSON.
#
# The CLI emits one section per command, each introduced by a banner of X's
# wrapping the ME name, then one or more instances delimited by runs of '='.
# Consecutive instances produce two adjacent delimiter lines, so a delimiter is
# treated purely as a boundary: whatever fields accumulated since the previous
# one form an instance, and an empty run yields nothing.
#
#     XXXXXXXXXXXXXXXXX
#     VlanTagFilterData
#     XXXXXXXXXXXXXXXXX
#     =================
#     EntityID: 0x01
#     FilterTbl[0]: PRI 0,CFI 0, VID 100
#     =================
#
# Most lines are plain "Key: Value". The exceptions are the repeating tables in
# ME 171 (INDEX / Filter / Treatment), the FilterTbl rows in ME 84, and the
# indented continuation lines under DscpToPbitMapping and ToDInfo. Those are
# collected into arrays so the dashboard can render them as tables rather than
# as opaque strings.
#
# Runs under gawk, mawk and BusyBox awk: no gensub, no length() on arrays, no
# octal ranges in bracket expressions.

# Replace anything outside printable ASCII with a space. Some fields carry raw
# bytes rather than text - ME 131's Version is 0x06 0x02 0x04 on this firmware -
# and those would otherwise emit literal control characters into the JSON and
# make it unparseable. Done by walking the string because BusyBox awk rejects
# octal ranges inside bracket expressions, so /[\001-\037]/ is not portable here.
function clean(s,   i, c, out) {
	out = ""
	for (i = 1; i <= length(s); i++) {
		c = substr(s, i, 1)
		out = out (index(PRINTABLE, c) > 0 ? c : " ")
	}
	return out
}

function esc(s) {
	s = trim(clean(s))
	gsub(/\\/, "\\\\", s)
	gsub(/"/, "\\\"", s)
	return s
}

function trim(s) {
	sub(/^[ \t]+/, "", s)
	sub(/[ \t]+$/, "", s)
	return s
}

# Flush the fields accumulated since the last delimiter as one instance.
function flush_instance(   i, n, out, first) {
	if (!fcount && !rcount && !lcount)
		return
	n = icount[me]++
	out = "{"
	first = 1
	for (i = 0; i < fcount; i++) {
		if (!first) out = out ","
		out = out "\"" esc(fkey[i]) "\":\"" esc(fval[i]) "\""
		first = 0
	}
	if (rcount) {
		if (!first) out = out ","
		out = out "\"rules\":[" rules "]"
		first = 0
	}
	if (lcount) {
		if (!first) out = out ","
		out = out "\"lines\":[" lines "]"
		first = 0
	}
	out = out "}"
	inst[me, n] = out
	fcount = 0
	rcount = 0
	lcount = 0
	rules = ""
	lines = ""
	rule_open = 0
}

# Close the rule object currently being built, if any.
function close_rule() {
	if (!rule_open)
		return
	if (rcount++) rules = rules ","
	rules = rules "{" rule "}"
	rule = ""
	rule_open = 0
}

function add_field(k, v) {
	fkey[fcount] = k
	fval[fcount] = v
	fcount++
}

function add_rule_field(k, v) {
	if (rule != "") rule = rule ","
	rule = rule "\"" esc(k) "\":\"" esc(v) "\""
	rule_open = 1
}

BEGIN {
	PRINTABLE = " !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~"
	me = ""
	fcount = 0
	rcount = 0
	lcount = 0
	banner = 0
}

# The echoed command tells us which ME class the following section describes.
/omcicli mib get [0-9]+/ {
	close_rule()
	flush_instance()
	line = $0
	sub(/.*omcicli mib get[ \t]+/, "", line)
	sub(/[^0-9].*$/, "", line)
	if (line != "") {
		me = line
		seen[me] = 1
		if (!(me in icount)) icount[me] = 0
	}
	banner = 0
	next
}

# Banner of X's; the line between two of them is the ME name.
/^X+$/ {
	banner = 1
	next
}

# The line following a banner is the ME name. Every line of telnet output is
# separated by a blank line, so blanks are skipped rather than ending the
# lookahead. The *closing* banner is followed by the first instance delimiter
# instead of a name, so a delimiter - or a name already recorded - falls through
# to the rules below rather than being consumed here.
banner == 1 {
	if (trim($0) == "")
		next
	banner = 0
	if (me != "" && mename[me] == "" && $0 !~ /^=+$/) {
		mename[me] = trim($0)
		next
	}
}

# Instance boundary.
/^=+$/ {
	close_rule()
	flush_instance()
	next
}

# ME 171 repeating table: a new INDEX starts a new rule object.
/^[ \t]*INDEX[ \t]+[0-9]+/ {
	close_rule()
	line = trim($0)
	sub(/^INDEX[ \t]+/, "", line)
	add_rule_field("index", line)
	next
}

# Filter / Treatment rows belong to the rule opened by the preceding INDEX.
/^[ \t]*(Filter|Treatment)[ \t]+(Outer|Inner)[ \t]*:/ {
	line = trim($0)
	key = line
	sub(/[ \t]*:.*$/, "", key)
	gsub(/[ \t]+/, "_", key)
	val = line
	sub(/^[^:]*:[ \t]*/, "", val)
	add_rule_field(tolower(key), trim(val))
	next
}

# ME 84 filter rows repeat with a bracketed index; keep each as its own entry.
/^[ \t]*FilterTbl\[[0-9]+\][ \t]*:/ {
	line = trim($0)
	key = line
	sub(/[ \t]*:.*$/, "", key)
	val = line
	sub(/^[^:]*:[ \t]*/, "", val)
	add_field(key, trim(val))
	next
}

# Indented continuation lines (ToDInfo detail, non-zero tables). Filter out all-zero hex lines like 0x000000.
/^[ \t]+[^ \t]/ {
	if (me == "")
		next
	val = trim($0)
	if (val == "" || val ~ /^0x0+$/ || val ~ /^0+$/)
		next
	if (lcount++) lines = lines ","
	lines = lines "\"" esc(val) "\""
	next
}

# Plain "Key: Value".
/^[A-Za-z][A-Za-z0-9_]*[ \t]*:/ {
	if (me == "")
		next
	key = $0
	sub(/[ \t]*:.*$/, "", key)
	val = $0
	sub(/^[^:]*:[ \t]*/, "", val)
	add_field(trim(key), trim(val))
	next
}

END {
	close_rule()
	flush_instance()

	printf("{\"success\":true,\"connected\":true,\"host\":\"%s\",\"timestamp\":%s,\"me\":{", esc(host), ts)
	firstme = 1
	# Emit in the order requested so the dashboard card order is stable.
	nclasses = split(classes, want, ",")
	for (c = 1; c <= nclasses; c++) {
		k = trim(want[c])
		if (k == "" || !(k in seen))
			continue
		if (!firstme) printf(",")
		printf("\"%s\":{\"name\":\"%s\",\"instances\":[", esc(k), esc(mename[k]))
		for (j = 0; j < icount[k]; j++) {
			if (j) printf(",")
			printf("%s", inst[k, j])
		}
		printf("]}")
		firstme = 0
	}
	printf("}}\n")
}
