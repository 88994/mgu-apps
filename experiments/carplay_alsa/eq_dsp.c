#include "eq_dsp.h"

#include <math.h>
#include <string.h>

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

static const double initial_hz[MGU_EQ_BANDS] = {100, 200, 500, 1000, 2000, 5000, 10000};
static int finite_value(double x) { return isfinite(x); }

void mgu_eq_defaults(MguEqConfig *config) {
    if (!config) return;
    memset(config, 0, sizeof(*config));
    config->auto_headroom = 1;
    for (int i = 0; i < MGU_EQ_BANDS; ++i) {
        config->bands[i].frequency_hz = initial_hz[i];
        config->bands[i].q = 1.0;
    }
}

int mgu_eq_valid(const MguEqConfig *config, unsigned sample_rate) {
    if (!config || (sample_rate != 44100 && sample_rate != 48000 &&
                    sample_rate != 88200 && sample_rate != 96000)) return 0;
    if ((config->enabled != 0 && config->enabled != 1) ||
        (config->auto_headroom != 0 && config->auto_headroom != 1) ||
        !finite_value(config->preamp_db) || config->preamp_db < -24 || config->preamp_db > 0) return 0;
    for (int i = 0; i < MGU_EQ_BANDS; ++i) {
        const MguEqBand *b = &config->bands[i];
        if (!finite_value(b->frequency_hz) || b->frequency_hz < 20 ||
            b->frequency_hz > 20000 || b->frequency_hz >= sample_rate / 2.0 ||
            !finite_value(b->gain_db) || b->gain_db < -12 || b->gain_db > 12 ||
            !finite_value(b->q) || b->q < 0.3 || b->q > 6) return 0;
    }
    return 1;
}

double mgu_eq_headroom_db(const MguEqConfig *config) {
    double gain = config->preamp_db;
    if (config->auto_headroom) {
        for (int i = 0; i < MGU_EQ_BANDS; ++i)
            if (config->bands[i].gain_db > 0) gain -= config->bands[i].gain_db;
    }
    return gain;
}

static void make_bank(MguEqBank *bank, unsigned sample_rate, const MguEqConfig *config) {
    memset(bank, 0, sizeof(*bank));
    bank->enabled = config->enabled;
    bank->linear_gain = pow(10.0, mgu_eq_headroom_db(config) / 20.0);
    for (int i = 0; i < MGU_EQ_BANDS; ++i) {
        const MguEqBand *b = &config->bands[i];
        const double omega = 2.0 * M_PI * b->frequency_hz / sample_rate;
        const double a = pow(10.0, b->gain_db / 40.0);
        const double alpha = sin(omega) / (2.0 * b->q);
        const double a0 = 1.0 + alpha / a;
        MguEqBiquad *c = &bank->biquads[i];
        c->b0 = (1.0 + alpha * a) / a0;
        c->b1 = -2.0 * cos(omega) / a0;
        c->b2 = (1.0 - alpha * a) / a0;
        c->a1 = c->b1;
        c->a2 = (1.0 - alpha / a) / a0;
    }
}

static double filter_sample(MguEqBank *bank, double input, unsigned channel) {
    if (!bank->enabled) return input;
    double x = input * bank->linear_gain;
    for (int i = 0; i < MGU_EQ_BANDS; ++i) {
        const MguEqBiquad *c = &bank->biquads[i];
        const double y = c->b0 * x + bank->z1[channel][i];
        bank->z1[channel][i] = c->b1 * x - c->a1 * y + bank->z2[channel][i];
        bank->z2[channel][i] = c->b2 * x - c->a2 * y;
        if (fabs(bank->z1[channel][i]) < 1e-30) bank->z1[channel][i] = 0;
        if (fabs(bank->z2[channel][i]) < 1e-30) bank->z2[channel][i] = 0;
        x = y;
    }
    return x;
}

int mgu_eq_init(MguEqDsp *dsp, unsigned sample_rate, unsigned channels, const MguEqConfig *config) {
    if (!dsp || (channels != 1 && channels != 2) || !mgu_eq_valid(config, sample_rate)) return -1;
    memset(dsp, 0, sizeof(*dsp));
    dsp->sample_rate = sample_rate;
    dsp->channels = channels;
    dsp->fade_frames = (unsigned)lround(sample_rate * 0.025);
    make_bank(&dsp->current, sample_rate, config);
    return 0;
}

int mgu_eq_configure(MguEqDsp *dsp, const MguEqConfig *config) {
    if (!dsp || !mgu_eq_valid(config, dsp->sample_rate)) return -1;
    MguEqBank next;
    make_bank(&next, dsp->sample_rate, config);
    const unsigned used = dsp->history_count < MGU_EQ_HISTORY_FRAMES ? dsp->history_count : MGU_EQ_HISTORY_FRAMES;
    const unsigned start = (dsp->history_pos + MGU_EQ_HISTORY_FRAMES - used) % MGU_EQ_HISTORY_FRAMES;
    for (unsigned frame = 0; frame < used; ++frame) {
        const unsigned pos = (start + frame) % MGU_EQ_HISTORY_FRAMES;
        for (unsigned ch = 0; ch < dsp->channels; ++ch)
            filter_sample(&next, dsp->history[pos][ch], ch);
    }
    dsp->previous = dsp->current;
    dsp->current = next;
    dsp->fading = 1;
    dsp->fade_remaining = dsp->fade_frames;
    return 0;
}

int mgu_eq_process_s16le(MguEqDsp *dsp, const int16_t *in, int16_t *out, size_t frames) {
    if (!dsp || !in || !out || frames > 4096 ||
        (dsp->channels != 1 && dsp->channels != 2)) return -1;
    for (size_t frame = 0; frame < frames; ++frame) {
        const double mix = dsp->fading ? 1.0 - (double)dsp->fade_remaining / dsp->fade_frames : 1.0;
        for (unsigned ch = 0; ch < dsp->channels; ++ch) {
            const size_t index = frame * dsp->channels + ch;
            const double input = in[index] / 32768.0;
            dsp->history[dsp->history_pos][ch] = (float)input;
            double output = filter_sample(&dsp->current, input, ch);
            if (dsp->fading)
                output = (1.0 - mix) * filter_sample(&dsp->previous, input, ch) + mix * output;
            if (!finite_value(output)) return -1;
            long raw = lround(output * 32768.0);
            if (raw > 32767) { raw = 32767; ++dsp->clipped_samples; }
            if (raw < -32768) { raw = -32768; ++dsp->clipped_samples; }
            out[index] = (int16_t)raw;
            if (fabs(input) > dsp->peak_in) dsp->peak_in = fabs(input);
            if (fabs(raw / 32768.0) > dsp->peak_out) dsp->peak_out = fabs(raw / 32768.0);
        }
        dsp->history_pos = (dsp->history_pos + 1) % MGU_EQ_HISTORY_FRAMES;
        if (dsp->history_count < MGU_EQ_HISTORY_FRAMES) ++dsp->history_count;
        if (dsp->fading && --dsp->fade_remaining == 0) dsp->fading = 0;
    }
    dsp->frames_processed += frames;
    return 0;
}
