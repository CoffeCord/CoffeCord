/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { definePluginSettings } from "@api/Settings";
import { findByPropsLazy, findByProps } from "@webpack";
import { FluxDispatcher, Menu, Toasts } from "@webpack/common";

const MediaEngineActions = findByPropsLazy("toggleSelfMute");
const NotificationSettingsStore = findByPropsLazy("getDisableAllSounds", "getState");

const RTCConnectionStore = findByPropsLazy("getRTCConnection", "getMediaSessionId");
const RegionStore = findByPropsLazy("getRegion", "getActiveRegions");
const MediaEngineStore = findByPropsLazy("getMediaEngine");
const VoiceStateStore = findByPropsLazy("getVoiceStateForUser");

interface VoiceServerUpdate {
    endpoint: string;
    token: string;
    guild_id?: string;
    channel_id?: string;
}

interface ResolvedEndpoint {
    hostname: string;
    ip: string;
    port: string;
    timestamp: number;
}

const resolvedEndpoints = new Map<string, ResolvedEndpoint>();
let currentVoiceServer: ResolvedEndpoint | null = null;
let pendingHostname: string | null = null;
let originalFluxDispatch: any = null;

// ============================================
// REGION STORE - MÉTODO DESCOBERTO!
// U.Z.getRegion(hostname)
// ============================================

function extractRegionFromHostname(hostname: string): string | null {
    // Fallback: extrai região do hostname quando store não está disponível
    const match = hostname.match(/^c?-?([a-z]+)\d{0,5}[\.-]/i);
    if (!match) return null;
    
    const prefix = match[1].toLowerCase();
    const regions: Record<string, string> = {
        gru: "brazil",
        syd: "sydney",
        lon: "london",
        fra: "frankfurt",
        sfo: "us-west",
        atl: "atlanta",
        iad: "us-east",
        lax: "us-west",
        mia: "miami",
        ord: "chicago",
        sea: "seattle",
        sjc: "us-west",
        dfw: "dallas",
        den: "denver"
    };
    
    return regions[prefix] || prefix;
}

function tryGetRegionFromStore(hostname?: string) {
    try {
        // Verifica se RegionStore foi carregado (só carrega após primeira conexão de voz)
        if (typeof RegionStore !== "object" || !RegionStore?.getRegion) {
            console.log("[VoiceRegion] RegionStore ainda não carregado (aguarde conexão de voz)");
            // Fallback: extrai do hostname
            return hostname ? extractRegionFromHostname(hostname) : null;
        }
        
        // Tenta getRegion com hostname
        if (hostname) {
            const region = RegionStore.getRegion(hostname);
            console.log(`[VoiceRegion] RegionStore.getRegion("${hostname}"):`, region);
            if (region) return region;
        }
        
        // Tenta getActiveRegions
        const activeRegions = RegionStore.getActiveRegions?.();
        console.log("[VoiceRegion] RegionStore.getActiveRegions():", activeRegions);
        
        return activeRegions || (hostname ? extractRegionFromHostname(hostname) : null);
    } catch (e) {
        console.error("[VoiceRegion] Erro ao acessar RegionStore:", e);
        // Fallback em caso de erro
        return hostname ? extractRegionFromHostname(hostname) : null;
    }
}

function tryGetRTCInfo() {
    try {
        const info: any = {};
        
        if (typeof RTCConnectionStore === "object" && RTCConnectionStore) {
            info.mediaSessionId = RTCConnectionStore.getMediaSessionId?.();
            info.rtcConnectionId = RTCConnectionStore.getRtcConnectionId?.();
            console.log("[VoiceRegion] RTC Info:", info);
        } else {
            console.log("[VoiceRegion] RTCConnectionStore não carregado ainda");
        }
        
        return info;
    } catch (e) {
        console.error("[VoiceRegion] Erro ao acessar RTC info:", e);
        return null;
    }
}

// ============================================
// RTC CONNECTION STATE HANDLER (via Flux)
// ============================================

// Tenta pegar informações de conexão do RTCConnectionStore
async function pollRTCConnectionInfo(channelId: string, retries = 10) {
    if (retries <= 0 || !currentVoiceServer) return;
    
    setTimeout(async () => {
        try {
            // Tenta encontrar o store dinamicamente
            const RTCStore = findByProps("getRTCConnection", "getMediaSessionId");
            
            if (!RTCStore) {
                console.log("[VoiceRegion] RTCConnectionStore ainda não encontrado, tentando novamente...");
                pollRTCConnectionInfo(channelId, retries - 1);
                return;
            }
            
            console.log("[VoiceRegion] ✅ RTCConnectionStore ENCONTRADO!");
            
            // Pega hostname e porta (já temos isso!)
            const rtcConnection = RTCStore.getRTCConnection?.(channelId);
            
            if (rtcConnection && rtcConnection.hostname && rtcConnection.port) {
                let hostname = rtcConnection.hostname;
                const port = String(rtcConnection.port);
                
                // Troca .media por .gg para pegar IP correto
                if (hostname.endsWith(".discord.media")) {
                    hostname = hostname.replace(".discord.media", ".discord.gg");
                    console.log(`[VoiceRegion] 🔄 Hostname convertido para: ${hostname}`);
                }
                
                console.log(`[VoiceRegion] 🌐 Servidor: ${hostname}:${port}`);
                
                // Atualiza com hostname (já é suficiente!)
                currentVoiceServer.ip = hostname; // Hostname é mais útil que IP
                currentVoiceServer.port = port;
                
                const region = extractRegionFromHostname(hostname);
                console.log(`[VoiceRegion] ✅ Servidor COMPLETO:`, currentVoiceServer);
                
                // Mostra toast
                if (settings.store.showRegionToasts) {
                    const message = `${hostname}:${port} (${region})`;
                    Toasts.show({
                        message: `🌐 ${message}`,
                        id: "voice-region-resolver-complete",
                        type: Toasts.Type.SUCCESS,
                        options: {
                            duration: 8000,
                            position: Toasts.Position.TOP
                        }
                    });
                    console.log("[VoiceRegion] 🎉 Toast mostrado!");
                }
                
                // OPCIONAL: Tenta resolver hostname para IP (DNS lookup)
                if (settings.store.resolveHostnameToIP) {
                    console.log("[VoiceRegion] 🔍 Resolvendo hostname para IP via DNS...");
                    
                    // .media → IPv6 Cloudflare (2606:4700:7::...)
                    // .gg → IPv4 do servidor Discord real
                    const hostnameForDNS = hostname.replace(".discord.media", ".discord.gg");
                    console.log(`[VoiceRegion] Hostname ajustado: ${hostname} → ${hostnameForDNS}`);
                    
                    try {
                        // Usa API pública de DNS (Google DNS over HTTPS)
                        const dnsUrl = `https://dns.google/resolve?name=${hostnameForDNS}&type=A`;
                        console.log(`[VoiceRegion] DNS URL: ${dnsUrl}`);
                        
                        const response = await fetch(dnsUrl);
                        const data = await response.json();
                        
                        console.log("[VoiceRegion] DNS Response completa:", data);
                        
                        if (data.Answer && data.Answer.length > 0) {
                            // Mostra TODOS os IPs retornados
                            console.log("[VoiceRegion] IPs encontrados:");
                            data.Answer.forEach((answer: any, index: number) => {
                                console.log(`  ${index + 1}. ${answer.data} (TTL: ${answer.TTL})`);
                            });
                            
                            // Usa o PRIMEIRO IP
                            const resolvedIP = data.Answer[0].data;
                            console.log(`[VoiceRegion] ✅ Usando IP: ${resolvedIP}`);
                            
                            // Atualiza com IP resolvido
                            currentVoiceServer.ip = resolvedIP;
                            
                            // Toast atualizado com IP
                            Toasts.show({
                                message: `🌐 ${hostname} → ${resolvedIP}:${port} (${region})`,
                                id: "voice-region-resolver-ip",
                                type: Toasts.Type.SUCCESS,
                                options: {
                                    duration: 8000,
                                    position: Toasts.Position.TOP
                                }
                            });
                        } else {
                            console.log("[VoiceRegion] ⚠️ Nenhum IP encontrado na resposta DNS");
                        }
                    } catch (e) {
                        console.error("[VoiceRegion] ❌ Erro no DNS lookup:", e);
                    }
                }
            } else {
                console.log("[VoiceRegion] Hostname ainda não disponível, tentando novamente...");
                pollRTCConnectionInfo(channelId, retries - 1);
            }
        } catch (e) {
            console.error("[VoiceRegion] Erro ao polling RTC info:", e);
            pollRTCConnectionInfo(channelId, retries - 1);
        }
    }, 500);
}

// Handler que captura TODOS os eventos RTC_* para debug e encontrar IP:porta
function handleAllRTCEvents(data: any) {
    if (!settings.store.enableRegionResolver) return;
    
    // Debug: captura TODOS os eventos RTC_* para achar IP:porta
    if (data.type?.startsWith("RTC_")) {
        console.log(`[VoiceRegion] 📡 ${data.type}:`, data);
        
        // Procura por campos que podem conter IP
        if (data.address || data.ip || data.endpoint) {
            console.log("[VoiceRegion] 🎯 ENCONTROU IP NO EVENTO!", {
                address: data.address,
                ip: data.ip,
                endpoint: data.endpoint,
                port: data.port
            });
            
            const ip = data.address || data.ip || data.endpoint;
            const port = data.port || "?";
            
            if (currentVoiceServer) {
                currentVoiceServer.ip = ip;
                currentVoiceServer.port = String(port);
                console.log("[VoiceRegion] ✅ Servidor atualizado com IP:", currentVoiceServer);
            }
        }
    }
}

function handleRTCConnectionState(data: any) {
    if (!settings.store.enableRegionResolver) return;
    
    console.log("[VoiceRegion] RTC_CONNECTION_STATE event:", data);
    
    // Quando conecta ao servidor RTC
    if (data.state === "RTC_CONNECTED") {
        // Pega hostname do evento (melhor que pendingHostname!)
        const hostname = data.hostname || pendingHostname || "unknown";
        const channelId = data.channelId;
        
        console.log("[VoiceRegion] RTC_CONNECTED! Data:", JSON.stringify(data, null, 2));
        
        // Pega região (via store ou fallback)
        const region = tryGetRegionFromStore(hostname);
        console.log(`[VoiceRegion] Região detectada: ${region || 'desconhecida'}`);
        
        // Atualiza servidor atual
        if (hostname !== "unknown") {
            currentVoiceServer = {
                hostname,
                ip: "connecting...", // Será atualizado pelo polling
                port: "?",
                timestamp: Date.now()
            };
        }
        
        if (region) {
            const message = `${hostname} (${region})`;
            console.log(`[VoiceRegion] 🌐 ${message}`);
            
            console.log(`[VoiceRegion] showRegionToasts setting:`, settings.store.showRegionToasts);
            console.log(`[VoiceRegion] Toasts object:`, Toasts);
            
            if (settings.store.showRegionToasts) {
                console.log("[VoiceRegion] 🎯 TENTANDO MOSTRAR TOAST...");
                
                try {
                    // Toast inicial (só hostname + região)
                    Toasts.show({
                        message: `🌐 Conectado: ${hostname} (${region})`,
                        id: "voice-region-resolver",
                        type: Toasts.Type.SUCCESS,
                        options: {
                            duration: 5000, // 5 segundos - será substituído pelo toast com IP
                            position: Toasts.Position.TOP
                        }
                    });
                    console.log("[VoiceRegion] ✅ Toast inicial mostrado! (iniciando polling do store...)");
                    
                    // Inicia polling para pegar IP do store
                    if (channelId) {
                        pollRTCConnectionInfo(channelId);
                    }
                } catch (e) {
                    console.error("[VoiceRegion] ❌ ERRO ao mostrar toast:", e);
                }
            } else {
                console.log("[VoiceRegion] ⚠️ Toast desabilitado nas configurações!");
            }
        } else {
            console.log("[VoiceRegion] ⚠️ Região não detectada, toast não será mostrado");
        }
        
        // Limpa hostname pendente
        pendingHostname = null;
    }
}

function handleRTCConnected(ip: string, port: number) {
    if (!settings.store.enableRegionResolver) return;
    
    const hostname = pendingHostname || ip;
    
    // Tenta pegar região do RegionStore usando hostname!
    const region = tryGetRegionFromStore(hostname);
    const rtcInfo = tryGetRTCInfo();
    
    console.log(`[VoiceRegion] Região detectada: ${region || 'desconhecida'}`);
    console.log(`[VoiceRegion] RTC Info:`, rtcInfo);
    
    const resolved: ResolvedEndpoint = {
        hostname,
        ip,
        port: String(port),
        timestamp: Date.now()
    };
    
    pendingHostname = null;
    currentVoiceServer = resolved;
    
    const cacheKey = `${hostname}:${port}`;
    resolvedEndpoints.set(cacheKey, resolved);
    
    // Mensagem com região se disponível
    const regionText = region ? ` (${region})` : '';
    const message = hostname === ip 
        ? `${ip}:${port}${regionText}`
        : `${hostname} → ${ip}:${port}${regionText}`;
    
    console.log(`[VoiceRegion] 🌐 ${message}`);
    
    if (settings.store.showRegionToasts) {
        Toasts.show({
            message: `🌐 Voice Server: ${message}`,
            id: "voice-region-resolver",
            type: Toasts.Type.INFO,
            options: {
                duration: 5000,
                position: Toasts.Position.BOTTOM
            }
        });
    }
}

// ============================================
// VOICE SERVER UPDATE HANDLER
// ============================================

function handleVoiceServerUpdate(data: VoiceServerUpdate) {
    console.log("[VoiceRegion] VOICE_SERVER_UPDATE:", data.endpoint);
    
    if (data.endpoint) {
        // Extrai hostname sem porta
        const match = data.endpoint.match(/^([^:]+)/);
        if (match) {
            pendingHostname = match[1];
            console.log("[VoiceRegion] Hostname guardado:", pendingHostname);
        }
    }
}

// ============================================
// FAKE MUTE/DEAFEN
// ============================================

let updating = false;
async function update() {
    if (updating) return setTimeout(update, 125);
    updating = true;
    const state = NotificationSettingsStore.getState();
    const toDisable: string[] = [];
    if (!state.disabledSounds.includes("mute")) toDisable.push("mute");
    if (!state.disabledSounds.includes("unmute")) toDisable.push("unmute");

    state.disabledSounds.push(...toDisable);
    await new Promise(r => setTimeout(r, 50));
    await MediaEngineActions.toggleSelfMute();
    await new Promise(r => setTimeout(r, 100));
    await MediaEngineActions.toggleSelfMute();
    state.disabledSounds = state.disabledSounds.filter((i: string) => !toDisable.includes(i));
    updating = false;
}

export const settings = definePluginSettings({
    autoMute: {
        type: OptionType.BOOLEAN,
        description: "Silenciar automaticamente ao se ensurdecer.",
        default: true
    },
    showRegionToasts: {
        type: OptionType.BOOLEAN,
        description: "Mostrar notificações quando conectar a um servidor de voz",
        default: true
    },
    resolveHostnameToIP: {
        type: OptionType.BOOLEAN,
        description: "Resolver hostname para IP numérico via DNS (opcional)",
        default: false
    },
    enableRegionResolver: {
        type: OptionType.BOOLEAN,
        description: "Ativar detecção e resolução de região dos servidores de voz",
        default: true
    }
});

const fakeVoiceState = {
    _selfMute: false,
    get selfMute() {
        try {
            if (!settings.store.autoMute) return this._selfMute;
            return this.selfDeaf || this._selfMute;
        } catch (e) {
            return this._selfMute;
        }
    },
    set selfMute(value) {
        this._selfMute = value;
    },
    selfDeaf: false,
    selfVideo: false
};

const StateKeys = ["selfDeaf", "selfMute", "selfVideo"];

function modifyVoiceState(e: any) {
    for (let i = 0; i < StateKeys.length; i++) {
        const stateKey = StateKeys[i];
        e[stateKey] = fakeVoiceState[stateKey] || e[stateKey];
    }
    return e;
}

function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(() => {
        Toasts.show({
            message: "✅ Copiado para área de transferência!",
            id: "voice-region-copied",
            type: Toasts.Type.SUCCESS,
            options: {
                duration: 2000,
                position: Toasts.Position.BOTTOM
            }
        });
    }).catch(() => {
        Toasts.show({
            message: "❌ Erro ao copiar",
            id: "voice-region-copy-error",
            type: Toasts.Type.FAILURE,
            options: {
                duration: 2000,
                position: Toasts.Position.BOTTOM
            }
        });
    });
}

export default definePlugin({
    name: "FakeMuteAndDeafen",
    description: "Você pode se silenciar e se ensurdecer falsamente. Durante esse tempo, pode continuar falando e ainda será ouvido. VoIP resolver incluso.",
    authors: [{ id: 549916363158716421n, name: "YOSHI" }],
    settings,

    start() {
        if (settings.store.enableRegionResolver) {
            // Subscribe eventos Flux
            FluxDispatcher.subscribe("VOICE_SERVER_UPDATE", handleVoiceServerUpdate);
            FluxDispatcher.subscribe("RTC_CONNECTION_STATE", handleRTCConnectionState);
            
            // Listener genérico para capturar TODOS os eventos (debug)
            originalFluxDispatch = FluxDispatcher.dispatch;
            FluxDispatcher.dispatch = function(payload: any) {
                handleAllRTCEvents(payload);
                return originalFluxDispatch.call(this, payload);
            };
            
            console.log("[FakeMuteAndDeafen] Voice Region Resolver ativado");
        }
    },

    stop() {
        if (settings.store.enableRegionResolver) {
            FluxDispatcher.unsubscribe("VOICE_SERVER_UPDATE", handleVoiceServerUpdate);
            FluxDispatcher.unsubscribe("RTC_CONNECTION_STATE", handleRTCConnectionState);
            
            // Restaura dispatch original
            if (originalFluxDispatch) {
                FluxDispatcher.dispatch = originalFluxDispatch;
                originalFluxDispatch = null;
            }
            
            resolvedEndpoints.clear();
            currentVoiceServer = null;
            pendingHostname = null;
        }
    },

    modifyVoiceState(e: any) {
        return modifyVoiceState(e);
    },

    contextMenus: {
        "audio-device-context"(children: any[], d: any) {
            if (d.renderInputDevices) {
                children.push(
                    <Menu.MenuSeparator />,
                    <Menu.MenuCheckboxItem
                        id="fake-mute"
                        label="Silenciamento Falso"
                        checked={fakeVoiceState.selfMute}
                        action={() => {
                            fakeVoiceState.selfMute = !fakeVoiceState.selfMute;
                            update();
                        }}
                    />
                );
            }

            if (d.renderOutputDevices) {
                children.push(
                    <Menu.MenuSeparator />,
                    <Menu.MenuCheckboxItem
                        id="fake-deafen"
                        label="Ensurdecimento Falso"
                        checked={fakeVoiceState.selfDeaf}
                        action={() => {
                            fakeVoiceState.selfDeaf = !fakeVoiceState.selfDeaf;
                            update();
                        }}
                    />
                );

                // Adiciona opções de região se disponível
                if (settings.store.enableRegionResolver && currentVoiceServer) {
                    const fullEndpoint = `${currentVoiceServer.hostname}:${currentVoiceServer.port}`;
                    const fullIP = `${currentVoiceServer.ip}:${currentVoiceServer.port}`;
                    
                    children.push(
                        <Menu.MenuSeparator />,
                        <Menu.MenuControlItem
                            id="voice-region-info"
                            label="🌐 Região do Servidor"
                        >
                            <div style={{ 
                                padding: "8px", 
                                fontSize: "12px",
                                display: "flex",
                                flexDirection: "column",
                                gap: "4px"
                            }}>
                                <div style={{ opacity: 0.7 }}>
                                    {currentVoiceServer.hostname}
                                </div>
                                <div style={{ 
                                    fontFamily: "monospace",
                                    fontSize: "11px",
                                    opacity: 0.9
                                }}>
                                    {currentVoiceServer.ip}:{currentVoiceServer.port}
                                </div>
                            </div>
                        </Menu.MenuControlItem>,
                        <Menu.MenuItem
                            id="copy-hostname"
                            label="Copiar hostname"
                            action={() => copyToClipboard(fullEndpoint)}
                        />,
                        <Menu.MenuItem
                            id="copy-ip"
                            label="Copiar IP"
                            action={() => copyToClipboard(fullIP)}
                        />
                    );
                }
            }
        },
        "video-device-context"(children: any[]) {
            children.push(
                <Menu.MenuSeparator />,
                <Menu.MenuCheckboxItem
                    id="fake-video"
                    label="Câmera Falsa"
                    checked={fakeVoiceState.selfVideo}
                    action={() => {
                        fakeVoiceState.selfVideo = !fakeVoiceState.selfVideo;
                        update();
                    }}
                />
            );
        }
    },

    patches: [
        {
            find: "voiceServerPing(){",
            replacement: [
                {
                    match: /voiceStateUpdate\((\w+)\){(.{0,10})guildId:/,
                    replace: "voiceStateUpdate($1){$1=$self.modifyVoiceState($1);$2guildId:"
                }
            ]
        }
    ],

    // Debug: mostra informações atuais
    debugInfo() {
        console.log("=== Voice Region Debug ===");
        console.log("Current server:", currentVoiceServer ?? "Nenhum");
        console.log("Pending hostname:", pendingHostname ?? "—");
        console.log("Resolved endpoints:", Array.from(resolvedEndpoints.keys()));
        
        console.log("\n--- RegionStore (U.Z) ---");
        if (typeof RegionStore === "object" && RegionStore) {
            try {
                const methods = Object.keys(RegionStore).filter(k => typeof RegionStore[k] === "function");
                console.log("Métodos disponíveis:", methods);
                console.log("getActiveRegions():", RegionStore.getActiveRegions?.());
                if (pendingHostname) {
                    console.log(`getRegion("${pendingHostname}"):`, RegionStore.getRegion?.(pendingHostname));
                }
            } catch (e) {
                console.log("Erro ao acessar métodos:", e);
            }
        } else {
            console.log("❌ RegionStore ainda não carregado (entre em uma call primeiro)");
        }
        
        console.log("\n--- RTCConnectionStore ---");
        if (typeof RTCConnectionStore === "object" && RTCConnectionStore) {
            try {
                const methods = Object.keys(RTCConnectionStore).filter(k => typeof RTCConnectionStore[k] === "function");
                console.log("Métodos disponíveis:", methods);
                console.log("getMediaSessionId():", RTCConnectionStore.getMediaSessionId?.());
                console.log("getRtcConnectionId():", RTCConnectionStore.getRtcConnectionId?.());
            } catch (e) {
                console.log("Erro ao acessar métodos:", e);
            }
        } else {
            console.log("❌ RTCConnectionStore ainda não carregado");
        }
        
        console.log("\n--- VoiceStateStore ---");
        if (typeof VoiceStateStore === "object" && VoiceStateStore) {
            console.log("✅ VoiceStateStore disponível");
        } else {
            console.log("❌ VoiceStateStore não encontrado!");
        }
        
        console.log("\n💡 Dica: Entre em uma call para carregar todos os stores!");
        console.log("💡 Eventos monitorados: VOICE_SERVER_UPDATE, RTC_CONNECTION_STATE");
    }
});