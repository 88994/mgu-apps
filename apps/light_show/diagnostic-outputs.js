'use strict';

// BDC_G05.prg revision 36.001, TAB_LICHT_AUSGANG_DIGITAL_ARG.
// The IDs are ECU argument values, NOT measured wiring/pin assignments.
// Some options depend on installed equipment and coding. Only exterior lamps
// are exposed. ALL_OUTPUTS (0xFE) and unrelated cabin/control LEDs are excluded.
const GROUPS = [
    { screen: 'OUTPUT_FRONT', button: 'BTN_OUTPUT_FRONT', name: 'Front lights', lights: [
        [0x01, 'Low beam left', 'AL_L'], [0x02, 'Low beam right', 'AL_R'],
        [0x03, 'Daytime light left', 'TFL_L'], [0x04, 'Daytime light right', 'TFL_R'],
        [0x07, 'High beam left (legacy)', 'FL_L'], [0x08, 'High beam right (legacy)', 'FL_R'],
        [0x09, 'Position light left', 'POL_L'], [0x0A, 'Position light right', 'POL_R'],
        [0x0B, 'Front fog left', 'NSW_L'], [0x0C, 'Front fog right', 'NSW_R'],
        [0x0D, 'Front indicator left', 'FRA_V_L'], [0x0E, 'Front indicator right', 'FRA_V_R'],
    ] },
    { screen: 'OUTPUT_SIDE', button: 'BTN_OUTPUT_SIDE', name: 'Side lights', lights: [
        [0x05, 'Side marker left (if fitted)', 'SML_L'],
        [0x06, 'Side marker right (if fitted)', 'SML_R'],
        [0x10, 'Side indicator left (FRA_Z)', 'FRA_Z_L'],
        [0x11, 'Side indicator right (FRA_Z)', 'FRA_Z_R'],
    ] },
    { screen: 'OUTPUT_REAR', button: 'BTN_OUTPUT_REAR', name: 'Rear / brake lights', lights: [
        [0x14, 'Tail light left', 'SL_L'], [0x15, 'Tail light right', 'SL_R'],
        [0x16, 'Tail light 2 left', 'SL_2_L'], [0x17, 'Tail light 2 right', 'SL_2_R'],
        [0x18, 'Brake light left', 'BL_L'], [0x19, 'Brake light right', 'BL_R'],
        [0x23, 'Centre brake light (3rd)', 'BL_M'],
        [0x1A, 'Brake-force display left', 'BFD_L'],
        [0x1B, 'Brake-force display right', 'BFD_R'],
    ] },
    { screen: 'OUTPUT_REAR_EXTRA', button: 'BTN_OUTPUT_REAR_EXTRA', name: 'Rear auxiliary lights', lights: [
        [0x1C, 'Rear fog left', 'NSL_L'], [0x1D, 'Rear fog right', 'NSL_R'],
        [0x1E, 'Reverse light left', 'RFS_L'], [0x1F, 'Reverse light right', 'RFS_R'],
        [0x20, 'Rear indicator left', 'FRA_H_L'], [0x21, 'Rear indicator right', 'FRA_H_R'],
        [0x22, 'Number plate light', 'KZL'],
    ] },
];

const OUTPUTS = Object.create(null);
for (const group of GROUPS) for (const [id, label, prg] of group.lights) {
    if (OUTPUTS[id]) throw new Error('Duplicate BDC output ' + id);
    OUTPUTS[id] = Object.freeze({ id, label, prg, group: group.screen });
}
function get(id) {
    if (!Number.isInteger(id) || !Object.prototype.hasOwnProperty.call(OUTPUTS, id))
        throw new Error('Unsupported individual light output');
    return OUTPUTS[id];
}
function buttonId(id) { return 'BTN_LAMP_' + id.toString(16).padStart(2, '0').toUpperCase(); }

module.exports = { GROUPS, OUTPUTS, get, buttonId };
