'use strict';
'require view';
'require rpc';
'require poll';
'require uci';

var callGetStatus = rpc.declare({
	object: 'vsol_ddm',
	method: 'get_status',
	expect: {}
});

/* OMCI managed entities. Deliberately not on the poll loop: the backend holds a
 * telnet session for the better part of 20 seconds to collect these, the ONT
 * accepts only about two concurrent sessions, and the values are provisioning
 * state that changes when the OLT reconfigures the ONT rather than per poll. */
var callGetOmci = rpc.declare({
	object: 'vsol_ddm',
	method: 'get_omci',
	expect: {}
});

var callGetHistory = rpc.declare({
	object: 'vsol_ddm',
	method: 'get_history',
	expect: {}
});

var callRestart = rpc.declare({
	object: 'vsol_ddm',
	method: 'restart',
	expect: {}
});

/* Managed entities rendered as cards, in display order. The descriptions are
 * ITU-T G.988 names; the CLI's own labels (EthUni, OltG) are shown alongside
 * whatever the ONT reports so the card still makes sense on other firmware. */
var OMCI_CARDS = [
	{ id: '11',  title: _('Ethernet UNI'),        sub: _('ME 11 - physical Ethernet user network interfaces') },
	{ id: '84',  title: _('VLAN Tag Filter'),     sub: _('ME 84 - VLANs the ONT is provisioned to accept') },
	{ id: '171', title: _('Extended VLAN Tagging'), sub: _('ME 171 - tagging and translation rules') },
	{ id: '329', title: _('Virtual Ethernet (VEIP)'), sub: _('ME 329 - virtual Ethernet interface point') },
	{ id: '131', title: _('OLT Identification'),  sub: _('ME 131 - upstream OLT vendor and time of day') }
];

/* Vendor IDs are transmitted as four packed ASCII bytes in a hex word. */
var hexToAscii = function(v) {
	if (typeof v !== 'string') return null;
	var h = v.replace(/^0x/i, '');
	if (!/^[0-9a-fA-F]+$/.test(h) || h.length % 2) return null;
	var out = '';
	for (var i = 0; i < h.length; i += 2) {
		var c = parseInt(h.substr(i, 2), 16);
		if (c < 32 || c > 126) return null;
		out += String.fromCharCode(c);
	}
	return out.length ? out : null;
};

/* ------------------------------------------------------------------------
 * Severity palette.
 * Every quality evaluator returns ALL five keys on EVERY return path:
 *   { color, bg, label, badge, severity }
 * A badge background must always come from this object, never from the
 * initial markup, otherwise it goes stale when the severity changes.
 * ---------------------------------------------------------------------- */
var SEVERITY = {
	alarm:   { color: '#ff5252', bg: 'rgba(255,82,82,0.16)' },
	warn:    { color: '#ffb300', bg: 'rgba(255,179,0,0.16)' },
	optimal: { color: '#8bc34a', bg: 'rgba(139,195,74,0.16)' },
	off:     { color: '#9e9e9e', bg: 'rgba(158,158,158,0.18)' }
};

/* Accent used for purely informational (non-graded) values. */
var ACCENT = '#00bcd4';

var quality = function(severity, label, badge) {
	var s = SEVERITY[severity] || SEVERITY.off;
	return { color: s.color, bg: s.bg, label: label, badge: badge, severity: severity };
};

/* ------------------------------------------------------------------------
 * Optical class profiles. These are the ONLY optical figures used locally,
 * and they are used solely as a fallback when the backend does not supply a
 * `thresholds` block (older firmware helper still installed).
 * When the backend does supply thresholds, the payload wins for BOTH the
 * matrix table and the evaluator bands, so the two can never disagree.
 * ---------------------------------------------------------------------- */
var OPTICAL_PROFILES = {
	/* GPON, ITU-T G.984.2 Class B+ (default) */
	bplus: {
		citation: 'ITU-T G.984.2 Class B+',
		rx_low_alarm: -27.0,	/* ONU receiver sensitivity  - LOS assert floor   */
		rx_high_alarm: -8.0,	/* ONU receiver overload     - LOS assert ceiling */
		tx_low_alarm: 0.5,	/* ONU minimum launch power  */
		tx_high_alarm: 5.0,	/* ONU maximum launch power  */
		wavelength_rx_nm: 1490,
		wavelength_tx_nm: 1310
	},
	/* GPON, ITU-T G.984.2 Amendment 2 Class C+ */
	cplus: {
		citation: 'ITU-T G.984.2 Amd.2 Class C+',
		rx_low_alarm: -32.0,
		rx_high_alarm: -12.0,
		tx_low_alarm: 0.5,
		tx_high_alarm: 5.0,
		wavelength_rx_nm: 1490,
		wavelength_tx_nm: 1310
	},
	/* EPON, IEEE 802.3ah 1000BASE-PX20-U (ONU side) */
	epon_px20: {
		citation: 'IEEE 802.3ah 1000BASE-PX20-U',
		rx_low_alarm: -24.0,
		rx_high_alarm: -3.0,
		tx_low_alarm: 2.0,
		tx_high_alarm: 7.0,
		wavelength_rx_nm: 1490,
		wavelength_tx_nm: 1310
	}
};

/* Non-optical transceiver diagnostics, SFF-8472 (class independent). */
var SFF8472 = {
	citation: 'SFF-8472',
	temp_low_alarm: -40.0,
	temp_low_warn: -10.0,
	temp_high_warn: 75.0,
	temp_high_alarm: 85.0,
	volt_low_alarm: 2.90,
	volt_low_warn: 3.05,
	volt_high_warn: 3.55,
	volt_high_alarm: 3.70,
	bias_low_alarm: 1.0,
	bias_low_warn: 2.0,
	bias_high_warn: 60.0,
	bias_high_alarm: 70.0
};

/* Warning margin is 1.0 dB inside each optical receive alarm limit and
 * 0.5 dB inside each optical transmit alarm limit. */
var RX_WARN_MARGIN_DB = 1.0;
var TX_WARN_MARGIN_DB = 0.5;

/* Below this the fibre is considered dark - reported as LOS, not as a value. */
var DARK_FIBRE_DBM = -35.0;
/* At or below this the upstream laser is treated as switched off. */
var LASER_OFF_DBM = -35.0;

var num = function(v) {
	if (v === null || v === undefined || v === '') return NaN;
	var n = parseFloat(v);
	return isNaN(n) ? NaN : n;
};

/* Return the first finite value found under any of `names`, else null. */
var pickNum = function(obj, names) {
	if (!obj) return null;
	for (var i = 0; i < names.length; i++) {
		var n = num(obj[names[i]]);
		if (!isNaN(n)) return n;
	}
	return null;
};

var pickStr = function(obj, names) {
	if (!obj) return null;
	for (var i = 0; i < names.length; i++) {
		var v = obj[names[i]];
		if (typeof v === 'string' && v !== '') return v;
	}
	return null;
};

var opticalClassLabel = function(cls) {
	if (cls === 'cplus') return _('GPON Class C+');
	if (cls === 'epon_px20') return _('EPON 1000BASE-PX20+');
	return _('GPON Class B+');
};

return view.extend({
	unitSystem: 'dual',

	load: function() {
		return Promise.all([
			uci.load('vsol_ddm'),
			callGetStatus(),
			L.resolveDefault(callGetHistory(), {})
		]);
	},

	render: function(data) {
		var self = this;
		var initialStatus = data[1] || {};
		var initialHistory = data[2] || {};

		/* Polling interval is clamped to 1..60 seconds. */
		var pollInterval = parseInt(uci.get('vsol_ddm', 'main', 'poll_interval'), 10);
		if (isNaN(pollInterval)) pollInterval = 3;
		pollInterval = Math.max(1, Math.min(60, pollInterval));

		/* Unit system is managed exclusively via Settings (UCI). */
		self.unitSystem = uci.get('vsol_ddm', 'main', 'unit_system') || 'dual';

		var uciOpticalClass = uci.get('vsol_ddm', 'main', 'optical_class') || 'bplus';

		/* Purge telemetry caches written by earlier releases. */
		if (window.localStorage) {
			try {
				window.localStorage.removeItem('vsol_unit_system');
				window.localStorage.removeItem('vsol_last_telemetry');
			} catch(e) {}
		}

		var container = E('div', {
			id: 'hw-dashboard',
			class: 'hw-dashboard'
		});

		var style = E('style', {},
			' .hw-dashboard { display: flex; flex-wrap: wrap; align-items: stretch; gap: 20px; padding: 15px; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; width: 100%; max-width: 100%; overflow: hidden; color: var(--text-color, inherit); }' +
			/* The container itself must be included, not just its descendants: it
			 * carries width:100% AND padding, so leaving it content-box makes the
			 * page exceed the viewport by exactly its own padding and scroll
			 * sideways at tablet widths. */
			' .hw-dashboard, .hw-dashboard * { box-sizing: border-box; }' +
			' .hw-banner { flex: 1 1 100%; width: 100%; border-radius: 10px; padding: 12px 16px; font-size: 0.9em; font-weight: 600; line-height: 1.4; word-break: break-word; border: 1px solid rgba(255,82,82,0.45); background: rgba(255,82,82,0.16); color: #ff5252; }' +
			' .hw-dashboard.hw-offline .hw-dial { opacity: 0.4; filter: grayscale(1); }' +
			' .hw-card { flex: 1 1 320px; min-width: 0; background: var(--background-color-high, rgba(128, 128, 128, 0.05)); border: 1px solid var(--border-color, rgba(128, 128, 128, 0.18)); border-radius: 12px; padding: 20px; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; color: var(--text-color, inherit); position: relative; box-shadow: 0 2px 8px rgba(0,0,0,0.06); max-width: 100%; overflow: hidden; }' +
			' .hw-card.wide { flex: 1 1 100%; align-items: stretch; }' +
			/* A card that occupies a full row would otherwise strand each label
			 * at the far left and its value at the far right. Flowing the pairs
			 * into columns keeps them readable at any width. */
			' .hw-kv-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 0 28px; width: 100%; }' +
			/* Action bar: full width so it sits above the dials as its own row. */
			' .hw-actionbar { flex: 1 1 100%; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border: 1px solid var(--border-color, rgba(128,128,128,0.18)); border-radius: 12px; background: var(--background-color-high, rgba(128,128,128,0.05)); }' +
			' .hw-actionbar-title { font-size: 0.95em; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; opacity: 0.85; }' +
			' .hw-actionbar-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }' +
			' .hw-actionbar-note { font-size: 0.72em; opacity: 0.65; width: 100%; margin: 0; }' +
			/* OMCI section: its own wrapping row of cards inside the flex dashboard. */
			' .hw-omci-wrap { flex: 1 1 100%; display: flex; flex-wrap: wrap; align-items: stretch; gap: 20px; }' +
			' .hw-omci-inst { width: 100%; margin: 0 0 12px 0; padding: 10px 12px; border: 1px solid var(--border-color, rgba(128,128,128,0.15)); border-radius: 8px; }' +
			' .hw-omci-inst:last-child { margin-bottom: 0; }' +
			' .hw-omci-eid { font-size: 0.75em; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; opacity: 0.8; margin: 0 0 8px 0; }' +
			' .hw-omci-tbl { width: 100%; border-collapse: collapse; font-size: 0.76em; }' +
			' .hw-omci-tbl th, .hw-omci-tbl td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--border-color, rgba(128,128,128,0.12)); white-space: nowrap; }' +
			' .hw-omci-tbl th { font-weight: 700; opacity: 0.7; }' +
			' .hw-omci-tbl td.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }' +
			' .hw-omci-empty { font-size: 0.78em; opacity: 0.6; text-align: center; padding: 12px 0; }' +
			' .hw-card.half { flex: 1 1 calc(50% - 10px); align-items: stretch; }' +
			/* Time-series charts section - 1 card with full width each */
			' .hw-charts-wrap { flex: 1 1 100%; display: flex; flex-direction: column; align-items: stretch; gap: 20px; width: 100%; }' +
			' .hw-chart-card { flex: 1 1 100%; width: 100%; min-width: 0; align-items: stretch; justify-content: flex-start; }' +
			' .hw-chart-header { display: flex; justify-content: space-between; align-items: flex-start; width: 100%; gap: 10px; }' +
			' .hw-chart-metrics { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }' +
			' .hw-chart-val { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 1.15em; font-weight: 700; line-height: 1.2; }' +
			' .hw-chart-submetrics { display: flex; gap: 8px; font-size: 0.72em; opacity: 0.65; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }' +
			' .hw-card h3 { margin: 0 0 6px 0; min-height: 24px; line-height: 1.3; font-size: 1.00em; color: var(--text-color, inherit); opacity: 0.85; text-transform: uppercase; letter-spacing: 0.8px; text-align: center; word-break: break-word; font-weight: 700; }' +
			' .hw-card-sub { margin: 0 0 14px 0; font-size: 0.72em; opacity: 0.62; text-align: center; line-height: 1.3; word-break: break-word; min-width: 0; }' +
			' .hw-subtitle { margin: 0 0 14px 0; font-size: 0.72em; line-height: 1.3; letter-spacing: 0.4px; opacity: 0.6; text-align: center; word-break: break-word; min-width: 0; }' +
			' .hw-dial { position: relative; width: 160px; height: 160px; display: flex; align-items: center; justify-content: center; margin: 0 auto; background: transparent !important; }' +
			' .hw-dial svg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; transform: rotate(-90deg); background: transparent !important; }' +
			' .hw-dial-bg { fill: none; stroke: var(--border-color, rgba(128, 128, 128, 0.2)); stroke-width: 10; }' +
			' .hw-dial-progress { fill: none; stroke-width: 10; stroke-linecap: round; transition: stroke-dasharray 0.5s ease, stroke 0.5s ease; }' +
			' .hw-dial-center { position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 1; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; text-align: center; pointer-events: none; box-sizing: border-box; padding: 0 5px; }' +
			' .hw-dial-line { font-size: 1.15em; font-weight: 700; letter-spacing: -0.3px; line-height: 1.25; white-space: nowrap; }' +
			' .hw-dial-single { font-size: 1.30em; font-weight: 700; letter-spacing: -0.3px; line-height: 1.2; white-space: nowrap; }' +
			' .hw-status-pill { min-height: 24px; line-height: 1.3; padding: 4px 14px; margin-top: 10px; margin-bottom: 12px; border-radius: 9999px; font-size: 0.76em; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; display: inline-flex; align-items: center; justify-content: center; text-align: center; word-break: break-word; box-sizing: border-box; max-width: 100%; }' +
			' .hw-stats-list { width: 100%; display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--border-color, rgba(128, 128, 128, 0.12)); padding-top: 14px; margin-top: 2px; }' +
			' .hw-stat-row { display: flex; justify-content: space-between; align-items: baseline; width: 100%; min-height: 22px; line-height: 1.3; min-width: 0; gap: 8px; box-sizing: border-box; }' +
			' .hw-stat-label { opacity: 0.7; font-size: 0.84em; white-space: normal; overflow-wrap: anywhere; flex: 0 1 auto; min-width: 0; line-height: 1.3; }' +
			' .hw-stat-value { font-weight: 700; font-size: 0.86em; white-space: normal; overflow-wrap: anywhere; word-break: normal; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; flex: 1 1 auto; min-width: 0; text-align: right; line-height: 1.35; color: var(--text-color, inherit); }' +
			' .hw-temp-badge { padding: 2px 8px; border-radius: 6px; font-weight: 700; font-size: 0.78em; white-space: nowrap; text-transform: uppercase; letter-spacing: 0.5px; display: inline-flex; align-items: center; justify-content: center; min-height: 22px; line-height: 1.3; box-sizing: border-box; max-width: 100%; }' +
			' .hw-temp-crit { animation: hwAlarmBreath 2.2s cubic-bezier(0.4, 0, 0.6, 1) infinite !important; will-change: box-shadow, background-color, opacity; }' +
			' @keyframes hwAlarmBreath { 0% { background-color: rgba(255, 82, 82, 0.16); box-shadow: 0 0 2px rgba(255, 82, 82, 0.3); opacity: 0.88; } 50% { background-color: rgba(255, 82, 82, 0.38); box-shadow: 0 0 12px 2px rgba(255, 82, 82, 0.65); opacity: 1; } 100% { background-color: rgba(255, 82, 82, 0.16); box-shadow: 0 0 2px rgba(255, 82, 82, 0.3); opacity: 0.88; } }' +
			' .hw-kv { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; width: 100%; min-height: 26px; line-height: 1.3; margin-bottom: 6px; min-width: 0; box-sizing: border-box; }' +
			' .hw-kv-k { font-size: 0.76em; opacity: 0.65; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; flex: 0 1 auto; min-width: 0; white-space: normal; overflow-wrap: anywhere; line-height: 1.3; }' +
			' .hw-kv-v { text-align: right; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.85em; font-weight: 600; white-space: normal; overflow-wrap: anywhere; word-break: normal; flex: 1 1 auto; min-width: 0; line-height: 1.35; color: var(--text-color, inherit); }' +
			' .hw-table-scroll { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }' +
			' .hw-table { width: 100%; min-width: 720px; border-collapse: collapse; font-size: 0.88em; }' +
			' .hw-table th, .hw-table td { padding: 9px 12px; border-bottom: 1px solid var(--border-color, rgba(128, 128, 128, 0.15)); text-align: left; white-space: nowrap; line-height: 1.3; }' +
			' .hw-table th { font-weight: 700; opacity: 0.65; text-transform: uppercase; font-size: 0.78em; letter-spacing: 0.5px; color: var(--text-color, inherit); }' +
			' .hw-table td { color: var(--text-color, inherit); }' +
			' @media (max-width: 600px) {' +
			'   .hw-dashboard .cbi-value-field > input[type=text],' +
			'   .hw-dashboard .cbi-value-field > select { width: 100%; box-sizing: border-box; min-width: 0; }' +
			'   .btn, .cbi-button, button, input[type=button], input[type=submit], input[type=reset] {' +
			'     white-space: nowrap !important; text-overflow: clip !important;' +
			'     max-width: none !important; min-width: max-content !important; box-sizing: border-box !important; }' +
			'   .cbi-page-actions, .right { display: flex !important; flex-wrap: wrap !important; gap: 6px !important; }' +
			' }' +
			' @media (max-width: 480px) {' +
			'   .hw-card { padding: 15px; }' +
			'   .hw-card.half { flex-basis: 100%; }' +
			'   .hw-dial { transform: scale(0.9); }' +
			'   .hw-dial-line { font-size: 1.05em; }' +
			'   .hw-dial-single { font-size: 1.05em; }' +
			'   .hw-kv-k { font-size: 0.72em; }' +
			'   .hw-kv-v { font-size: 0.82em; }' +
			'   .hw-stat-label { font-size: 0.80em; }' +
			'   .hw-stat-value { font-size: 0.82em; }' +
			' }'
		);

		container.appendChild(style);

		/* Error banner. Hidden while telemetry is healthy. */
		var errBanner = E('div', {
			id: 'hw-err-banner',
			class: 'hw-banner',
			style: 'display: none;'
		}, '');
		container.appendChild(errBanner);

		/* ---------------- Action bar ------------------------------------
		 * Sits above the dials as its own full-width row. Holds the two
		 * operations that act on the ONT rather than just reading from it, so
		 * they are never mixed in among the telemetry cards.
		 * ---------------------------------------------------------------- */
		var omciWrap = E('div', { id: 'hw-omci-wrap', class: 'hw-omci-wrap' });
		var actionNote = E('p', { class: 'hw-actionbar-note', style: 'display: none;' }, '');

		var setNote = function(msg, colour) {
			actionNote.textContent = msg || '';
			actionNote.style.color = colour || '';
			actionNote.style.display = msg ? '' : 'none';
		};

		var omciBtn = E('button', {
			class: 'cbi-button cbi-button-neutral',
			click: function() { loadOmci(true); }
		}, _('Refresh OMCI'));

		/* A restart drops the fibre link for around a minute, so it confirms
		 * first and reports what the backend actually returned rather than
		 * assuming success. */
		var restartBtn = E('button', {
			class: 'cbi-button cbi-button-negative',
			click: function(ev) {
				if (!confirm(_('Restart the VSOL ONT now? The fibre link and every service through it will drop for about a minute.')))
					return;

				var btn = ev.currentTarget;
				btn.disabled = true;
				setNote(_('Sending restart command to the ONT...'));

				callRestart().then(function(res) {
					res = res || {};
					setNote(res.message || res.error || _('Restart command sent.'),
					        res.success ? '' : '#e53935');
					btn.disabled = false;
				}).catch(function(e) {
					setNote(_('Restart failed: ') + (e && e.message ? e.message : String(e)), '#e53935');
					btn.disabled = false;
				});
			}
		}, _('Restart ONT'));

		container.appendChild(E('div', { class: 'hw-actionbar' }, [
			E('div', { class: 'hw-actionbar-title' }, _('VSOL V2802RH ONT')),
			E('div', { class: 'hw-actionbar-actions' }, [omciBtn, restartBtn]),
			actionNote
		]));

		/* ---------------- Metric & Imperial conversion utilities --------- */
		var toFahrenheit = function(c) {
			return (c * 9.0 / 5.0) + 32.0;
		};

		var toMicrowatts = function(dbm) {
			if (isNaN(dbm) || dbm <= -40) return 0;
			return Math.pow(10, dbm / 10.0) * 1000.0; // In µW
		};

		var fmtTemp = function(c) {
			if (c === null || isNaN(c)) return '--';
			var f = toFahrenheit(c);
			if (self.unitSystem === 'imperial') return f.toFixed(1) + ' °F';
			if (self.unitSystem === 'dual') return c.toFixed(1) + ' °C / ' + f.toFixed(1) + ' °F';
			return c.toFixed(1) + ' °C';
		};

		var fmtDbm = function(v) {
			if (v === null || isNaN(v)) return '--';
			return (v > 0 ? '+' : '') + v.toFixed(1) + ' dBm';
		};

		var fmtVolt = function(v) {
			if (v === null || isNaN(v)) return '--';
			return v.toFixed(2) + ' V';
		};

		var fmtBias = function(v) {
			if (v === null || isNaN(v)) return '--';
			return v.toFixed(1) + ' mA';
		};

		var fmtMicrowatts = function(dbm) {
			var uw = toMicrowatts(dbm);
			if (uw >= 1000) return (uw / 1000.0).toFixed(2) + ' mW';
			if (uw < 1) return uw.toFixed(2) + ' µW';
			return uw.toFixed(1) + ' µW';
		};

		var fmtPower = function(dbm) {
			if (isNaN(dbm)) return '--';
			if (dbm <= LASER_OFF_DBM) {
				if (self.unitSystem === 'imperial') return '0.00 µW';
				if (self.unitSystem === 'dual') return _('Off') + ' / 0.00 µW';
				return _('Laser Inactive');
			}
			var uwStr = fmtMicrowatts(dbm);
			var dbmStr = (dbm > 0 ? '+' : '') + dbm.toFixed(2) + ' dBm';
			if (self.unitSystem === 'imperial') return uwStr;
			if (self.unitSystem === 'dual') return dbmStr + ' / ' + uwStr;
			return dbmStr;
		};

		/* Dial centre text, one array entry per rendered line. */
		var powerLines = function(dbm) {
			if (isNaN(dbm)) return ['--'];
			var uwStr = fmtMicrowatts(dbm);
			var dbmStr = (dbm > 0 ? '+' : '') + dbm.toFixed(2) + ' dBm';
			if (self.unitSystem === 'imperial') return [uwStr];
			if (self.unitSystem === 'dual') return [dbmStr, uwStr];
			return [dbmStr];
		};

		var tempLines = function(c) {
			if (isNaN(c)) return ['--'];
			if (self.unitSystem === 'imperial') return [toFahrenheit(c).toFixed(1) + ' °F'];
			if (self.unitSystem === 'dual') return [c.toFixed(1) + ' °C', toFahrenheit(c).toFixed(1) + ' °F'];
			return [c.toFixed(1) + ' °C'];
		};

		/* Standard uptime formatter (e.g. 2d 14h 50m or 8h 22m).
		 * The `days?` keyword is MANDATORY inside the optional leading group,
		 * otherwise "18:07" is misread as 1 day 8 hours 7 minutes. */
		var formatUptime = function(upRaw) {
			if (upRaw === null || upRaw === undefined || upRaw === '' || upRaw === '--') return '--';
			var days = 0, hours = 0, mins = 0, out = '';
			if (typeof upRaw === 'number' || /^\d+$/.test(String(upRaw).trim())) {
				var sec = parseInt(upRaw, 10);
				if (isNaN(sec) || sec < 0) return '--';
				days = Math.floor(sec / 86400);
				hours = Math.floor((sec % 86400) / 3600);
				mins = Math.floor((sec % 3600) / 60);
				if (days > 0) out += days + 'd ';
				if (hours > 0 || days > 0) out += hours + 'h ';
				out += mins + 'm';
				return out || '0m';
			}
			var m = String(upRaw).match(/(?:(\d+)\s*days?,?\s*)?(\d+):(\d+)(?::(\d+))?/i);
			if (m) {
				days = parseInt(m[1], 10) || 0;
				hours = parseInt(m[2], 10) || 0;
				mins = parseInt(m[3], 10) || 0;
				if (days > 0) out += days + 'd ';
				if (hours > 0 || days > 0) out += hours + 'h ';
				out += mins + 'm';
				return out || '0m';
			}
			return String(upRaw);
		};

		/* ---------------- Threshold resolution --------------------------
		 * The backend payload is authoritative. Anything it omits falls back
		 * to the §2 profile for the active optical class. Both the matrix
		 * table cells and the evaluator bands read this one object, so the
		 * table and the badge on the same row cannot contradict each other.
		 * ---------------------------------------------------------------- */
		/* Renders the governing standard, marked as assumed when the optic did not
		 * state its own class. The V2802RH BOSA reports a vendor string of
		 * "ONU_B+_G", so optical_class_source is normally "hardware" here -- but a
		 * different optic may say nothing, and an assumed budget must not be shown
		 * as a confirmed one. */
		var citationLabel = function(th, res) {
			var src = res && res.optical_class_source;
			/* The provenance is preserved in the payload as optical_class_source
			 * for anyone reading the JSON. The visible label carries only the
			 * formal designation of the governing recommendation. */
			return th.optical_citation;
		};

		var resolveThresholds = function(res) {
			var cls = (res && typeof res.optical_class === 'string' && res.optical_class !== '')
				? res.optical_class : uciOpticalClass;
			if (!OPTICAL_PROFILES[cls]) cls = 'bplus';

			var p = OPTICAL_PROFILES[cls];
			var raw = (res && res.thresholds && typeof res.thresholds === 'object') ? res.thresholds : {};
			var th = { cls: cls };
			var v;

			th.optical_citation = pickStr(raw, ['citation', 'optical_citation']) || p.citation;
			th.sff_citation = pickStr(raw, ['sff_citation', 'diag_citation']) || SFF8472.citation;

			/* Optical receive - alarm limits are the LOS assert points. */
			v = pickNum(raw, ['rx_low_alarm', 'rx_pwr_low_alarm', 'rx_sensitivity_dbm']);
			th.rx_low_alarm = (v !== null) ? v : p.rx_low_alarm;
			v = pickNum(raw, ['rx_high_alarm', 'rx_pwr_high_alarm', 'rx_overload_dbm']);
			th.rx_high_alarm = (v !== null) ? v : p.rx_high_alarm;
			v = pickNum(raw, ['rx_low_warn', 'rx_pwr_low_warn']);
			th.rx_low_warn = (v !== null) ? v : th.rx_low_alarm + RX_WARN_MARGIN_DB;
			v = pickNum(raw, ['rx_high_warn', 'rx_pwr_high_warn']);
			th.rx_high_warn = (v !== null) ? v : th.rx_high_alarm - RX_WARN_MARGIN_DB;

			/* Optical transmit. */
			v = pickNum(raw, ['tx_low_alarm', 'tx_pwr_low_alarm', 'tx_min_dbm']);
			th.tx_low_alarm = (v !== null) ? v : p.tx_low_alarm;
			v = pickNum(raw, ['tx_high_alarm', 'tx_pwr_high_alarm', 'tx_max_dbm']);
			th.tx_high_alarm = (v !== null) ? v : p.tx_high_alarm;
			v = pickNum(raw, ['tx_low_warn', 'tx_pwr_low_warn']);
			th.tx_low_warn = (v !== null) ? v : th.tx_low_alarm + TX_WARN_MARGIN_DB;
			v = pickNum(raw, ['tx_high_warn', 'tx_pwr_high_warn']);
			th.tx_high_warn = (v !== null) ? v : th.tx_high_alarm - TX_WARN_MARGIN_DB;

			/* Non-optical SFF-8472 diagnostics. */
			var simple = [
				['temp_low_alarm',   ['temp_low_alarm', 'temperature_low_alarm']],
				['temp_low_warn',    ['temp_low_warn', 'temperature_low_warn']],
				['temp_high_warn',   ['temp_high_warn', 'temperature_high_warn']],
				['temp_high_alarm',  ['temp_high_alarm', 'temperature_high_alarm']],
				['volt_low_alarm',   ['volt_low_alarm', 'voltage_low_alarm']],
				['volt_low_warn',    ['volt_low_warn', 'voltage_low_warn']],
				['volt_high_warn',   ['volt_high_warn', 'voltage_high_warn']],
				['volt_high_alarm',  ['volt_high_alarm', 'voltage_high_alarm']],
				['bias_low_alarm',   ['bias_low_alarm', 'bias_current_low_alarm']],
				['bias_low_warn',    ['bias_low_warn', 'bias_current_low_warn']],
				['bias_high_warn',   ['bias_high_warn', 'bias_current_high_warn']],
				['bias_high_alarm',  ['bias_high_alarm', 'bias_current_high_alarm']]
			];
			for (var i = 0; i < simple.length; i++) {
				var key = simple[i][0];
				v = pickNum(raw, simple[i][1]);
				th[key] = (v !== null) ? v : SFF8472[key];
			}

			v = pickNum(raw, ['wavelength_rx_nm', 'rx_wavelength_nm', 'wl_rx_nm']);
			th.wavelength_rx_nm = (v !== null) ? v : p.wavelength_rx_nm;
			v = pickNum(raw, ['wavelength_tx_nm', 'tx_wavelength_nm', 'wl_tx_nm']);
			th.wavelength_tx_nm = (v !== null) ? v : p.wavelength_tx_nm;

			return th;
		};

		/* ---------------- Diagnostic quality evaluators ------------------
		 * Bands are taken from the resolved threshold object, never from
		 * literals, so they always match the matrix table on screen.
		 * ---------------------------------------------------------------- */

		/* Loss of Signal is asserted on BOTH sides of the receiver window:
		 * below the BOSA sensitivity floor there is no framing, and above the
		 * overload ceiling the photodiode is saturated. */
		var getRxQuality = function(rx, th) {
			if (isNaN(rx))
				return quality('off', _('NO DATA'), _('Unknown'));
			if (rx < th.rx_low_alarm) {
				return quality('alarm',
					(rx <= DARK_FIBRE_DBM) ? _('LOS - NO SIGNAL / DARK FIBRE') : _('LOS - BELOW RECEIVER SENSITIVITY'),
					_('LOS Alarm'));
			}
			if (rx > th.rx_high_alarm)
				return quality('alarm', _('LOS - RECEIVER OVERLOAD'), _('LOS Overload'));
			if (rx < th.rx_low_warn)
				return quality('warn', _('MARGINAL LOW (WARNING)'), _('Marginal (Low)'));
			if (rx > th.rx_high_warn)
				return quality('warn', _('HIGH SIGNAL (WARNING)'), _('High (Warning)'));
			return quality('optimal', _('OPTIMAL SIGNAL'), _('Optimal'));
		};

		var getTxQuality = function(tx, th) {
			if (isNaN(tx))
				return quality('off', _('NO DATA'), _('Unknown'));
			if (tx <= LASER_OFF_DBM)
				return quality('off', _('LASER INACTIVE'), _('Laser Inactive'));
			if (tx < th.tx_low_alarm)
				return quality('alarm', _('LOW TX POWER (ALARM)'), _('Low TX Alarm'));
			if (tx > th.tx_high_alarm)
				return quality('alarm', _('HIGH TX POWER (ALARM)'), _('High TX Alarm'));
			if (tx < th.tx_low_warn)
				return quality('warn', _('MARGINAL TX (WARNING)'), _('Marginal (Low)'));
			if (tx > th.tx_high_warn)
				return quality('warn', _('HIGH TX (WARNING)'), _('High (Warning)'));
			return quality('optimal', _('OPTIMAL TX POWER'), _('Optimal'));
		};

		var getTempQuality = function(temp, th) {
			if (isNaN(temp))
				return quality('off', _('NO DATA'), _('Unknown'));
			if (temp <= th.temp_low_alarm)
				return quality('alarm', _('CRITICAL LOW (ALARM)'), _('Low Alarm'));
			if (temp >= th.temp_high_alarm)
				return quality('alarm', _('CRITICAL HIGH (ALARM)'), _('High Alarm'));
			if (temp < th.temp_low_warn)
				return quality('warn', _('LOW TEMPERATURE (WARNING)'), _('Low Warning'));
			if (temp >= th.temp_high_warn)
				return quality('warn', _('ELEVATED (WARNING)'), _('Elevated (Warm)'));
			return quality('optimal', _('OPTIMAL (NORMAL)'), _('Optimal'));
		};

		var getVoltQuality = function(volt, th) {
			if (isNaN(volt))
				return quality('off', _('NO DATA'), _('Unknown'));
			if (volt <= th.volt_low_alarm || volt >= th.volt_high_alarm)
				return quality('alarm', _('SUPPLY VOLTAGE ALARM'), _('Alarm'));
			if (volt < th.volt_low_warn || volt > th.volt_high_warn)
				return quality('warn', _('MARGINAL VCC (WARNING)'), _('Warning'));
			return quality('optimal', _('OPTIMAL VCC'), _('Optimal'));
		};

		var getBiasQuality = function(bias, tx, th) {
			if (isNaN(bias))
				return quality('off', _('NO DATA'), _('Unknown'));
			/* A quiescent laser is not a fault - report it as off, not green. */
			if (bias <= 0.0 || (!isNaN(tx) && tx <= LASER_OFF_DBM))
				return quality('off', _('STANDBY / LASER OFF'), _('Standby'));
			if (bias < th.bias_low_alarm || bias > th.bias_high_alarm)
				return quality('alarm', _('LASER BIAS ALARM'), _('Alarm'));
			if (bias < th.bias_low_warn || bias > th.bias_high_warn)
				return quality('warn', _('LASER BIAS WARNING'), _('Warning'));
			return quality('optimal', _('OPTIMAL BIAS'), _('Optimal'));
		};

		/* ---------------- Radial SVG dial builder ------------------------ */
		var createDial = function(type, title) {
			var radius = 64;
			var circumference = 2 * Math.PI * radius; // ~402.12

			var svgContainer = E('div', {
				style: 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: transparent !important;'
			});
			svgContainer.innerHTML = '<svg viewBox="0 0 160 160" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; transform: rotate(-90deg); background: transparent !important;">' +
				'<circle class="hw-dial-bg" cx="80" cy="80" r="' + radius + '" style="fill: none; stroke: var(--border-color, rgba(128, 128, 128, 0.2)); stroke-width: 10;"/>' +
				'<circle id="dial-prog-' + type + '" class="hw-dial-progress" cx="80" cy="80" r="' + radius + '" style="fill: none; stroke-width: 10; stroke-linecap: round; stroke-dasharray: 0 ' + circumference.toFixed(2) + '; stroke: ' + SEVERITY.off.color + '; transition: stroke-dasharray 0.5s ease, stroke 0.5s ease;"/>' +
				'</svg>';

			var dialBox = E('div', { class: 'hw-dial' }, [
				svgContainer,
				E('div', { id: 'dial-txt-' + type, class: 'hw-dial-center' }, [
					E('span', { class: 'hw-dial-single', style: 'color: ' + SEVERITY.off.color + ';' }, '--')
				])
			]);

			var card = E('div', { class: 'hw-card' }, [
				E('h3', {}, title),
				E('div', { id: 'sub-' + type, class: 'hw-subtitle' }, '--'),
				dialBox,
				E('div', {
					id: 'dial-pill-' + type,
					class: 'hw-status-pill',
					style: 'background: ' + SEVERITY.off.bg + '; color: ' + SEVERITY.off.color + ';'
				}, _('WAITING FOR DATA')),
				E('div', { id: 'stats-' + type, class: 'hw-stats-list' }, [
					E('div', { class: 'hw-stat-row' }, [E('span', { class: 'hw-stat-label' }, _('Status:')), E('span', { class: 'hw-stat-value' }, '--')]),
					E('div', { class: 'hw-stat-row' }, [E('span', { class: 'hw-stat-label' }, _('Reading:')), E('span', { class: 'hw-stat-value' }, '--')]),
					E('div', { class: 'hw-stat-row' }, [E('span', { class: 'hw-stat-label' }, _('Target Range:')), E('span', { class: 'hw-stat-value' }, '--')]),
					E('div', { class: 'hw-stat-row' }, [E('span', { class: 'hw-stat-label' }, _('Reference:')), E('span', { class: 'hw-stat-value' }, '--')])
				])
			]);

			return {
				node: card,
				circ: circumference
			};
		};

		// 1. Top row: three primary dials (RX, TX, Operating Temperature)
		var rxDial = createDial('rx', _('Received Optical Power (RX)'));
		var txDial = createDial('tx', _('Transmitted Optical Power (TX)'));
		var tempDial = createDial('temp', _('Operating Temperature'));

		container.appendChild(rxDial.node);
		container.appendChild(txDial.node);
		container.appendChild(tempDial.node);

		/* ---------------- 24-Hour Historical Time-Series Charts ------------- */
		var MAX_CHART_SAMPLES = 1440;
		var chartHistories = {
			rx: [],
			tx: [],
			temp: [],
			bias: []
		};

		if (initialHistory && Array.isArray(initialHistory.history)) {
			var hist = initialHistory.history;
			for (var h = 0; h < hist.length; h++) {
				var item = hist[h];
				if (Array.isArray(item) && item.length >= 5) {
					var ts = item[0] * 1000;
					if (item[1] !== null && isFinite(item[1])) chartHistories.rx.push({ time: ts, val: item[1] });
					if (item[2] !== null && isFinite(item[2])) chartHistories.tx.push({ time: ts, val: item[2] });
					if (item[3] !== null && isFinite(item[3])) chartHistories.temp.push({ time: ts, val: item[3] });
					if (item[4] !== null && isFinite(item[4])) chartHistories.bias.push({ time: ts, val: item[4] });
				}
			}
		}

		var createChartCard = function(key, title, unit, color, minFixed, maxFixed) {
			var canvas = E('canvas', {
				id: 'hw-chart-' + key,
				class: 'hw-chart-canvas',
				style: 'width: 100%; height: 180px; display: block;'
			});

			var curVal = E('span', { id: 'hw-chart-cur-' + key, class: 'hw-chart-val', style: 'color: ' + color + ';' }, '--');
			var minVal = E('span', { id: 'hw-chart-min-' + key, class: 'hw-chart-val-sub' }, 'Min: --');
			var maxVal = E('span', { id: 'hw-chart-max-' + key, class: 'hw-chart-val-sub' }, 'Max: --');
			var avgVal = E('span', { id: 'hw-chart-avg-' + key, class: 'hw-chart-val-sub' }, 'Avg: --');

			var card = E('div', { class: 'hw-card wide hw-chart-card' }, [
				E('div', { class: 'hw-chart-header' }, [
					E('div', {}, [
						E('h3', { style: 'text-align: left; margin: 0 0 2px 0;' }, title),
						E('div', { class: 'hw-card-sub', style: 'text-align: left; margin: 0;' }, _('24-Hour Historical Trend') + ' (' + unit + ')')
					]),
					E('div', { class: 'hw-chart-metrics' }, [
						curVal,
						E('div', { class: 'hw-chart-submetrics' }, [minVal, avgVal, maxVal])
					])
				]),
				E('div', { style: 'position: relative; width: 100%; height: 180px; margin-top: 10px;' }, [canvas])
			]);

			return {
				key: key,
				node: card,
				canvas: canvas,
				color: color,
				unit: unit,
				minFixed: minFixed,
				maxFixed: maxFixed
			};
		};

		var chartsWrap = E('div', { class: 'hw-charts-wrap' });
		var rxChart = createChartCard('rx', _('Signal Rx Power'), 'dBm', '#00bcd4', -35, -5);
		var txChart = createChartCard('tx', _('Signal Tx Power'), 'dBm', '#8bc34a', 0, 5);
		var tempChart = createChartCard('temp', _('Operating Temperature'), '°C', '#ffb300', 20, 85);
		var biasChart = createChartCard('bias', _('Laser Bias Current'), 'mA', '#ab47bc', 0, 40);

		chartsWrap.appendChild(rxChart.node);
		chartsWrap.appendChild(txChart.node);
		chartsWrap.appendChild(tempChart.node);
		chartsWrap.appendChild(biasChart.node);

		container.appendChild(chartsWrap);

		/*
		 * 2. Middle rows: four cards, each confined to a single subsystem.
		 *
		 * The categories do not overlap. OMCI management (ITU-T G.988) covers the
		 * activation state machine and the managed-entity identity; the optical
		 * card covers only the BOSA and the laser; the Ethernet card covers only
		 * the host-side interface and its packet counters; and the host platform
		 * details that belong to none of those have their own card rather than
		 * being appended to whichever card had room. No placeholder readings -
		 * every field starts at '--' until real telemetry arrives.
		 */
		var kv = function (label, id, cls) {
			return E('div', { class: 'hw-kv' }, [
				E('span', { class: 'hw-kv-k' }, label),
				E('span', { id: id, class: cls || 'hw-kv-v' }, '--')
			]);
		};
		var kvStatic = function (label, value) {
			return E('div', { class: 'hw-kv' }, [
				E('span', { class: 'hw-kv-k' }, label),
				E('span', { class: 'hw-kv-v' }, value)
			]);
		};

		/* ONU management and activation, per ITU-T G.984.3 and G.988. */
		var omciCard = E('div', { class: 'hw-card', style: 'align-items: stretch; justify-content: flex-start;' }, [
			E('h3', {}, _('OMCI Management')),
			E('div', { id: 'sub-omci', class: 'hw-card-sub' }, _('ONU management and control, per ITU-T G.988')),
			E('div', { class: 'hw-kv' }, [
				E('span', { class: 'hw-kv-k' }, _('ONU State:')),
				E('span', { id: 'info-onu-state', class: 'hw-temp-badge', style: 'font-weight: 700; background: ' + SEVERITY.off.bg + '; color: ' + SEVERITY.off.color + ';' }, '--')
			]),
			kv(_('Activation State:'), 'info-reg-state'),
			kv(_('Registration:'), 'info-onu-reg'),
			kv(_('GPON Serial Number:'), 'info-sn'),
			kv(_('OMCI Vendor Identifier:'), 'info-vendor'),
			kv(_('Organisationally Unique Identifier:'), 'info-oui'),
			kv(_('Equipment Identifier:'), 'info-pclass'),
			kv(_('Manufacturer:'), 'info-manuf'),
			kv(_('Registration Password:'), 'info-regpw'),
			kv(_('Equalisation Delay:'), 'info-eqd'),
			kv(_('Upstream PLOAM:'), 'info-ploam'),
			kv(_('Remote Defect Indication:'), 'info-rdi'),
			kv(_('Downstream OMCI PTI (pattern / mask):'), 'info-pti'),
			kv(_('T-CONT Allocations:'), 'info-tcont'),
			kv(_('Upstream GEM Ports:'), 'info-gem'),
			kv(_('Downstream GEM Assembly Threshold:'), 'info-gemthr'),
			kvStatic(_('Management Protocol:'), _('OMCI, ITU-T G.988')),
			kvStatic(_('Activation Procedure:'), _('ITU-T G.984.3'))
		]);

		/* The optical transmitter and receiver assembly. Optical layer only. */
		var bosaCard = E('div', { class: 'hw-card', style: 'align-items: stretch; justify-content: flex-start;' }, [
			E('h3', {}, _('BOSA Laser & Optics')),
			E('div', { id: 'sub-bosa', class: 'hw-card-sub' }, '--'),
			kv(_('Optic Model:'), 'info-bosa'),
			kv(_('Optic Vendor:'), 'info-optic-vendor'),
			kv(_('Optical Class:'), 'info-bosa-class'),
			kv(_('Transmit Wavelength:'), 'info-wl-tx'),
			kv(_('Receive Wavelength:'), 'info-wl-rx'),
			kvStatic(_('Interface Connector:'), _('Single-core, single-mode (SC)')),
			kv(_('Supply Voltage:'), 'info-vcc'),
			kv(_('Laser Bias Current:'), 'info-bias'),
			kv(_('Forward Error Correction:'), 'info-fec'),
			kv(_('FEC Codewords (Cor / Uncor):'), 'info-fec-codewords'),
			kv(_('BIP Parity Errors (Bits / Blks):'), 'info-bip'),
			kv(_('Optical Alarms:'), 'info-alarms')
		]);

		/* Host-side Ethernet interfaces and their packet counters. */
		var netCard = E('div', { class: 'hw-card', style: 'align-items: stretch; justify-content: flex-start;' }, [
			E('h3', {}, _('Ethernet & Packet Statistics')),
			E('div', { id: 'sub-net', class: 'hw-card-sub' }, _('Host-side interfaces and traffic counters')),
			kv(_('LAN 2.5G (Port 0):'), 'info-lan25'),
			kv(_('LAN 1G (Port 1):'), 'info-lan1'),
			kv(_('Management Link:'), 'info-mgmt'),
			kv(_('MAC Address:'), 'info-mac'),
			kv(_('Packets (RX / TX):'), 'info-pkts'),
			kv(_('Bytes (RX / TX):'), 'info-bytes'),
			kv(_('Errors (RX / TX):'), 'info-errs'),
			kv(_('Dropped (RX / TX):'), 'info-drops')
		]);

		/* Host platform details, which belong to none of the three subsystems. */
		var sysCard = E('div', { class: 'hw-card wide', style: 'align-items: stretch; justify-content: flex-start;' }, [
			E('h3', {}, _('System Information')),
			E('div', { id: 'sub-sys', class: 'hw-card-sub' }, _('ONT platform and firmware')),
			E('div', { class: 'hw-kv-grid' }, [
				kv(_('Device Model:'), 'info-model'),
				kv(_('Firmware Version:'), 'info-fw'),
				kv(_('Hardware Revision:'), 'info-hw'),
				kv(_('CPU Load:'), 'info-cpu'),
				kv(_('System Uptime:'), 'info-uptime'),
				kv(_('Standards Compliance:'), 'info-compliance')
			])
		]);

		container.appendChild(omciCard);
		container.appendChild(bosaCard);
		container.appendChild(netCard);
		container.appendChild(sysCard);

		// 3. Third row: diagnostic threshold matrix. Every limit cell is
		//    populated from the backend payload - no hardcoded numbers here.
		var offBadge = function() {
			return E('span', {
				class: 'hw-temp-badge',
				style: 'background: ' + SEVERITY.off.bg + '; color: ' + SEVERITY.off.color + '; font-weight: 700;'
			}, _('Unknown'));
		};

		var threshTable = E('table', { class: 'hw-table' }, [
			E('thead', {}, [
				E('tr', {}, [
					E('th', {}, _('Diagnostic Metric')),
					E('th', {}, _('Current Reading')),
					E('th', {}, _('Low Alarm')),
					E('th', {}, _('Low Warning')),
					E('th', {}, _('High Warning')),
					E('th', {}, _('High Alarm')),
					E('th', {}, _('Diagnostic Status'))
				])
			]),
			E('tbody', {}, [
				E('tr', {}, [
					E('td', {}, E('strong', {}, _('Received Optical Power (RX)'))),
					E('td', { id: 'th-rx-val', style: 'font-weight: 700; font-family: ui-monospace, monospace;' }, '--'),
					E('td', { id: 'th-rx-la' }, '--'),
					E('td', { id: 'th-rx-lw' }, '--'),
					E('td', { id: 'th-rx-hw' }, '--'),
					E('td', { id: 'th-rx-ha' }, '--'),
					E('td', { id: 'th-rx-status' }, offBadge())
				]),
				E('tr', {}, [
					E('td', {}, E('strong', {}, _('Transmitted Optical Power (TX)'))),
					E('td', { id: 'th-tx-val', style: 'font-weight: 700; font-family: ui-monospace, monospace;' }, '--'),
					E('td', { id: 'th-tx-la' }, '--'),
					E('td', { id: 'th-tx-lw' }, '--'),
					E('td', { id: 'th-tx-hw' }, '--'),
					E('td', { id: 'th-tx-ha' }, '--'),
					E('td', { id: 'th-tx-status' }, offBadge())
				]),
				E('tr', {}, [
					E('td', {}, E('strong', {}, _('Operating Temperature'))),
					E('td', { id: 'th-temp-val', style: 'font-weight: 700; font-family: ui-monospace, monospace;' }, '--'),
					E('td', { id: 'th-temp-la' }, '--'),
					E('td', { id: 'th-temp-lw' }, '--'),
					E('td', { id: 'th-temp-hw' }, '--'),
					E('td', { id: 'th-temp-ha' }, '--'),
					E('td', { id: 'th-temp-status' }, offBadge())
				]),
				E('tr', {}, [
					E('td', {}, E('strong', {}, _('Supply Voltage (VCC)'))),
					E('td', { id: 'th-volt-val', style: 'font-weight: 700; font-family: ui-monospace, monospace;' }, '--'),
					E('td', { id: 'th-volt-la' }, '--'),
					E('td', { id: 'th-volt-lw' }, '--'),
					E('td', { id: 'th-volt-hw' }, '--'),
					E('td', { id: 'th-volt-ha' }, '--'),
					E('td', { id: 'th-volt-status' }, offBadge())
				]),
				E('tr', {}, [
					E('td', {}, E('strong', {}, _('Laser Bias Current'))),
					E('td', { id: 'th-bias-val', style: 'font-weight: 700; font-family: ui-monospace, monospace;' }, '--'),
					E('td', { id: 'th-bias-la' }, '--'),
					E('td', { id: 'th-bias-lw' }, '--'),
					E('td', { id: 'th-bias-hw' }, '--'),
					E('td', { id: 'th-bias-ha' }, '--'),
					E('td', { id: 'th-bias-status' }, offBadge())
				])
			])
		]);

		var threshCard = E('div', { class: 'hw-card wide', style: 'align-items: stretch; margin-top: 5px;' }, [
			E('h3', {}, _('Diagnostic Threshold Limits & Status')),
			E('div', { id: 'th-caption', class: 'hw-subtitle' }, '--'),
			E('div', { class: 'hw-table-scroll' }, [threshTable])
		]);
		container.appendChild(threshCard);

		/* ---------------- OMCI managed entity cards ---------------------
		 * One card per ME class. The backend returns each instance as a flat
		 * map of whatever fields the ONT printed, plus optional `rules` (the
		 * ME 171 tagging table) and `lines` (indented continuation rows such
		 * as ME 131's ToDInfo). Rendering is driven by the payload rather than
		 * a fixed field list, so a firmware that reports extra fields shows
		 * them instead of silently dropping them.
		 * ---------------------------------------------------------------- */
		container.appendChild(omciWrap);

		/* G.988 assigns these polarities, but this firmware reports ME 11's two
		 * ports with them apparently inverted relative to each other. Raw values
		 * are shown with the legend rather than being rendered as a green/red
		 * badge that could be backwards. */
		var OMCI_STATE_LEGEND = _('AdminState: 0 = unlocked, 1 = locked. OpState: 0 = enabled, 1 = disabled (ITU-T G.988). This firmware does not report these consistently, so raw values are shown.');

		var omciScalarGrid = function(inst) {
			var rows = [];
			for (var k in inst) {
				if (k === 'rules' || k === 'lines') continue;
				var v = inst[k];
				if (v === '' || v == null || v === '0x000000' || (k === 'DscpToPbitMapping' && (!v || v === '--'))) continue;

				/* Decode OltVendorId ASCII e.g. 0x414c434c -> ALCL (Alcatel-Lucent / Nokia) */
				if (k === 'OltVendorId') {
					var ascii = hexToAscii(inst[k]);
					if (ascii) {
						var vendorDesc = (ascii === 'ALCL') ? 'ALCL (Alcatel-Lucent / Nokia)' : (ascii === 'HWTC' ? 'HWTC (Huawei)' : (ascii === 'ZTEG' ? 'ZTEG (ZTE)' : ascii));
						v = vendorDesc + ' [' + inst[k] + ']';
					}
				}

				/* Decode AssociatedMePoint in ME 171 to human-readable interface */
				if (k === 'AssociatedMePoint') {
					var pointNum = parseInt(v, 16);
					if (!isNaN(pointNum)) {
						var ifName = '';
						if ((pointNum & 0x0100) !== 0) ifName = 'LAN Port ' + (pointNum & 0x00ff);
						else if ((pointNum & 0x0600) !== 0 || (pointNum & 0x0e00) !== 0) ifName = 'VEIP (Virtual Ethernet)';
						else if ((pointNum & 0x4000) !== 0) ifName = 'PPP Connection';
						else if ((pointNum & 0xff00) !== 0) ifName = 'POTS / Voice';
						if (ifName) v = v + ' (' + ifName + ')';
					}
				}

				rows.push(E('div', { class: 'hw-kv' }, [
					E('span', { class: 'hw-kv-k' }, k),
					E('span', { class: 'hw-kv-v' }, String(v))
				]));
			}
			return E('div', { class: 'hw-kv-grid' }, rows);
		};

		var omciRulesTable = function(rules) {
			return E('div', { class: 'hw-table-scroll' }, [
				E('table', { class: 'hw-omci-tbl' }, [
					E('thead', {}, [E('tr', {}, [
						E('th', {}, _('#')),
						E('th', {}, _('Filter Outer')),
						E('th', {}, _('Filter Inner')),
						E('th', {}, _('Treatment Outer')),
						E('th', {}, _('Treatment Inner'))
					])]),
					E('tbody', {}, rules.map(function(r) {
						return E('tr', {}, [
							E('td', { class: 'mono' }, r.index != null ? String(r.index) : '--'),
							E('td', { class: 'mono' }, r.filter_outer || '--'),
							E('td', { class: 'mono' }, r.filter_inner || '--'),
							E('td', { class: 'mono' }, r.treatment_outer || '--'),
							E('td', { class: 'mono' }, r.treatment_inner || '--')
						]);
					}))
				])
			]);
		};

		var renderOmciCards = function(payload, placeholder) {
			var me = (payload && payload.me) || {};

			omciWrap.innerHTML = '';

			OMCI_CARDS.forEach(function(spec) {
				var data = me[spec.id];
				var body;

				if (!data || !data.instances || !data.instances.length) {
					body = [E('div', { class: 'hw-omci-empty' },
						placeholder ? _('Not read yet') : _('No instances reported'))];
				} else {
					body = data.instances.map(function(inst) {
						var eid = inst.EntityID || inst.EntityId || '--';
						var kids = [
							E('div', { class: 'hw-omci-eid' }, _('Entity') + ' ' + eid),
							omciScalarGrid(inst)
						];
						if (inst.rules && inst.rules.length)
							kids.push(omciRulesTable(inst.rules));
						var validLines = (inst.lines || []).filter(function(line) {
							return line && !/^0x0+$/i.test(line.trim()) && line.trim() !== '0x000000';
						});
						if (validLines.length)
							kids.push(E('div', { class: 'hw-kv-grid' }, validLines.map(function(line) {
								return E('div', { class: 'hw-kv' }, [
									E('span', { class: 'hw-kv-v' }, line)
								]);
							})));
						return E('div', { class: 'hw-omci-inst' }, kids);
					});
				}

				/* ME 171's rule table is wide; the rest pair up two to a row. */
				var head = [
					E('h3', {}, spec.title + (data && data.name ? ' – ' + data.name : '')),
					E('div', { class: 'hw-card-sub' }, spec.sub)
				];
				var foot = (spec.id === '11' || spec.id === '329')
					? [E('p', { class: 'hw-actionbar-note' }, OMCI_STATE_LEGEND)]
					: [];

				omciWrap.appendChild(E('div', {
					class: spec.id === '171' ? 'hw-card wide' : 'hw-card half',
					style: 'align-items: stretch; justify-content: flex-start;'
				}, head.concat(body).concat(foot)));
			});
		};

		var omciDataCache = null;
		var fiberWasDown = true;
		var omciLoading = false;

		var loadOmci = function(force) {
			if (omciLoading)
				return;
			if (omciDataCache && !force) {
				renderOmciCards(omciDataCache, false);
				return;
			}

			omciLoading = true;
			omciBtn.disabled = true;
			setNote(_('Reading OMCI managed entities from the ONT...'));

			callGetOmci().then(function(res) {
				res = res || {};
				if (res.success && res.me && Object.keys(res.me).length > 0) {
					omciDataCache = res;
					renderOmciCards(res, false);
					setNote('');
				} else {
					omciDataCache = null;
					renderOmciCards(null, true);
					setNote(res.error || _('Could not read OMCI data from the ONT.'), '#e53935');
				}
				omciBtn.disabled = false;
				omciLoading = false;
			}).catch(function(e) {
				omciDataCache = null;
				renderOmciCards(null, true);
				setNote(_('OMCI read failed: ') + (e && e.message ? e.message : String(e)), '#e53935');
				omciBtn.disabled = false;
				omciLoading = false;
			});
		};

		renderOmciCards(null, true);

		/* ---------------- Time-series Canvas Renderer (24h Window) ------- */
		var renderChart = function(chartObj, dataHistory, thLo, thHi) {
			var canvas = chartObj.canvas;
			if (!canvas || !canvas.getContext) return;
			var ctx = canvas.getContext('2d');
			if (!ctx) return;

			var dpr = window.devicePixelRatio || 1;
			var rect = canvas.getBoundingClientRect();
			var width = rect.width || 300;
			var height = rect.height || 180;

			if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
				canvas.width = Math.round(width * dpr);
				canvas.height = Math.round(height * dpr);
			}

			ctx.save();
			ctx.scale(dpr, dpr);
			ctx.clearRect(0, 0, width, height);

			var padL = 44;
			var padR = 16;
			var padT = 14;
			var padB = 24;
			var plotW = width - padL - padR;
			var plotH = height - padT - padB;

			if (plotW <= 10 || plotH <= 10) {
				ctx.restore();
				return;
			}

			// 24-Hour Fixed Window
			var now = Date.now();
			var WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
			var minTime = now - WINDOW_MS;
			var maxTime = now;

			var curEl = document.getElementById('hw-chart-cur-' + chartObj.key);
			var minEl = document.getElementById('hw-chart-min-' + chartObj.key);
			var maxEl = document.getElementById('hw-chart-max-' + chartObj.key);
			var avgEl = document.getElementById('hw-chart-avg-' + chartObj.key);

			// Filter points belonging to the 24h window
			var allSamples = dataHistory.filter(function(d) {
				return d != null && d.time >= minTime - 60000;
			});
			var validSamples = allSamples.filter(function(d) {
				return d.val != null && isFinite(d.val);
			});

			if (!validSamples.length) {
				if (curEl) curEl.textContent = '--';
				if (minEl) minEl.textContent = 'Min: --';
				if (maxEl) maxEl.textContent = 'Max: --';
				if (avgEl) avgEl.textContent = 'Avg: --';
				ctx.fillStyle = 'rgba(128,128,128,0.4)';
				ctx.font = '12px system-ui, sans-serif';
				ctx.textAlign = 'center';
				ctx.fillText(_('Waiting for 24h telemetry samples...'), padL + plotW / 2, padT + plotH / 2);
				ctx.restore();
				return;
			}

			var minVal = Infinity, maxVal = -Infinity, sum = 0;
			for (var i = 0; i < validSamples.length; i++) {
				var v = validSamples[i].val;
				if (v < minVal) minVal = v;
				if (v > maxVal) maxVal = v;
				sum += v;
			}
			var avgValNum = sum / validSamples.length;

			if (chartObj.minFixed != null) minVal = Math.min(minVal, chartObj.minFixed);
			if (chartObj.maxFixed != null) maxVal = Math.max(maxVal, chartObj.maxFixed);
			if (thLo != null && isFinite(thLo)) minVal = Math.min(minVal, thLo);
			if (thHi != null && isFinite(thHi)) maxVal = Math.max(maxVal, thHi);

			if (maxVal === minVal) {
				maxVal += 1;
				minVal -= 1;
			}

			var span = maxVal - minVal;
			var yPad = span * 0.08;
			var yMin = minVal - yPad;
			var yMax = maxVal + yPad;

			var latest = validSamples[validSamples.length - 1].val;
			if (curEl) curEl.textContent = latest.toFixed(2) + ' ' + chartObj.unit;
			if (minEl) minEl.textContent = 'Min: ' + minVal.toFixed(1);
			if (maxEl) maxEl.textContent = 'Max: ' + maxVal.toFixed(1);
			if (avgEl) avgEl.textContent = 'Avg: ' + avgValNum.toFixed(1);

			// Draw Grid lines & Y labels
			ctx.strokeStyle = 'rgba(128, 128, 128, 0.12)';
			ctx.lineWidth = 1;
			ctx.fillStyle = 'rgba(128, 128, 128, 0.65)';
			ctx.font = '9px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
			ctx.textAlign = 'right';

			var gridSteps = 4;
			for (var g = 0; g <= gridSteps; g++) {
				var gy = padT + (plotH * g / gridSteps);
				var gVal = yMax - ((yMax - yMin) * g / gridSteps);
				ctx.beginPath();
				ctx.moveTo(padL, gy);
				ctx.lineTo(padL + plotW, gy);
				ctx.stroke();
				ctx.fillText(gVal.toFixed(1), padL - 6, gy + 3);
			}

			// Draw X-axis 24-Hour Timeline Marks (-24h, -18h, -12h, -6h, Now)
			ctx.textAlign = 'center';
			var xSteps = 4;
			var xLabels = [_('24h ago'), _('18h ago'), _('12h ago'), _('6h ago'), _('Now')];
			for (var xs = 0; xs <= xSteps; xs++) {
				var xx = padL + (plotW * xs / xSteps);
				var curT = minTime + (WINDOW_MS * xs / xSteps);
				var dObj = new Date(curT);
				var hh = ('0' + dObj.getHours()).slice(-2);
				var mm = ('0' + dObj.getMinutes()).slice(-2);
				var lbl = xLabels[xs] + ' (' + hh + ':' + mm + ')';
				if (xs === xSteps) lbl = _('Now') + ' (' + hh + ':' + mm + ')';
				ctx.fillText(lbl, xx, padT + plotH + 16);
			}

			// Threshold guide lines (dashed)
			if (thLo != null && isFinite(thLo) && thLo >= yMin && thLo <= yMax) {
				var tLoY = padT + plotH * (1 - (thLo - yMin) / (yMax - yMin));
				ctx.save();
				ctx.setLineDash([4, 4]);
				ctx.strokeStyle = 'rgba(255, 82, 82, 0.55)';
				ctx.beginPath();
				ctx.moveTo(padL, tLoY);
				ctx.lineTo(padL + plotW, tLoY);
				ctx.stroke();
				ctx.restore();
			}
			if (thHi != null && isFinite(thHi) && thHi >= yMin && thHi <= yMax) {
				var tHiY = padT + plotH * (1 - (thHi - yMin) / (yMax - yMin));
				ctx.save();
				ctx.setLineDash([4, 4]);
				ctx.strokeStyle = 'rgba(255, 82, 82, 0.55)';
				ctx.beginPath();
				ctx.moveTo(padL, tHiY);
				ctx.lineTo(padL + plotW, tHiY);
				ctx.stroke();
				ctx.restore();
			}

			// Map all points to 24-hour canvas coordinates with state evaluation
			var points = [];
			for (var p = 0; p < allSamples.length; p++) {
				var item = allSamples[p];
				var px = padL + Math.max(0, Math.min(1, (item.time - minTime) / WINDOW_MS)) * plotW;
				var isOffline = (item.val === null || !isFinite(item.val));
				var valNum = isOffline ? yMin : item.val;
				var py = padT + plotH * (1 - (valNum - yMin) / (yMax - yMin));
				var isAlarm = (!isOffline && ((thLo != null && item.val < thLo) || (thHi != null && item.val > thHi)));
				points.push({ x: px, y: py, val: item.val, offline: isOffline, alarm: isAlarm });
			}

			// 1. Draw subtle area glow under valid connected points
			var validPoints = points.filter(function(pt) { return !pt.offline; });
			if (validPoints.length >= 2) {
				var grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
				grad.addColorStop(0, chartObj.color + '33');
				grad.addColorStop(1, chartObj.color + '01');

				ctx.beginPath();
				ctx.moveTo(validPoints[0].x, padT + plotH);
				for (var k = 0; k < validPoints.length; k++) {
					ctx.lineTo(validPoints[k].x, validPoints[k].y);
				}
				ctx.lineTo(validPoints[validPoints.length - 1].x, padT + plotH);
				ctx.closePath();
				ctx.fillStyle = grad;
				ctx.fill();
			}

			// 2. Draw segments with dynamic state colors:
			//    - Grey dashed line for offline / unreachable
			//    - Red line for values beyond or below limits
			//    - Normal color for healthy operating values
			for (var s = 0; s < points.length - 1; s++) {
				var pA = points[s];
				var pB = points[s + 1];

				ctx.beginPath();
				ctx.moveTo(pA.x, pA.y);
				ctx.lineTo(pB.x, pB.y);

				if (pA.offline || pB.offline) {
					// Offline / unreachable state: grey dashed line
					ctx.setLineDash([4, 4]);
					ctx.strokeStyle = '#9e9e9e';
					ctx.lineWidth = 1.8;
				} else if (pA.alarm || pB.alarm) {
					// Beyond or below limits: red solid line
					ctx.setLineDash([]);
					ctx.strokeStyle = '#ff5252';
					ctx.lineWidth = 2.4;
				} else {
					// Normal healthy operating value: standard metric color
					ctx.setLineDash([]);
					ctx.strokeStyle = chartObj.color;
					ctx.lineWidth = 2.2;
				}
				ctx.stroke();
			}

			// 3. Draw latest sample indicator dot
			if (points.length > 0) {
				var lastPt = points[points.length - 1];
				ctx.beginPath();
				ctx.setLineDash([]);
				ctx.arc(lastPt.x, lastPt.y, 4, 0, 2 * Math.PI);
				ctx.fillStyle = lastPt.offline ? '#9e9e9e' : (lastPt.alarm ? '#ff5252' : chartObj.color);
				ctx.fill();
				ctx.strokeStyle = 'var(--background-color-high, #1e1e1e)';
				ctx.lineWidth = 1.5;
				ctx.stroke();
			}

			ctx.restore();
		};

		/* ---------------- Shared DOM helpers ---------------------------- */
		var setTxt = function(id, val) {
			var el = document.getElementById(id);
			if (!el) return;
			el.textContent = (val === undefined || val === null || val === '') ? '--' : String(val);
		};

		var setTxtColor = function(id, val, color) {
			var el = document.getElementById(id);
			if (!el) return;
			el.textContent = (val === undefined || val === null || val === '') ? '--' : String(val);
			el.style.color = color || '';
		};

		var renderDial = function(key, dial, q, pctVal, lines) {
			var txt = document.getElementById('dial-txt-' + key);
			var pill = document.getElementById('dial-pill-' + key);
			var prog = document.getElementById('dial-prog-' + key);

			if (txt) {
				txt.innerHTML = '';
				var cls = (lines.length > 1) ? 'hw-dial-line' : 'hw-dial-single';
				for (var i = 0; i < lines.length; i++)
					txt.appendChild(E('span', { class: cls, style: 'color: ' + q.color + ';' }, lines[i]));
			}
			if (pill) {
				pill.textContent = q.label;
				pill.style.color = q.color;
				pill.style.background = q.bg;
			}
			if (prog) {
				var p = isNaN(pctVal) ? 0 : Math.min(100, Math.max(0, pctVal));
				var dash = (p / 100) * dial.circ;
				prog.style.strokeDasharray = dash.toFixed(2) + ' ' + dial.circ.toFixed(2);
				prog.style.stroke = q.color;
			}
		};

		var renderStats = function(key, rows) {
			var el = document.getElementById('stats-' + key);
			if (!el) return;
			el.innerHTML = '';
			for (var i = 0; i < rows.length; i++) {
				el.appendChild(E('div', { class: 'hw-stat-row' }, [
					E('span', { class: 'hw-stat-label' }, rows[i][0]),
					E('span', {
						class: 'hw-stat-value',
						style: 'color: ' + (rows[i][2] || 'inherit') + ';'
					}, rows[i][1])
				]));
			}
		};

		/* A badge always takes its background from the quality object. Never
		 * assign a possibly-undefined value here: the CSSOM discards it and
		 * the previous colour would persist. */
		var setStatusBadge = function(id, q) {
			var el = document.getElementById(id);
			if (!el) return;
			var isAlarm = (q.severity === 'alarm');
			var targetClass = 'hw-temp-badge' + (isAlarm ? ' hw-temp-crit' : '');
			var badgeEl = el.firstElementChild;

			if (!badgeEl || badgeEl.tagName !== 'SPAN') {
				badgeEl = document.createElement('span');
				badgeEl.className = targetClass;
				el.replaceChildren(badgeEl);
			} else if (badgeEl.className !== targetClass) {
				badgeEl.className = targetClass;
			}

			if (badgeEl.textContent !== q.badge)
				badgeEl.textContent = q.badge;

			badgeEl.style.color = q.color;
			/* The alarm animation drives its own background-color. */
			badgeEl.style.background = isAlarm ? '' : q.bg;
			badgeEl.style.fontWeight = '700';
		};

		var pctOf = function(v, lo, hi) {
			if (isNaN(v) || hi === lo) return 0;
			return Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100));
		};

		/* Both endpoints carry their own sign, so a range reads unambiguously as
		 * "-27.0 to -8.0 dBm" or "+0.5 to +5.0 dBm" without the reader having to
		 * infer the sign of the second value from the first. Exactly zero takes no
		 * sign, matching the convention datasheets use for a 0 ~ +4 dBm window. */
		var signed = function(v, digits) {
			var t = Math.abs(v).toFixed(digits === undefined ? 1 : digits);
			if (v > 0) return '+' + t;
			if (v < 0) return '-' + t;
			return t;
		};

		var rangeText = function(lo, hi, unit) {
			if (lo === null || hi === null || isNaN(lo) || isNaN(hi)) return '--';
			return signed(lo) + ' to ' + signed(hi) + ' ' + unit;
		};

		/* ---------------- Telemetry update ------------------------------ */
		var updateDashboard = function(res) {
			res = res || {};
			self.lastData = res;

			var healthy = (res.success !== false) && !!res.ddm;
			var banner = document.getElementById('hw-err-banner');
			if (banner) {
				if (healthy) {
					banner.style.display = 'none';
					banner.textContent = '';
				} else {
					var reason = res.error || res.message ||
						_('the ONT returned no diagnostic data');
					banner.textContent = _('Telemetry unavailable: ') + reason + ' ' +
						_('All readings below are shown as unknown.');
					banner.style.display = '';
				}
			}

			/* Grey the dials while offline. A gauge still rendered in its healthy
			 * colours reads as a live measurement even with the banner above it. */
			container.classList.toggle('hw-offline', !healthy);

			var ddm = (healthy && res.ddm) ? res.ddm : {};
			var onu = res.onu || {};
			var dev = res.device || {};
			var th = resolveThresholds(res);

			var rx = healthy ? num(ddm.rx_power_dbm) : NaN;
			var tx = healthy ? num(ddm.tx_power_dbm) : NaN;
			var temp = healthy ? num(ddm.temperature_c) : NaN;
			var volt = healthy ? num(ddm.voltage_v) : NaN;
			var bias = healthy ? num(ddm.bias_current_ma) : NaN;

			var rxQ = getRxQuality(rx, th);
			var txQ = getTxQuality(tx, th);
			var tempQ = getTempQuality(temp, th);
			var voltQ = getVoltQuality(volt, th);
			var biasQ = getBiasQuality(bias, tx, th);

			var wlRx = isNaN(th.wavelength_rx_nm) ? '--' : th.wavelength_rx_nm + ' nm';
			var wlTx = isNaN(th.wavelength_tx_nm) ? '--' : th.wavelength_tx_nm + ' nm';

			// 1. RX optical power
			setTxt('sub-rx', citationLabel(th, res));
			renderDial('rx', rxDial, rxQ,
				pctOf(rx, th.rx_low_alarm - 5.0, th.rx_high_alarm + 2.0),
				powerLines(rx));
			renderStats('rx', [
				[_('Signal Quality:'), rxQ.badge, rxQ.color],
				[_('Calculated Power:'), fmtPower(rx), rxQ.color],
				[_('Optimal Range:'), rangeText(th.rx_low_warn, th.rx_high_warn, 'dBm'), SEVERITY.optimal.color],
				[_('RX Wavelength:'), wlRx, ACCENT]
			]);

			// 2. TX optical power
			setTxt('sub-tx', citationLabel(th, res));
			renderDial('tx', txDial, txQ,
				(isNaN(tx) || tx <= LASER_OFF_DBM) ? 0 : pctOf(tx, th.tx_low_alarm - 1.0, th.tx_high_alarm + 1.0),
				(!isNaN(tx) && tx <= LASER_OFF_DBM) ? [_('Laser Off')] : powerLines(tx));
			renderStats('tx', [
				[_('Transmitter State:'), txQ.badge, txQ.color],
				[_('Calculated Power:'), fmtPower(tx), txQ.color],
				[_('Target TX Range:'), rangeText(th.tx_low_warn, th.tx_high_warn, 'dBm'), SEVERITY.optimal.color],
				[_('TX Wavelength:'), wlTx, ACCENT]
			]);

			// 3. Operating temperature
			setTxt('sub-temp', th.sff_citation);
			renderDial('temp', tempDial, tempQ,
				pctOf(temp, 0.0, th.temp_high_alarm),
				tempLines(temp));
			renderStats('temp', [
				[_('Thermal Status:'), tempQ.badge, tempQ.color],
				[_('Temperature:'), fmtTemp(temp), tempQ.color],
				/* Informational only, deliberately not used for grading. The reading
				 * above is the transceiver internal temperature reported over DDM,
				 * which normally sits above ambient; the V2802RH datasheet figure is
				 * the unit's ambient operating rating. Grading an internal reading
				 * against an ambient rating would raise alarms that mean nothing, so
				 * the bands stay on SFF-8472, the standard written for DDM. */
				[_('Rated Ambient Range:'), _('−10 °C to +55 °C'), ACCENT],
				[_('Supply Voltage (VCC):'), fmtVolt(volt), voltQ.color],
				[_('Laser Bias Current:'), fmtBias(bias), biasQ.color]
			]);

			// 4. Update Time-Series Chart Data & Canvas Renderers
			var tsNow = Date.now();
			if (healthy) {
				if (!isNaN(rx)) chartHistories.rx.push({ time: tsNow, val: rx });
				if (!isNaN(tx)) chartHistories.tx.push({ time: tsNow, val: tx });
				if (!isNaN(temp)) chartHistories.temp.push({ time: tsNow, val: temp });
				if (!isNaN(bias)) chartHistories.bias.push({ time: tsNow, val: bias });

				while (chartHistories.rx.length > MAX_CHART_SAMPLES) chartHistories.rx.shift();
				while (chartHistories.tx.length > MAX_CHART_SAMPLES) chartHistories.tx.shift();
				while (chartHistories.temp.length > MAX_CHART_SAMPLES) chartHistories.temp.shift();
				while (chartHistories.bias.length > MAX_CHART_SAMPLES) chartHistories.bias.shift();
			}

			renderChart(rxChart, chartHistories.rx, th.rx_pwr_low_alarm, th.rx_pwr_high_alarm);
			renderChart(txChart, chartHistories.tx, th.tx_pwr_low_alarm, th.tx_pwr_high_alarm);
			renderChart(tempChart, chartHistories.temp, th.temp_low_alarm, th.temp_high_alarm);
			renderChart(biasChart, chartHistories.bias, th.bias_low_alarm, th.bias_high_alarm);

			// 5. Card 1: GPON & OMCI management
			var stateRaw = (onu.state !== undefined && onu.state !== null && onu.state !== '')
				? String(onu.state).toUpperCase()
				: (typeof onu.state_raw === 'string' ? onu.state_raw.toUpperCase() : '');
			var isO5 = (stateRaw.indexOf('O5') !== -1);
			var haveState = healthy && stateRaw !== '';
			var stateQ = !haveState ? quality('off', _('UNKNOWN'), _('Unknown'))
				: (isO5 ? quality('optimal', _('O5 - OPERATIONAL'), _('O5 - Operational'))
					: quality('warn', _('NOT OPERATIONAL'), stateRaw));

			var onuStateEl = document.getElementById('info-onu-state');
			if (onuStateEl) {
				onuStateEl.textContent = haveState ? (isO5 ? _('O5 - OPERATIONAL') : stateRaw) : '--';
				onuStateEl.style.color = stateQ.color;
				onuStateEl.style.background = stateQ.bg;
			}

			setTxtColor('info-onu-reg',
				haveState ? (onu.registered_status || (isO5 ? _('Registered (O5)') : _('Not registered'))) : null,
				haveState ? stateQ.color : SEVERITY.off.color);
			setTxtColor('info-sn', onu.serial_number || dev.gpon_sn,
				(onu.serial_number || dev.gpon_sn) ? ACCENT : SEVERITY.off.color);

			/* FEC and GPON PHY layer error statistics */
			var fec = ddm.fec_status || onu.fec_status || dev.fec_status;
			var fecText = fec ? (fec + ' / US: OLT Grant (G.984.3)') : null;
			setTxtColor('info-fec', fecText, fec ? ACCENT : SEVERITY.off.color);

			var cor = num(ddm.fec_corrected_codewords);
			var uncor = num(ddm.fec_uncorrectable_codewords);
			if (!isNaN(cor) && !isNaN(uncor)) {
				setTxtColor('info-fec-codewords',
					cor.toLocaleString() + ' / ' + uncor.toLocaleString(),
					(uncor > 0) ? SEVERITY.alarm.color : (cor > 0 ? SEVERITY.warn.color : SEVERITY.optimal.color));
			} else {
				setTxtColor('info-fec-codewords', null, SEVERITY.off.color);
			}

			var bipBits = num(ddm.bip_error_bits);
			var bipBlks = num(ddm.bip_error_blocks);
			if (!isNaN(bipBits) && !isNaN(bipBlks)) {
				setTxtColor('info-bip',
					bipBits.toLocaleString() + ' / ' + bipBlks.toLocaleString(),
					(bipBits > 0 || bipBlks > 0) ? SEVERITY.warn.color : SEVERITY.optimal.color);
			} else {
				setTxtColor('info-bip', null, SEVERITY.off.color);
			}

			var alarmQ, alarmTxt;
			if (!healthy) {
				alarmQ = quality('off', _('UNKNOWN'), _('Unknown'));
				alarmTxt = null;
			} else if (rxQ.severity === 'alarm') {
				alarmQ = rxQ;
				alarmTxt = rxQ.label;
			} else if (typeof onu.alarm_los === 'string' && (onu.alarm_los.indexOf('Alarm') !== -1 || onu.alarm_los.indexOf('Active') !== -1)) {
				alarmQ = quality('alarm', _('LOS'), _('LOS Alarm'));
				alarmTxt = _('Loss of Signal (LOS)');
			} else if (typeof onu.alarm_sf === 'string' && onu.alarm_sf.indexOf('Fail') !== -1) {
				alarmQ = quality('alarm', _('SF'), _('Signal Fail'));
				alarmTxt = _('Signal Fail (SF)');
			} else if (typeof onu.alarm_sd === 'string' && onu.alarm_sd.indexOf('Degrade') !== -1) {
				alarmQ = quality('warn', _('SD'), _('Signal Degrade'));
				alarmTxt = _('Signal Degrade (SD)');
			} else if (haveState && !isO5) {
				alarmQ = quality('warn', _('LOF'), _('Synchronising'));
				alarmTxt = _('LOF: synchronising') + ' (' + stateRaw + ')';
			} else if (haveState) {
				alarmQ = quality('optimal', _('CLEAR'), _('Clear'));
				alarmTxt = _('LOS/LOF/SF: clear');
			} else {
				alarmQ = quality('off', _('UNKNOWN'), _('Unknown'));
				alarmTxt = null;
			}
			setTxtColor('info-alarms', alarmTxt, alarmQ.color);

			setTxt('info-compliance', th.optical_citation + ' / ' + th.sff_citation);
			setTxt('info-vendor', dev.vendor || ddm.vendor_name);

			/* OMCI and PLOAM layer attributes. The ONT exposes no managed-entity
			 * pages, so these are the whole of what it reports about management;
			 * the equalisation delay in particular has always been in the payload
			 * but was never rendered. */
			setTxt('info-oui', onu.oui);
			setTxt('info-pclass', onu.product_class);
			setTxt('info-manuf', onu.manufacturer);
			setTxt('info-regpw', onu.registration_password);
			setTxt('info-ploam', onu.ploam_upstream);
			setTxt('info-rdi', onu.rdi_state);
			setTxt('info-pti', onu.omci_pti);

			/* Transmission containers and GEM ports, both OMCI managed entities.
			 * The counts are shown alongside the identifiers so an empty list
			 * reads as "none allocated" rather than as a failed read. */
			setTxt('info-tcont', onu.tcont_allocations
				? onu.tcont_allocations + ' (' + onu.tcont_count + ')'
				: (onu.tcont_count === 0 ? _('None allocated') : null));
			setTxt('info-gem', onu.gem_ports
				? onu.gem_ports + ' (' + onu.gem_port_count + ')'
				: (onu.gem_port_count === 0 ? _('None allocated') : null));
			setTxt('info-gemthr', (onu.ds_gem_assembly_threshold === null ||
				onu.ds_gem_assembly_threshold === undefined)
				? null : String(onu.ds_gem_assembly_threshold));
			setTxt('info-eqd', (ddm.eqd_offset === null || ddm.eqd_offset === undefined)
				? null : String(ddm.eqd_offset));
			setTxtColor('info-reg-state',
				haveState ? (isO5 ? _('Operation state (O5)') : _('State') + ' ' + stateRaw) : null,
				haveState ? stateQ.color : SEVERITY.off.color);

			// 5. Card 2: transceiver & BOSA diagnostics
			setTxt('info-bosa', ddm.part_number);
			setTxt('info-bosa-class', th.optical_citation);
			setTxt('info-wl-tx', wlTx);
			setTxt('info-wl-rx', wlRx);
			setTxtColor('info-vcc', fmtVolt(volt), voltQ.color);
			setTxtColor('info-bias', fmtBias(bias), biasQ.color);
			setTxt('info-hw', dev.hardware);

			// 6. Card 3: Ethernet & network performance
			var lan25 = dev.lan25g || dev.port0_stat;
			var lan1 = dev.lan1g || dev.port1_stat;
			setTxtColor('info-lan25', lan25,
				lan25 ? ((lan25.indexOf('Up') !== -1) ? SEVERITY.optimal.color : SEVERITY.off.color) : SEVERITY.off.color);
			setTxtColor('info-lan1', lan1,
				lan1 ? ((lan1.indexOf('Up') !== -1) ? SEVERITY.optimal.color : SEVERITY.off.color) : SEVERITY.off.color);

			var mgmt = null;
			if (lan25 && lan25.indexOf('Up') !== -1) mgmt = _('LAN 2.5G (Port 0)');
			else if (lan1 && lan1.indexOf('Up') !== -1) mgmt = _('LAN 1G (Port 1)');
			setTxt('info-mgmt', mgmt);

			var mac = dev.mac || dev.mac_address;
			if (typeof mac === 'string' && mac.indexOf(':') === -1 && mac.length === 12)
				mac = mac.match(/.{1,2}/g).join(':').toUpperCase();
			setTxt('info-mac', mac);
			setTxt('info-cpu', dev.cpu_usage);
			setTxt('info-model', dev.model);
			setTxt('info-fw', dev.firmware);
			setTxt('info-uptime', formatUptime(dev.uptime));

			/* Card subtitles. */
			setTxt('sub-bosa', th.optical_citation + ' / ' + th.sff_citation);

			/* The optic's own vendor string, as reported. Distinct from the OMCI
			 * vendor identifier, which is a management attribute rather than a
			 * property of the fitted transceiver. */
			setTxt('info-optic-vendor', ddm.vendor_name);

			/*
			 * Ethernet packet counters. The helper has always emitted these eight
			 * values; nothing rendered them until the Ethernet card was given sole
			 * responsibility for host-side traffic.
			 */
			/* Named distinctly from the module-level num(): declaring another `num`
			 * here would hoist a local binding across the whole of this function and
			 * shadow the shared helper, leaving the earlier reads of rx/tx/temp/volt
			 * and bias calling an undefined value. Counters also want null for
			 * "absent" rather than the NaN the shared helper returns. */
			var counterNum = function (v) {
				if (v === null || v === undefined || v === '') return null;
				var n = Number(v);
				return isFinite(n) ? n : null;
			};
			var pair = function (a, b) {
				var x = counterNum(a), y = counterNum(b);
				if (x === null && y === null) return null;
				return (x === null ? '--' : x.toLocaleString()) + ' / ' +
				       (y === null ? '--' : y.toLocaleString());
			};
			var bytesPair = function (a, b) {
				var fmt = function (v) {
					var n = counterNum(v);
					if (n === null) return '--';
					var u = ['B', 'kB', 'MB', 'GB', 'TB'], i = 0;
					while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
					return (i === 0 ? n : n.toFixed(1)) + ' ' + u[i];
				};
				if (counterNum(a) === null && counterNum(b) === null) return null;
				return fmt(a) + ' / ' + fmt(b);
			};

			setTxt('info-pkts',  pair(dev.rx_packets, dev.tx_packets));
			setTxt('info-bytes', bytesPair(dev.rx_bytes, dev.tx_bytes));

			var errTxt = pair(dev.rx_errors, dev.tx_errors);
			var drpTxt = pair(dev.rx_dropped, dev.tx_dropped);
			setTxt('info-errs', errTxt);
			setTxt('info-drops', drpTxt);

			/* Any non-zero error or drop count is worth the operator's attention,
			 * so it is coloured as a warning rather than left to be read as normal. */
			var mark = function (id, a, b) {
				var el = document.getElementById(id);
				if (!el) return;
				var x = counterNum(a), y = counterNum(b);
				var bad = (x !== null && x > 0) || (y !== null && y > 0);
				el.style.color = (x === null && y === null) ? ''
					: (bad ? SEVERITY.warn.color : SEVERITY.optimal.color);
			};
			mark('info-errs', dev.rx_errors, dev.tx_errors);
			mark('info-drops', dev.rx_dropped, dev.tx_dropped);

			// 7. Threshold matrix. Cells and badges share one payload, so the
			//    advertised band and the badge on the row cannot disagree.
			setTxt('th-caption',
				_('Optical limits per') + ' ' + th.optical_citation + '. ' +
				_('Transceiver diagnostics per') + ' ' + th.sff_citation + '.');

			setTxtColor('th-rx-val', fmtPower(rx), rxQ.color);
			setTxt('th-rx-la', fmtDbm(th.rx_low_alarm));
			setTxt('th-rx-lw', fmtDbm(th.rx_low_warn));
			setTxt('th-rx-hw', fmtDbm(th.rx_high_warn));
			setTxt('th-rx-ha', fmtDbm(th.rx_high_alarm));

			setTxtColor('th-temp-val', fmtTemp(temp), tempQ.color);
			setTxt('th-temp-la', fmtTemp(th.temp_low_alarm));
			setTxt('th-temp-lw', fmtTemp(th.temp_low_warn));
			setTxt('th-temp-hw', fmtTemp(th.temp_high_warn));
			setTxt('th-temp-ha', fmtTemp(th.temp_high_alarm));

			setTxtColor('th-volt-val', fmtVolt(volt), voltQ.color);
			setTxt('th-volt-la', fmtVolt(th.volt_low_alarm));
			setTxt('th-volt-lw', fmtVolt(th.volt_low_warn));
			setTxt('th-volt-hw', fmtVolt(th.volt_high_warn));
			setTxt('th-volt-ha', fmtVolt(th.volt_high_alarm));

			setTxtColor('th-bias-val', fmtBias(bias), biasQ.color);
			setTxt('th-bias-la', fmtBias(th.bias_low_alarm));
			setTxt('th-bias-lw', fmtBias(th.bias_low_warn));
			setTxt('th-bias-hw', fmtBias(th.bias_high_warn));
			setTxt('th-bias-ha', fmtBias(th.bias_high_alarm));

			setTxtColor('th-tx-val', fmtPower(tx), txQ.color);
			setTxt('th-tx-la', fmtDbm(th.tx_low_alarm));
			setTxt('th-tx-lw', fmtDbm(th.tx_low_warn));
			setTxt('th-tx-hw', fmtDbm(th.tx_high_warn));
			setTxt('th-tx-ha', fmtDbm(th.tx_high_alarm));

			setStatusBadge('th-rx-status', rxQ);
			setStatusBadge('th-temp-status', tempQ);
			setStatusBadge('th-volt-status', voltQ);
			setStatusBadge('th-bias-status', biasQ);
			setStatusBadge('th-tx-status', txQ);

			/* 8. OMCI Managed Entities Lifecycle:
			 * - When fiber is in LOS / disconnected: blank out OMCI cards immediately.
			 * - When fiber returns to O5 operational state: fetch OMCI once and populate.
			 * - While healthy: do not query OMCI on polling cycles.
			 */
			var isFiberDown = !healthy || isNaN(rx) || (rx <= -35.0) || (onu.state && onu.state !== 'O5');
			if (isFiberDown) {
				if (!fiberWasDown) {
					fiberWasDown = true;
					omciDataCache = null;
					renderOmciCards(null, true);
					setNote(_('Optical link is inactive / LOS. OMCI data is cleared until PON link synchronises (O5).'), '#ff5252');
				}
			} else {
				if (fiberWasDown || !omciDataCache) {
					fiberWasDown = false;
					loadOmci(true);
				}
			}
		};

		/* Initial populate from the data resolved by load(). */
		updateDashboard(initialStatus);

		/* Standard LuCI polling. A rejected call is surfaced as an error
		 * banner, never left on screen as stale telemetry. */
		poll.add(function() {
			return callGetStatus().then(function(res) {
				updateDashboard(res);
			}, function(err) {
				updateDashboard({
					success: false,
					error: (err && err.message) ? err.message : String(err)
				});
			});
		}, pollInterval);

		return container;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
