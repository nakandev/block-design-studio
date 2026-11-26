# Block Port Types

## Loading definitions

Use **Load definitions folder** and select a folder containing a manifest, such as the `examples` folder. Folder selection requires browser support for directory uploads.

The manifest lists `interfaces` and `blocks` as `{ "path": "interface/ahb.json", "version": "0.1.0" }` references. Paths are relative to the manifest's folder. Each referenced JSON file contains one definition and its `version`; the versions must match exactly. Missing files, invalid definitions, and version mismatches prevent the entire load.

### Interface signals

Interfaces can optionally define `parameters`, `signals`, `masterSignals`, and `slaveSignals`; definitions without them remain supported. Each signal has a unique HDL identifier `name`, an `input`, `output`, or `inout` direction, and a `width` (a positive integer or a nonempty HDL expression string). Parameters use the same `{ "type": "int", "value": "32" }` format as block parameters. Expressions and parameter values are stored as written, not evaluated or checked against a specific HDL.

The `signals` directions are relative to the master; the slave uses the opposite direction for `input` and `output`, while `inout` remains `inout`. `masterSignals` and `slaveSignals` are role-specific and use the specified direction directly. Names must not repeat within a list or between common and role-specific signals for the same role. A name can occur in both role-specific lists.

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

The other examples describe APB4, Wishbone B4 Classic, a single-port synchronous BRAM with scalar write enable, single-select SPI, basic UART without flow control, and JTAG without optional TRST. Bus clocks and resets are separate block ports; SPI `SCLK` and JTAG `TCK` are included. UART `TX` and `RX` name the master-to-slave and slave-to-master wires, respectively; the slave-side `TX` is its receive input and `RX` is its transmit output. Wishbone `ADR` is a raw address with addressing granularity determined by the connected implementation.

GPIO and I2C use `inout` for physical shared pins. I3C models controller-driven `SCL` and bidirectional `SDA`; this basic model does not describe I2C-compatible clock stretching or open-drain/push-pull drive control. These examples do not specify pull-ups, pin buffers, electrical behavior, or protocol-specific timing. RTL generation rejects any used interface with `inout` signals until bidirectional wiring is supported.

## RTL generation

With Python 3.9 or later, start the Python backend with `npm run backend` and the Vite frontend with `npm run dev` in separate terminals. The frontend proxies `/api` requests to the loopback backend. **Generate RTL** posts the current design and loaded definitions to `/api/rtl/generate` and downloads a ZIP containing `top.sv` and `rtl-manifest.json`.

**Validate Design** opens a results panel without changing the design. It checks connections and address ranges and warns about unconnected ports; selecting a result focuses the relevant node or connection. The backend also checks RTL generation using the currently loaded definitions. RTL checks report the first generation error at a time (along with block label errors), so revalidate after corrections. If the backend is unavailable, the panel reports that RTL validation could not run. Results become stale after the design or definitions change.

The backend generates a structural top-level module: block module names come from `kind` after SystemVerilog identifier sanitization, interface pins are flattened as `<port name>_<signal name>`, scalar ports use their sanitized configured names, and signal directions and widths are checked on each connection. Interface width expressions use matching block parameters when present or the interface parameter defaults otherwise. Only configured, materialized ports are emitted; generation templates and Address Maps are ignored.

Instance names and internal wire names are derived from block labels and port names, not node or port IDs. Labels must be nonempty and must not collide after identifier sanitization; rename blocks if generation reports a collision.

The generated archive intentionally does not contain block RTL source files yet. Its manifest lists the expected modules and makes this limitation explicit; the generated top is not compile-ready until those modules are supplied. A future package manager can stage the selected sources in a per-job temporary directory. Connections with role-specific signals or incompatible directions/widths (including AHB-Lite routing such as `HREADYOUT` to `HREADY`) fail rather than producing guessed wiring. Interconnect-specific routing and Address Maps are not generated.

Run backend tests with `npm run test:backend`.

Use **Export JSON** to save a design to a file and **Open** to restore it. Opening another file or leaving the page warns when the design has changed since the last export or open; browser unload warnings depend on browser support and interaction. If loading a design applies changes from currently loaded definitions, export again to save those changes.

Exported designs include an `interfaceSource` with `path` and `version` on each interface port and generated port definition. Generated ports inherit their definition's source. Paths are relative to the loaded manifest's folder; unknown sources have `null` path and version. Older designs with per-node `interfaceSources` are migrated to per-port sources when opened or exported.

For example, an interface port can include `"interfaceSource": { "path": "interface/ahb.json", "version": "0.1.0" }`. Individual generated-port sources are retained when ports are disabled or their count is reduced and later restored.

The design also includes `definitions.interfaces` and `definitions.blocks` listing the definitions used by nodes. Interface entries are collected from ports and generated port definitions; a bus without matching ports is included using its per-node source when available. Different versions remain distinct after reopening. Definition files are not included or automatically loaded. Existing blocks with a known source are not updated from a different definition path or version.

## Ports

Select a block and use **Port layout** in Properties to choose vertical ports (inputs left, outputs right) or horizontal ports (inputs top, outputs bottom). The selection is saved with the design; existing designs default to vertical. Single-port external nodes retain their usual layout.

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
