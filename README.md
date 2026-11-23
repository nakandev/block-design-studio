# Block Design Studio

ブロック図を配置・配線し、ブラウザまたはJSONファイルとして保存できます。

## セットアップ

```bash
npm install
npm run dev
```

## ブロック定義JSON

ヘッダーの **Load definitions** からブロック定義ファイルを読み込めます。
読み込みに成功すると、ブロックライブラリがその定義へ置き換わります。

```json
[
  {
    "kind": "Counter",
    "label": "Counter",
    "ports": [
      { "id": "clk", "name": "clk", "direction": "input", "width": 1 },
      { "id": "count", "name": "count", "direction": "output", "width": 32 }
    ]
  }
]
```

### ポート定義

通常ポート:

```json
{ "id": "clk", "name": "clk", "direction": "input", "width": 1 }
```

AXIポート:

```json
{ "id": "bus", "name": "bus", "type": "axi.master" }
```

```json
{ "id": "bus", "name": "bus", "type": "axi.slave" }
```

サンプルは `examples/block-definitions.json` にあります。
