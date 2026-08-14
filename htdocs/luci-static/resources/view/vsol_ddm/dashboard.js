'use strict';
'require view';
'require rpc';
'require poll';
'require dom';
'require uci';

var callGetStatus = rpc.declare({
	object: 'vsol_ddm',
	method: 'get_status',
	expect: {}
});

return view.extend({
	unitSystem: 'dual',

	load: function() {
		return Promise.all([
			uci.load('vsol_ddm'),
			callGetStatus()
		]);
	},

	render: function(data) {
		var self = this;
		var uciConfig = data[0];
		var initialStatus = data[1] || {};
		var pollInterval = parseInt(uci.get('vsol_ddm', 'main', 'poll_interval')) || 3;
		// Unit system is managed exclusively via Settings (UCI)
		self.unitSystem = uci.get('vsol_ddm', 'main', 'unit_system') || 'dual';
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
			' .hw-dashboard * { box-sizing: border-box; }' +
			' .hw-thermals-container { display: flex; flex-direction: row; width: 100%; height: 100%; }' +
			' .hw-thermals-col { flex: 1; min-width: 0; }' +
			' .hw-thermals-col-left { padding-right: 15px; }' +
			' .hw-thermals-col-mid { padding: 0 15px; }' +
			' .hw-thermals-col-right { padding-left: 15px; }' +
			' .hw-thermals-title { font-size: 0.85em; opacity: 0.65; margin-bottom: 14px; text-transform: uppercase; letter-spacing: 0.8px; font-weight: 700; text-align: center; }' +
			' .hw-thermals-divider { width: 1px; background: var(--border-color, rgba(128,128,128,0.18)); margin: 10px 15px; }' +
			' @media (max-width: 768px) { .hw-thermals-container { flex-direction: column; } .hw-thermals-col { padding: 0 !important; } .hw-thermals-divider { width: auto; height: 1px; margin: 18px 0; } }' +
			' .hw-card { flex: 1 1 280px; background: var(--background-color-high, rgba(128, 128, 128, 0.05)); border: 1px solid var(--border-color, rgba(128, 128, 128, 0.18)); border-radius: 12px; padding: 20px; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; color: var(--text-color, inherit); position: relative; box-shadow: 0 2px 8px rgba(0,0,0,0.06); max-width: 100%; overflow: hidden; }' +
			' .hw-card.wide { flex: 1 1 100%; align-items: stretch; }' +
			' .hw-card.half { flex: 1 1 calc(50% - 10px); align-items: stretch; }' +
			' @media (max-width: 480px) { .hw-card { padding: 15px; } .hw-card.half { flex-basis: 100%; } .hw-dial { transform: scale(0.9); } }' +
			' .hw-card h3 { margin: 0 0 16px 0; font-size: 1.05em; color: var(--text-color, inherit); opacity: 0.85; text-transform: uppercase; letter-spacing: 1px; text-align: center; word-break: break-word; line-height: 1.3; font-weight: 700; }' +
			' .hw-dial { position: relative; width: 160px; height: 160px; display: flex; align-items: center; justify-content: center; margin: 0 auto; background: transparent !important; }' +
			' .hw-dial svg { position: absolute; top: 0; left: 0; width: 160px; height: 160px; transform: rotate(-90deg); background: transparent !important; }' +
			' .hw-dial-bg { fill: none; stroke: var(--border-color, rgba(128, 128, 128, 0.2)); stroke-width: 10; }' +
			' .hw-dial-progress { fill: none; stroke-width: 10; stroke-linecap: round; transition: stroke-dasharray 0.5s ease, stroke 0.5s ease; }' +
			' .hw-dial-center { position: absolute; top: 0; left: 0; width: 160px; height: 160px; display: flex; flex-direction: column; align-items: center; justify-content: center; z-index: 1; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; text-align: center; pointer-events: none; box-sizing: border-box; padding: 0 5px; }' +
			' .hw-dial-line { font-size: 1.16em; font-weight: 700; letter-spacing: -0.3px; line-height: 1.25; white-space: nowrap; }' +
			' .hw-dial-single { font-size: 1.32em; font-weight: 700; letter-spacing: -0.3px; line-height: 1.2; white-space: nowrap; }' +
			' .hw-status-pill { margin-top: 10px; margin-bottom: 12px; padding: 4px 14px; border-radius: 9999px; font-size: 0.76em; font-weight: 700; letter-spacing: 0.6px; text-transform: uppercase; display: inline-flex; align-items: center; justify-content: center; text-align: center; white-space: nowrap; }' +
			' .hw-stats-list { width: 100%; display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--border-color, rgba(128, 128, 128, 0.12)); padding-top: 14px; margin-top: 2px; }' +
			' .hw-stat-row { display: flex; justify-content: space-between; align-items: center; width: 100%; min-width: 0; }' +
			' .hw-stat-label { opacity: 0.7; font-size: 0.85em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1 1 auto; margin-right: 8px; }' +
			' .hw-stat-value { font-weight: 700; font-size: 0.88em; white-space: nowrap; font-family: ui-monospace, monospace; flex: 0 0 auto; text-align: right; color: var(--text-color, inherit); }' +
			' .hw-temp-badge { padding: 4px 10px; border-radius: 6px; font-weight: 700; font-size: 0.82em; white-space: nowrap; text-transform: uppercase; letter-spacing: 0.5px; display: inline-flex; align-items: center; justify-content: center; }' +
			' .hw-temp-crit { animation: hwTempPulse 1.1s ease-in-out infinite; }' +
			' @keyframes hwTempPulse { 0%, 100% { box-shadow: 0 0 3px rgba(225,29,72,0.5); } 50% { box-shadow: 0 0 14px rgba(225,29,72,0.95); } }' +
			' .hw-kv { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; margin-bottom: 9px; }' +
			' .hw-kv-k { font-size: 0.75em; opacity: 0.6; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600; flex: 0 0 auto; }' +
			' .hw-kv-v { text-align: right; font-family: ui-monospace, monospace; font-size: 0.88em; font-weight: 600; word-break: break-all; color: var(--text-color, inherit); }' +
			' .hw-table { width: 100%; border-collapse: collapse; font-size: 0.88em; }' +
			' .hw-table th, .hw-table td { padding: 9px 12px; border-bottom: 1px solid var(--border-color, rgba(128, 128, 128, 0.15)); text-align: left; }' +
			' .hw-table th { font-weight: 700; opacity: 0.65; text-transform: uppercase; font-size: 0.78em; letter-spacing: 0.5px; color: var(--text-color, inherit); }' +
			' .hw-table td { color: var(--text-color, inherit); }'
		);

		container.appendChild(style);

		// Metric & Imperial Conversion Utilities
		var toFahrenheit = function(c) {
			return (c * 9.0 / 5.0) + 32.0;
		};

		var toMicrowatts = function(dbm) {
			if (isNaN(dbm) || dbm <= -40) return 0;
			return Math.pow(10, dbm / 10.0) * 1000.0; // In µW
		};

		var fmtTemp = function(c) {
			if (isNaN(c)) return '--';
			var f = toFahrenheit(c);
			if (self.unitSystem === 'imperial') return f.toFixed(1) + ' °F';
			if (self.unitSystem === 'dual') return c.toFixed(1) + ' °C / ' + f.toFixed(1) + ' °F';
			return c.toFixed(1) + ' °C';
		};

		var fmtPower = function(dbm) {
			if (isNaN(dbm) || dbm <= -35) {
				return self.unitSystem === 'dual' ? 'Off / 0.00 µW' : (self.unitSystem === 'imperial' ? '0.00 µW' : 'Laser Inactive');
			}
			var uw = toMicrowatts(dbm);
			var uwStr = uw < 1 ? uw.toFixed(2) + ' µW' : (uw >= 1000 ? (uw / 1000.0).toFixed(2) + ' mW' : uw.toFixed(1) + ' µW');
			if (self.unitSystem === 'imperial') return uwStr;
			if (self.unitSystem === 'dual') return dbm.toFixed(2) + ' dBm / ' + uwStr;
			return dbm.toFixed(2) + ' dBm';
		};

		// Standard Uptime Formatter (e.g. 2d 14h 50m or 8h 22m)
		var formatUptime = function(upRaw) {
			if (!upRaw || upRaw === '--') return '--';
			if (typeof upRaw === 'number' || /^\d+$/.test(String(upRaw).trim())) {
				var sec = parseInt(upRaw);
				var days = Math.floor(sec / 86400);
				var hours = Math.floor((sec % 86400) / 3600);
				var mins = Math.floor((sec % 3600) / 60);
				var out = '';
				if (days > 0) out += days + 'd ';
				if (hours > 0 || days > 0) out += hours + 'h ';
				out += mins + 'm';
				return out || '0m';
			}
			var m = String(upRaw).match(/(?:(\d+)\s*(?:days?)?,?\s*)?(\d+):(\d+)(?::(\d+))?/i);
			if (m) {
				var days = parseInt(m[1]) || 0;
				var hours = parseInt(m[2]) || 0;
				var mins = parseInt(m[3]) || 0;
				var out = '';
				if (days > 0) out += days + 'd ';
				if (hours > 0 || days > 0) out += hours + 'h ';
				out += mins + 'm';
				return out || '0m';
			}
			return upRaw;
		};

		// Diagnostic Quality & Official Standards Evaluator (ITU-T G.984 / SFF-8472 / IEEE 802.3ah)
		var getRxQuality = function(rx) {
			if (isNaN(rx) || rx <= -35.0) {
				return { color: '#64748b', bg: 'rgba(100,116,139,0.18)', label: _('NO SIGNAL'), badge: _('No Signal'), severity: 'off' };
			}
			// ITU-T Standard Optical Link Health Grading:
			// Optimal / Best: -13.0 to -24.0 dBm (Green)
			// Marginal / Low Warning: -24.1 to -27.5 dBm (Yellow / Amber)
			// High Warning: -8.0 to -12.9 dBm (Yellow / Amber)
			// Alarm / Worst: < -27.5 dBm (Critical Low) OR > -8.0 dBm (Overload) (Red)
			if (rx <= -27.5) {
				return { color: '#ef4444', bg: 'rgba(239,68,68,0.15)', label: _('CRITICAL LOW (ALARM)'), badge: _('Critical Low'), severity: 'alarm' };
			}
			if (rx < -24.0) {
				return { color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', label: _('MARGINAL LOW (WARN)'), badge: _('Marginal (Low)'), severity: 'warn' };
			}
			if (rx > -8.0) {
				return { color: '#ef4444', bg: 'rgba(239,68,68,0.15)', label: _('SIGNAL OVERLOAD (ALARM)'), badge: _('Overload Alarm'), severity: 'alarm' };
			}
			if (rx > -13.0) {
				return { color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', label: _('HIGH SIGNAL (WARN)'), badge: _('High (Warning)'), severity: 'warn' };
			}
			return { color: '#10b981', bg: 'rgba(16,185,129,0.15)', label: _('OPTIMAL SIGNAL (BEST)'), badge: _('Optimal'), severity: 'optimal' };
		};

		var getTxQuality = function(tx) {
			if (isNaN(tx) || tx <= -35.0) {
				return { color: '#64748b', bg: 'rgba(100,116,139,0.18)', label: _('LASER INACTIVE'), badge: _('Inactive'), severity: 'off' };
			}
			// ITU-T Standard Optical Transmit Grading:
			// Optimal / Best: +1.5 to +4.5 dBm (Green)
			// Marginal: +0.5 to +1.4 dBm OR +4.6 to +5.0 dBm (Yellow)
			// Alarm: < +0.5 dBm OR > +5.0 dBm (Red)
			if (tx < 0.5) {
				return { color: '#ef4444', bg: 'rgba(239,68,68,0.15)', label: _('LOW TX POWER (ALARM)'), badge: _('Low Tx Alarm'), severity: 'alarm' };
			}
			if (tx < 1.5) {
				return { color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', label: _('MARGINAL TX (WARN)'), badge: _('Marginal Tx'), severity: 'warn' };
			}
			if (tx > 5.0) {
				return { color: '#ef4444', bg: 'rgba(239,68,68,0.15)', label: _('HIGH TX (ALARM)'), badge: _('High Tx Alarm'), severity: 'alarm' };
			}
			if (tx > 4.5) {
				return { color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', label: _('HIGH TX (WARN)'), badge: _('High Tx Warn'), severity: 'warn' };
			}
			return { color: '#10b981', bg: 'rgba(16,185,129,0.15)', label: _('OPTIMAL TX (BEST)'), badge: _('Optimal'), severity: 'optimal' };
		};

		var getTempQuality = function(temp) {
			if (isNaN(temp)) {
				return { color: '#64748b', bg: 'rgba(100,116,139,0.18)', label: _('UNKNOWN'), badge: _('Unknown'), severity: 'off' };
			}
			// Operating Temperature Grading:
			// Optimal (Cool): < 55.0 °C (Green)
			// Elevated (Warm): 55.0 °C to 69.9 °C (Yellow / Amber)
			// Critical High (Alarm): >= 70.0 °C (Red)
			// Low Warning: < 15.0 °C (Yellow)
			// Low Alarm: <= 0.0 °C (Red)
			if (temp >= 70.0) {
				return { color: '#ef4444', bg: 'rgba(239,68,68,0.15)', label: _('CRITICAL TEMP (ALARM)'), badge: _('High Alarm'), severity: 'alarm' };
			}
			if (temp >= 55.0) {
				return { color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', label: _('ELEVATED (WARM)'), badge: _('Warm / Elevated'), severity: 'warn' };
			}
			if (temp <= 0.0) {
				return { color: '#ef4444', bg: 'rgba(239,68,68,0.15)', label: _('LOW TEMP (ALARM)'), badge: _('Low Alarm'), severity: 'alarm' };
			}
			if (temp < 15.0) {
				return { color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', label: _('LOW TEMP (WARN)'), badge: _('Low Temp'), severity: 'warn' };
			}
			return { color: '#10b981', bg: 'rgba(16,185,129,0.15)', label: _('OPTIMAL (COOL)'), badge: _('Optimal'), severity: 'optimal' };
		};

		var getVoltQuality = function(volt) {
			if (isNaN(volt)) {
				return { color: '#64748b', bg: 'rgba(100,116,139,0.18)', label: _('UNKNOWN'), badge: _('Unknown'), severity: 'off' };
			}
			if (volt < 3.05 || volt > 3.55) {
				return { color: '#ef4444', bg: 'rgba(239,68,68,0.15)', label: _('VOLTAGE ALARM'), badge: _('Alarm'), severity: 'alarm' };
			}
			if (volt < 3.15 || volt > 3.45) {
				return { color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', label: _('MARGINAL VCC'), badge: _('Warning'), severity: 'warn' };
			}
			return { color: '#10b981', bg: 'rgba(16,185,129,0.15)', label: _('OPTIMAL (3.3V)'), badge: _('Optimal'), severity: 'optimal' };
		};

		var getBiasQuality = function(bias, tx) {
			if (isNaN(bias) || bias <= 0.0 || (tx !== undefined && tx <= -35)) {
				return { color: '#64748b', bg: 'rgba(100,116,139,0.18)', label: _('STANDBY / OFF'), badge: _('Standby'), severity: 'off' };
			}
			if (bias > 45.0 || bias < 1.0) {
				return { color: '#ef4444', bg: 'rgba(239,68,68,0.15)', label: _('BIAS ALARM'), badge: _('Alarm'), severity: 'alarm' };
			}
			if (bias > 25.0 || bias < 5.0) {
				return { color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', label: _('ELEVATED BIAS'), badge: _('Warning'), severity: 'warn' };
			}
			return { color: '#10b981', bg: 'rgba(16,185,129,0.15)', label: _('OPTIMAL BIAS'), badge: _('Optimal'), severity: 'optimal' };
		};

		// Circular Dial Generator
		var createDial = function(id, title) {
			var radius = 70;
			var circumference = 2 * Math.PI * radius;

			var svgContainer = E('div', {
				id: 'dial-svg-' + id,
				style: 'position:absolute; top:0; left:0; width:160px; height:160px; background:transparent !important;'
			});
			svgContainer.innerHTML = '<svg viewBox="0 0 160 160" style="background:transparent !important; width:160px; height:160px;">' +
				'<circle class="hw-dial-bg" cx="80" cy="80" r="' + radius + '"/>' +
				'<circle id="dial-prog-' + id + '" class="hw-dial-progress" cx="80" cy="80" r="' + radius + '" style="stroke: #00acc1; stroke-dasharray: 0 ' + circumference + ';"/>' +
				'</svg>';

			var dialBox = E('div', {
				class: 'hw-dial',
				style: 'background:transparent !important;'
			}, [
				svgContainer,
				E('div', { id: 'dial-txt-' + id, class: 'hw-dial-center' }, '--')
			]);

			var statusPill = E('div', {
				id: 'dial-pill-' + id,
				class: 'hw-status-pill',
				style: 'background: rgba(128,128,128,0.15); color: var(--text-color, inherit);'
			}, '--');

			var card = E('div', {
				class: 'hw-card',
				id: 'card-' + id
			}, [
				E('h3', { id: 'title-' + id }, title),
				dialBox,
				statusPill,
				E('div', { id: 'stats-' + id, class: 'hw-stats-list' })
			]);

			return {
				node: card,
				circ: circumference
			};
		};

		// 1. Top Row: 3 Primary Dials
		var rxDial = createDial('rx', _('Received Optical Power (RX)'));
		var tempDial = createDial('temp', _('Operating Temperature'));
		var onuDial = createDial('onu', _('ONU & Link Status'));

		container.appendChild(rxDial.node);
		container.appendChild(tempDial.node);
		container.appendChild(onuDial.node);

		// 2. Second Row: Hardware Telemetry Card
		var infoCard = E('div', { class: 'hw-card wide', style: 'align-items: stretch; margin-top: 5px;' }, [
			E('h3', {}, _('Transceiver & ONT System Information')),
			E('div', { class: 'hw-thermals-container' }, [
				// Column 1: Device & GPON Identification
				E('div', { class: 'hw-thermals-col hw-thermals-col-left' }, [
					E('div', { class: 'hw-thermals-title' }, _('Device Identification')),
					E('div', { class: 'hw-kv' }, [E('span', { class: 'hw-kv-k' }, _('Model:')), E('span', { id: 'info-model', class: 'hw-kv-v' }, 'V2802RH')]),
					E('div', { class: 'hw-kv' }, [E('span', { class: 'hw-kv-k' }, _('Vendor:')), E('span', { id: 'info-vendor', class: 'hw-kv-v' }, 'VSOL')]),
					E('div', { class: 'hw-kv' }, [E('span', { class: 'hw-kv-k' }, _('GPON SN:')), E('span', { id: 'info-sn', class: 'hw-kv-v', style: 'color: #00acc1; font-weight: 700;' }, 'NKOT2F04917E')]),
					E('div', { class: 'hw-kv' }, [E('span', { class: 'hw-kv-k' }, _('MAC Address:')), E('span', { id: 'info-mac', class: 'hw-kv-v' }, 'B4:64:15:31:71:25')]),
					E('div', { class: 'hw-kv' }, [E('span', { class: 'hw-kv-k' }, _('Hardware Revision:')), E('span', { id: 'info-hw', class: 'hw-kv-v' }, '8671x')]),
					E('div', { class: 'hw-kv' }, [E('span', { class: 'hw-kv-k' }, _('System Uptime:')), E('span', { id: 'info-uptime', class: 'hw-kv-v' }, '--')])
				]),
				E('div', { class: 'hw-thermals-divider' }),
				// Column 2: Optical & Firmware Specifications
				E('div', { class: 'hw-thermals-col hw-thermals-col-mid' }, [
					E('div', { class: 'hw-thermals-title' }, _('Optical & OMCI Specifications')),
					E('div', { class: 'hw-kv' }, [E('span', { class: 'hw-kv-k' }, _('Optical Transceiver:')), E('span', { id: 'info-bosa', class: 'hw-kv-v' }, 'GN25L95')]),
					E('div', { class: 'hw-kv' }, [E('span', { class: 'hw-kv-k' }, _('Wavelengths:')), E('span', { class: 'hw-kv-v' }, '1310 nm TX / 1490 nm RX')]),
					E('div', { class: 'hw-kv' }, [E('span', { class: 'hw-kv-k' }, _('Optical Interface:')), E('span', { class: 'hw-kv-v' }, 'SC-APC (Single Mode)')]),
					E('div', { class: 'hw-kv' }, [E('span', { class: 'hw-kv-k' }, _('Standard Compliance:')), E('span', { class: 'hw-kv-v' }, 'ITU-T G.984 / SFF-8472')]),
					E('div', { class: 'hw-kv' }, [E('span', { class: 'hw-kv-k' }, _('Firmware Version:')), E('span', { id: 'info-fw', class: 'hw-kv-v' }, 'V1.1.8')]),
					E('div', { class: 'hw-kv' }, [E('span', { class: 'hw-kv-k' }, _('Transceiver Class:')), E('span', { id: 'info-bosa-vendor', class: 'hw-kv-v' }, 'Class B+ BOSA')])
				]),
				E('div', { class: 'hw-thermals-divider' }),
				// Column 3: Network & Interface Status
				E('div', { class: 'hw-thermals-col hw-thermals-col-right' }, [
					E('div', { class: 'hw-thermals-title' }, _('Network & Ethernet Status')),
					E('div', { class: 'hw-kv' }, [
						E('span', { class: 'hw-kv-k' }, _('LAN 1G (Port 1):')),
						E('span', { id: 'info-lan1', class: 'hw-kv-v', style: 'color: #00acc1; font-weight: 700;' }, 'Up, 1000M Full (In Use)')
					]),
					E('div', { class: 'hw-kv' }, [
						E('span', { class: 'hw-kv-k' }, _('LAN 2.5G (Port 0):')),
						E('span', { id: 'info-lan25', class: 'hw-kv-v' }, 'Up, 2.5G Full')
					]),
					E('div', { class: 'hw-kv' }, [E('span', { class: 'hw-kv-k' }, _('Module CPU Load:')), E('span', { id: 'info-cpu', class: 'hw-kv-v' }, '1%')]),
					E('div', { class: 'hw-kv' }, [E('span', { class: 'hw-kv-k' }, _('Management Link:')), E('span', { class: 'hw-kv-v' }, 'LAN 1G (Port 1)')]),
					E('div', { class: 'hw-kv' }, [E('span', { class: 'hw-kv-k' }, _('Registration State:')), E('span', { id: 'info-reg-state', class: 'hw-kv-v', style: 'color: #00acc1; font-weight: 700;' }, 'Operation State (O5)')])
				])
			])
		]);
		container.appendChild(infoCard);

		// 3. Third Row: Diagnostic Threshold Matrix & Alarms (Wide Card)
		var threshCard = E('div', { class: 'hw-card wide', style: 'align-items: stretch; margin-top: 5px;' }, [
			E('h3', {}, _('SFF-8472 Diagnostic Threshold Limits & Status')),
			E('table', { class: 'hw-table' }, [
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
						E('td', { id: 'th-rx-val', style: 'font-weight: 700; font-family: ui-monospace, monospace;' }, '-- dBm'),
						E('td', { id: 'th-rx-la' }, '-28.0 dBm'),
						E('td', { id: 'th-rx-lw' }, '-27.0 dBm'),
						E('td', { id: 'th-rx-hw' }, '-9.0 dBm'),
						E('td', { id: 'th-rx-ha' }, '-8.0 dBm'),
						E('td', { id: 'th-rx-status' }, E('span', { class: 'hw-temp-badge', style: 'background: rgba(128,128,128,0.15); color: inherit;' }, _('Checking')))
					]),
					E('tr', {}, [
						E('td', {}, E('strong', {}, _('Operating Temperature'))),
						E('td', { id: 'th-temp-val', style: 'font-weight: 700; font-family: ui-monospace, monospace;' }, '-- °C'),
						E('td', { id: 'th-temp-la' }, '-40.0 °C / -40.0 °F'),
						E('td', { id: 'th-temp-lw' }, '-10.0 °C / 14.0 °F'),
						E('td', { id: 'th-temp-hw' }, '75.0 °C / 167.0 °F'),
						E('td', { id: 'th-temp-ha' }, '85.0 °C / 185.0 °F'),
						E('td', { id: 'th-temp-status' }, E('span', { class: 'hw-temp-badge', style: 'background: rgba(0,172,193,0.15); color: #00acc1;' }, _('Nominal')))
					]),
					E('tr', {}, [
						E('td', {}, E('strong', {}, _('Supply Voltage (VCC)'))),
						E('td', { id: 'th-volt-val', style: 'font-weight: 700; font-family: ui-monospace, monospace;' }, '-- V'),
						E('td', {}, '2.90 V'),
						E('td', {}, '3.05 V'),
						E('td', {}, '3.55 V'),
						E('td', {}, '3.70 V'),
						E('td', { id: 'th-volt-status' }, E('span', { class: 'hw-temp-badge', style: 'background: rgba(0,172,193,0.15); color: #00acc1;' }, _('Nominal')))
					]),
					E('tr', {}, [
						E('td', {}, E('strong', {}, _('Laser Bias Current'))),
						E('td', { id: 'th-bias-val', style: 'font-weight: 700; font-family: ui-monospace, monospace;' }, '-- mA'),
						E('td', {}, '1.0 mA'),
						E('td', {}, '2.0 mA'),
						E('td', {}, '60.0 mA'),
						E('td', {}, '70.0 mA'),
						E('td', { id: 'th-bias-status' }, E('span', { class: 'hw-temp-badge', style: 'background: rgba(0,172,193,0.15); color: #00acc1;' }, _('Nominal')))
					]),
					E('tr', {}, [
						E('td', {}, E('strong', {}, _('Transmitted Optical Power (TX)'))),
						E('td', { id: 'th-tx-val', style: 'font-weight: 700; font-family: ui-monospace, monospace;' }, '-- dBm'),
						E('td', {}, '0.5 dBm'),
						E('td', {}, '1.0 dBm'),
						E('td', {}, '4.5 dBm'),
						E('td', {}, '5.0 dBm'),
						E('td', { id: 'th-tx-status' }, E('span', { class: 'hw-temp-badge', style: 'background: rgba(0,172,193,0.15); color: #00acc1;' }, _('Nominal')))
					])
				])
			])
		]);
		container.appendChild(threshCard);

		// Telemetry Update Function
		var updateDashboard = function(res) {
			if (!res || !res.ddm) return;
			self.lastData = res;

			// Save to localStorage for instant subsequent loads
			if (window.localStorage) {
				try {
					window.localStorage.setItem('vsol_last_telemetry', JSON.stringify(res));
				} catch(e) {}
			}

			var ddm = res.ddm;
			var onu = res.onu || {};
			var dev = res.device || {};
			var th = res.thresholds || {};

			var rx = parseFloat(ddm.rx_power_dbm);
			var tx = parseFloat(ddm.tx_power_dbm);
			var temp = parseFloat(ddm.temperature_c);
			var volt = parseFloat(ddm.voltage_v);
			var bias = parseFloat(ddm.bias_current_ma);

			// Diagnostic Quality & Official Standards Evaluator
			var rxQ = getRxQuality(rx);
			var txQ = getTxQuality(tx);
			var tempQ = getTempQuality(temp);
			var voltQ = getVoltQuality(volt);
			var biasQ = getBiasQuality(bias, tx);

			// 1. RX Power Dial
			var rxTxt = document.getElementById('dial-txt-rx');
			var rxPill = document.getElementById('dial-pill-rx');
			var rxProg = document.getElementById('dial-prog-rx');
			var rxStats = document.getElementById('stats-rx');

			var rxPct = Math.min(100, Math.max(0, ((rx + 40) / 32) * 100));
			var rxDash = (rxPct / 100) * rxDial.circ;

			if (rxTxt) {
				rxTxt.innerHTML = '';
				if (self.unitSystem === 'dual') {
					var uwVal = toMicrowatts(rx);
					var uwFormatted = (uwVal < 1 ? uwVal.toFixed(2) : (uwVal >= 1000 ? (uwVal/1000).toFixed(1) : uwVal.toFixed(1))) + (uwVal >= 1000 ? ' mW' : ' µW');
					rxTxt.appendChild(E('span', { class: 'hw-dial-line', style: 'color: ' + rxQ.color + ';' }, (isNaN(rx) ? '--' : rx.toFixed(1)) + ' dBm'));
					rxTxt.appendChild(E('span', { class: 'hw-dial-line', style: 'color: ' + rxQ.color + ';' }, uwFormatted));
				} else if (self.unitSystem === 'imperial') {
					var uw = toMicrowatts(rx);
					var uwSingle = (uw < 1 ? uw.toFixed(2) : (uw >= 1000 ? (uw/1000).toFixed(2) : uw.toFixed(1))) + (uw >= 1000 ? ' mW' : ' µW');
					rxTxt.appendChild(E('span', { class: 'hw-dial-single', style: 'color: ' + rxQ.color + ';' }, uwSingle));
				} else {
					rxTxt.appendChild(E('span', { class: 'hw-dial-single', style: 'color: ' + rxQ.color + ';' }, (isNaN(rx) ? '--' : rx.toFixed(1)) + ' dBm'));
				}
			}

			if (rxPill) {
				rxPill.textContent = rxQ.label;
				rxPill.style.color = rxQ.color;
				rxPill.style.background = rxQ.bg;
			}

			if (rxProg) {
				rxProg.style.strokeDasharray = rxDash + ' ' + rxDial.circ;
				rxProg.style.stroke = rxQ.color;
			}

			if (rxStats) {
				rxStats.innerHTML = '';
				rxStats.appendChild(E('div', { class: 'hw-stat-row' }, [
					E('span', { class: 'hw-stat-label' }, _('Signal Quality:')),
					E('span', { class: 'hw-stat-value', style: 'color: ' + rxQ.color + '; font-weight: 700;' }, rxQ.badge)
				]));
				rxStats.appendChild(E('div', { class: 'hw-stat-row' }, [
					E('span', { class: 'hw-stat-label' }, _('Calculated Power:')),
					E('span', { class: 'hw-stat-value', style: 'color: ' + rxQ.color + ';' }, fmtPower(rx))
				]));
				rxStats.appendChild(E('div', { class: 'hw-stat-row' }, [
					E('span', { class: 'hw-stat-label' }, _('Optimal Range:')),
					E('span', { class: 'hw-stat-value', style: 'color: #10b981;' }, '-12.0 to -24.0 dBm')
				]));
				rxStats.appendChild(E('div', { class: 'hw-stat-row' }, [
					E('span', { class: 'hw-stat-label' }, _('RX Wavelength:')),
					E('span', { class: 'hw-stat-value' }, '1490 nm')
				]));
			}

			// 2. Temperature Dial
			var tempTxt = document.getElementById('dial-txt-temp');
			var tempPill = document.getElementById('dial-pill-temp');
			var tempProg = document.getElementById('dial-prog-temp');
			var tempStats = document.getElementById('stats-temp');

			var tempPct = Math.min(100, Math.max(0, (temp / 85.0) * 100));
			var tempDash = (tempPct / 100) * tempDial.circ;

			if (tempTxt) {
				tempTxt.innerHTML = '';
				if (self.unitSystem === 'dual') {
					var cVal = isNaN(temp) ? '--' : temp.toFixed(1);
					var fVal = isNaN(temp) ? '--' : toFahrenheit(temp).toFixed(1);
					tempTxt.appendChild(E('span', { class: 'hw-dial-line', style: 'color: ' + tempQ.color + ';' }, cVal + ' °C'));
					tempTxt.appendChild(E('span', { class: 'hw-dial-line', style: 'color: ' + tempQ.color + ';' }, fVal + ' °F'));
				} else if (self.unitSystem === 'imperial') {
					var fSingle = (isNaN(temp) ? '--' : toFahrenheit(temp).toFixed(1)) + ' °F';
					tempTxt.appendChild(E('span', { class: 'hw-dial-single', style: 'color: ' + tempQ.color + ';' }, fSingle));
				} else {
					var cSingle = (isNaN(temp) ? '--' : temp.toFixed(1)) + ' °C';
					tempTxt.appendChild(E('span', { class: 'hw-dial-single', style: 'color: ' + tempQ.color + ';' }, cSingle));
				}
			}

			if (tempPill) {
				tempPill.textContent = tempQ.label;
				tempPill.style.color = tempQ.color;
				tempPill.style.background = tempQ.bg;
			}

			if (tempProg) {
				tempProg.style.strokeDasharray = tempDash + ' ' + tempDial.circ;
				tempProg.style.stroke = tempQ.color;
			}

			if (tempStats) {
				tempStats.innerHTML = '';
				tempStats.appendChild(E('div', { class: 'hw-stat-row' }, [
					E('span', { class: 'hw-stat-label' }, _('Thermal Status:')),
					E('span', { class: 'hw-stat-value', style: 'color: ' + tempQ.color + '; font-weight: 700;' }, tempQ.badge)
				]));
				tempStats.appendChild(E('div', { class: 'hw-stat-row' }, [
					E('span', { class: 'hw-stat-label' }, _('Temperature (Dual):')),
					E('span', { class: 'hw-stat-value', style: 'color: ' + tempQ.color + ';' }, fmtTemp(temp))
				]));
				tempStats.appendChild(E('div', { class: 'hw-stat-row' }, [
					E('span', { class: 'hw-stat-label' }, _('Supply Voltage (VCC):')),
					E('span', { class: 'hw-stat-value', style: 'color: ' + voltQ.color + ';' }, volt.toFixed(2) + ' V')
				]));
				tempStats.appendChild(E('div', { class: 'hw-stat-row' }, [
					E('span', { class: 'hw-stat-label' }, _('Laser Bias Current:')),
					E('span', { class: 'hw-stat-value', style: 'color: ' + biasQ.color + ';' }, bias.toFixed(1) + ' mA')
				]));
			}

			// 3. ONU & Link Dial
			var onuTxt = document.getElementById('dial-txt-onu');
			var onuPill = document.getElementById('dial-pill-onu');
			var onuProg = document.getElementById('dial-prog-onu');
			var onuStats = document.getElementById('stats-onu');

			var onuStateStr = onu.state ? String(onu.state).toUpperCase() : 'O1';
			var onuStateNum = parseInt(onuStateStr.replace(/[^0-9]/g, '')) || 1;
			var onuPct = Math.min(100, Math.max(20, (onuStateNum / 5.0) * 100));
			var onuDash = (onuPct / 100) * onuDial.circ;
			var onuColor = (onuStateStr === 'O5') ? '#10b981' : ((onuStateNum >= 2) ? '#f59e0b' : '#64748b');
			var onuPillBg = (onuStateStr === 'O5') ? 'rgba(16,185,129,0.15)' : ((onuStateNum >= 2) ? 'rgba(245,158,11,0.15)' : 'rgba(100,116,139,0.18)');
			var onuSubLabel = (onuStateStr === 'O5') ? _('O5 - OPERATIONAL') : ((onuStateNum >= 2) ? _('SYNCHRONIZING') : _('O1 - STANDBY'));

			if (onuTxt) {
				onuTxt.innerHTML = '';
				onuTxt.appendChild(E('span', { class: 'hw-dial-single', style: 'color: ' + onuColor + ';' }, onuStateStr));
			}
			if (onuPill) {
				onuPill.textContent = onuSubLabel;
				onuPill.style.color = onuColor;
				onuPill.style.background = onuPillBg;
			}
			if (onuProg) {
				onuProg.style.strokeDasharray = onuDash + ' ' + onuDial.circ;
				onuProg.style.stroke = onuColor;
			}

			if (onuStats) {
				onuStats.innerHTML = '';
				onuStats.appendChild(E('div', { class: 'hw-stat-row' }, [
					E('span', { class: 'hw-stat-label' }, _('Registration Status:')),
					E('span', { class: 'hw-stat-value', style: 'color: ' + onuColor + '; font-weight: 700;' }, onu.registered_status || (onuStateStr === 'O5' ? 'Registered (O5)' : 'Standby'))
				]));
				onuStats.appendChild(E('div', { class: 'hw-stat-row' }, [
					E('span', { class: 'hw-stat-label' }, _('1G Port (In Use):')),
					E('span', { class: 'hw-stat-value', style: 'color: #10b981; font-weight: 700;' }, (dev.lan1g ? dev.lan1g : 'Up, 1000M Full'))
				]));
				onuStats.appendChild(E('div', { class: 'hw-stat-row' }, [
					E('span', { class: 'hw-stat-label' }, _('2.5G Port:')),
					E('span', { class: 'hw-stat-value' }, (dev.lan25g ? dev.lan25g : 'Up, 2.5G Full'))
				]));
			}

			// 4. Detailed Telemetry Grid
			var setTxt = function(id, val) {
				var el = document.getElementById(id);
				if (el && val !== undefined && val !== null && val !== '') el.textContent = val;
			};
			setTxt('info-model', dev.model);
			setTxt('info-vendor', dev.vendor);
			setTxt('info-sn', (onu.serial_number || dev.gpon_sn || 'NKOT2F04917E'));
			setTxt('info-mac', dev.mac);
			setTxt('info-hw', dev.hardware);
			setTxt('info-uptime', formatUptime(dev.uptime));
			setTxt('info-bosa', ddm.part_number);
			setTxt('info-fw', dev.firmware);
			setTxt('info-bosa-vendor', ddm.vendor_name || 'Class B+ BOSA');
			setTxt('info-lan1', (dev.lan1g ? dev.lan1g + ' (In Use)' : 'Up, 1000M Full (In Use)'));
			setTxt('info-lan25', (dev.lan25g ? dev.lan25g : 'Up, 2.5G Full'));
			setTxt('info-cpu', dev.cpu_usage);
			setTxt('info-reg-state', onu.state_raw || 'Operation State (O5)');

			// 5. Threshold Matrix Table
			var setTableVal = function(id, val, color) {
				var el = document.getElementById(id);
				if (el) {
					el.textContent = val;
					if (color) el.style.color = color;
				}
			};

			setTableVal('th-rx-val', fmtPower(rx), rxQ.color);
			setTableVal('th-temp-val', fmtTemp(temp), tempQ.color);
			setTableVal('th-volt-val', isNaN(volt) ? '-- V' : volt.toFixed(2) + ' V', voltQ.color);
			setTableVal('th-bias-val', isNaN(bias) ? '-- mA' : bias.toFixed(1) + ' mA', biasQ.color);
			setTableVal('th-tx-val', (tx <= -35 ? 'Laser Inactive' : fmtPower(tx)), txQ.color);

			// Threshold table headers / unit labels
			if (self.unitSystem === 'imperial') {
				setTxt('th-temp-la', '-40.0 °F');
				setTxt('th-temp-lw', '14.0 °F');
				setTxt('th-temp-hw', '167.0 °F');
				setTxt('th-temp-ha', '185.0 °F');
			} else if (self.unitSystem === 'dual') {
				setTxt('th-temp-la', '-40.0 °C / -40.0 °F');
				setTxt('th-temp-lw', '-10.0 °C / 14.0 °F');
				setTxt('th-temp-hw', '75.0 °C / 167.0 °F');
				setTxt('th-temp-ha', '85.0 °C / 185.0 °F');
			} else {
				setTxt('th-temp-la', '-40.0 °C');
				setTxt('th-temp-lw', '-10.0 °C');
				setTxt('th-temp-hw', '75.0 °C');
				setTxt('th-temp-ha', '85.0 °C');
			}

			var setStatusBadge = function(id, q) {
				var el = document.getElementById(id);
				if (el) {
					var critClass = (q.severity === 'alarm') ? ' hw-temp-crit' : '';
					el.innerHTML = '<span class="hw-temp-badge' + critClass + '" style="background: ' + q.bg + '; color: ' + q.color + '; font-weight: 700;">' + q.badge + '</span>';
				}
			};

			setStatusBadge('th-rx-status', rxQ);
			setStatusBadge('th-temp-status', tempQ);
			setStatusBadge('th-volt-status', voltQ);
			setStatusBadge('th-bias-status', biasQ);
			setStatusBadge('th-tx-status', txQ);
		};

		// Initial render populate
		updateDashboard(initialStatus);

		// Standard LuCI Native Polling System
		poll.add(function() {
			return callGetStatus().then(function(res) {
				updateDashboard(res);
			});
		}, pollInterval);

		return container;
	},

	handleSaveApply: null,
	handleSave: null,
	handleReset: null
});
