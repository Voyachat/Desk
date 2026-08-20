# @voyaseek-ai/dsh-tool-modelscope

English | [中文](README.zh.md)

The read-only `modelscope_search` tool invokes the official `modelscope-hub==0.2.0` Python client through an isolated uv environment. It searches public model metadata and optionally resolves `MODELSCOPE_API_TOKEN` through the credentials service for private visibility.

The integration deliberately excludes snapshot download, upload, training, pipelines, remote servers, studios, skills, plugins, MCP installation, llamafile execution, and arbitrary model code. A selected model becomes a separate adoption decision after its own model card, license, files, size, and `trust_remote_code` requirements are reviewed.

## Model Experience

### Tool schema and result

#### What the model sees

The generated [`modelscope_search` schema](../../../docs/tool-catalog.md#voyaseek-aidsh-tool-modelscope) while the tool is visible, plus one bounded catalog result when the model calls it. The package adds no standing prompt section.

#### Token effect

Fixed schema cost while the tool is visible, plus data-dependent result text for each call.

#### KV Cache effect

The tool definition stays prefix-stable while its configuration and visibility are unchanged. Each call and result extend the active request suffix.

## Known Limitations and Deferred Work

- The deployment must provide `uv`; first use downloads the small official Hub client environment.
- Search does not prove that a model is safe, license-compatible, runnable locally, or suitable for production.
- Model download and execution stay absent until an exact model passes a separate adoption review.
