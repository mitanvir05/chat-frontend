import React, { useState, useEffect, useRef } from "react";
import io from "socket.io-client";
import {
  Send,
  MessageSquare,
  Phone,
  PhoneOff,
  Mic,
  MicOff,
  Video,
  VideoOff,
} from "lucide-react";

// Connect to backend
const socket = io(import.meta.env.VITE_SOCKET_URL, {
  path: "/socket.io",
  transports: ["websocket", "polling"],
  withCredentials: true
});

// Basic STUN; add TURN in prod
const RTC_CONFIG = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    // replace with your real TURN creds (udp/tcp + tls)
    { urls: "turn:YOUR_TURN_HOST:3478?transport=udp", username: "USER", credential: "PASS" },
    { urls: "turn:YOUR_TURN_HOST:3478?transport=tcp", username: "USER", credential: "PASS" },
    { urls: "turns:YOUR_TURN_HOST:5349?transport=tcp", username: "USER", credential: "PASS" }
  ],
  iceTransportPolicy: "relay" // <- for testing; change to "all" after it works
};

const App = () => {
  // Chat states
  const [myId, setMyId] = useState("");
  const [userIdInput, setUserIdInput] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [users, setUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [recipientId, setRecipientId] = useState("");

  // Call states
  const [inCallWith, setInCallWith] = useState(""); // userId you're on a call with
  const [incomingFrom, setIncomingFrom] = useState(""); // userId calling you
  const [showIncomingModal, setShowIncomingModal] = useState(false);
  const [isMicOn, setIsMicOn] = useState(true);
  const [isCamOn, setIsCamOn] = useState(true);

  // Streams and PC
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const pcRef = useRef(null);

  const messagesEndRef = useRef(null);
  const peerIdRef = useRef("");
const pendingIceRef = useRef([]); 

  // ========= Socket listeners =========
  useEffect(() => {
    if (!isLoggedIn) return;

    socket.on("update-user-list", (userList) => {
      setUsers(userList.filter((u) => u !== myId));
    });

    socket.on("load-messages", (loadedMessages) => {
      setMessages(loadedMessages);
    });

    socket.on("new-message", (message) => {
      setMessages((prev) => [...prev, message]);
    });

    // --- WebRTC signaling ---
    socket.on("incoming-call", async ({ fromUserId, offer }) => {
      // Prepare peer connection for answering
      setIncomingFrom(fromUserId);
      setShowIncomingModal(true);
      // Store offer temporarily on window to avoid extra state pickle
      window.__incomingOffer = offer;
    });

    socket.on("call-answered", async ({ fromUserId, answer }) => {
  if (!pcRef.current) return;
  await pcRef.current.setRemoteDescription(answer);

  // FLUSH queued ICE now
  for (const c of pendingIceRef.current) {
    try { await pcRef.current.addIceCandidate(c); } catch (e) { console.error(e); }
  }
  pendingIceRef.current = [];

  setInCallWith(fromUserId);
});

  socket.on("ice-candidate", async ({ candidate }) => {
  try {
    if (!pcRef.current) return;
    if (!pcRef.current.remoteDescription) {
      // queue until SRD is set
      pendingIceRef.current.push(candidate);
      return;
    }
    await pcRef.current.addIceCandidate(candidate);
  } catch (err) {
    console.error("Error adding remote ICE candidate:", err);
  }
});


    socket.on("call-ended", () => {
      endCallLocalCleanup();
    });

    return () => {
      socket.off("update-user-list");
      socket.off("load-messages");
      socket.off("new-message");
      socket.off("incoming-call");
      socket.off("call-answered");
      socket.off("ice-candidate");
      socket.off("call-ended");
    };
  }, [isLoggedIn, myId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ========= Helpers =========
  const createPeerConnection = () => {
  console.log("Creating new RTCPeerConnection...");
  const pc = new RTCPeerConnection(RTC_CONFIG);

  // Remote track handling
  pc.ontrack = (e) => {
    console.log("✅ ONTRACK EVENT FIRED. Assigning stream to video element.");
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = e.streams[0];
      // force play (prevents black frame on some setups)
      remoteVideoRef.current.onloadedmetadata = () => {
        remoteVideoRef.current?.play().catch(() => {});
      };
    }
  };

  pc.onicecandidate = (e) => {
    if (!e.candidate) return;
    const target = peerIdRef.current;           // <- NOT state
    if (!target) {
      // (optional) queue until remoteDescription is set
      pendingIceRef.current.push(e.candidate);
      return;
    }
    socket.emit("ice-candidate", {
      toUserId: target,
      fromUserId: myId,
      candidate: e.candidate,
    });
  };

  pc.onconnectionstatechange = () => {
    console.log(`Connection state changed to: ${pc.connectionState}`);
    if (["failed","disconnected","closed"].includes(pc.connectionState)) {
      endCallLocalCleanup();
    }
  };

  pcRef.current = pc;
  return pc;
};


  const getMedia = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true,
    });
    localStreamRef.current = stream;
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;
    return stream;
  };

  const attachLocalTracks = (pc, stream) => {
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));
  };

  // ========= Call flows =========

  const startCall = async (toUserId) => {
  if (!toUserId) return;
  peerIdRef.current = toUserId;        // <- set ref BEFORE creating PC
  setInCallWith(toUserId);

  const pc = createPeerConnection();
  const stream = await getMedia();
  attachLocalTracks(pc, stream);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  socket.emit("call-user", { toUserId, fromUserId: myId, offer });
};

  const acceptCall = async () => {
  const fromUserId = incomingFrom;
  peerIdRef.current = fromUserId;      // <- set ref BEFORE creating PC
  setShowIncomingModal(false);
  setInCallWith(fromUserId);

  const pc = createPeerConnection();
  const stream = await getMedia();
  attachLocalTracks(pc, stream);

  const offer = window.__incomingOffer;
  await pc.setRemoteDescription(offer);

  // flush any queued ICE (if you use the queue)
  for (const c of pendingIceRef.current) await pc.addIceCandidate(c);
  pendingIceRef.current = [];

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  socket.emit("answer-call", { toUserId: fromUserId, fromUserId: myId, answer });
  delete window.__incomingOffer;
};

  const declineCall = () => {
    setShowIncomingModal(false);
    setIncomingFrom("");
    delete window.__incomingOffer;
  };

  const endCall = () => {
    if (!inCallWith) return;
    socket.emit("end-call", { toUserId: inCallWith, fromUserId: myId });
    endCallLocalCleanup();
  };

  const endCallLocalCleanup = () => {
    setIncomingFrom("");
    setInCallWith("");

    if (pcRef.current) {
      try {
        pcRef.current.ontrack = null;
        pcRef.current.onicecandidate = null;
        pcRef.current.close();
      } catch {}
      pcRef.current = null;
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach((t) => t.stop());
      remoteStreamRef.current = null;
    }

    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
  };

  const toggleMic = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const track = stream.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setIsMicOn(track.enabled);
  };

  const toggleCam = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setIsCamOn(track.enabled);
  };

  // ========= Auth / Chat actions =========

  const handleLogin = (e) => {
    e.preventDefault();
    if (userIdInput) {
      setMyId(userIdInput);
      socket.emit("join", userIdInput);
      setIsLoggedIn(true);
    }
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (newMessage.trim() && recipientId) {
      socket.emit("send-message", {
        senderId: myId,
        recipientId,
        text: newMessage,
      });
      setNewMessage("");
    }
  };

  if (!isLoggedIn) {
    return (
      <div className="bg-gray-900 min-h-screen flex items-center justify-center">
        <div className="bg-gray-800 p-8 rounded-lg shadow-xl w-full max-w-sm">
          <h1 className="text-3xl font-bold text-center text-teal-400 mb-6">
            Join Chat
          </h1>
          <form onSubmit={handleLogin}>
            <input
              type="text"
              value={userIdInput}
              onChange={(e) => setUserIdInput(e.target.value)}
              placeholder="Enter your name or ID"
              className="w-full bg-gray-700 text-white p-3 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <button
              type="submit"
              className="w-full bg-teal-600 p-3 rounded-lg font-bold hover:bg-teal-700 transition-colors"
            >
              Join
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-900 text-white min-h-screen flex font-sans">
      {/* Sidebar */}
      <div className="w-1/4 bg-gray-800 p-4 border-r border-gray-700 flex flex-col">
        <h1 className="text-2xl font-bold mb-4 text-teal-400">Chat App</h1>
        <h2 className="text-lg font-semibold mb-2">
          Your ID: <span className="font-mono text-green-400">{myId}</span>
        </h2>
        <div className="flex-grow">
          <h3 className="text-md font-semibold mb-2 text-gray-400">
            Online Users
          </h3>
          <ul>
            {users.map((user) => (
              <li
                key={user}
                className={`p-2 rounded-lg mb-2 flex justify-between items-center transition-all ${
                  recipientId === user
                    ? "bg-teal-600"
                    : "bg-gray-700 hover:bg-gray-600"
                }`}
              >
                <button
                  onClick={() => setRecipientId(user)}
                  className="flex items-center gap-2"
                >
                  <span>{user}</span>
                  <MessageSquare size={16} />
                </button>
                <button
                  onClick={() => startCall(user)}
                  className="ml-2 bg-teal-500 hover:bg-teal-600 px-2 py-1 rounded flex items-center gap-1"
                  title="Start video call"
                >
                  <Phone size={16} /> Call
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Main */}
      <div className="w-3/4 flex flex-col">
        {/* Header */}
        <div className="bg-gray-800 p-3 flex items-center justify-between border-b border-gray-700">
          <div>
            <h3 className="text-lg font-semibold">
              Chat with:{" "}
              <span className="text-teal-400">
                {recipientId || "Select a user"}
              </span>
            </h3>
            {inCallWith && (
              <p className="text-xs text-gray-400">In call with {inCallWith}</p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => recipientId && startCall(recipientId)}
              className="bg-teal-600 hover:bg-teal-700 px-3 py-2 rounded flex items-center gap-2 disabled:opacity-50"
              disabled={!recipientId || !!inCallWith}
              title="Start video call"
            >
              <Phone size={16} /> Call
            </button>
            <button
              onClick={endCall}
              className="bg-red-600 hover:bg-red-700 px-3 py-2 rounded flex items-center gap-2 disabled:opacity-50"
              disabled={!inCallWith}
              title="End call"
            >
              <PhoneOff size={16} /> Hang up
            </button>
            <button
              onClick={toggleMic}
              className="bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded flex items-center gap-2 disabled:opacity-50"
              disabled={!inCallWith}
              title="Toggle mic"
            >
              {isMicOn ? <Mic size={16} /> : <MicOff size={16} />} Mic
            </button>
            <button
              onClick={toggleCam}
              className="bg-gray-700 hover:bg-gray-600 px-3 py-2 rounded flex items-center gap-2 disabled:opacity-50"
              disabled={!inCallWith}
              title="Toggle camera"
            >
              {isCamOn ? <Video size={16} /> : <VideoOff size={16} />} Cam
            </button>
          </div>
        </div>

        {/* Video Area */}
        <div className="bg-black flex gap-2 p-3 h-72 border-b border-gray-800">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="bg-gray-900 rounded-lg w-1/3 object-cover"
          />
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            muted /* <--- ADD THIS LINE */
            className="bg-gray-900 rounded-lg flex-1 object-cover"
          />
        </div>

        {/* Chat Area */}
        <div className="h-full bg-gray-800 flex flex-col p-4">
          <div className="flex-grow overflow-y-auto mb-2 pr-2">
            {messages
              .filter(
                (m) =>
                  (m.senderId === myId && m.recipientId === recipientId) ||
                  (m.senderId === recipientId && m.recipientId === myId)
              )
              .map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${
                    msg.senderId === myId ? "justify-end" : "justify-start"
                  }`}
                >
                  <div
                    className={`max-w-xs lg:max-w-md p-3 rounded-lg mb-2 ${
                      msg.senderId === myId ? "bg-teal-600" : "bg-gray-600"
                    }`}
                  >
                    <p>{msg.text}</p>
                  </div>
                </div>
              ))}
            <div ref={messagesEndRef} />
          </div>
          <form onSubmit={handleSendMessage} className="flex">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Type a message..."
              disabled={!recipientId}
              className="flex-grow bg-gray-700 p-2 rounded-l-lg focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!recipientId}
              className="bg-teal-600 p-2 rounded-r-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send size={20} />
            </button>
          </form>
        </div>
      </div>

      {/* Incoming Call Modal */}
      {showIncomingModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 p-6 rounded-xl border border-gray-700 w-full max-w-sm">
            <h4 className="text-xl font-semibold mb-2">Incoming call</h4>
            <p className="text-gray-300 mb-4">
              from{" "}
              <span className="text-teal-400 font-mono">{incomingFrom}</span>
            </p>
            <div className="flex gap-3">
              <button
                onClick={acceptCall}
                className="flex-1 bg-teal-600 hover:bg-teal-700 py-2 rounded flex items-center justify-center gap-2"
              >
                <Phone size={16} /> Accept
              </button>
              <button
                onClick={declineCall}
                className="flex-1 bg-red-600 hover:bg-red-700 py-2 rounded flex items-center justify-center gap-2"
              >
                <PhoneOff size={16} /> Decline
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
