# CarPlay DSP – native PCM filter experiment

This is an **offline-only source prototype**, not an installable MGU component.
It contains a low-latency C implementation of the existing Equalizer 0.2.0
seven-band peaking DSP. There is deliberately no ALSA interception, service
modification, CarPlay restart, `LD_PRELOAD`, PCM redirect, or vehicle installer.

The current production DSP remains the existing Node.js component 0.2.0.
The C implementation uses the same filter equations, supported sample rates,
gain/Q limits, 25 ms crossfade, and conservative automatic headroom.
Its initial configuration is bypass (enabled=false).

The separate [ALSA_ROUTE_PROBE.md](ALSA_ROUTE_PROBE.md) describes an additional
**offline-only pass-through ALSA route detector**. Its mock test verifies that
the intended CarPlay PCM name can be identified while unrelated audio streams
remain untouched. The detector is not connected to the EQ filter and is not
safe to deploy in the vehicle without additional compatibility work.

## Offline test

```sh
gcc -std=c11 -Wall -Wextra -Werror -O2 -o test_eq_dsp eq_dsp.c test_eq_dsp.c -lm
./test_eq_dsp
```

The test checks bit-exact S16 bypass, left/right isolation, expected +6 dB
response at 44.1/48 kHz, headroom, parameter validation and crossfade.
It does **not** demonstrate that stock CarPlay audio is filtered.

## Evidence and remaining work

On the user's MGU, `/dev/shm/smartx_CarPlayMain_CF_48_STEREO_p_ringbuffer`
appeared during CarPlay music playback. `libNmeAudioDevice.so` imports and
calls both `snd_pcm_writei` and `snd_pcm_mmap_writei`. These facts identify
candidate PCM insertion points, but not the exact runtime branch or PCM
sample format. Before any vehicle test:

1. Confirm the actual CarPlay stereo format and write mode at runtime.
2. Determine a reversible, per-process insertion mechanism that cannot touch
   telephony, alerts, BMW audio or other SmartX streams.
3. Implement configuration transfer from the existing DSP service without
   blocking an audio callback; test thread safety, frame ordering and underruns.
4. Validate with dummy ALSA and stress/latency tests before parking-lot testing.
5. Keep playback fail-open and disabled by default, with a documented rollback.

Do **not** load this code into `/usr/bin/carplay` or modify MGU launch units.
