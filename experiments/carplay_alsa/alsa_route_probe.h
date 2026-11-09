#ifndef MGU_ALSA_ROUTE_PROBE_H
#define MGU_ALSA_ROUTE_PROBE_H

#include <stdint.h>

/* Read-only snapshot of one strictly identified ALSA playback stream. */
typedef struct {
    int stream_open;
    int hw_params_seen;
    int format;
    unsigned channels;
    unsigned rate;
    uint64_t writei_calls;
    uint64_t mmap_writei_calls;
} MguAlsaRouteSnapshot;

/* Useful for offline tests; does not create any socket or log audio. */
void mgu_alsa_route_snapshot(MguAlsaRouteSnapshot *out);

#endif
