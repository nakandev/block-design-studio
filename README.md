# Block Port Types

## Loading definitions

Use **Load definitions** for a single JSON file in the existing inline format. For a manifest such as `examples/block-definitions.json`, use **Load definitions folder** and select the `examples` folder. Folder selection requires browser support for directory uploads.

The manifest lists `interfaces` and `blocks` as `{ "path": "interface/ahb.json", "version": "0.1.0" }` references. Paths are relative to the manifest's folder. Each referenced JSON file contains one definition and its `version`; the versions must match exactly. Missing files, invalid definitions, and version mismatches prevent the entire load.

Exported and browser-saved designs include an `interfaceSource` with `path` and `version` on each interface port and generated port definition. Generated ports inherit their definition's source. Paths are relative to the loaded manifest's folder; unknown sources have `null` path and version. Older designs with per-node `interfaceSources` are migrated to per-port sources when opened or saved.

For example, an interface port can include `"interfaceSource": { "path": "interface/ahb.json", "version": "0.1.0" }`. Individual generated-port sources are retained when ports are disabled or their count is reduced and later restored.

The design also includes `definitions.interfaces` and `definitions.blocks` listing the definitions used by nodes. Interface entries are collected from ports and generated port definitions; a bus without matching ports is included using its per-node source when available. Different versions remain distinct after reopening. Definition files are not included or automatically loaded. Existing blocks with a known source are not updated from a different definition path or version.

## Ports

- `clock`: clock ports connect only to clock ports and do not compare width.
- `reset`: reset ports connect only to reset ports and do not compare width.
- `axi.master` and `axi.slave`: continue to require master-to-slave connections.

Clock and reset block ports can use either `input` or `output` direction. The External Ports palette also offers Clock Input, Clock Output, Reset Input, and Reset Output. External inputs supply signals to the design; external outputs receive signals from it. Connections run from output to input, allow fan-out, and accept only one connection per input.

Example:

```json
[
  {
    "kind": "Sequential",
    "label": "Sequential",
    "ports": [
      { "id": "clk", "name": "clk", "direction": "input", "type": "clock" },
      { "id": "rst", "name": "rst", "direction": "input", "type": "reset" },
      { "id": "data", "name": "data", "direction": "input", "width": 32 }
    ]
  }
]
```
