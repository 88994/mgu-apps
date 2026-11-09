'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {Diagnostics, FILE, MAX_EVENTS, MAX_BYTES, safeText} = require('../apps/mgu_video_hub/diagnostics');

function run() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-hub-diag-'));
    try {
        const d = new Diagnostics(dir, '0.1.4');
        d.add('INFO', 'app.started', 'Node 8; ffmpeg=false');
        d.add('ERROR', 'decoder.failed',
            'Signed URL https://r1.googlevideo.com/videoplayback?sig=sensitive123 token=topsecret');
        const snapshot = d.snapshot({uplink:{appLease:true}, ffmpeg:false});
        assert.strictEqual(snapshot.version, '0.1.4');
        assert.strictEqual(snapshot.status.uplink.appLease, true);
        assert.strictEqual(snapshot.events.length, 2);
        const contents = fs.readFileSync(path.join(dir, FILE), 'utf8');
        assert.ok(!contents.includes('sensitive123'), 'Never persist signed YouTube URL');
        assert.ok(!contents.includes('topsecret'), 'Never persist credentials');
        assert.ok(contents.includes('decoder.failed'));
        assert.ok(safeText('https://example.com/video?a=1').includes('[URL redacted]'));

        const restarted = new Diagnostics(dir, '0.1.4');
        assert.strictEqual(restarted.events.length, 2, 'App relaunch keeps existing logs');
        for (let i = 0; i < MAX_EVENTS + 50; i++) restarted.add('INFO', 'poll.changed', 'iteration=' + i);
        assert.strictEqual(restarted.events.length, MAX_EVENTS, 'Oldest events must rotate out');
        assert.ok(fs.statSync(path.join(dir, FILE)).size <= MAX_BYTES, 'Log file must remain bounded');
        assert.ok(restarted.recent(6).length === 6);
        assert.strictEqual(restarted.recent(1)[0].detail, 'iteration=399');
        const exported = restarted.snapshot({toolAvailability:{ffmpeg:false, ytDlp:false}});
        assert.strictEqual(exported.events.length, MAX_EVENTS);
        assert.strictEqual(exported.status.toolAvailability.ytDlp, false);
        assert.ok(!JSON.stringify(exported).includes('topsecret'));
    } finally {
        try { fs.unlinkSync(path.join(dir, FILE)); } catch (_) {}
        fs.rmdirSync(dir);
    }
    console.log('Video Hub diagnostics tests passed: persistence, bounded logs, URL redaction, export state');
}

run();
