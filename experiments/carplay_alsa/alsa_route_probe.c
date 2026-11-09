/*
 * Experimental, PASS-THROUGH ALSA route detector. NOT for installation in a car.
 * It never alters audio data, return codes, ALSA configuration, or stream state.
 * No ALSA headers are required for this offline ABI experiment: types are opaque.
 * A production implementation must be rebuilt against the MGU-compatible ABI.
 */
#define _GNU_SOURCE
#include "alsa_route_probe.h"

#include <dlfcn.h>
#include <errno.h>
#include <stdatomic.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

typedef struct _snd_pcm snd_pcm_t;
typedef struct _snd_pcm_hw_params snd_pcm_hw_params_t;
typedef unsigned long snd_pcm_uframes_t;
typedef long snd_pcm_sframes_t;

typedef int (*OpenFn)(snd_pcm_t **, const char *, int, int);
typedef int (*HwParamsFn)(snd_pcm_t *, snd_pcm_hw_params_t *);
typedef int (*GetFormatFn)(const snd_pcm_hw_params_t *, int *);
typedef int (*GetChannelsFn)(const snd_pcm_hw_params_t *, unsigned *);
typedef int (*GetRateFn)(const snd_pcm_hw_params_t *, unsigned *, int *);
typedef snd_pcm_sframes_t (*WriteFn)(snd_pcm_t *, const void *, snd_pcm_uframes_t);
typedef int (*CloseFn)(snd_pcm_t *);

static const char kTarget[] = "smartx:CarPlayMain_CF_48_STEREO";
static _Atomic(uintptr_t) g_pcm;
static _Atomic(int) g_hw_params_seen;
static _Atomic(int) g_format;
static _Atomic(unsigned) g_channels;
static _Atomic(unsigned) g_rate;
static _Atomic(uint64_t) g_writei_calls;
static _Atomic(uint64_t) g_mmap_writei_calls;

static int is_target(const snd_pcm_t *pcm)
{
    return pcm && atomic_load_explicit(&g_pcm, memory_order_acquire) == (uintptr_t)pcm;
}

void mgu_alsa_route_snapshot(MguAlsaRouteSnapshot *out)
{
    if (!out) return;
    out->stream_open = atomic_load_explicit(&g_pcm, memory_order_acquire) != 0;
    out->hw_params_seen = atomic_load_explicit(&g_hw_params_seen, memory_order_relaxed);
    out->format = atomic_load_explicit(&g_format, memory_order_relaxed);
    out->channels = atomic_load_explicit(&g_channels, memory_order_relaxed);
    out->rate = atomic_load_explicit(&g_rate, memory_order_relaxed);
    out->writei_calls = atomic_load_explicit(&g_writei_calls, memory_order_relaxed);
    out->mmap_writei_calls = atomic_load_explicit(&g_mmap_writei_calls, memory_order_relaxed);
}

int snd_pcm_open(snd_pcm_t **pcm, const char *name, int stream, int mode)
{
    OpenFn real_open;
    *(void **)(&real_open) = dlsym(RTLD_NEXT, "snd_pcm_open");
    if (!real_open) return -ENOSYS;

    int rc = real_open(pcm, name, stream, mode);
    /* ALSA SND_PCM_STREAM_PLAYBACK == 0; exact stream name is mandatory. */
    if (rc == 0 && pcm && *pcm && name && stream == 0 && strcmp(name, kTarget) == 0) {
        atomic_store_explicit(&g_hw_params_seen, 0, memory_order_relaxed);
        atomic_store_explicit(&g_format, -1, memory_order_relaxed);
        atomic_store_explicit(&g_channels, 0, memory_order_relaxed);
        atomic_store_explicit(&g_rate, 0, memory_order_relaxed);
        atomic_store_explicit(&g_writei_calls, 0, memory_order_relaxed);
        atomic_store_explicit(&g_mmap_writei_calls, 0, memory_order_relaxed);
        atomic_store_explicit(&g_pcm, (uintptr_t)*pcm, memory_order_release);
    }
    return rc;
}

int snd_pcm_hw_params(snd_pcm_t *pcm, snd_pcm_hw_params_t *params)
{
    HwParamsFn real_params;
    *(void **)(&real_params) = dlsym(RTLD_NEXT, "snd_pcm_hw_params");
    if (!real_params) return -ENOSYS;

    int rc = real_params(pcm, params);
    if (rc != 0 || !params || !is_target(pcm)) return rc;

    GetFormatFn get_format;
    GetChannelsFn get_channels;
    GetRateFn get_rate;
    *(void **)(&get_format) = dlsym(RTLD_NEXT, "snd_pcm_hw_params_get_format");
    *(void **)(&get_channels) = dlsym(RTLD_NEXT, "snd_pcm_hw_params_get_channels");
    *(void **)(&get_rate) = dlsym(RTLD_NEXT, "snd_pcm_hw_params_get_rate");

    int format = -1;
    unsigned channels = 0;
    unsigned rate = 0;
    int direction = 0;
    if (get_format && get_format(params, &format) == 0)
        atomic_store_explicit(&g_format, format, memory_order_relaxed);
    if (get_channels && get_channels(params, &channels) == 0)
        atomic_store_explicit(&g_channels, channels, memory_order_relaxed);
    if (get_rate && get_rate(params, &rate, &direction) == 0)
        atomic_store_explicit(&g_rate, rate, memory_order_relaxed);
    atomic_store_explicit(&g_hw_params_seen, 1, memory_order_relaxed);
    return rc;
}

snd_pcm_sframes_t snd_pcm_writei(snd_pcm_t *pcm, const void *buffer, snd_pcm_uframes_t size)
{
    WriteFn real_write;
    *(void **)(&real_write) = dlsym(RTLD_NEXT, "snd_pcm_writei");
    if (!real_write) return -ENOSYS;
    if (is_target(pcm)) atomic_fetch_add_explicit(&g_writei_calls, 1, memory_order_relaxed);
    return real_write(pcm, buffer, size);
}

snd_pcm_sframes_t snd_pcm_mmap_writei(snd_pcm_t *pcm, const void *buffer, snd_pcm_uframes_t size)
{
    WriteFn real_write;
    *(void **)(&real_write) = dlsym(RTLD_NEXT, "snd_pcm_mmap_writei");
    if (!real_write) return -ENOSYS;
    if (is_target(pcm)) atomic_fetch_add_explicit(&g_mmap_writei_calls, 1, memory_order_relaxed);
    return real_write(pcm, buffer, size);
}

int snd_pcm_close(snd_pcm_t *pcm)
{
    CloseFn real_close;
    *(void **)(&real_close) = dlsym(RTLD_NEXT, "snd_pcm_close");
    if (!real_close) return -ENOSYS;
    int tracked = is_target(pcm);
    int rc = real_close(pcm);
    if (tracked) atomic_store_explicit(&g_pcm, 0, memory_order_release);
    return rc;
}
