'use strict';

// Retry only a transient, *explicit* ECU busy response (UDS NRC 0x21),
// and only for a seat ON request. Never retry unknown errors, OFF commands,
// or writes if permission/vehicle-state guards have since changed.
async function seatOnWithBusyRetry(options) {
    const opts = options || {};
    if (typeof opts.send !== 'function' || typeof opts.allowed !== 'function' ||
        typeof opts.wait !== 'function' || typeof opts.event !== 'function')
        throw new TypeError('seat retry requires send, allowed, wait and event');
    const enabled = opts.device === 'Driver seat' || opts.device === 'Passenger seat';
    const permitted = enabled && opts.type === 'ON';
    const delays = [4500, 7000];
    let result = await opts.send(1);
    for (let index = 0; permitted && !result.ok && result.nrc === 0x21 &&
        index < delays.length; index++) {
        opts.event('SEAT BUSY', opts.device + ' ECU busy (NRC 0x21); retry ' +
            (index + 1) + '/' + delays.length + ' in ' + delays[index] / 1000 + 's');
        await opts.wait(delays[index]);
        if (!opts.allowed()) {
            opts.event('SEAT RETRY BLOCKED', opts.device + ': vehicle state or permission changed');
            return { ok: false, nrc: null, blocked: true };
        }
        result = await opts.send(index + 2);
    }
    return result;
}

module.exports = { seatOnWithBusyRetry };
