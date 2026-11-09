#include "alsa_route_probe.h"

#include <assert.h>
#include <stdint.h>
#include <stdio.h>

typedef struct _snd_pcm snd_pcm_t;
typedef struct _snd_pcm_hw_params {
    int format;
    unsigned channels;
    unsigned rate;
} snd_pcm_hw_params_t;

int snd_pcm_open(snd_pcm_t **, const char *, int, int);
int snd_pcm_hw_params(snd_pcm_t *, snd_pcm_hw_params_t *);
long snd_pcm_writei(snd_pcm_t *, const void *, unsigned long);
long snd_pcm_mmap_writei(snd_pcm_t *, const void *, unsigned long);
int snd_pcm_close(snd_pcm_t *);
unsigned fake_alsa_total_writes(void);
uint64_t fake_alsa_total_bytes(void);

int main(void)
{
    snd_pcm_hw_params_t params = {2, 2, 48000};
    snd_pcm_t *other = NULL;
    snd_pcm_t *target = NULL;
    int16_t pcm[32] = {0};
    MguAlsaRouteSnapshot s;

    assert(snd_pcm_open(&other, "smartx:CarPlayMain_Mono_CF_24_MONO", 0, 0) == 0);
    assert(snd_pcm_hw_params(other, &params) == 0);
    assert(snd_pcm_writei(other, pcm, 16) == 16);
    mgu_alsa_route_snapshot(&s);
    assert(s.stream_open == 0 && s.writei_calls == 0);

    assert(snd_pcm_open(&target, "smartx:CarPlayMain_CF_48_STEREO", 0, 0) == 0);
    assert(snd_pcm_hw_params(target, &params) == 0);
    assert(snd_pcm_writei(target, pcm, 16) == 16);
    assert(snd_pcm_mmap_writei(target, pcm, 8) == 8);
    assert(snd_pcm_writei(other, pcm, 4) == 4);

    mgu_alsa_route_snapshot(&s);
    assert(s.stream_open == 1 && s.hw_params_seen == 1);
    assert(s.format == 2 && s.channels == 2 && s.rate == 48000);
    assert(s.writei_calls == 1 && s.mmap_writei_calls == 1);
    assert(fake_alsa_total_writes() == 4);
    assert(fake_alsa_total_bytes() == (16 + 16 + 8 + 4) * 4);

    assert(snd_pcm_close(target) == 0);
    assert(snd_pcm_close(other) == 0);
    mgu_alsa_route_snapshot(&s);
    assert(s.stream_open == 0);
    puts("PASS: exact playback name, ALSA params, write-mode counters, pass-through");
    return 0;
}
