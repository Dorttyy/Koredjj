import { Ionicons } from "@/src/ui/icons";
import { LinearGradient } from "expo-linear-gradient";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Alert,
  AppState,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { Avatar } from "@/src/components/Avatar";
import { IncomingCallPopup } from "@/src/components/call/IncomingCallPopup";
import { stopVoicePlayback } from "@/src/utils/voice-playback";
import { useCallTones } from "@/src/hooks/use-call-tones";
import { VipBadge } from "@/src/components/Badges";
import { useAuth } from "@/src/context/AuthContext";
import { useNetwork } from "@/src/context/NetworkContext";
import { useTheme } from "@/src/context/ThemeContext";
import { fonts, radius, spacing, ThemeColors } from "@/src/theme";
import { api, User, wsUrl } from "@/src/utils/api";
import {
  LevelMeter,
  SPEAKING_HOLD_MS,
  SPEAKING_THRESHOLD_STATS,
  SPEAKING_THRESHOLD_WEB,
  createLevelMeter,
} from "@/src/utils/audio-level";
import { audioSession } from "@/src/utils/incall";
import { alertMicError } from "@/src/utils/mic-error";
import {
  getIceConfig,
  getMicStream,
  getRTC,
  preferOpus,
  readStats,
  webrtcAvailable,
} from "@/src/utils/webrtc";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Expanding ripple ring behind the avatar while ringing. */
const PulseRing: React.FC<{ size: number; delay: number }> = ({
  size,
  delay,
}) => {
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withDelay(
      delay,
      withRepeat(
        withTiming(1, { duration: 2000, easing: Easing.out(Easing.ease) }),
        -1,
        false,
      ),
    );
  }, [t, delay]);

  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + t.value * 0.6 }],
    opacity: 0.55 * (1 - t.value),
  }));

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 2,
          borderColor: "#7DD3FC",
          pointerEvents: "none",
        },
        style,
      ]}
    />
  );
};

type SignalHandler = (event: any) => void;

/**
 * Call lifecycle. `status` drives which controls the (unchanged) UI shows;
 * `phase` is the fine-grained state machine used internally and for the
 * status line: OUTGOING → RINGING → CONNECTING → CONNECTED → RECONNECTING.
 */
type CallPhase =
  | "outgoing"
  | "ringing"
  | "incoming"
  | "connecting"
  | "connected"
  | "reconnecting";

interface CallState {
  status: "outgoing" | "incoming" | "active";
  phase: CallPhase;
  peer: User;
  callId: string;
  offerSdp?: any;
  expiresAt?: number;
  practice?: boolean;
  endsAt?: number;
}

interface CallContextValue {
  startCall: (peer: User, reservedCallId?: string, expiresAt?: number) => Promise<void>;
  busy: boolean;
  recoverIncoming: (callId?: string) => Promise<boolean>;
  sendSignal: (data: Record<string, unknown>) => void;
  subscribe: (fn: SignalHandler) => () => void;
}

const CallContext = createContext<CallContextValue | undefined>(undefined);

const RING_TIMEOUT_MS = 45000;
const ICE_RESTART_DELAY_MS = 2000;
const RECONNECT_GIVEUP_MS = 25000;
const LEVEL_POLL_MS = 300;
const KEEPALIVE_MS = 25000;

/** RN-web's Alert.alert is a no-op — use window.alert on web so users always see feedback. */
const notify = (title: string, message: string) => {
  if (Platform.OS === "web") {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
};

export const CallProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user } = useAuth();
  // `ready` flips true only after the backend has answered at least once.
  const { ready: serverReady } = useNetwork();
  const { colors } = useTheme();
  const wsRef = useRef<WebSocket | null>(null);
  const subscribersRef = useRef<Set<SignalHandler>>(new Set());
  const pcRef = useRef<any>(null);
  const localStreamRef = useRef<any>(null);
  const remoteAudioRef = useRef<any>(null);
  const remoteMeterRef = useRef<LevelMeter | null>(null);
  const callRef = useRef<CallState | null>(null);
  const pendingIceRef = useRef<any[]>([]);
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const giveUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards against double-tapping the call button (duplicate sessions/PCs).
  const startingRef = useRef(false);
  // Tracks when the active call started, so we can log its duration into the
  // chat as a call-event bubble when it ends.
  const callActiveSinceRef = useRef<number | null>(null);
  const isCallerRef = useRef<boolean>(false);
  const isCurrentCall = (callId: string) => callRef.current?.callId === callId;

  // Records the call outcome as a message in the chat with the peer. Only the
  // caller logs (avoids duplicate bubbles); the message syncs to both sides.
  const logCallEvent = useCallback(
    async (peerId: string, callStatus: string, durationMs?: number | null) => {
      try {
        const conv = await api.post<{ id: string }>("/chats", {
          partner_id: peerId,
        });
        await api.post(`/chats/${conv.id}/call`, {
          status: callStatus,
          duration_ms: durationMs ?? null,
          kind: "voice",
        });
      } catch {
        /* best-effort logging */
      }
    },
    [],
  );

  /** Persist the session outcome (COMPLETED / MISSED / REJECTED / …). */
  const finalizeSession = useCallback(
    async (callId: string | undefined, status: string) => {
      if (!callId) return;
      try {
        await api.post(`/rtc/calls/${callId}/status`, { status });
      } catch {
        /* server also finalizes via signaling; best-effort */
      }
    },
    [],
  );

  const [call, setCallState] = useState<CallState | null>(null);
  const [muted, setMuted] = useState(false);
  const [speakerOn, setSpeakerOn] = useState(false);
  const [audioRouteError, setAudioRouteError] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [peerSpeaking, setPeerSpeaking] = useState(false);
  const stopCallTones = useCallTones(user ? call : null);

  const setCall = (c: CallState | null) => {
    // Stop synchronously before accepting/enabling the mic or clearing a call,
    // rather than letting a pending async playback start after the transition.
    const previous = callRef.current;
    if (!c || c.status !== previous?.status || c.callId !== previous?.callId || c.practice !== previous?.practice) {
      stopCallTones();
    }
    if (c && !callRef.current) stopVoicePlayback();
    callRef.current = c;
    setCallState(c);
  };

  const setPhase = (phase: CallPhase) => {
    const current = callRef.current;
    if (!current || current.phase === phase) return;
    setCall({ ...current, phase });
  };

  const sendSignal = useCallback((data: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }, []);

  const subscribe = useCallback((fn: SignalHandler) => {
    subscribersRef.current.add(fn);
    return () => {
      subscribersRef.current.delete(fn);
    };
  }, []);

  const clearTimers = () => {
    for (const ref of [ringTimeoutRef, reconnectTimerRef, giveUpTimerRef]) {
      if (ref.current) {
        clearTimeout(ref.current);
        ref.current = null;
      }
    }
  };

  const cleanupMedia = () => {
    clearTimers();
    pendingIceRef.current = [];
    const pc = pcRef.current;
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.oniceconnectionstatechange = null;
      pc.close?.();
    }
    pcRef.current = null;
    localStreamRef.current?.getTracks?.().forEach((t: any) => t.stop());
    localStreamRef.current = null;
    remoteMeterRef.current?.stop();
    remoteMeterRef.current = null;
    if (remoteAudioRef.current && "srcObject" in remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    remoteAudioRef.current = null;
    startingRef.current = false;
    setMuted(false);
    setSeconds(0);
    setPeerSpeaking(false);
    audioSession.stop();
  };

  /** Apply buffered ICE candidates once the remote description is set. */
  const flushIce = async () => {
    const pc = pcRef.current;
    if (!pc || !pc.remoteDescription) return;
    const queued = pendingIceRef.current.splice(0);
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(candidate);
      } catch {
        // stale candidate; ignore
      }
    }
  };

  /** Terminate everything and log the outcome (used by end / failure paths). */
  const teardown = (
    outcome: "COMPLETED" | "CANCELLED" | "REJECTED" | "FAILED" | "MISSED",
  ) => {
    const current = callRef.current;
    if (current) {
      finalizeSession(current.callId, outcome);
      if (isCallerRef.current && !current.practice) {
        if (callActiveSinceRef.current) {
          logCallEvent(
            current.peer.id,
            "answered",
            Date.now() - callActiveSinceRef.current,
          );
        } else if (outcome !== "COMPLETED") {
          logCallEvent(current.peer.id, "missed");
        }
      }
    }
    callActiveSinceRef.current = null;
    isCallerRef.current = false;
    cleanupMedia();
    setCall(null);
  };

  /** Network recovery: ICE restart from the caller side, give up after a while. */
  const beginRecovery = () => {
    const current = callRef.current;
    if (!current || current.status !== "active") return;
    setPhase("reconnecting");
    if (!giveUpTimerRef.current) {
      giveUpTimerRef.current = setTimeout(() => {
        giveUpTimerRef.current = null;
        const c = callRef.current;
        const pc = pcRef.current;
        const state = pc?.connectionState || pc?.iceConnectionState;
        if (!c || state === "connected" || state === "completed") return;
        const peerId = c.peer.id;
        sendSignal({ type: "call_end", to: peerId, call_id: c.callId });
        teardown("FAILED");
        notify(
          "Call ended",
          "The connection was lost and could not be restored.",
        );
      }, RECONNECT_GIVEUP_MS);
    }
    if (!isCallerRef.current || reconnectTimerRef.current) return;
    reconnectTimerRef.current = setTimeout(async () => {
      reconnectTimerRef.current = null;
      const pc = pcRef.current;
      const c = callRef.current;
      if (!pc || !c) return;
      const state = pc.connectionState || pc.iceConnectionState;
      if (state === "connected" || state === "completed") return;
      try {
        const offer = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription(offer);
        sendSignal({
          type: "call_offer",
          to: c.peer.id,
          call_id: c.callId,
          sdp: offer,
        });
      } catch {
        // give-up timer will end the call if this never recovers
      }
    }, ICE_RESTART_DELAY_MS);
  };

  const createPeer = async (peerId: string, callId: string) => {
    const rtc = getRTC();
    if (!rtc) throw new Error("webrtc-unavailable");
    if (rtc.native) {
      await audioSession.prepare();
      if (!isCurrentCall(callId)) throw new Error("Call cancelled");
      audioSession.start(false);
    }
    const stream = await getMicStream();
    if (!isCurrentCall(callId)) {
      stream.getTracks().forEach((t: any) => t.stop());
      throw new Error("Call cancelled");
    }
    localStreamRef.current = stream;
    const config = await getIceConfig();
    if (!isCurrentCall(callId)) {
      stream.getTracks().forEach((t: any) => t.stop());
      throw new Error("Call cancelled");
    }
    const pc = new rtc.PC(config);
    stream.getTracks().forEach((t: any) => {
      // A ringing request is not a conversation: do not transmit the mic yet.
      t.enabled = callRef.current?.status === "active";
      pc.addTrack(t, stream);
    });
    preferOpus(pc);
    pc.onicecandidate = (e: any) => {
      const c = callRef.current;
      if (e.candidate && c) {
        sendSignal({
          type: "call_ice",
          to: peerId,
          call_id: c.callId,
          candidate: e.candidate,
        });
      }
    };
    const onState = () => {
      const state = pc.connectionState || pc.iceConnectionState;
      if (state === "connected" || state === "completed") {
        clearTimeout(reconnectTimerRef.current as any);
        reconnectTimerRef.current = null;
        clearTimeout(giveUpTimerRef.current as any);
        giveUpTimerRef.current = null;
        if (!callActiveSinceRef.current) callActiveSinceRef.current = Date.now();
        const c = callRef.current;
        if (c) sendSignal({ type: "call_media_ready", to: peerId, call_id: c.callId });
        setPhase("connected");
      } else if (state === "disconnected" || state === "failed") {
        beginRecovery();
      }
    };
    pc.onconnectionstatechange = onState;
    pc.oniceconnectionstatechange = onState;
    pc.ontrack = (e: any) => {
      const remoteStream = e.streams?.[0] || null;
      if (rtc.native) {
        // react-native-webrtc plays remote audio tracks automatically.
        remoteAudioRef.current = remoteStream;
      } else {
        const audio = document.createElement("audio");
        audio.autoplay = true;
        audio.srcObject = remoteStream;
        remoteAudioRef.current = audio;
        remoteMeterRef.current?.stop();
        remoteMeterRef.current = createLevelMeter(remoteStream);
      }
    };
    pcRef.current = pc;
    return pc;
  };

  const startCall = useCallback(
    async (peer: User, reservedCallId?: string, reservedExpiresAt?: number) => {
      if (callRef.current || startingRef.current) {
        if (reservedCallId) await finalizeSession(reservedCallId, "CANCELLED");
        return;
      }
      if (!webrtcAvailable()) {
        if (reservedCallId) await finalizeSession(reservedCallId, "FAILED");
        notify(
          "Audio calls",
          Platform.OS === "web"
            ? "Your browser doesn't support audio calls."
            : "Audio calls work in the installed app (production build) or on the web. Voice messages work everywhere!",
        );
        return;
      }
      if (wsRef.current?.readyState !== WebSocket.OPEN) {
        if (reservedCallId) await finalizeSession(reservedCallId, "FAILED");
        notify("Connecting", "Please wait for the call connection and try again.");
        return;
      }
      startingRef.current = true;
      let callId: string;
      let expiresAt = Date.now() + RING_TIMEOUT_MS;
      try {
        // The server authorizes the pair and owns the callId.
        const session = reservedCallId ? { call_id: reservedCallId, expires_at: reservedExpiresAt } : await api.post<{ call_id: string; expires_at: number }>("/rtc/calls", {
          receiver_id: peer.id,
        });
        callId = session.call_id;
        expiresAt = session.expires_at || expiresAt;
      } catch (err: any) {
        startingRef.current = false;
        notify("Call failed", err?.message || "Could not start the call.");
        return;
      }
      try {
        setCall({ status: "outgoing", phase: "outgoing", peer, callId, expiresAt, practice: !!reservedCallId });
        ringTimeoutRef.current = setTimeout(() => {
          if (isCurrentCall(callId) && callRef.current?.status === "outgoing") {
            sendSignal({ type: "call_end", to: peer.id, call_id: callId });
            teardown("MISSED");
          }
        }, Math.max(0, expiresAt - Date.now()));
        isCallerRef.current = true;
        callActiveSinceRef.current = null;
        const pc = await createPeer(peer.id, callId);
        const offer = await pc.createOffer();
        if (!isCurrentCall(callId)) return;
        await pc.setLocalDescription(offer);
        if (!isCurrentCall(callId)) return;
        sendSignal({
          type: "call_offer",
          to: peer.id,
          call_id: callId,
          sdp: offer,
        });
        // Calling stays visible until the receiving app acknowledges delivery.
        startingRef.current = false;
      } catch (err: any) {
        finalizeSession(callId, "FAILED");
        if (!isCurrentCall(callId)) return;
        cleanupMedia();
        setCall(null);
        alertMicError(err, "Call failed");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sendSignal],
  );

  const acceptCall = async () => {
    const current = callRef.current;
    if (!current?.offerSdp || current.status !== "incoming") return;
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      notify("Connecting", "The call connection is starting. Please try Accept again in a moment.");
      return;
    }
    if (!webrtcAvailable()) {
      sendSignal({
        type: "call_decline",
        to: current.peer.id,
        call_id: current.callId,
      });
      setCall(null);
      notify(
        "Audio calls",
        "Audio calls work in the installed app (production build) or on the web.",
      );
      return;
    }
    try {
      if (ringTimeoutRef.current) { clearTimeout(ringTimeoutRef.current); ringTimeoutRef.current = null; }
      setCall({ ...current, status: "active", phase: "connecting" });
      const pc = await createPeer(current.peer.id, current.callId);
      await pc.setRemoteDescription(current.offerSdp);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await flushIce();
      sendSignal({
        type: "call_answer",
        to: current.peer.id,
        call_id: current.callId,
        sdp: answer,
      });
    } catch (err: any) {
      if (callRef.current?.callId !== current.callId) return;
      sendSignal({
        type: "call_decline",
        to: current.peer.id,
        call_id: current.callId,
      });
      finalizeSession(current.callId, "FAILED");
      cleanupMedia();
      setCall(null);
      alertMicError(err, "Call failed");
    }
  };

  const declineCall = () => {
    const current = callRef.current;
    if (current) {
      sendSignal({
        type: "call_decline",
        to: current.peer.id,
        call_id: current.callId,
      });
      finalizeSession(current.callId, "REJECTED");
    }
    callActiveSinceRef.current = null;
    isCallerRef.current = false;
    cleanupMedia();
    setCall(null);
  };

  const endCall = () => {
    const current = callRef.current;
    if (!current) return;
    sendSignal({
      type: "call_end",
      to: current.peer.id,
      call_id: current.callId,
    });
    const connected = !!callActiveSinceRef.current;
    teardown(connected ? "COMPLETED" : "CANCELLED");
  };

  const toggleMute = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !muted;
    stream.getAudioTracks().forEach((t: any) => {
      t.enabled = !next;
    });
    setMuted(next);
  };

  const toggleSpeaker = () => {
    try {
      const next = !speakerOn;
      audioSession.setSpeaker(next);
      setSpeakerOn(next);
      setAudioRouteError("");
    } catch (e: any) { setAudioRouteError(e.message || "Could not change the speaker. Please check your audio device."); }
  };

  const handleEvent = useCallback(async (event: any) => {
    subscribersRef.current.forEach((fn) => fn(event));
    const current = callRef.current;
    switch (event.type) {
      case "call_offer": {
        if (current && current.callId === event.call_id && current.status === "incoming") {
          sendSignal({ type: "call_ringing", to: event.from, call_id: event.call_id });
          return;
        }
        // Renegotiation / ICE restart on the live call.
        if (
          current &&
          current.peer.id === event.from &&
          current.callId === event.call_id &&
          pcRef.current
        ) {
          try {
            await pcRef.current.setRemoteDescription(event.sdp);
            const answer = await pcRef.current.createAnswer();
            await pcRef.current.setLocalDescription(answer);
            await flushIce();
            sendSignal({
              type: "call_answer",
              to: event.from,
              call_id: current.callId,
              sdp: answer,
            });
          } catch {
            // give-up timer handles a failed restart
          }
          return;
        }
        // Busy: already on another call.
        if (current) {
          sendSignal({
            type: "call_decline",
            to: event.from,
            call_id: event.call_id,
          });
          return;
        }
        if (!event.call_id) return;
        if (event.expires_at && event.expires_at <= Date.now()) return;
        pendingIceRef.current = [...pendingIceRef.current, ...(event.queued_ice || [])];
        setCall({
          status: "incoming",
          phase: "incoming",
          peer: event.caller || { id: event.from, name: "Unknown" },
          callId: event.call_id,
          offerSdp: event.sdp,
          expiresAt: event.expires_at || Date.now() + RING_TIMEOUT_MS,
          practice: event.practice === true,
        });
        isCallerRef.current = false;
        sendSignal({ type: "call_ringing", to: event.from, call_id: event.call_id });
        callActiveSinceRef.current = null;
        ringTimeoutRef.current = setTimeout(() => {
          const ringing = callRef.current;
          if (ringing && ringing.callId === event.call_id && ringing.status === "incoming") teardown("MISSED");
        }, Math.max(0, (event.expires_at || Date.now() + RING_TIMEOUT_MS) - Date.now()));
        break;
      }
      case "call_ringing":
        if (current && current.callId === event.call_id && current.status === "outgoing") setPhase("ringing");
        break;
      case "call_connected":
        if (current && current.callId === event.call_id && current.practice) setCall({ ...current, endsAt: event.ends_at });
        break;
      case "call_answer":
        if (!current || current.callId !== event.call_id || !pcRef.current) break;
        try {
          if (ringTimeoutRef.current) {
            clearTimeout(ringTimeoutRef.current);
            ringTimeoutRef.current = null;
          }
          if (current.status === "outgoing") {
            setCall({ ...current, status: "active", phase: "connecting" });
            localStreamRef.current?.getAudioTracks?.().forEach((track: any) => { track.enabled = true; });
          }
          await pcRef.current.setRemoteDescription(event.sdp);
          await flushIce();
        } catch {
          endCall();
        }
        break;
      case "call_ice":
        if (event.candidate && current?.callId === event.call_id) {
          pendingIceRef.current.push(event.candidate);
          await flushIce();
        }
        break;
      case "call_unavailable":
        // Offline/no acknowledgement is Calling, with the same gentle ringback.
        if (current && current.callId === event.call_id && current.status === "outgoing") setPhase("outgoing");
        break;
      case "call_invalid":
        // The server rejected this session (expired / not a participant).
        if (current && current.callId === event.call_id) {
          cleanupMedia();
          setCall(null);
        }
        break;
      case "call_decline":
      case "call_end":
        if (current && (!event.call_id || current.callId === event.call_id)) {
          const connected = !!callActiveSinceRef.current;
          if (isCallerRef.current && !current.practice) {
            if (connected) {
              logCallEvent(
                current.peer.id,
                "answered",
                Date.now() - callActiveSinceRef.current!,
              );
            } else {
              logCallEvent(current.peer.id, "missed");
            }
          }
          callActiveSinceRef.current = null;
          isCallerRef.current = false;
          cleanupMedia();
          setCall(null);
        }
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recoverIncoming = useCallback(async (callId?: string) => {
    const current = callRef.current;
    if (current) {
      if (current.status === "incoming") sendSignal({ type: "call_ringing", to: current.peer.id, call_id: current.callId });
      return !callId || current.callId === callId;
    }
    try {
      const data = await api.get<{ offers: any[] }>("/rtc/incoming");
      const offer = data.offers.find(o => !callId || o.call_id === callId);
      if (!offer) return false;
      await handleEvent(offer);
      return true;
    } catch { return false; }
  }, [handleEvent, sendSignal]);

  useEffect(() => {
    // Gate the socket on a backend that has actually answered once. On Android
    // a WebSocket permanently occupies one of OkHttp's five per-host slots, so
    // opening (and endlessly retrying) it while HTTP is broken would starve
    // real requests and turn a server outage into a frozen app.
    if (!user || !serverReady) return;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let ping: ReturnType<typeof setInterval> | null = null;

    const connect = () => {
      if (closed) return;
      const existing = wsRef.current;
      if (
        existing &&
        (existing.readyState === WebSocket.OPEN ||
          existing.readyState === WebSocket.CONNECTING)
      ) {
        return;
      }
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;
      ws.onopen = () => {
        void recoverIncoming();
        // Mobile carriers / proxies drop idle sockets — a light keepalive keeps
        // incoming calls and room events flowing in real time.
        if (ping) clearInterval(ping);
        ping = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            try {
              ws.send(JSON.stringify({ type: "ping" }));
            } catch {
              // socket closing; onclose will reconnect
            }
          }
        }, KEEPALIVE_MS);
      };
      ws.onmessage = (e) => {
        try {
          handleEvent(JSON.parse(e.data));
        } catch {
          // ignore malformed
        }
      };
      ws.onclose = () => {
        if (ping) {
          clearInterval(ping);
          ping = null;
        }
        if (!closed) retry = setTimeout(connect, 3000);
      };
    };
    connect();

    // Reconnect the moment the app comes back to the foreground (Android/iOS
    // suspend sockets in the background).
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state !== "active" || closed) return;
      const ws = wsRef.current;
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        if (retry) clearTimeout(retry);
        connect();
      }
    });

    return () => {
      closed = true;
      appStateSub.remove();
      if (retry) clearTimeout(retry);
      if (ping) clearInterval(ping);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [user, serverReady, handleEvent, recoverIncoming]);

  useEffect(() => {
    if (call?.phase !== "connected" && call?.phase !== "reconnecting") return;
    const t = setInterval(() => setSeconds(callActiveSinceRef.current ? Math.floor((Date.now() - callActiveSinceRef.current) / 1000) : 0), 1000);
    return () => clearInterval(t);
  }, [call?.phase]);

  // Absolute server deadline, with polling fallback after socket/background gaps.
  useEffect(() => {
    if (!call?.practice || call.status !== "active") return;
    const callId = call.callId;
    let alive = true;
    const check = async () => {
      try {
        const state = await api.get<{ ends_at?: number; status: string }>(`/rtc/calls/${callId}/state`);
        const current = callRef.current;
        if (alive && current?.callId === callId && state.ends_at && current.endsAt !== state.ends_at) setCall({ ...current, endsAt: state.ends_at });
      } catch (e: any) {
        if (alive && e.status === 404 && isCurrentCall(callId)) teardown("COMPLETED");
      }
    };
    void check();
    const poll = setInterval(check, 5000);
    const appState = AppState.addEventListener("change", state => { if (state === "active") void check(); });
    return () => { alive = false; clearInterval(poll); appState.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call?.callId, call?.status, call?.practice]);

  useEffect(() => {
    if (!call?.practice || !call.endsAt) return;
    const timer = setTimeout(endCall, Math.max(0, call.endsAt - Date.now()));
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call?.callId, call?.endsAt]);

  // Real speaking detection for the remote party (Web Audio on web, getStats
  // audio levels on native) + lightweight connection-quality monitoring.
  useEffect(() => {
    if (call?.status !== "active") return;
    const rtc = getRTC();
    const useStats = !!rtc?.native;
    let lastLoud = 0;
    const iv = setInterval(async () => {
      const pc = pcRef.current;
      if (!pc) return;
      let loud = false;
      if (useStats) {
        const s = await readStats(pc);
        loud = s.inboundLevel > SPEAKING_THRESHOLD_STATS;
      } else {
        loud = (remoteMeterRef.current?.level() ?? 0) > SPEAKING_THRESHOLD_WEB;
      }
      const now = Date.now();
      if (loud) lastLoud = now;
      setPeerSpeaking(now - lastLoud < SPEAKING_HOLD_MS);
    }, LEVEL_POLL_MS);
    return () => clearInterval(iv);
  }, [call?.status]);

  // Native audio session for the life of an active call: proper audio focus,
  // earpiece by default, loudspeaker via the toggle (no-op on web / Expo Go).
  useEffect(() => {
    if (call?.status !== "active") return;
    audioSession.start(false);
    const unsubscribeRoute = audioSession.onRouteChanged(route => {
      if (route) setSpeakerOn(route === "SPEAKER_PHONE");
    });
    setAudioRouteError("");
    return () => {
      unsubscribeRoute();
      audioSession.stop();
      setSpeakerOn(false);
    };
  }, [call?.status]);

  const styles = makeStyles(colors);
  const insets = useSafeAreaInsets();
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;

  const activeStatusText = () => {
    if (call?.phase === "reconnecting") return "Reconnecting...";
    if (call?.phase === "connecting") return "Connecting...";
    return muted ? "You are muted" : "Connected";
  };

  return (
    <CallContext.Provider value={{ startCall, sendSignal, subscribe, busy: !!call, recoverIncoming }}>
      {children}
      <Modal visible={!!call} transparent animationType="fade" onRequestClose={endCall}>
        {call && call.practice && call.status !== "active" ? <IncomingCallPopup peer={call.peer} outgoing={call.status === "outgoing"} ringing={call.phase === "ringing"} expiresAt={call.expiresAt!} onAccept={acceptCall} onReject={call.status === "outgoing" ? endCall : declineCall} /> : call && (
          <LinearGradient
            colors={["#0B1B2E", "#14335A", "#0B1B2E"]}
            style={[
              styles.backdrop,
              {
                paddingTop: 16 + insets.top,
                paddingBottom: 16 + insets.bottom,
              },
            ]}
            testID="call-overlay"
          >
            <ScrollView style={styles.callScroll} contentContainerStyle={styles.callContent} showsVerticalScrollIndicator={false}>
            <View style={styles.topArea}>
              <Text testID="call-kind" style={styles.callKind}>
                {call.practice ? "Practice call" : "Audio call"}
              </Text>
              {call.status === "active" && (
                <View style={styles.timerPill} testID="call-timer">
                  <View style={styles.liveDot} />
                  <Text style={styles.timerText}>
                    {mins}:{secs.toString().padStart(2, "0")}
                  </Text>
                </View>
              )}
              {call.practice && <Text testID="practice-call-duration-limit" style={styles.actionLabel}>{call.endsAt ? `${Math.max(0, Math.ceil((call.endsAt - Date.now()) / 1000))} seconds remaining` : "Up to 10 minutes · No call history"}</Text>}
            </View>

            <View style={styles.centerArea}>
              <View style={styles.avatarWrap}>
                {call.status !== "active" && (
                  <>
                    <PulseRing size={150} delay={0} />
                    <PulseRing size={150} delay={700} />
                    <PulseRing size={150} delay={1400} />
                  </>
                )}
                <Avatar
                  name={call.peer.name}
                  url={call.peer.avatar_url}
                  size={124}
                  frame={call.peer.active_frame}
                  isSpeaking={call.status === "active" && peerSpeaking}
                />
              </View>
              <View style={styles.nameRow}>
                <Text style={styles.name}>{call.peer.name}</Text>
                {call.peer.is_vip ? (
                  <VipBadge tier={call.peer.vip_tier} />
                ) : null}
              </View>
              <Text testID="call-connection-status" style={styles.status}>
                {call.status === "active" && activeStatusText()}
                {call.status === "incoming" && "Incoming audio call"}
                {call.status === "outgoing" && (call.phase === "ringing" ? "Ringing…" : "Calling…")}
              </Text>
            </View>


            <View style={styles.actions}>
              {(
                <>
                  {call.status === "incoming" && <View style={styles.actionCol}><Pressable testID="call-accept-btn" accessibilityLabel="Accept call" style={[styles.actionBtn, styles.accept]} onPress={acceptCall}><Ionicons name="call" size={26} color="#FFFFFF" /></Pressable><Text style={styles.actionLabel}>Accept</Text></View>}
                  {call.status === "active" && (
                    <>
                      <View style={styles.actionCol}>
                        <Pressable
                          testID="call-mute-btn"
                          style={[styles.actionBtn, styles.neutral, muted && styles.neutralActive]}
                          onPress={toggleMute}
                        >
                          <Ionicons
                            name={muted ? "mic-off" : "mic"}
                            size={26}
                            color="#FFF"
                          />
                        </Pressable>
                        <Text style={styles.actionLabel}>
                          {muted ? "Unmute" : "Mute"}
                        </Text>
                      </View>
                      {audioSession.available && (
                        <View style={styles.actionCol}>
                          <Pressable
                            testID="call-speaker-btn"
                            accessibilityRole="switch"
                            accessibilityLabel="Loudspeaker"
                            accessibilityState={{ checked: speakerOn, disabled: !audioSession.available }}
                            style={[styles.actionBtn, styles.neutral, speakerOn && styles.neutralActive, !audioSession.available && { opacity: 0.4 }]}
                            onPress={toggleSpeaker}
                          >
                            <Ionicons
                              name={speakerOn ? "volume-high" : "volume-mute"}
                              size={26}
                              color="#FFF"
                            />
                          </Pressable>
                          <Text testID="call-speaker-label" style={styles.actionLabel}>{speakerOn ? "Speaker on" : "Speaker off"}</Text>
                        </View>
                      )}
                    </>
                  )}
                  <View style={styles.actionCol}>
                    <Pressable
                      testID={call.status === "incoming" ? "call-decline-btn" : "call-end-btn"}
                      style={[styles.actionBtn, styles.danger]}
                      onPress={call.status === "incoming" ? declineCall : endCall}
                    >
                      <Ionicons
                        name="call"
                        size={28}
                        color="#FFF"
                        style={{ transform: [{ rotate: "135deg" }] }}
                      />
                    </Pressable>
                    <Text style={styles.actionLabel}>{call.status === "incoming" ? "Reject" : "End"}</Text>
                  </View>
                </>
              )}
            </View>
            {!!audioRouteError && <Text testID="call-speaker-error" style={styles.deviceNote}>{audioRouteError}</Text>}
            {call.status === "active" && !audioSession.available && <Text testID="call-speaker-device-note" style={styles.deviceNote}>Speaker switching needs the installed mobile app. This preview uses your device’s selected audio output.</Text>}
            </ScrollView>
          </LinearGradient>
        )}
      </Modal>
    </CallContext.Provider>
  );
};

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used within CallProvider");
  return ctx;
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.xl,
    },
    callScroll: { width: "100%", flex: 1 },
    callContent: { flexGrow: 1, alignItems: "center", justifyContent: "space-between", gap: 24, paddingVertical: 12 },
    topArea: {
      alignItems: "center",
      gap: spacing.md,
    },
    callKind: {
      fontFamily: fonts.textBold,
      fontSize: 13,
      color: "rgba(255,255,255,0.65)",
      textTransform: "uppercase",
      letterSpacing: 1.2,
    },
    timerPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      backgroundColor: "rgba(255,255,255,0.12)",
      borderRadius: radius.pill,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
    },
    liveDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: "#22C55E",
    },
    timerText: {
      fontFamily: fonts.displaySemi,
      fontSize: 16,
      color: "#FFFFFF",
    },
    centerArea: {
      alignItems: "center",
      gap: spacing.md,
    },
    avatarWrap: {
      width: 150,
      height: 150,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: spacing.md,
    },
    nameRow: {
      flexDirection: "row",
      maxWidth: "100%",
      justifyContent: "center",
      alignItems: "center",
      gap: spacing.sm,
    },
    name: {
      fontFamily: fonts.display,
      fontSize: 28,
      flexShrink: 1,
      textAlign: "center",
      color: "#FFFFFF",
    },
    status: {
      fontFamily: fonts.textSemi,
      fontSize: 15,
      color: "rgba(255,255,255,0.6)",
    },
    actions: {
      flexDirection: "row",
      gap: spacing.lg,
      alignItems: "flex-end",
    },
    deviceNote: { color: "rgba(255,255,255,0.7)", fontSize: 11, lineHeight: 17, textAlign: "center" },
    actionCol: {
      alignItems: "center",
      gap: spacing.sm,
    },
    actionBtn: {
      width: 68,
      height: 68,
      borderRadius: 34,
      alignItems: "center",
      justifyContent: "center",
    },
    actionLabel: {
      fontFamily: fonts.textSemi,
      fontSize: 12,
      color: "rgba(255,255,255,0.75)",
    },
    danger: {
      backgroundColor: "#EF4444",
    },
    accept: {
      backgroundColor: "#10B981",
    },
    neutral: {
      backgroundColor: "rgba(255,255,255,0.14)",
    },
    neutralActive: {
      backgroundColor: "rgba(255,255,255,0.35)",
    },
  });
