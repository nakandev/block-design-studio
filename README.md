# Block Port Types

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
