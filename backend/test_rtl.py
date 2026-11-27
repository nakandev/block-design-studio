import io
import json
import unittest
import zipfile

from .rtl import GenerationError, generate_bundle, make_top, validate_rtl


def block_node(node_id, kind, ports, parameters=None):
    return {
        "id": node_id,
        "type": "block",
        "data": {
            "kind": kind,
            "label": node_id,
            "ports": ports,
            "parameters": parameters or {},
        },
    }


def external_node(node_id, kind, port_id, direction, width):
    return {
        "id": node_id,
        "type": kind,
        "data": {
            "kind": kind,
            "label": node_id,
            "ports": [{
                "id": port_id,
                "name": f"external_{node_id}",
                "direction": direction,
                "width": width,
            }],
            "parameters": {},
        },
    }


def payload(nodes, edges, interfaces=None, blocks=None, name="demo"):
    return {
        "design": {"name": name, "nodes": nodes, "edges": edges},
        "interfaces": interfaces or [],
        "blocks": blocks or [],
    }


class RTLGenerationTests(unittest.TestCase):
    def setUp(self):
        self.interface = {
            "name": "bus",
            "parameters": {"DATA_WIDTH": {"type": "int", "value": "16"}},
            "signals": [
                {"name": "DATA", "direction": "output", "width": "DATA_WIDTH"},
                {"name": "READY", "direction": "input", "width": 1},
            ],
        }
        self.blocks = [
            {"type": "Source Block", "name": "Source", "parameters": {"DATA_WIDTH": {"type": "int", "value": "8"}}},
            {"type": "Sink", "name": "Sink", "parameters": {"DATA_WIDTH": {"type": "int", "value": "8"}}},
        ]

    def test_accepts_new_definition_fields_and_rejects_old_ones(self):
        node = block_node("node", "Example", [])
        top, _ = make_top(payload([node], [], blocks=[{"type": "Example", "name": "example"}]))
        self.assertIn("Example u_node", top)
        for definition in [{"kind": "Example", "label": "example"}, {"type": "Example", "name": "example", "kind": "Example"}]:
            with self.assertRaisesRegex(GenerationError, "no longer supported"):
                make_top(payload([node], [], blocks=[definition]))
        with self.assertRaisesRegex(GenerationError, "Interface label is no longer supported"):
            make_top(payload([], [], interfaces=[{"name": "bus", "label": "Bus"}]))

    def test_rejects_hierarchical_designs(self):
        request = payload([], [])
        request["design"]["subdesigns"] = [{"id": "child", "nodes": [], "edges": []}]
        with self.assertRaisesRegex(GenerationError, "hierarchical designs"):
            make_top(request)
        request["design"]["subdesigns"] = []
        request["design"]["nodes"] = [{"id": "child", "type": "subdesign"}]
        with self.assertRaisesRegex(GenerationError, "hierarchical designs"):
            generate_bundle(request)
        request["design"]["subdesigns"] = {}
        with self.assertRaisesRegex(GenerationError, "subdesigns must be an array"):
            make_top(request)

    def test_builds_structural_top_with_flattened_interface_wires_and_parameters(self):
        source = block_node("source-1", "Source Block", [
            {"id": "din", "name": "din", "direction": "input", "width": 8},
            {"id": "link", "name": "link", "direction": "output", "type": "bus.master"},
        ], {"DATA_WIDTH": {"type": "int", "value": "8"}})
        sink = block_node("sink-1", "Sink", [
            {"id": "link", "name": "link", "direction": "input", "type": "bus.slave"},
            {"id": "dout", "name": "dout", "direction": "output", "width": 8},
        ], {"DATA_WIDTH": {"type": "int", "value": "8"}})
        input_node = external_node("input", "externalInput", "data", "output", 8)
        output_node = external_node("output", "externalOutput", "data", "input", 8)
        edges = [
            {"source": "input", "sourceHandle": "data", "target": "source-1", "targetHandle": "din"},
            {"source": "source-1", "sourceHandle": "link", "target": "sink-1", "targetHandle": "link"},
            {"source": "sink-1", "sourceHandle": "dout", "target": "output", "targetHandle": "data"},
        ]
        top, report = make_top(payload([input_node, source, sink, output_node], edges, [self.interface], self.blocks))
        self.assertIn("module demo (", top)
        self.assertIn("input wire [7:0] external_input", top)
        self.assertIn("output wire [7:0] external_output", top)
        self.assertIn("Source_Block #(", top)
        self.assertIn(".DATA_WIDTH(8)", top)
        self.assertIn(".link_DATA(net_source_1_link_DATA)", top)
        self.assertIn(".link_READY(net_source_1_link_READY)", top)
        self.assertEqual(len(report["instances"]), 2)
        self.assertFalse(report["rtl_sources_included"])

    def test_fanout_joins_multiple_sinks_to_one_net(self):
        source = block_node("src", "Source Block", [{"id": "out", "name": "out", "direction": "output", "width": 1}])
        sink_a = block_node("a", "Sink", [{"id": "in", "name": "in", "direction": "input", "width": 1}])
        sink_b = block_node("b", "Sink", [{"id": "in", "name": "in", "direction": "input", "width": 1}])
        edges = [
            {"source": "src", "sourceHandle": "out", "target": "a", "targetHandle": "in"},
            {"source": "src", "sourceHandle": "out", "target": "b", "targetHandle": "in"},
        ]
        top, _ = make_top(payload([source, sink_a, sink_b], edges, blocks=self.blocks))
        self.assertIn(".out(net_src_out_sig)", top)
        self.assertEqual(top.count(".in(net_src_out_sig)"), 2)

    def test_uses_labels_and_port_names_instead_of_ids(self):
        source = block_node("node-123", "Source Block", [
            {"id": "port-456", "name": "bus", "direction": "output", "type": "bus.master"},
            {"id": "port-999", "name": "done", "direction": "output", "width": 1},
        ], {"DATA_WIDTH": 8})
        source["data"]["label"] = "CPU core"
        sink = block_node("node-789", "Sink", [
            {"id": "target-123", "name": "link", "direction": "input", "type": "bus.slave"},
        ], {"DATA_WIDTH": 8})
        sink["data"]["label"] = "Memory"
        edge = {"source": "node-123", "sourceHandle": "port-456", "target": "node-789", "targetHandle": "target-123"}
        top, _ = make_top(payload([source, sink], [edge], [self.interface], self.blocks))
        self.assertIn(") u_CPU_core (", top)
        self.assertIn(") u_Memory (", top)
        self.assertIn(".bus_DATA(net_CPU_core_bus_DATA)", top)
        self.assertIn(".link_DATA(net_CPU_core_bus_DATA)", top)
        self.assertIn(".done(net_CPU_core_done_sig)", top)
        self.assertNotIn("node_123", top)
        self.assertNotIn("port_456", top)

    def test_rejects_empty_or_colliding_block_labels(self):
        a = block_node("first", "Sink", [])
        b = block_node("second", "Sink", [])
        a["data"]["label"] = "same-label"
        b["data"]["label"] = "same label"
        with self.assertRaisesRegex(GenerationError, "duplicate instance name.*rename"):
            make_top(payload([a, b], [], blocks=self.blocks))
        a["data"]["label"] = " "
        with self.assertRaisesRegex(GenerationError, "nonempty label"):
            make_top(payload([a], [], blocks=self.blocks))

    def test_validation_reports_independent_label_errors_and_generation_error(self):
        a = block_node("first", "Sink", [])
        b = block_node("second", "Sink", [])
        c = block_node("third", "Sink", [])
        a["data"]["label"] = "same-label"
        b["data"]["label"] = "same label"
        c["data"]["label"] = " "
        issues = validate_rtl(payload([a, b, c], [], blocks=self.blocks))
        self.assertTrue(any(issue.get("nodeId") == "second" and "duplicate instance" in issue["message"] for issue in issues))
        self.assertTrue(any(issue.get("nodeId") == "third" and "nonempty" in issue["message"] for issue in issues))
        self.assertEqual(validate_rtl(payload([a], [], blocks=self.blocks)), [])
        self.assertTrue(any("No block definition" in issue["message"] for issue in validate_rtl(payload([a], [], blocks=[]))))

    def test_external_interface_port_becomes_top_level_port(self):
        source = block_node("src", "Source Block", [
            {"id": "link", "name": "link", "direction": "output", "type": "bus.master"},
        ], {"DATA_WIDTH": 16})
        external = {
            "id": "external",
            "type": "externalInterfaceMaster",
            "data": {
                "kind": "External bus Master",
                "label": "external_bus_master",
                "parameters": {},
                "ports": [{
                    "id": "bus_master",
                    "name": "external_bus_master",
                    "direction": "input",
                    "type": "bus.master",
                }],
            },
        }
        edge = {"source": "src", "sourceHandle": "link", "target": "external", "targetHandle": "bus_master"}
        top, _ = make_top(payload([source, external], [edge], [self.interface], self.blocks))
        self.assertIn("output wire [15:0] external_bus_master_DATA", top)
        self.assertIn("input wire external_bus_master_READY", top)
        self.assertIn(".link_DATA(external_bus_master_DATA)", top)
        self.assertIn(".link_READY(external_bus_master_READY)", top)

    def test_uses_interface_defaults_when_block_has_no_matching_parameter(self):
        node = block_node("src", "Simple", [
            {"id": "link", "name": "link", "direction": "output", "type": "bus.master"},
        ])
        top, _ = make_top(payload([node], [], [self.interface], [{"type": "Simple", "name": "Simple"}]))
        self.assertIn("wire [15:0] net_src_link_DATA", top)

    def test_generates_zip_with_source_manifest_and_limitations(self):
        node = block_node("src", "Source Block", [{"id": "out", "name": "out", "direction": "output", "width": 1}])
        archive = generate_bundle(payload([node], [], blocks=self.blocks))
        with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
            self.assertEqual(set(bundle.namelist()), {"README.txt", "rtl-manifest.json", "top.sv"})
            manifest = json.loads(bundle.read("rtl-manifest.json"))
            self.assertIn("Source_Block", [instance["module"] for instance in manifest["instances"]])
            self.assertIn("package manager", manifest["limitations"][0])
            self.assertEqual(manifest["unconnected_inputs"], [])

    def test_rejects_role_specific_signal_without_routing_rule(self):
        ahb = {
            "name": "ahb",
            "signals": [{"name": "HADDR", "direction": "output", "width": 32}],
            "masterSignals": [{"name": "HREADY", "direction": "input", "width": 1}],
            "slaveSignals": [
                {"name": "HREADY", "direction": "input", "width": 1},
                {"name": "HREADYOUT", "direction": "output", "width": 1},
            ],
        }
        master = block_node("master", "Source Block", [{"id": "bus", "name": "bus", "direction": "output", "type": "ahb.master"}])
        slave = block_node("slave", "Sink", [{"id": "bus", "name": "bus", "direction": "input", "type": "ahb.slave"}])
        edge = {"source": "master", "sourceHandle": "bus", "target": "slave", "targetHandle": "bus"}
        with self.assertRaisesRegex(GenerationError, "role-specific signals"):
            make_top(payload([master, slave], [edge], [ahb], self.blocks))

    def test_rejects_inout_interfaces_without_guessing_wiring(self):
        interface = {"name": "gpio", "signals": [{"name": "GPIO", "direction": "inout", "width": 1}]}
        node = block_node("src", "Source Block", [
            {"id": "pins", "name": "pins", "direction": "output", "type": "gpio.master"},
        ])
        with self.assertRaisesRegex(GenerationError, "does not support inout.*gpio"):
            make_top(payload([node], [], [interface], self.blocks))
        node["data"]["ports"][0].update({"direction": "input", "type": "gpio.slave"})
        with self.assertRaisesRegex(GenerationError, "does not support inout.*gpio"):
            make_top(payload([node], [], [interface], self.blocks))
        node["type"] = "externalInterfaceSlave"
        with self.assertRaisesRegex(GenerationError, "does not support inout.*gpio"):
            make_top(payload([node], [], [interface], self.blocks))

    def test_rejects_unsafe_parameters_and_unresolved_widths(self):
        node = block_node("src", "Source Block", [{"id": "bus", "name": "bus", "direction": "output", "type": "bus.master"}], {"DATA_WIDTH": "8); endmodule"})
        with self.assertRaisesRegex(GenerationError, "Unsupported expression"):
            make_top(payload([node], [], [self.interface], self.blocks))
        self.interface["signals"][0]["width"] = "MISSING + 1"
        node["data"]["parameters"] = {}
        with self.assertRaisesRegex(GenerationError, "Unresolved parameter"):
            make_top(payload([node], [], [self.interface], self.blocks))
        self.interface["signals"][0]["width"] = "1 << 1000000000"
        with self.assertRaisesRegex(GenerationError, "Shift amount is out of range"):
            make_top(payload([node], [], [self.interface], self.blocks))

    def test_rejects_sanitized_module_name_collisions(self):
        blocks = [
            {"type": "A-B", "name": "A-B"},
            {"type": "A B", "name": "A B"},
        ]
        nodes = [
            block_node("a", "A-B", []),
            block_node("b", "A B", []),
        ]
        with self.assertRaisesRegex(GenerationError, "same module name"):
            make_top(payload(nodes, [], blocks=blocks))


if __name__ == "__main__":
    unittest.main()
