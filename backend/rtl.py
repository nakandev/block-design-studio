from __future__ import annotations

import ast
import io
import json
import re
import tempfile
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Any


class GenerationError(ValueError):
    pass


SV_KEYWORDS = set(
    """
    accept_on alias always always_comb always_ff always_latch and assert assign assume
    automatic before begin bind bins binsof bit break buf bufif0 bufif1 byte case
    casex casez cell chandle checker class clocking const constraint context continue
    cover covergroup coverpoint cross deassign default defparam design disable dist do
    edge else end endcase endchecker endclass endclocking endgroup endinterface
    endpackage endprogram endproperty endsequence endtable endtask enum event eventual
    expect export extends extern final first_match for force foreach forever fork
    forkjoin function generate genvar highz0 highz1 if iff ifnone ignore_bins
    illegal_bins implements implies incdir include initial inout input inside instance
    int integer interconnect interface intersect join join_any join_none large let
    liblist library local localparam logic longint macromodule matches medium modport
    module nand negedge nettype new nmos nor noshowcancelled not notif0 notif1 null
    or output package packed parameter pmos posedge primitive priority program property
    protected pull0 pull1 pulldown pullup pulsestyle_onevent pulsestyle_ondetect pure
    rand randc randcase randsequence rcmos real realtime ref reg release repeat
    restrict return rnmos rpmos rtran rtranif0 rtranif1 scalared sequence shortint
    shortreal showcancelled signed small soft solve specify specparam static std
    string strong strong0 strong1 struct super supply0 supply1 sync_accept_on
    sync_reject_on table tagged task this throughout time timeprecision timeunit
    tran tranif0 tranif1 tri tri0 tri1 triand trior trireg type typedef union unique
    unique0 unsigned until until_with untyped use uwire var vectored virtual void
    wait wait_order wand weak weak0 weak1 while wildcard wire with within wor xnor xor
    """.split()
)
IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_$]*$")
TOKEN = re.compile(
    r"\s*(?:(?:\d+'[sS]?[bBoOdDhH][0-9a-fA-F_xXzZ?]+)|"
    r"(?:\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d[\d_]*)?)|"
    r"(?:[A-Za-z_$][A-Za-z0-9_$]*)|"
    r"(?:<<<|>>>|<<|>>|<=|>=|==|!=|&&|\|\||\*\*|[()+\-*/%&|^~!?:]))"
)


def identifier(value: str, prefix: str = "n") -> str:
    result = re.sub(r"[^A-Za-z0-9_$]+", "_", value).strip("_")
    if not result:
        result = prefix
    if not re.match(r"[A-Za-z_]", result):
        result = f"{prefix}_{result}"
    if result in SV_KEYWORDS:
        result = f"{prefix}_{result}"
    return result


def validate_identifier(value: Any, description: str) -> str:
    if not isinstance(value, str) or not IDENTIFIER.fullmatch(value) or value in SV_KEYWORDS:
        raise GenerationError(f"Invalid SystemVerilog identifier for {description}: {value!r}")
    return value


def validate_expression(value: Any, description: str) -> str:
    if isinstance(value, bool):
        return "1'b1" if value else "1'b0"
    if isinstance(value, int):
        return str(value)
    if not isinstance(value, str) or not value.strip():
        raise GenerationError(f"Missing expression for {description}")
    expression = value.strip()
    if len(expression) > 1024:
        raise GenerationError(f"Expression for {description} is too long")
    if "\n" in expression or "\r" in expression or "//" in expression or "/*" in expression or "*/" in expression:
        raise GenerationError(f"Unsupported expression for {description}: {expression!r}")
    cursor = 0
    tokens = []
    while cursor < len(expression):
        match = TOKEN.match(expression, cursor)
        if not match:
            raise GenerationError(f"Unsupported expression for {description}: {expression!r}")
        tokens.append(match.group().strip())
        cursor = match.end()
    if any(token in expression for token in (";", "`", "{", "}", "[", "]", '"')):
        raise GenerationError(f"Unsupported expression for {description}: {expression!r}")
    normalized = []
    for token in tokens:
        literal = re.fullmatch(r"(\d+)'([sS]?[bBoOdDhH])([0-9a-fA-F_]+)", token)
        if literal:
            base = {"b": 2, "o": 8, "d": 10, "h": 16}[literal.group(2)[-1].lower()]
            try:
                token = str(int(literal.group(3).replace("_", ""), base))
            except ValueError as error:
                raise GenerationError(f"Unsupported expression for {description}: {expression!r}") from error
        normalized.append(token)
    try:
        tree = ast.parse("".join(normalized), mode="eval")
    except SyntaxError as error:
        raise GenerationError(f"Unsupported expression for {description}: {expression!r}") from error

    def safe_node(node: ast.AST) -> bool:
        return (
            isinstance(node, ast.Expression)
            and safe_node(node.body)
            or isinstance(node, ast.Constant)
            and isinstance(node.value, int)
            and not isinstance(node.value, bool)
            or isinstance(node, ast.Name)
            or isinstance(node, ast.UnaryOp)
            and isinstance(node.op, (ast.UAdd, ast.USub, ast.Invert))
            and safe_node(node.operand)
            or isinstance(node, ast.BinOp)
            and isinstance(node.op, (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.FloorDiv, ast.Mod, ast.LShift, ast.RShift, ast.BitAnd, ast.BitOr, ast.BitXor))
            and safe_node(node.left)
            and safe_node(node.right)
        )

    if not safe_node(tree):
        raise GenerationError(f"Unsupported expression for {description}: {expression!r}")
    return expression


def numeric_expression(expression: str, values: dict[str, Any], resolving: set[str] | None = None) -> int:
    resolving = resolving or set()
    sized = re.fullmatch(r"(\d+)'([sS]?[bBoOdDhH])([0-9a-fA-F_]+)", expression.replace(" ", ""))
    if sized:
        base = {"b": 2, "o": 8, "d": 10, "h": 16}[sized.group(2)[-1].lower()]
        return int(sized.group(3).replace("_", ""), base)
    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError as error:
        raise GenerationError(f"Unsupported width expression: {expression!r}") from error

    def evaluate(node: ast.AST) -> int:
        if isinstance(node, ast.Expression):
            return evaluate(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, int) and not isinstance(node.value, bool):
            return node.value
        if isinstance(node, ast.Name):
            if node.id in resolving:
                raise GenerationError(f"Circular parameter reference: {node.id}")
            if node.id not in values:
                raise GenerationError(f"Unresolved parameter in width expression: {node.id}")
            raw = values[node.id]
            nested = validate_expression(raw, f"parameter {node.id}")
            return numeric_expression(nested, values, resolving | {node.id})
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub, ast.Invert)):
            operand = evaluate(node.operand)
            return +operand if isinstance(node.op, ast.UAdd) else -operand if isinstance(node.op, ast.USub) else ~operand
        if isinstance(node, ast.BinOp):
            left, right = evaluate(node.left), evaluate(node.right)
            if isinstance(node.op, (ast.LShift, ast.RShift)) and (right < 0 or right > 63):
                raise GenerationError(f"Shift amount is out of range in width expression: {expression!r}")
            operations = {
                ast.Add: lambda: left + right,
                ast.Sub: lambda: left - right,
                ast.Mult: lambda: left * right,
                ast.Div: lambda: left // right,
                ast.FloorDiv: lambda: left // right,
                ast.Mod: lambda: left % right,
                ast.LShift: lambda: left << right,
                ast.RShift: lambda: left >> right,
                ast.BitAnd: lambda: left & right,
                ast.BitOr: lambda: left | right,
                ast.BitXor: lambda: left ^ right,
            }
            operation = operations.get(type(node.op))
            if operation is None:
                raise GenerationError(f"Unsupported operator in width expression: {expression!r}")
            try:
                result = operation()
            except (ArithmeticError, ValueError) as error:
                raise GenerationError(f"Could not evaluate width expression: {expression!r}") from error
            if abs(result) > 2**63 - 1:
                raise GenerationError(f"Width expression result is too large: {expression!r}")
            return result
        raise GenerationError(f"Unsupported width expression: {expression!r}")

    return evaluate(tree)


def parameter_values(node_data: dict[str, Any], template: dict[str, Any], interface: dict[str, Any]) -> dict[str, str]:
    result: dict[str, str] = {}
    for source in (interface.get("parameters", {}), template.get("parameters", {}), node_data.get("parameters", {})):
        if not isinstance(source, dict):
            raise GenerationError("Parameters must be objects")
        for name, value in source.items():
            validate_identifier(name, "parameter name")
            raw = value.get("value") if isinstance(value, dict) else value
            result[name] = validate_expression(raw, f"parameter {name}")
    return result


def width_value(width: Any, parameters: dict[str, str], description: str) -> int:
    expression = validate_expression(width, description)
    value = numeric_expression(expression, parameters)
    if value < 1 or value > 2**31 - 1:
        raise GenerationError(f"Width for {description} must resolve to a positive 32-bit integer")
    return value


def width_decl(width: int) -> str:
    return "" if width == 1 else f" [{width - 1}:0]"


def load_interfaces(raw: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(raw, list):
        raise GenerationError("interfaces must be an array")
    result: dict[str, dict[str, Any]] = {}
    for definition in raw:
        if not isinstance(definition, dict):
            raise GenerationError("Invalid interface definition")
        name = definition.get("name")
        if not isinstance(name, str) or not name or len(name) > 128:
            raise GenerationError("Interface definitions need a name")
        if name in result:
            raise GenerationError(f"Duplicate interface definition: {name}")
        parameters = definition.get("parameters", {})
        if not isinstance(parameters, dict):
            raise GenerationError(f"Parameters in interface {name!r} must be an object")
        for parameter_name, setting in parameters.items():
            validate_identifier(parameter_name, "interface parameter name")
            value = setting.get("value") if isinstance(setting, dict) else setting
            validate_expression(value, f"interface parameter {parameter_name}")
        common_names: set[str] = set()
        role_names: dict[str, set[str]] = {"master": set(), "slave": set()}
        for key in ("signals", "masterSignals", "slaveSignals"):
            signals = definition.get(key, [])
            if not isinstance(signals, list):
                raise GenerationError(f"{key} in interface {name!r} must be an array")
            seen: set[str] = set()
            for signal in signals:
                if not isinstance(signal, dict):
                    raise GenerationError(f"Invalid signal in interface {name!r}")
                signal_name = validate_identifier(signal.get("name"), f"signal in interface {name}")
                if signal.get("direction") not in ("input", "output", "inout"):
                    raise GenerationError(f"Invalid direction for {name}.{signal_name}")
                if not isinstance(signal.get("width"), (int, str)) or isinstance(signal.get("width"), bool):
                    raise GenerationError(f"Invalid width for {name}.{signal_name}")
                if signal_name in seen:
                    raise GenerationError(f"Duplicate signal {signal_name!r} in {name}.{key}")
                seen.add(signal_name)
                if key == "signals":
                    common_names.add(signal_name)
                else:
                    role_names[key.removesuffix("Signals")].add(signal_name)
        if common_names.intersection(role_names["master"] | role_names["slave"]):
            raise GenerationError(f"Common and role-specific signal names overlap in interface {name!r}")
        result[name] = definition
    return result


def load_blocks(raw: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(raw, list):
        raise GenerationError("blocks must be an array")
    result: dict[str, dict[str, Any]] = {}
    for definition in raw:
        if not isinstance(definition, dict):
            raise GenerationError("Invalid block definition")
        kind = definition.get("kind")
        if not isinstance(kind, str) or not kind or len(kind) > 256:
            raise GenerationError("Block definitions need a kind")
        if kind in result:
            raise GenerationError(f"Duplicate block definition: {kind}")
        result[kind] = definition
    return result


def get_ports(data: Any, node_id: str) -> list[dict[str, Any]]:
    if not isinstance(data, dict) or not isinstance(data.get("ports"), list):
        raise GenerationError(f"Node {node_id} has invalid ports")
    ports = data["ports"]
    seen: set[str] = set()
    for port in ports:
        if not isinstance(port, dict) or not isinstance(port.get("id"), str):
            raise GenerationError(f"Node {node_id} has an invalid port")
        if port["id"] in seen:
            raise GenerationError(f"Node {node_id} has duplicate port id {port['id']!r}")
        seen.add(port["id"])
    return ports


def role_for(port: dict[str, Any]) -> tuple[str, str] | None:
    value = port.get("type")
    match = re.fullmatch(r"(.+)\.(master|slave)", value) if isinstance(value, str) else None
    return (match.group(1), match.group(2)) if match else None


def interface_signals(definition: dict[str, Any], side: str) -> list[dict[str, Any]]:
    signals = []
    for signal in definition.get("signals", []):
        direction = signal["direction"]
        signals.append({
            "name": signal["name"],
            "direction": direction if side == "master" or direction == "inout" else ("output" if direction == "input" else "input"),
            "width": signal["width"],
        })
    signals.extend(definition.get(f"{side}Signals", []))
    return signals


def make_top(payload: Any) -> tuple[str, dict[str, Any]]:
    if not isinstance(payload, dict):
        raise GenerationError("Request body must be an object")
    design = payload.get("design")
    if not isinstance(design, dict) or not isinstance(design.get("nodes"), list) or not isinstance(design.get("edges"), list):
        raise GenerationError("design must contain nodes and edges arrays")
    interfaces = load_interfaces(payload.get("interfaces"))
    blocks = load_blocks(payload.get("blocks"))
    nodes = design["nodes"]
    if len(nodes) > 10000 or len(design["edges"]) > 50000:
        raise GenerationError("Design exceeds the supported node or edge count")
    nodes_by_id: dict[str, dict[str, Any]] = {}
    block_info: dict[str, tuple[dict[str, Any], dict[str, Any], str, dict[str, str]]] = {}
    endpoints: dict[tuple[str, str], list[dict[str, Any]]] = {}
    pins: list[dict[str, Any]] = []
    top_ports: list[dict[str, Any]] = []
    top_names: set[str] = set()
    instances: list[dict[str, Any]] = []
    used_modules: dict[str, str] = {}
    defines: dict[str, str] = {}
    connections: list[tuple[tuple[str, str, str | None], tuple[str, str, str | None]]] = []

    for node in nodes:
        if not isinstance(node, dict) or not isinstance(node.get("id"), str) or node["id"] in nodes_by_id:
            raise GenerationError("Nodes must have unique string ids")
        node_id = node["id"]
        nodes_by_id[node_id] = node
        node_type = node.get("type")
        data = node.get("data")
        node_ports = get_ports(data, node_id)
        if node_type == "block":
            label = data.get("label")
            if not isinstance(label, str) or not label.strip():
                raise GenerationError(f"Block {node_id} needs a nonempty label for RTL naming")
            kind = data.get("kind")
            template = blocks.get(kind)
            if template is None:
                raise GenerationError(f"No block definition is loaded for {kind!r}")
            module = identifier(kind, "module")
            previous_kind = used_modules.get(module)
            if previous_kind is not None and previous_kind != kind:
                raise GenerationError(f"Block types {previous_kind!r} and {kind!r} map to the same module name {module!r}")
            used_modules[module] = kind
            parameters = parameter_values(data, template, {})
            block_info[node_id] = (data, template, module, parameters)
            instances.append({"kind": kind, "module": module, "node_id": node_id})
            node_defines = data.get("defines") or {}
            if not isinstance(node_defines, dict):
                raise GenerationError(f"Defines on node {node_id} must be an object")
            for name, setting in node_defines.items():
                if not isinstance(setting, dict) or not setting.get("enabled"):
                    continue
                validate_identifier(name, "define name")
                value = validate_expression(setting.get("value") or "1", f"define {name}")
                if name in defines and defines[name] != value:
                    raise GenerationError(f"Conflicting values for Verilog define {name}")
                defines[name] = value
        elif not isinstance(node_type, str) or not node_type.startswith("external"):
            raise GenerationError(f"Unsupported node type: {node_type!r}")

        for port in node_ports:
            port_id = port["id"]
            port_name = port.get("name")
            if not isinstance(port_name, str) or not port_name:
                raise GenerationError(f"Missing port name on {node_id}.{port_id}")
            endpoint: list[dict[str, Any]] = []
            role = role_for(port)
            if role:
                interface_name, side = role
                definition = interfaces.get(interface_name)
                if definition is None:
                    raise GenerationError(f"Missing interface definition {interface_name!r}")
                source = port.get("interfaceSource")
                expected_source = definition.get("source")
                if isinstance(source, dict) and source.get("path") and expected_source:
                    if not isinstance(expected_source, dict) or source.get("path") != expected_source.get("path") or source.get("version") != expected_source.get("version"):
                        raise GenerationError(f"Interface source mismatch for {node_id}.{port.get('name')}: loaded {interface_name} definition does not match the design")
                if node_type == "block":
                    params = parameter_values(data, block_info[node_id][1], definition)
                else:
                    params = parameter_values(data, {}, definition)
                signals = interface_signals(definition, side)
                if not signals:
                    raise GenerationError(f"Interface {interface_name!r} has no signal definitions")
                if any(signal["direction"] == "inout" for signal in signals):
                    raise GenerationError(f"RTL generation does not support inout signals on interface {interface_name!r} ({node_id}.{port_id})")
                signal_names: set[str] = set()
                for signal in signals:
                    signal_name = validate_identifier(signal.get("name"), f"signal in interface {interface_name}")
                    if signal_name in signal_names:
                        raise GenerationError(f"Duplicate {side} signal {signal_name!r} in interface {interface_name!r}")
                    signal_names.add(signal_name)
                    width = width_value(signal.get("width"), params, f"{interface_name}.{signal_name}")
                    sv_name = identifier(f"{port_name}_{signal_name}", "port")
                    direction = signal["direction"]
                    if node_type != "block":
                        direction = "input" if direction == "output" else "output"
                    endpoint.append({
                        "node_id": node_id, "port_id": port_id, "signal": signal_name,
                        "sv_name": sv_name, "direction": direction, "width": width,
                        "external": node_type != "block", "interface": interface_name, "role": side,
                    })
            elif node_type == "block":
                if port.get("type") not in (None, "clock", "reset"):
                    raise GenerationError(f"Unsupported port type on {node_id}.{port_id}: {port.get('type')!r}")
                width = port.get("width", 1)
                if not isinstance(width, int) or isinstance(width, bool) or width < 1:
                    raise GenerationError(f"Invalid width on {node_id}.{port_id}")
                if port.get("direction") not in ("input", "output"):
                    raise GenerationError(f"Invalid direction on {node_id}.{port_id}")
                endpoint.append({
                    "node_id": node_id, "port_id": port_id, "signal": None,
                    "sv_name": identifier(port_name, "port"),
                    "direction": port["direction"], "width": width, "external": False,
                    "interface": None, "role": None,
                })
            else:
                if port.get("type") not in (None, "clock", "reset"):
                    raise GenerationError(f"Unsupported external port type on {node_id}.{port_id}: {port.get('type')!r}")
                width = port.get("width", 1)
                if not isinstance(width, int) or isinstance(width, bool) or width < 1:
                    raise GenerationError(f"Invalid width on external port {node_id}.{port_id}")
                direction = port.get("direction")
                if direction not in ("input", "output"):
                    raise GenerationError(f"Invalid direction on external port {node_id}.{port_id}")
                endpoint.append({
                    "node_id": node_id, "port_id": port_id, "signal": None,
                    "sv_name": identifier(port.get("name", port_id), "port"),
                    "direction": direction, "width": width, "external": True,
                    "interface": None, "role": None,
                })

            for pin in endpoint:
                pin["key"] = (node_id, port_id, pin["signal"])
                if pin["external"]:
                    base_name = pin["sv_name"]
                    top_name = base_name
                    if top_name in top_names:
                        top_name = identifier(f"{base_name}_{node_id}", "port")
                    if top_name in top_names:
                        raise GenerationError(f"Duplicate top-level port name: {top_name}")
                    top_names.add(top_name)
                    pin["top_name"] = top_name
                    top_ports.append({
                        "name": top_name, "direction": "input" if pin["direction"] == "output" else "output",
                        "width": pin["width"], "key": pin["key"],
                    })
                pins.append(pin)
            endpoints[(node_id, port_id)] = endpoint

    connected_targets: set[tuple[str, str]] = set()
    for edge in design["edges"]:
        if not isinstance(edge, dict):
            raise GenerationError("Invalid edge")
        source_id, target_id = edge.get("source"), edge.get("target")
        source_handle, target_handle = edge.get("sourceHandle"), edge.get("targetHandle")
        if not all(isinstance(value, str) for value in (source_id, target_id, source_handle, target_handle)):
            raise GenerationError("Edges must identify source/target nodes and ports")
        source_node, target_node = nodes_by_id.get(source_id), nodes_by_id.get(target_id)
        if source_node is None or target_node is None:
            raise GenerationError(f"Edge refers to a missing node: {source_id} -> {target_id}")
        if source_id == target_id:
            raise GenerationError("Self-connections are not supported")
        target_key = (target_id, target_handle)
        if target_key in connected_targets:
            raise GenerationError(f"Input port {target_id}.{target_handle} has multiple connections")
        connected_targets.add(target_key)
        source_port = next((p for p in source_node["data"]["ports"] if p["id"] == source_handle), None)
        target_port = next((p for p in target_node["data"]["ports"] if p["id"] == target_handle), None)
        if source_port is None or target_port is None:
            raise GenerationError("Edge refers to a missing port")
        if source_port.get("direction") != "output" or target_port.get("direction") != "input":
            raise GenerationError("Edges must connect an output port to an input port")
        source_role, target_role = role_for(source_port), role_for(target_port)
        source_pins = endpoints[(source_id, source_handle)]
        target_pins = endpoints[(target_id, target_handle)]
        if source_role or target_role:
            if not source_role or not target_role or source_role[0] != target_role[0]:
                raise GenerationError("Connected interface types do not match")
            source_external, target_external = source_node["type"] != "block", target_node["type"] != "block"
            if source_external and target_external:
                raise GenerationError("Direct connections between two external interface nodes are not supported")
            if source_external or target_external:
                if source_role[1] != target_role[1]:
                    raise GenerationError("External interface nodes must connect to a block port with the same role")
            elif source_role[1] != "master" or target_role[1] != "slave":
                raise GenerationError("Block interface connections must go from master to slave")
            source_by_name = {pin["signal"]: pin for pin in source_pins}
            target_by_name = {pin["signal"]: pin for pin in target_pins}
            if source_by_name.keys() != target_by_name.keys():
                missing = sorted(source_by_name.keys() ^ target_by_name.keys())
                raise GenerationError(f"Interface {source_role[0]} has role-specific signals without an automatic connection: {', '.join(missing)}")
            for name, left in source_by_name.items():
                right = target_by_name[name]
                if left["width"] != right["width"]:
                    raise GenerationError(f"Width mismatch on {source_role[0]}.{name}: {left['width']} vs {right['width']}")
                if left["direction"] == right["direction"]:
                    raise GenerationError(f"Interface {source_role[0]}.{name} has incompatible directions on connected roles")
                connections.append((left["key"], right["key"]))
        else:
            if source_role or target_role:
                raise GenerationError("Cannot connect an interface port to a scalar port")
            if source_port.get("type") != target_port.get("type"):
                raise GenerationError("Connected signal port types do not match")
            left, right = source_pins[0], target_pins[0]
            if left["width"] != right["width"]:
                raise GenerationError(f"Width mismatch on connected ports: {left['width']} vs {right['width']}")
            connections.append((left["key"], right["key"]))

    parent: dict[tuple[str, str, str | None], tuple[str, str, str | None]] = {pin["key"]: pin["key"] for pin in pins}

    def find(key: tuple[str, str, str | None]) -> tuple[str, str, str | None]:
        if parent[key] != key:
            parent[key] = find(parent[key])
        return parent[key]

    def union(a: tuple[str, str, str | None], b: tuple[str, str, str | None]) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for left, right in connections:
        union(left, right)
    connected_keys = {key for connection in connections for key in connection}
    groups: dict[tuple[str, str, str | None], list[dict[str, Any]]] = defaultdict(list)
    for pin in pins:
        groups[find(pin["key"])].append(pin)
    net_by_key: dict[tuple[str, str, str | None], str] = {}
    net_owners: dict[str, tuple[str, str, str | None]] = {}
    for group in groups.values():
        top_members = [pin for pin in group if pin.get("top_name")]
        if len(top_members) > 1:
            raise GenerationError("A connection cannot join multiple external top-level ports")
        drivers = [pin for pin in group if pin["direction"] == "output"]
        if len(drivers) > 1:
            raise GenerationError("Connection has multiple output drivers: " + ", ".join(pin["sv_name"] for pin in drivers))
        if top_members:
            net_name = top_members[0]["top_name"]
        else:
            first = group[0]
            label = nodes_by_id[first["node_id"]]["data"]["label"]
            suffix = first["sv_name"] if first["signal"] else f"{first['sv_name']}_sig"
            net_name = identifier(f"net_{label}_{suffix}", "net")
            if net_name in top_names:
                raise GenerationError(f"Internal net name collides with a top-level port: {net_name}")
        previous_owner = net_owners.get(net_name)
        owner = group[0]["key"]
        if previous_owner is not None and previous_owner != owner:
            raise GenerationError(f"Internal net names collide after sanitizing: {net_name}")
        net_owners[net_name] = owner
        for pin in group:
            net_by_key[pin["key"]] = net_name

    used_module_ports: dict[str, set[str]] = defaultdict(set)
    declarations: dict[str, int] = {}
    for pin in pins:
        if pin["external"]:
            continue
        node_id = pin["node_id"]
        _, _, _, _ = block_info[node_id]
        if pin["sv_name"] in used_module_ports[node_id]:
            raise GenerationError(f"Generated module port name collision on node {node_id}: {pin['sv_name']}")
        used_module_ports[node_id].add(pin["sv_name"])
        declarations[net_by_key[pin["key"]]] = pin["width"]

    top_module = identifier(str(design.get("name") or "block_design"), "design")
    block_module_names = {instance["module"] for instance in instances}
    while top_module in block_module_names:
        top_module = f"top_{top_module}"

    lines = []
    for name in sorted(defines):
        lines.append(f"`ifndef {name}")
        lines.append(f"`define {name} {defines[name]}")
        lines.append("`endif")
    if lines:
        lines.append("")
    lines.append(f"module {top_module} (")
    if top_ports:
        lines.extend(f"  {port['direction']} wire{width_decl(port['width'])} {port['name']}{',' if index + 1 < len(top_ports) else ''}" for index, port in enumerate(top_ports))
        lines.append(");")
    else:
        lines.append(");")
    lines.append("")
    top_name_set = {port["name"] for port in top_ports}
    for name, width in declarations.items():
        if name not in top_name_set:
            lines.append(f"  wire{width_decl(width)} {name};")
    if declarations:
        lines.append("")

    instance_names: set[str] = set()
    for node_id, (data, template, module, params) in block_info.items():
        instance = identifier(f"u_{data['label']}", "u")
        if instance in instance_names:
            raise GenerationError(f"Block labels produce duplicate instance name {instance}; rename the blocks")
        instance_names.add(instance)
        parameter_overrides = []
        template_parameters = template.get("parameters") or {}
        for name in template_parameters:
            validate_identifier(name, "parameter name")
            if name in params:
                parameter_overrides.append(f".{name}({params[name]})")
        for name in data.get("parameters", {}):
            validate_identifier(name, "parameter name")
            if name not in template_parameters:
                parameter_overrides.append(f".{name}({params[name]})")
        if parameter_overrides:
            lines.append(f"  {module} #(")
            lines.append("    " + ",\n    ".join(parameter_overrides))
            lines.append(f"  ) {instance} (")
        else:
            lines.append(f"  {module} {instance} (")
        node_pins = [pin for pin in pins if pin["node_id"] == node_id]
        lines.append(",\n".join(f"    .{pin['sv_name']}({net_by_key[pin['key']]})" for pin in node_pins))
        lines.append("  );")
        lines.append("")
    lines.append("endmodule")
    lines.append("")
    report = {
        "top_module": top_module,
        "instances": instances,
        "definitions": design.get("definitions", {}),
        "rtl_sources_included": False,
        "unconnected_inputs": [
            f"{pin['node_id']}.{pin['port_id']}.{pin['signal']}" if pin["signal"] else f"{pin['node_id']}.{pin['port_id']}"
            for pin in pins
            if not pin["external"] and pin["direction"] == "input" and pin["key"] not in connected_keys
        ],
        "limitations": [
            "Block RTL sources are not included; module sources must be supplied by a package manager before compilation.",
            "Address maps and interconnect-specific routing are not generated.",
            "Interface connections require same-named signals with compatible directions and widths.",
        ],
    }
    return "\n".join(lines), report


def generate_bundle(payload: Any) -> bytes:
    top, report = make_top(payload)
    with tempfile.TemporaryDirectory(prefix="block-design-rtl-") as workdir:
        root = Path(workdir)
        (root / "top.sv").write_text(top, encoding="utf-8")
        (root / "rtl-manifest.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        (root / "README.txt").write_text(
            "Generated structural SystemVerilog top.\n"
            "Block module RTL sources are not included yet; see rtl-manifest.json.\n"
            "Address maps and interconnect-specific routing are not generated.\n",
            encoding="utf-8",
        )
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as bundle:
            for path in sorted(root.iterdir()):
                bundle.write(path, path.name)
        return archive.getvalue()
