#!/usr/bin/env node

import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const WIRE_VERSION = 'aistaff.desktop-supervisor.v1'
const CONTROL_VERSION = 'aidesktop.supervisor-control.v1'
if (process.env.AISTAFF_SUPERVISOR_TOKEN !== undefined) process.exit(78)
let token
const mode = readFileSync('mode', 'utf8').trim()

function send(requestId, result) {
  process.stdout.write(`${JSON.stringify({
    protocol_version: WIRE_VERSION,
    request_id: requestId,
    ok: true,
    result,
  })}\n`)
}

function reject(requestId, code) {
  process.stdout.write(`${JSON.stringify({
    protocol_version: WIRE_VERSION,
    request_id: requestId,
    ok: false,
    error: { code },
  })}\n`)
}

function receipt(operationId, effectState = 'none') {
  return {
    receipt_ref: `receipt-${operationId}`,
    operation_id: operationId,
    status: 'succeeded',
    effect_state: effectState,
    evidence_refs: [`evidence-${operationId}`],
    receipt_hash: `hash-${operationId}`,
    recorded_at: '2026-08-15T00:00:00.000Z',
  }
}

function controlHello() {
  if (mode === 'bad-version') {
    return {
      control_version: 'aidesktop.supervisor-control.v2',
      supervisor_version: '0.1.0-test',
      supported_control_versions: ['aidesktop.supervisor-control.v2'],
      platform: 'test',
      architecture: 'test',
      capabilities: ['file/read_text', 'directory/list'],
      max_request_bytes: 65536,
      max_result_bytes: 24576,
      capability_context_handle: 'context-1',
    }
  }
  if (mode === 'bad-capabilities') {
    return {
      control_version: CONTROL_VERSION,
      supervisor_version: '0.1.0-test',
      supported_control_versions: [CONTROL_VERSION],
      platform: 'test',
      architecture: 'test',
      capabilities: ['read_file', 'list_directory'],
      max_request_bytes: 65536,
      max_result_bytes: 24576,
      capability_context_handle: 'context-1',
    }
  }
  if (mode === 'bad-capability-order') {
    return {
      control_version: CONTROL_VERSION,
      supervisor_version: '0.1.0-test',
      supported_control_versions: [CONTROL_VERSION],
      platform: 'test',
      architecture: 'test',
      capabilities: ['directory/list', 'file/read_text'],
      max_request_bytes: 65536,
      max_result_bytes: 24576,
      capability_context_handle: 'context-1',
    }
  }
  if (mode === 'bad-limits') {
    return {
      control_version: CONTROL_VERSION,
      supervisor_version: '0.1.0-test',
      supported_control_versions: [CONTROL_VERSION],
      platform: 'test',
      architecture: 'test',
      capabilities: ['file/read_text', 'directory/list'],
      max_request_bytes: 1024,
      max_result_bytes: 2048,
      capability_context_handle: 'context-1',
    }
  }
  return {
    control_version: CONTROL_VERSION,
    supervisor_version: '0.1.0-test',
    supported_control_versions: [CONTROL_VERSION],
    platform: 'test',
    architecture: 'test',
    capabilities: ['file/read_text', 'directory/list'],
    max_request_bytes: 65536,
    max_result_bytes: 24576,
    capability_context_handle: 'context-1',
  }
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
for await (const line of lines) {
  if (token === undefined) {
    if (!/^[A-Za-z0-9_-]{32,128}$/.test(line)) process.exit(78)
    token = line
    continue
  }
  const frame = JSON.parse(line)
  if (frame.auth_token !== token || frame.protocol_version !== WIRE_VERSION) {
    reject(frame.request_id, 'SUPERVISOR_UNAVAILABLE')
    continue
  }
  if (frame.command === 'hello') {
    send(frame.request_id, {
      protocol_version: WIRE_VERSION,
      version: 'test',
      platform: 'test',
      arch: 'test',
      pid: process.pid,
      capabilities: ['supervisor-control.v1'],
      authentication: 'per_launch_token',
    })
    continue
  }
  if (frame.command === 'control.hello') {
    send(frame.request_id, controlHello())
    continue
  }
  if (frame.command === 'health') {
    send(frame.request_id, { status: 'ok', uptime_ms: 1 })
    continue
  }
  if (frame.command === 'shutdown') {
    send(frame.request_id, {})
    setImmediate(() => process.exit(0))
    continue
  }
  const payload = frame.payload
  if (frame.command === 'control.grant.register') {
    send(frame.request_id, {
      grant: {
        grant_handle: payload.operation_id === 'bad-response-path' ? '/private/customer' : 'grant-1',
        grant_revision: 'revision-1',
        display_name: payload.display_name,
        access: 'read_only',
        allowed_intents: payload.allowed_intents,
        expires_at: payload.expires_at,
        root_fingerprint: 'root-fingerprint-1',
      },
      receipt: receipt(payload.operation_id),
    })
    continue
  }
  if (frame.command === 'control.grant.revoke') {
    send(frame.request_id, receipt(payload.operation_id, 'not_applied'))
    continue
  }
  if (frame.command === 'control.capability.read') {
    if (payload.operation_id === 'timeout-read') continue
    if (payload.operation_id === 'remote-unknown') {
      reject(frame.request_id, 'OUTCOME_UNKNOWN')
      continue
    }
    if (payload.operation_id === 'remote-conflict') {
      reject(frame.request_id, 'OPERATION_CONFLICT')
      continue
    }
    if (payload.operation_id === 'unknown-remote-code') {
      reject(frame.request_id, 'PRIVATE_LOCAL_PATH_FAILURE')
      continue
    }
    let capabilityPayload
    if (payload.operation_id === 'bad-base64') {
      capabilityPayload = {
        kind: 'file',
        bytes_base64: 'not base64',
        media_type: 'text/plain; charset=utf-8',
      }
    } else if (payload.operation_id === 'oversized-file') {
      capabilityPayload = {
        kind: 'file',
        bytes_base64: Buffer.alloc(payload.max_bytes + 1).toString('base64'),
        media_type: 'text/plain; charset=utf-8',
      }
    } else if (payload.operation_id === 'bad-metadata') {
      capabilityPayload = {
        kind: 'metadata',
        target_kind: 'file',
        size_bytes: 5,
        root_path: '/private/customer',
      }
    } else if (payload.operation_id === 'bad-directory') {
      capabilityPayload = {
        kind: 'directory',
        entries: [{ name: '../private', kind: 'file', size_bytes: 1 }],
      }
    } else if (payload.intent === 'directory/list') {
      capabilityPayload = {
        kind: 'directory',
        entries: [
          { name: 'notes.txt', kind: 'file', size_bytes: 15 },
          { name: 'archive', kind: 'directory' },
        ],
      }
    } else {
      capabilityPayload = {
        kind: 'file',
        bytes_base64: Buffer.from('hello from rust', 'utf8').toString('base64'),
        media_type: 'text/plain; charset=utf-8',
      }
    }
    send(frame.request_id, {
      payload: capabilityPayload,
      receipt: receipt(payload.operation_id),
    })
    continue
  }
  if (frame.command === 'control.receipt.get') {
    send(frame.request_id, receipt('read-file'))
    continue
  }
  if (frame.command === 'control.operation.read') {
    send(frame.request_id, {
      operation_id: payload.operation_id,
      state: 'succeeded',
      receipt_ref: `receipt-${payload.operation_id}`,
      updated_at: '2026-08-15T00:00:00.000Z',
    })
    continue
  }
  reject(frame.request_id, 'CAPABILITY_DENIED')
}
