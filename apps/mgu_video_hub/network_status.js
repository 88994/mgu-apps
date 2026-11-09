'use strict';

const http = require('http');
const PORT = 18979;

// Only the loopback root helper responds here; never trust a QR just because
// the application found an IP address or called listen().
function readNetworkStatus(done, port) {
    let finished = false, body = '';
    function finish(error, status) {
        if (finished) return;
        finished = true;
        done(error || null, status || null);
    }
    const req = http.get({hostname:'127.0.0.1', port:port || PORT, path:'/status'}, res => {
        if (res.statusCode !== 200) { res.resume(); return finish(new Error('Network tool HTTP ' + res.statusCode)); }
        res.on('data', part => {
            body += part.toString('utf8');
            if (body.length > 4096) req.destroy(new Error('Network status too large'));
        });
        res.on('end', () => {
            try {
                const value = JSON.parse(body);
                if (typeof value.ready !== 'boolean') throw new Error('Invalid network tool response');
                finish(null, value);
            } catch (e) { finish(e); }
        });
    });
    req.setTimeout(1500, () => req.destroy(new Error('Network tool timeout')));
    req.on('error', finish);
    return req;
}

module.exports = { readNetworkStatus, PORT };
