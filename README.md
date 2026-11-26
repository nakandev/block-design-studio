# Block Port Types

## Loading definitions

Use **Load definitions folder** and select a folder containing a manifest, such as the `examples` folder. Folder selection requires browser support for directory uploads.

The manifest lists `interfaces` and `blocks` as `{ "path": "interface/ahb.json", "version": "0.1.0" }` references. Paths are relative to the manifest's folder. Each referenced JSON file contains one definition and its `version`; the versions must match exactly. Missing files, invalid definitions, and version mismatches prevent the entire load.

### Interface signals

Interfaces can optionally define `parameters`, `signals`, `masterSignals`, and `slaveSignals`; definitions without them remain supported. Each signal has a unique HDL identifier `name`, an `input` or `output` direction, and a `width` (a positive integer or a nonempty HDL expression string). Parameters use the same `{ "type": "int", "value": "32" }` format as block parameters. Expressions and parameter values are stored as written, not evaluated or checked against a specific HDL.

The `signals` directions are relative to the master; the slave uses the opposite direction. `masterSignals` and `slaveSignals` are role-specific and use the specified direction directly. Names must not repeat within a list or between common and role-specific signals for the same role. A name can occur in both role-specific lists.

```json
{
  "name": "example",
  "parameters": { "DATA_WIDTH": { "type": "int", "value": "32" } },
  "signals": [
    { "name": "DATA", "direction": "output", "width": "DATA_WIDTH" }
  ],
  "slaveSignals": [
    { "name": "SELECT", "direction": "input", "width": 1 }
  ]
}
```

The example `ahb` and `axi` interfaces describe AHB-Lite and AXI4-Lite respectively. In AHB-Lite, `HREADY` is an input on both roles, while `HSEL` and `HREADYOUT` are slave-specific; their interconnect routing is not represented by simple signal reversal. Clock and reset remain separate block ports. These definitions describe signals only: they do not validate parameter ranges, check interface compatibility, or generate RTL.

## RTL generation

With Python 3.9 or later, start the Python backend with `npm run backend` and the Vite frontend with `npm run dev` in separate terminals. The frontend proxies `/api` requests to the loopback backend. **Generate RTL** posts the current design and loaded definitions to `/api/rtl/generate` and downloads a ZIP containing `top.sv` and `rtl-manifest.json`.

The backend generates a structural top-level module: block module names come from `kind` after SystemVerilog identifier sanitization, interface pins are flattened as `<port name>_<signal name>`, scalar ports use their sanitized configured names, and signal directions and widths are checked on each connection. Interface width expressions use matching block parameters when present or the interface parameter defaults otherwise. Only configured, materialized ports are emitted; generation templates and Address Maps are ignored.

Instance names and internal wire names are derived from block labels and port names, not node or port IDs. Labels must be nonempty and must not collide after identifier sanitization; rename blocks if generation reports a collision.

The generated archive intentionally does not contain block RTL source files yet. Its manifest lists the expected modules and makes this limitation explicit; the generated top is not compile-ready until those modules are supplied. A future package manager can stage the selected sources in a per-job temporary directory. Connections with role-specific signals or incompatible directions/widths (including AHB-Lite routing such as `HREADYOUT` to `HREADY`) fail rather than producing guessed wiring. Interconnect-specific routing and Address Maps are not generated.

Run backend tests with `npm run test:backend`.

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
