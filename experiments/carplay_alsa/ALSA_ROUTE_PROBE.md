# CarPlay ALSA route adapter – offline proof of concept

**Status: test-only. Not an installable MGU service or vehicle deployment.**

The `alsa_route_probe.c` library is an independent, *pass-through* ALSA
interposer. It tracks only playback handles opened with the exact device name
`smartx:CarPlayMain_CF_48_STEREO`. It delegates all ALSA functions to the
original implementation without changing PCM samples or playback results.

After a successful `snd_pcm_hw_params`, it captures negotiated format, rate
and channel count. It separately counts calls to `snd_pcm_writei` and
`snd_pcm_mmap_writei`. All metadata stays inside the process. The exported
`mgu_alsa_route_snapshot()` is currently usable only by an in-process test;
there is deliberately **no vehicle-side logging, IPC, restart, installer or
`LD_PRELOAD` unit override**.

## Offline mock test

Build in a temporary directory on a Linux development system:

```sh
mkdir -p build
cc -std=c11 -O2 -Wall -Wextra -Werror -fPIC -shared \
  -o build/libfakealsa.so fake_alsa_backend.c
cc -std=c11 -O2 -Wall -Wextra -Werror -fPIC -shared \
  -o build/libmgu_alsa_route_probe.so alsa_route_probe.c -ldl
cc -std=c11 -O2 -Wall -Wextra -Werror \
  -o build/test_alsa_route_probe test_alsa_route_probe.c \
  -Lbuild -lfakealsa -lmgu_alsa_route_probe -Wl,-rpath,'$ORIGIN'
LD_PRELOAD=./build/libmgu_alsa_route_probe.so ./build/test_alsa_route_probe
```

This demonstrates symbol forwarding and metadata logic against a **fake ALSA
backend**, not the actual Cinemo/SmartX stack.

## Required before even considering a car test

1. Confirm compatibility with the MGU glibc 2.27 and the actual ALSA symbol
   versions, and validate that the existing `libschedconfig.so.1` stays loaded.
2. Replace per-write `dlsym()` with resolved, verified function pointers and
   audit locking, recursion, stream lifetime and thread safety.
3. Establish a bounded, nonblocking vehicle telemetry mechanism with no
   audio payload capture or privacy-sensitive logs.
4. Distinguish original Cinemo/CarPlay music from telephony, notification,
   Siri, and other streams; the ALSA name is a candidate, not proof.
5. Connect and stress-test the existing `eq_dsp.c` before enabling filters.
6. Document explicit recovery if `carplay.service` stops: systemd currently
   reports `Restart=no`, and the user's Waze-on-Cluster patch is installed.

No file from this directory should be copied into the MGU's CarPlay service.
