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
		self.unitSystem = uci.get('vsol_ddm', 'main', 'unit_system') || 'dual';

		// Stored user preferences in localStorage
		if (window.localStorage) {
			var savedUnit = window.localStorage.getItem('vsol_unit_system');
			if (savedUnit) self.unitSystem = savedUnit;

			// Instant cache snapshot if live status is pending
			if (!initialStatus || !initialStatus.ddm) {
				try {
					var cached = JSON.parse(window.localStorage.getItem('vsol_last_telemetry') || '{}');
					if (cached && cached.ddm) initialStatus = cached;
				} catch(e) {}
			}
		}

		var container = E('div', {
			id: 'hw-dashboard',
			class: 'hw-dashboard'
		});

		var style = E('style', {},
			' .hw-dashboard { display: flex; flex-wrap: wrap; align-items: stretch; gap: 20px; padding: 15px; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; width: 100%; max-width: 100%; overflow: hidden; color: var(--text-color, inherit); }' +
			' .hw-dashboard * { box-sizing: border-box; }' +
			' .hw-top-bar { width: 100%; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px; margin-bottom: 4px; padding-bottom: 12px; border-bottom: 1px solid var(--border-color, rgba(128,128,128,0.18)); }' +
			' .hw-top-left { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }' +
			' .hw-top-right { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }' +
			' .hw-unit-group { display: inline-flex; border: 1px solid var(--border-color, rgba(128,128,128,0.25)); border-radius: 6px; overflow: hidden; background: var(--background-color-high, rgba(128,128,128,0.06)); }' +
			' .hw-unit-btn { background: transparent; border: none; padding: 6px 13px; font-size: 0.78em; font-weight: 600; color: var(--text-color, inherit); opacity: 0.75; cursor: pointer; transition: all 0.2s ease; }' +
			' .hw-unit-btn:hover { opacity: 1; background: var(--border-color, rgba(128,128,128,0.12)); }' +
			' .hw-unit-btn.active { background: var(--primary, #00acc1); color: #ffffff !important; opacity: 1; font-weight: 700; }' +
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

		// Standard Uptime Formatter (e.g. 2d 14h 50m or 8h 19m)
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
			// Handle "0 8:19:55" or "0 days, 8:19:55"
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

		// Top Quick Bar (Unit Switcher + Target Badge)
		var topBar = E('div', { class: 'hw-top-bar' }, [
			E('div', { class: 'hw-top-left' }, [
				E('span', { style: 'font-size: 0.85em; opacity: 0.75; font-weight: 600;' }, _('Units:')),
				E('div', { class: 'hw-unit-group' }, [
					E('button', {
						id: 'btn-unit-dual',
						class: 'hw-unit-btn' + (self.unitSystem === 'dual' ? ' active' : ''),
						click: function() {
							self.unitSystem = 'dual';
							if (window.localStorage) window.localStorage.setItem('vsol_unit_system', 'dual');
							updateUnitButtons();
							if (self.lastData) updateDashboard(self.lastData);
						}
					}, _('Dual (Metric / Imperial)')),
					E('button', {
						id: 'btn-unit-metric',
						class: 'hw-unit-btn' + (self.unitSystem === 'metric' ? ' active' : ''),
						click: function() {
							self.unitSystem = 'metric';
							if (window.localStorage) window.localStorage.setItem('vsol_unit_system', 'metric');
							updateUnitButtons();
							if (self.lastData) updateDashboard(self.lastData);
						}
					}, _('Metric (°C, dBm)')),
					E('button', {
						id: 'btn-unit-imperial',
						class: 'hw-unit-btn' + (self.unitSystem === 'imperial' ? ' active' : ''),
						click: function() {
							self.unitSystem = 'imperial';
							if (window.localStorage) window.localStorage.setItem('vsol_unit_system', 'imperial');
							updateUnitButtons();
							if (self.lastData) updateDashboard(self.lastData);
						}
					}, _('Imperial (°F, µW)'))
				])
			]),
			E('div', { class: 'hw-top-right' }, [
				E('span', { style: 'font-size: 0.82em; opacity: 0.75; font-family: ui-monospace, monospace; font-weight: 600;' },
					_('ONT: ') + (initialStatus.host || '192.168.100.1')
				)
			])
		]);
		container.appendChild(topBar);

		var updateUnitButtons = function() {
			['dual', 'metric', 'imperial'].forEach(function(u) {
				var btn = document.getElementById('btn-unit-' + u);
				if (btn) {
					if (self.unitSystem === u) btn.classList.add('active');
					else btn.classList.remove('active');
				}
			});
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
				// Column 3: Traffic & Network Performance
				E('div', { class: 'hw-thermals-col hw-thermals-col-right' }, [
					E('div', { class: 'hw-thermals-title' }, _('Network & Ethernet Status')),
					E('div', { class: 'hw-kv' }, [E('span', { class: 'hw-kv-k' }, _('LAN 2.5G Port:')), E('span', { id: 'info-lan25', class: 'hw-kv-v' }, 'Up, 2.5G Full')]),
					E('div', { class: 'hw-kv' }, [E('span', { class: 'hw-kv-k' }, _('LAN 1G Port:')), E('span', { id: 'info-lan1', class: 'hw-kv-v' }, 'Up, 1000M Full')]),
					E('div', { class: 'hw-kv' }, [E('span', { class: 'hw-kv-k' }, _('Module CPU Load:')), E('span', { id: 'info-cpu', class: 'hw-kv-v' }, '1%')]),
					E('div', { class: 'hw-kv' }, [E('span', { class: 'hw-kv-k' }, _('Management Interface:')), E('span', { class: 'hw-kv-v' }, 'Telnet CLI (Port 23)')]),
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

			var rx = parseFloat(ddm.rx_power_dbm);
			var tx = parseFloat(ddm.tx_power_dbm);
			var temp = parseFloat(ddm.temperature_c);
			var volt = parseFloat(ddm.voltage_v);
			var bias = parseFloat(ddm.bias_current_ma);

			// 1. RX Power Dial
			var rxTxt = document.getElementById('dial-txt-rx');
			var rxPill = document.getElementById('dial-pill-rx');
			var rxProg = document.getElementById('dial-prog-rx');
			var rxStats = document.getElementById('stats-rx');

			var rxPct = Math.min(100, Math.max(0, ((rx + 40) / 32) * 100));
			var rxDash = (rxPct / 100) * rxDial.circ;
			var rxColor = '#00acc1';
			var rxStateBadge = 'OPTIMAL SIGNAL';
			var rxPillBg = 'rgba(0,172,193,0.15)';

			if (rx <= -35) {
				rxColor = '#64748b'; // Slate for unlinked / low signal
				rxStateBadge = 'NO SIGNAL';
				rxPillBg = 'rgba(100,116,139,0.18)';
			} else if (rx < -27) {
				rxColor = '#d97706';
				rxStateBadge = 'LOW POWER';
				rxPillBg = 'rgba(217,119,6,0.15)';
			} else if (rx > -8) {
				rxColor = '#e11d48';
				rxStateBadge = 'SIGNAL OVERLOAD';
				rxPillBg = 'rgba(225,29,72,0.15)';
			}

			if (rxTxt) {
				rxTxt.innerHTML = '';
				if (self.unitSystem === 'dual') {
					var uwVal = toMicrowatts(rx);
					var uwFormatted = (uwVal < 1 ? uwVal.toFixed(2) : (uwVal >= 1000 ? (uwVal/1000).toFixed(1) : uwVal.toFixed(1))) + (uwVal >= 1000 ? ' mW' : ' µW');
					rxTxt.appendChild(E('span', { class: 'hw-dial-line', style: 'color: ' + rxColor + ';' }, (isNaN(rx) ? '--' : rx.toFixed(1)) + ' dBm'));
					rxTxt.appendChild(E('span', { class: 'hw-dial-line', style: 'color: ' + rxColor + ';' }, uwFormatted));
				} else if (self.unitSystem === 'imperial') {
					var uw = toMicrowatts(rx);
					var uwSingle = (uw < 1 ? uw.toFixed(2) : (uw >= 1000 ? (uw/1000).toFixed(2) : uw.toFixed(1))) + (uw >= 1000 ? ' mW' : ' µW');
					rxTxt.appendChild(E('span', { class: 'hw-dial-single', style: 'color: ' + rxColor + ';' }, uwSingle));
				} else {
					rxTxt.appendChild(E('span', { class: 'hw-dial-single', style: 'color: ' + rxColor + ';' }, (isNaN(rx) ? '--' : rx.toFixed(1)) + ' dBm'));
				}
			}

			if (rxPill) {
				rxPill.textContent = rxStateBadge;
				rxPill.style.color = rxColor;
				rxPill.style.background = rxPillBg;
			}

			if (rxProg) {
				rxProg.style.strokeDasharray = rxDash + ' ' + rxDial.circ;
				rxProg.style.stroke = rxColor;
			}

			if (rxStats) {
				rxStats.innerHTML = '';
				rxStats.appendChild(E('div', { class: 'hw-stat-row' }, [
					E('span', { class: 'hw-stat-label' }, _('Signal Status:')),
					E('span', { class: 'hw-stat-value', style: 'color: ' + rxColor + ';' }, rxStateBadge)
				]));
				rxStats.appendChild(E('div', { class: 'hw-stat-row' }, [
					E('span', { class: 'hw-stat-label' }, _('Calculated Power:')),
					E('span', { class: 'hw-stat-value' }, fmtPower(rx))
				]));
				rxStats.appendChild(E('div', { class: 'hw-stat-row' }, [
					E('span', { class: 'hw-stat-label' }, _('Sensitivity Range:')),
					E('span', { class: 'hw-stat-value' }, '-9.0 to -27.0 dBm')
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
			var tempColor = '#00acc1';
			var tempStateBadge = 'NOMINAL';
			var tempPillBg = 'rgba(0,172,193,0.15)';

			if (temp >= 75) {
				tempColor = '#e11d48';
				tempStateBadge = 'HIGH TEMPERATURE';
				tempPillBg = 'rgba(225,29,72,0.15)';
			} else if (temp >= 68) {
				tempColor = '#d97706';
				tempStateBadge = 'ELEVATED';
				tempPillBg = 'rgba(217,119,6,0.15)';
			}

			if (tempTxt) {
				tempTxt.innerHTML = '';
				if (self.unitSystem === 'dual') {
					var cVal = isNaN(temp) ? '--' : temp.toFixed(1);
					var fVal = isNaN(temp) ? '--' : toFahrenheit(temp).toFixed(1);
					tempTxt.appendChild(E('span', { class: 'hw-dial-line', style: 'color: ' + tempColor + ';' }, cVal + ' °C'));
					tempTxt.appendChild(E('span', { class: 'hw-dial-line', style: 'color: ' + tempColor + ';' }, fVal + ' °F'));
				} else if (self.unitSystem === 'imperial') {
					var fSingle = (isNaN(temp) ? '--' : toFahrenheit(temp).toFixed(1)) + ' °F';
					tempTxt.appendChild(E('span', { class: 'hw-dial-single', style: 'color: ' + tempColor + ';' }, fSingle));
				} else {
					var cSingle = (isNaN(temp) ? '--' : temp.toFixed(1)) + ' °C';
					tempTxt.appendChild(E('span', { class: 'hw-dial-single', style: 'color: ' + tempColor + ';' }, cSingle));
				}
			}

			if (tempPill) {
				tempPill.textContent = tempStateBadge;
				tempPill.style.color = tempColor;
				tempPill.style.background = tempPillBg;
			}

			if (tempProg) {
				tempProg.style.strokeDasharray = tempDash + ' ' + tempDial.circ;
				tempProg.style.stroke = tempColor;
			}

			if (tempStats) {
				tempStats.innerHTML = '';
				tempStats.appendChild(E('div', { class: 'hw-stat-row' }, [
					E('span', { class: 'hw-stat-label' }, _('Temperature (Dual):')),
					E('span', { class: 'hw-stat-value' }, fmtTemp(temp))
				]));
				tempStats.appendChild(E('div', { class: 'hw-stat-row' }, [
					E('span', { class: 'hw-stat-label' }, _('Supply Voltage (VCC):')),
					E('span', { class: 'hw-stat-value' }, volt.toFixed(2) + ' V')
				]));
				tempStats.appendChild(E('div', { class: 'hw-stat-row' }, [
					E('span', { class: 'hw-stat-label' }, _('Laser Bias Current:')),
					E('span', { class: 'hw-stat-value' }, bias.toFixed(1) + ' mA')
				]));
				tempStats.appendChild(E('div', { class: 'hw-stat-row' }, [
					E('span', { class: 'hw-stat-label' }, _('Maximum Rating:')),
					E('span', { class: 'hw-stat-value' }, fmtTemp(85.0))
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
			var onuColor = (onuStateStr === 'O5') ? '#00acc1' : '#64748b';
			var onuSubLabel = (onuStateStr === 'O5') ? 'OPERATIONAL' : 'ONU STANDBY';
			var onuPillBg = (onuStateStr === 'O5') ? 'rgba(0,172,193,0.15)' : 'rgba(100,116,139,0.18)';

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
					E('span', { class: 'hw-stat-value', style: 'color: ' + (onuStateStr === 'O5' ? '#00acc1' : 'var(--text-color, inherit)') + ';' }, onu.registered_status || 'Not Registered')
				]));
				onuStats.appendChild(E('div', { class: 'hw-stat-row' }, [
					E('span', { class: 'hw-stat-label' }, _('Transmitter Power (TX):')),
					E('span', { class: 'hw-stat-value' }, (tx <= -35 ? 'Laser Inactive' : fmtPower(tx)))
				]));
				onuStats.appendChild(E('div', { class: 'hw-stat-row' }, [
					E('span', { class: 'hw-stat-label' }, _('2.5G Port:')),
					E('span', { class: 'hw-stat-value' }, dev.lan25g || 'Up, 2.5G Full')
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
			setTxt('info-lan25', dev.lan25g);
			setTxt('info-lan1', dev.lan1g);
			setTxt('info-cpu', dev.cpu_usage);
			setTxt('info-reg-state', onu.state_raw || 'Operation State (O5)');

			// 5. Threshold Matrix Table
			setTxt('th-rx-val', fmtPower(rx));
			setTxt('th-temp-val', fmtTemp(temp));
			setTxt('th-volt-val', isNaN(volt) ? '-- V' : volt.toFixed(2) + ' V');
			setTxt('th-bias-val', isNaN(bias) ? '-- mA' : bias.toFixed(1) + ' mA');
			setTxt('th-tx-val', (tx <= -35 ? 'Laser Inactive' : fmtPower(tx)));

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

			var trRxStat = document.getElementById('th-rx-status');
			if (trRxStat) {
				if (rx <= -35) {
					trRxStat.innerHTML = '<span class="hw-temp-badge" style="background: rgba(100,116,139,0.18); color: #64748b;">' + _('No Signal') + '</span>';
				} else if (rx < -27) {
					trRxStat.innerHTML = '<span class="hw-temp-badge" style="background: rgba(217,119,6,0.15); color: #d97706;">' + _('Low Warning') + '</span>';
				} else {
					trRxStat.innerHTML = '<span class="hw-temp-badge" style="background: rgba(0,172,193,0.15); color: #00acc1;">' + _('Optimal') + '</span>';
				}
			}

			var trTempStat = document.getElementById('th-temp-status');
			if (trTempStat) {
				if (temp >= 75) {
					trTempStat.innerHTML = '<span class="hw-temp-badge hw-temp-crit" style="background: rgba(225,29,72,0.15); color: #e11d48;">' + _('High Alarm') + '</span>';
				} else if (temp >= 68) {
					trTempStat.innerHTML = '<span class="hw-temp-badge" style="background: rgba(217,119,6,0.15); color: #d97706;">' + _('Elevated') + '</span>';
				} else {
					trTempStat.innerHTML = '<span class="hw-temp-badge" style="background: rgba(0,172,193,0.15); color: #00acc1;">' + _('Nominal') + '</span>';
				}
			}
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
