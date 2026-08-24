# QVAC for DAppNode

This package runs the official [QVAC](https://qvac.tether.io/) CLI as a private, OpenAI-compatible AI server on DAppNode.

The image includes QVAC's upstream worker and native Linux addons. The built-in configuration UI provides a searchable model library and manages QVAC settings without shell or File Manager access.

## Endpoints

- Configuration UI: `http://qvac.dappnode:8080`
- OpenAI-compatible API: `http://qvac.dappnode:11434/v1`
- Interactive API documentation: `http://qvac.dappnode:11434/docs`

## Defaults

- QVAC CLI: `0.11.0`
- Model: `QWEN3_600M_INST_Q4`
- API alias: `qwen3-600m`
- Model cache: `/data/models`
- Configuration: `/data/config/qvac.config.json`

CPU inference is supported on Linux. The package does not request host GPU devices, so larger models and image generation can be slow. Model downloads, configuration, and backups persist in the `data` volume.

## Configuration ownership

The installation wizard is limited to settings that must exist before the package starts:

- API bearer token
- Optional host mapping for the API port
- Data-volume location

After installation, use `http://qvac.dappnode:8080` for model selection, aliases, preload/default behavior, engine configuration, logging, download behavior, browser origins, JSON import/export, validation, and backup restore.

## Development

Build and run locally without IPFS:

```bash
docker compose build
docker compose up -d
```

Use `make dev-tar` only when a Docker image tarball is needed for a DAppNode development upload.

## Upstream

- [QVAC source](https://github.com/tetherto/qvac)
- [QVAC documentation](https://docs.qvac.tether.io/)
