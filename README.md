# Block Port Types

## Loading definitions

Use **Load definitions** for a single JSON file in the existing inline format. For a manifest such as `examples/block-definitions.json`, use **Load definitions folder** and select the `examples` folder. Folder selection requires browser support for directory uploads.

The manifest lists `interfaces` and `blocks` as `{ "path": "interface/ahb.json", "version": "0.1.0" }` references. Paths are relative to the manifest's folder. Each referenced JSON file contains one definition and its `version`; the versions must match exactly. Missing files, invalid definitions, and version mismatches prevent the entire load.

Exported and browser-saved designs include `definitions.interfaces` and `definitions.blocks` with the names or kinds, paths, and versions of definitions used by nodes. Paths are relative to the loaded manifest's folder. Definitions without known provenance, including built-ins and older designs, have `null` path and version. Per-node provenance is saved so different versions remain distinct after reopening; definition files are not included or automatically loaded. Existing blocks with a known source are not updated from a different definition path or version.

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
