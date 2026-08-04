# mcp-nsi-bg

Bulgarian National Statistical Institute (НСИ / NSI) — Open Data API.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `list_datasets` | List NSI Bulgaria open-data datasets with their numeric id and English (or Bulgarian) name. Each dataset id can be passed to get_dataset for the actual figures. Use the optional `filter` to substring-match dataset names (case-insensitive), e.g. 'population', 'export', 'inflation'. |
| `get_dataset` | Fetch a single NSI Bulgaria dataset by numeric id as a JSON-stat 2.0 object (dimensions, categories, and the flat `value` array). Get ids from list_datasets. Example ids: 107 (children in kindergartens by municipality), 242 (aggregate replacement ratio). |
| `get_fields` | Fetch the field/dimension metadata for an NSI dataset (its column codes plus Bulgarian and English names) as parsed CSV rows. Useful for interpreting the dimension codes in a get_dataset response. |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "nsi-bg": {
      "url": "https://gateway.pipeworx.io/nsi-bg/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Nsi Bg data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
