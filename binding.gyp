{
  "targets": [
    {
      "target_name": "stack-trace",
      "sources": [ "module.cc" ],
      # With V8_DEPRECATION_WARNINGS defined, the class-level V8_DEPRECATED
      # annotations in the V8 15+ (Electron >= 43) headers expand to a mix of
      # C++11 and GNU attributes that GCC <= 12 cannot parse
      "defines!": [ "V8_DEPRECATION_WARNINGS=1" ],
      "conditions": [
        ["OS=='win'", {
          "defines": [
            "WIN32_LEAN_AND_MEAN"
          ],
          "libraries": [
            "Mincore.lib"
          ]
        }]
      ]
    }
  ]
}
