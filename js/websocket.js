/**
 * BrainWebSocket - Manages WebSocket connection to the Leon brain server.
 */
export class BrainWebSocket {
    constructor(url) {
        this.url = url;
        this.ws = null;
        this.reconnectDelay = 1000;
        this.maxReconnectDelay = 10000;
        this.onInit = null;    // callback(positions)
        this.onState = null;   // callback(state)
        this.onDisconnect = null;
        // Two-message binary init: server sends init_meta JSON first,
        // then a single ArrayBuffer with packed Float32 LE positions.
        this._pendingInitMeta = null;
    }

    connect() {
        try {
            this.ws = new WebSocket(this.url);
            // Binary init payload (neuron positions) arrives as a Float32
            // blob — request raw ArrayBuffer so we can build a typed
            // array view with zero copies.
            this.ws.binaryType = 'arraybuffer';
        } catch (e) {
            console.error('[WS] Failed to create WebSocket:', e);
            this._scheduleReconnect();
            return;
        }

        this.ws.onopen = () => {
            console.log('[WS] Connected');
            this.reconnectDelay = 1000;
            this._pendingInitMeta = null;  // fresh handshake each connect
            // Anything that needs to re-announce client state on
            // (re)connect can hook in here. Critical for the webcam:
            // each new WS connection has its own id() server-side, so
            // the dashboard MUST re-tell it whether the cam is ready.
            if (this.onConnected) {
                try { this.onConnected(); } catch (e) { console.error('[WS] onConnected hook error:', e); }
            }
        };

        this.ws.onmessage = (event) => {
            // Binary frame → either the init positions blob (if meta
            // already arrived) or unexpected — warn and ignore.
            if (event.data instanceof ArrayBuffer) {
                this._handleBinaryFrame(event.data);
                return;
            }
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'init_meta') {
                    // Two-message binary init: stash meta, wait for blob.
                    this._pendingInitMeta = msg;
                } else if (msg.type === 'init' && this.onInit) {
                    // Legacy JSON init (fallback path / older servers).
                    this.onInit(msg.positions);
                } else if (msg.type === 'state' && this.onState) {
                    this.onState(msg.data);
                } else if (msg.type === 'brain_response' && this.onResponse) {
                    // Legacy non-streaming path
                    this.onResponse(msg.user, msg.response, msg);
                } else if (msg.type === 'brain_response_start' && this.onResponseStart) {
                    this.onResponseStart(msg.user, msg.response_id, msg);
                    // Phase 6 — fire a custom event when this is a spontaneous
                    // thought so the Cognition Monitor can flash its indicator.
                    if (msg.from_spontaneous) {
                        window.dispatchEvent(new CustomEvent('leon-spontaneous-thought', {
                            detail: { response_id: msg.response_id, memory_id: msg.memory_id },
                        }));
                    }
                } else if (msg.type === 'brain_response_model' && this.onResponseModel) {
                    this.onResponseModel(msg.response_id, msg.model, msg.tier);
                } else if (msg.type === 'brain_response_delta' && this.onResponseDelta) {
                    this.onResponseDelta(msg.response_id, msg.text);
                } else if (msg.type === 'brain_response_end' && this.onResponseEnd) {
                    this.onResponseEnd(msg.response_id, msg.response);
                } else if (msg.type === 'brain_tool_use' && this.onToolUse) {
                    this.onToolUse(msg.response_id, msg.tool, msg.input, msg.tool_id, msg.risk);
                } else if (msg.type === 'brain_tool_result' && this.onToolResult) {
                    this.onToolResult(msg.response_id, msg.tool, msg.summary, msg.tool_id);
                } else if (msg.type === 'brain_tool_confirm_request' && this.onToolConfirmRequest) {
                    this.onToolConfirmRequest(msg.confirm_id, msg.tool, msg.input, msg.risk);
                } else if (msg.type === 'brain_response_text' && this.onProactiveText) {
                    this.onProactiveText(msg.text, msg.source);
                } else if (msg.type === 'brain_audio' && this.onAudio) {
                    this.onAudio(msg);
                } else if (msg.type === 'wake_listening' && this.onWakeListening) {
                    this.onWakeListening(!!msg.listening);
                } else if (msg.type === 'wake_triggered' && this.onWakeTriggered) {
                    this.onWakeTriggered(msg.wake_word, msg.score);
                } else if (msg.type === 'wake_transcribed' && this.onWakeTranscribed) {
                    this.onWakeTranscribed(msg.transcript || '', !!msg.rejected);
                } else if (msg.type === 'webcam_capture_request' && this.onWebcamCaptureRequest) {
                    this.onWebcamCaptureRequest(msg.request_id);
                } else if (msg.type === 'presence_event' && this.onPresenceEvent) {
                    this.onPresenceEvent(msg.event);
                } else if (msg.type === 'presence_status' && this.onPresenceStatus) {
                    this.onPresenceStatus(msg.status);
                } else if (msg.type === 'activity_status' && this.onActivityStatus) {
                    this.onActivityStatus(msg.activity);
                }
            } catch (e) {
                console.error('[WS] Parse error:', e);
            }
        };

        this.ws.onclose = () => {
            console.log('[WS] Disconnected');
            if (this.onDisconnect) this.onDisconnect();
            this._scheduleReconnect();
        };

        this.ws.onerror = (e) => {
            console.error('[WS] Error:', e);
        };
    }

    _scheduleReconnect() {
        setTimeout(() => {
            console.log('[WS] Reconnecting...');
            this.connect();
        }, this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxReconnectDelay);
    }

    sendTextInput(text) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'text_input', text }));
        }
    }

    sendCommand(cmd) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ type: 'command', cmd }));
        }
    }

    sendToolConfirm(confirmId, approved) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({
                type: 'tool_confirm',
                confirm_id: confirmId,
                approved: !!approved,
            }));
        }
    }

    // ---------- Binary init handler ----------
    _handleBinaryFrame(buf) {
        const meta = this._pendingInitMeta;
        if (!meta) {
            console.warn('[WS] Unexpected binary frame (no pending init_meta)', buf.byteLength);
            return;
        }
        this._pendingInitMeta = null;

        if (meta.magic !== 'NPOS') {
            console.warn('[WS] init_meta magic mismatch:', meta.magic);
            return;
        }
        if (buf.byteLength !== meta.byte_size) {
            console.warn(
                '[WS] init blob size mismatch:',
                'expected', meta.byte_size, 'got', buf.byteLength
            );
            // Fall through anyway — slice what we can.
        }

        // Build positions dict in the same shape brain3d.initNeurons
        // already understands (region name → {center, count, positions, spread}),
        // but with `positions` as a Float32Array(n*3) instead of an array of
        // [x,y,z] triplets. brain3d's updated initNeurons accepts both.
        const positions = {};
        for (const [name, r] of Object.entries(meta.regions)) {
            const n = r.n_points;
            const view = new Float32Array(buf, r.byte_offset, n * 3);
            // Copy the slice so it owns its memory (the underlying buf
            // can be GC'd; we hand the copy to THREE which keeps it).
            const owned = new Float32Array(view);
            positions[name] = {
                center: r.center,
                count: r.count,
                spread: r.spread,
                positions: owned,         // Float32Array — fast path
            };
        }

        if (this.onInit) {
            try { this.onInit(positions); }
            catch (e) { console.error('[WS] onInit error:', e); }
        }
    }
}
