'use strict';
'require view';
'require form';
'require rpc';
'require ui';

var callTestConnection = rpc.declare({
	object: 'vsol_ddm',
	method: 'test_connection',
	expect: {}
});

return view.extend({
	render: function() {
		var m, s, o;

		m = new form.Map('vsol_ddm', _('VSOL V2802RH Diagnostics Settings'),
			_('Configure connection parameters and polling preferences for your VSOL V2802RH 2.5G XPON ONT.'));

		s = m.section(form.NamedSection, 'main', 'vsol_ddm', _('Connection Settings'));
		s.anonymous = true;
		s.addremove = false;

		o = s.option(form.Flag, 'enabled', _('Enable Telemetry Polling'),
			_('Enable background telemetry extraction from the VSOL ONT.'));
		o.default = '1';
		o.rmempty = false;

		o = s.option(form.Value, 'host', _('ONT IP Address'),
			_('IPv4 address of the VSOL V2802RH ONT (Default: 192.168.100.1).'));
		o.datatype = 'ip4addr';
		o.default = '192.168.100.1';
		o.rmempty = false;

		o = s.option(form.Value, 'port', _('Telnet Port'),
			_('Telnet service management port (Default: 23).'));
		o.datatype = 'port';
		o.default = '23';
		o.rmempty = false;

		o = s.option(form.Value, 'username', _('Telnet Username'),
			_('Telnet management username (Default: admin).'));
		o.default = 'admin';
		o.rmempty = false;

		o = s.option(form.Value, 'password', _('Telnet Password'),
			_('Telnet management password.'));
		o.password = true;
		o.default = 'Admin@123';
		o.rmempty = false;

		o = s.option(form.ListValue, 'unit_system', _('Default Unit System'),
			_('Choose whether metrics display in Dual mode (°C & °F, dBm & µW), Metric only, or Imperial only.'));
		o.value('dual', _('Dual (Metric & Imperial)'));
		o.value('metric', _('Metric Only (°C, dBm)'));
		o.value('imperial', _('Imperial Only (°F, µW)'));
		o.default = 'dual';

		o = s.option(form.ListValue, 'poll_interval', _('Polling Interval'),
			_('Frequency of background telemetry collection.'));
		o.value('1', _('1 second (Real-Time)'));
		o.value('2', _('2 seconds (Fast)'));
		o.value('3', _('3 seconds (Standard Recommended)'));
		o.value('5', _('5 seconds'));
		o.value('10', _('10 seconds (Relaxed)'));
		o.default = '3';

		o = s.option(form.Value, 'timeout', _('Connection Timeout (seconds)'),
			_('Socket timeout duration when connecting to the ONT (1 to 30 seconds).'));
		o.datatype = 'range(1,30)';
		o.default = '3';

		o = s.option(form.Button, '_test', _('Test Connection'),
			_('Perform an immediate Telnet diagnostic test against the VSOL ONT.'));
		o.inputtitle = _('Run Test');
		o.inputstyle = 'apply';
		o.onclick = function() {
			return callTestConnection().then(function(res) {
				if (res && res.connected) {
					ui.addNotification(null, E('p', { class: 'alert-message success' },
						_('Successfully connected and authenticated to VSOL V2802RH at ') + (res.host || '192.168.100.1')));
				} else {
					ui.addNotification(null, E('p', { class: 'alert-message warning' },
						_('Connection failed: ') + ((res && res.error) || _('Could not reach Telnet service at 192.168.100.1:23.'))));
				}
			}).catch(function(err) {
				ui.addNotification(null, E('p', { class: 'alert-message warning' }, err.message || err));
			});
		};

		return m.render();
	}
});
