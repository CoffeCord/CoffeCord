/*
 * Vencord, a Discord client mod
 * Copyright (c) 2025 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import definePlugin, { OptionType } from "@utils/types";
import { definePluginSettings } from "@api/Settings";
import { findComponentByCodeLazy } from "@webpack";
import { React } from "@webpack/common";
import ErrorBoundary from "@components/ErrorBoundary";

const Button = findComponentByCodeLazy(".NONE,disabled:", ".PANEL_BUTTON");

let currentConnection: any = null;

const settings = definePluginSettings({
    voiceBitrate: {
        type: OptionType.SLIDER,
        description: "Voice Bitrate",
        markers: [8, 64, 128, 256, 384, 512],
        default: 256,
        stickToMarkers: false,
        componentProps: {
            onValueChange: (v: number) => {
                settings.store.voiceBitrate = Math.floor(v);
                if (currentConnection?.setVoiceBitRate) {
                    try {
                        const targetBitrate = Math.floor(v) * 1000;
                        console.log(`[StereoMic] Aplicando bitrate ${Math.floor(v)}kbps na conexão ${currentConnection.context} (streamUserId: ${currentConnection.streamUserId || 'N/A'})`);
                        currentConnection.setVoiceBitRate(targetBitrate);
                        console.log(`[StereoMic] ✅ Bitrate de MIC aplicado: ${Math.floor(v)}kbps`);
                    } catch (e) {
                        console.error("[StereoMic] Erro ao aplicar bitrate:", e);
                    }
                } else {
                    console.warn("[StereoMic] ⚠️ Conexão de VOZ não disponível! Entre numa call de voz primeiro.");
                }
            },
            onValueRender: (v: number): string => `${v.toFixed(0)}kbps`,
            onMarkerRender: (v: number): string => `${v.toFixed(0)}kbps`
        }
    },
    enableFec: {
        type: OptionType.BOOLEAN,
        description: "Enable Forward Error Correction (pode causar crackling em stereo)",
        default: false
    }
});

function StereoIcon() {
    return React.createElement("svg", {
        width: "20",
        height: "20",
        viewBox: "0 0 24 24",
        fill: "currentColor"
    },
        React.createElement("path", { d: "M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z" }),
        React.createElement("path", { d: "M14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" })
    );
}

const bitratePresets = [8, 64, 128, 256, 384, 512];

function StereoMicButton() {
    const [bitrate, setBitrate] = React.useState(settings.store.voiceBitrate);
    const [, forceUpdate] = React.useReducer((x: number) => x + 1, 0);

    React.useEffect(() => {
        const interval = setInterval(() => {
            if (settings.store.voiceBitrate !== bitrate) {
                setBitrate(settings.store.voiceBitrate);
            }
        }, 500);
        return () => clearInterval(interval);
    }, [bitrate]);

    const handleClick = () => {
        let currentIndex = 0;
        for (let i = 0; i < bitratePresets.length; i++) {
            if (bitrate <= bitratePresets[i]) {
                currentIndex = i;
                break;
            }
        }
        
        const nextIndex = (currentIndex + 1) % bitratePresets.length;
        const newBitrate = bitratePresets[nextIndex];
        
        setBitrate(newBitrate);
        settings.store.voiceBitrate = newBitrate;
        
        if (currentConnection?.setVoiceBitRate) {
            try {
                currentConnection.setVoiceBitRate(newBitrate * 1000);
                console.log(`[StereoMic] ✅ Bitrate alterado para: ${newBitrate}kbps`);
            } catch (e) {
                console.error("[StereoMic] Erro ao aplicar bitrate:", e);
            }
        }
        forceUpdate();
    };

    return React.createElement(Button, {
        onClick: handleClick,
        tooltipText: `Stereo Mic: ${bitrate}kbps\n(Click to cycle)`,
        icon: StereoIcon,
        role: "button",
        "aria-label": `Stereo Mic - ${bitrate}kbps`
    });
}

export default definePlugin({
    name: "StereoMic",
    description: "True stereo voice with optimized buffer (2880) and instant bitrate changes without reconnecting",
    authors: [{ name: "Diyagi", id: 651109069565853764n }],
    
    patches: [
        {
            find: "this.getAttenuationOptions()",
            replacement: [
                {
                    match: /freq:48e3,pacsize:960,channels:1,rate:64e3/,
                    replace: "freq:48e3,pacsize:2880,channels:2,params:{stereo:\"1\",cbr:\"1\"},rate:$self.getBitrate()"
                },
                {
                    match: /setBitRate\((\i)\)\{this\.setVoiceBitRate\(\1\)\}/,
                    replace: "setBitRate($1){$self.storeConnection(this);$self.setVoiceBitratePatch(this, $1)}"
                },
                {
                    match: /fec:!0/,
                    replace: "fec:$self.isFecEnabled()"
                }
            ]
        },
        {
            find: "#{intl::ACCOUNT_SPEAKING_WHILE_MUTED}",
            replacement: {
                match: /className:\i\.buttons,.{0,50}children:\[/,
                replace: "$&$self.StereoMicButton(),"
            }
        }
    ],

    settings,

    StereoMicButton: ErrorBoundary.wrap(StereoMicButton, { noop: true }),

    storeConnection(connection: any) {
        if (connection.context === "default" && currentConnection !== connection) {
            currentConnection = connection;
            console.log("[StereoMic] Conexão de VOZ capturada! (context: default)");
        } else if (connection.context !== "default") {
            console.log(`[StereoMic] Ignorando conexão de ${connection.context} (queremos apenas 'default')`);
        }
    },

    getBitrate() {
        return settings.store.voiceBitrate * 1000;
    },

    isFecEnabled() {
        console.log(`[StereoMic] FEC ${settings.store.enableFec ? "ENABLED" : "DISABLED"}`);
        return settings.store.enableFec;
    },

    setVoiceBitratePatch(moduleContext: any, orgBitrate: number) {
        const targetBitrate = settings.store.voiceBitrate * 1000;
        console.log(`[StereoMic] Stereo Voice Bitrate: ${orgBitrate/1000}kbps -> ${settings.store.voiceBitrate}kbps (buffer: 2880, CBR)`);
        moduleContext.setVoiceBitRate(targetBitrate);
    }
});