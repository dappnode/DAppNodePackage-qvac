# QVAC for DAppNode

This package runs the official [QVAC](https://qvac.tether.io/) CLI as a private, OpenAI-compatible AI server on DAppNode.

The image includes QVAC's upstream worker and native Linux addons. The built-in configuration UI provides a searchable model library and manages QVAC settings without shell or File Manager access.

## Variants

The repository publishes two packages from the same image and configuration:

| Variant | Package | Hostname | Hardware behavior |
| --- | --- | --- | --- |
| CPU | `qvac.dnp.dappnode.eth` | `qvac.dappnode` | Does not request a GPU and runs on every DAppNode |
| GPU | `qvac-gpu.dnp.dappnode.eth` | `qvac-gpu.dappnode` | Reserves every GPU exposed by Docker's GPU/CDI runtime |

On either hostname, the configuration UI uses port `8080`, the OpenAI-compatible API uses `/v1` on port `11434`, and the interactive API documentation is at `/docs` on port `11434`.

## Defaults

- QVAC CLI: `0.12.0`
- Model: `QWEN3_600M_INST_Q4`
- API alias: `qwen3-600m`
- Model cache: `/data/models`
- Configuration: `/data/config/qvac.config.json`

Model downloads, configuration, and backups persist in the `data` volume.

## CPU and GPU behavior

Docker treats a Compose GPU reservation as a hard requirement and fails before starting the container when no GPU vendor is available. The CPU package therefore omits that reservation. The GPU package requests every GPU through Docker's vendor-neutral `gpu` capability and requires a working AMD or NVIDIA container toolkit/CDI configuration. Both variants use the same image, which includes the Vulkan loader, Mesa Vulkan drivers, and `vulkaninfo`.

## Configuration ownership

The installation wizard is limited to settings that must exist before the package starts:

- API bearer token
- Optional host mapping for the API port
- Data-volume location

After installation, open port `8080` on your variant's hostname for model selection, aliases, preload/default behavior, engine configuration, logging, download behavior, browser origins, JSON import/export, validation, and backup restore.

## Development

Build and run the CPU variant locally without IPFS:

```bash
docker compose -f docker-compose.yml -f package_variants/cpu/docker-compose.yml build
docker compose -f docker-compose.yml -f package_variants/cpu/docker-compose.yml up -d
```

Confirm that the CPU-safe service is running:

```bash
docker compose -f docker-compose.yml -f package_variants/cpu/docker-compose.yml ps
API_PORT=$(docker compose -f docker-compose.yml -f package_variants/cpu/docker-compose.yml port qvac 11434 | sed 's/.*://')
curl --fail "http://127.0.0.1:${API_PORT}/v1/models"
```

Use `package_variants/gpu/docker-compose.yml` instead to test the GPU variant on a host where `docker run --rm --gpus all ubuntu:24.04 true` succeeds. CI and the release workflow build and publish both variants with the SDK's `--all-variants` option.

Use `make dev-tar` only when a Docker image tarball is needed for a DAppNode development upload.

## Upstream

- [QVAC source](https://github.com/tetherto/qvac)
- [QVAC documentation](https://docs.qvac.tether.io/)
