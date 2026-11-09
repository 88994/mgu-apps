/* Test double, not an ALSA implementation. */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

typedef struct _snd_pcm {
    int stream;
    char name[96];
} snd_pcm_t;

typedef struct _snd_pcm_hw_params {
    int format;
    unsigned channels;
    unsigned rate;
} snd_pcm_hw_params_t;

static unsigned g_total_writes;
static uint64_t g_total_bytes;

int snd_pcm_open(snd_pcm_t **out, const char *name, int stream, int mode)
{
    (void)mode;
    if (!out || !name) return -1;
    snd_pcm_t *pcm = calloc(1, sizeof(*pcm));
    if (!pcm) return -1;
    pcm->stream = stream;
    strncpy(pcm->name, name, sizeof(pcm->name) - 1);
    *out = pcm;
    return 0;
}

int snd_pcm_hw_params(snd_pcm_t *pcm, snd_pcm_hw_params_t *params)
{
    return pcm && params ? 0 : -1;
}

int snd_pcm_hw_params_get_format(const snd_pcm_hw_params_t *params, int *format)
{
    if (!params || !format) return -1;
    *format = params->format;
    return 0;
}

int snd_pcm_hw_params_get_channels(const snd_pcm_hw_params_t *params, unsigned *channels)
{
    if (!params || !channels) return -1;
    *channels = params->channels;
    return 0;
}

int snd_pcm_hw_params_get_rate(const snd_pcm_hw_params_t *params, unsigned *rate, int *dir)
{
    if (!params || !rate || !dir) return -1;
    *rate = params->rate;
    *dir = 0;
    return 0;
}

long snd_pcm_writei(snd_pcm_t *pcm, const void *buffer, unsigned long frames)
{
    if (!pcm || !buffer) return -1;
    ++g_total_writes;
    g_total_bytes += frames * 4;
    return (long)frames;
}

long snd_pcm_mmap_writei(snd_pcm_t *pcm, const void *buffer, unsigned long frames)
{
    if (!pcm || !buffer) return -1;
    ++g_total_writes;
    g_total_bytes += frames * 4;
    return (long)frames;
}

int snd_pcm_close(snd_pcm_t *pcm)
{
    free(pcm);
    return 0;
}

unsigned fake_alsa_total_writes(void) { return g_total_writes; }
uint64_t fake_alsa_total_bytes(void) { return g_total_bytes; }
