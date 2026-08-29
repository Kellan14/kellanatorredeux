// Generated from games/Robocop (Data East 1989)_drakkon(mod_1.2).vpx by scripts/extract-vpx-script-physics.mjs.
// Do not hand-edit numeric values; regenerate them from the source VPX.

export const VPX_ROBOCOP_SCRIPT_PHYSICS = {
  "gameTimerIntervalMilliseconds": 10,
  "flipper": {
    "coilRampUpMode": 0,
    "endOfStrokeTorque": 0.8,
    "endOfStrokeAngleDegrees": 1,
    "endOfStrokeRampUp": 0,
    "startOfStrokeRampUp": 2.5,
    "liveCatchMilliseconds": 16,
    "liveElasticity": 0.45,
    "restElasticityMultiplier": 0.815,
    "returnTorqueRatio": 0.035,
    "restEndAngleOffsetDegrees": 3,
    "liveCatchDistanceMin": 30,
    "liveCatchDistanceMax": 114,
    "dampenerCurve": [
      [
        0,
        1.1
      ],
      [
        3.77,
        0.99
      ],
      [
        6,
        0.99
      ]
    ]
  },
  "rubber": {
    "dampenerCurve": [
      [
        0,
        1.1
      ],
      [
        3.77,
        0.97
      ],
      [
        5.76,
        0.967
      ],
      [
        15.84,
        0.874
      ],
      [
        56,
        0.64
      ]
    ],
    "sleeveMultiplier": 0.85
  },
  "targetBouncer": {
    "enabled": true,
    "factor": 0.7
  },
  "standup": {
    "names": [
      "sw33",
      "sw34",
      "sw35",
      "sw36",
      "sw41",
      "sw42",
      "sw43",
      "sw23"
    ],
    "animationStep": 1.5,
    "maximumOffset": 9,
    "mass": 0.2,
    "disabledMilliseconds": 60
  }
} as const
