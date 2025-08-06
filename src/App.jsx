import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import Peer from 'simple-peer';
import { Phone, PhoneOff, Send, Mic, MicOff, Video, VideoOff } from 'lucide-react';

// --- Connect to your backend server ---
// Make sure your backend server is running
const socket = io('http://localhost:5000');

const App = () => {
    // State Management
    const [myId, setMyId] = useState('');
    const [userIdInput, setUserIdInput] = useState('');
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [users, setUsers] = useState([]);
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState('');
    const [recipientId, setRecipientId] = useState('');

    // Call State
    const [stream, setStream] = useState(null);
    const [receivingCall, setReceivingCall] = useState(false);
    const [caller, setCaller] = useState('');
    const [callerSignal, setCallerSignal] = useState();
    const [callAccepted, setCallAccepted] = useState(false);
    const [callEnded, setCallEnded] = useState(true); // Start as true
    const [isMuted, setIsMuted] = useState(false);
    const [isVideoOff, setIsVideoOff] = useState(false);

    // Refs for video elements and connection
    const myVideo = useRef();
    const userVideo = useRef();
    const connectionRef = useRef();
    const messagesEndRef = useRef(null);

    useEffect(() => {
        if (!isLoggedIn) return;

        // Get user media
        navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(stream => {
            setStream(stream);
            if (myVideo.current) {
                myVideo.current.srcObject = stream;
            }
        }).catch(err => {
            console.error("Error accessing media devices.", err);
        });

        // Socket event listeners
        socket.on('update-user-list', (userList) => {
            setUsers(userList.filter(u => u !== myId));
        });

        socket.on('load-messages', (loadedMessages) => {
            setMessages(loadedMessages);
        });

        socket.on('new-message', (message) => {
            setMessages(prev => [...prev, message]);
        });

        socket.on('incoming-call', (data) => {
            setReceivingCall(true);
            setCaller(data.from);
            setCallerSignal(data.signal);
        });
        
        socket.on('call-ended', () => {
            leaveCall(false); // Don't emit another end-call event
        });

        return () => {
            socket.off('update-user-list');
            socket.off('load-messages');
            socket.off('new-message');
            socket.off('incoming-call');
            socket.off('call-ended');
        };
    }, [isLoggedIn, myId]);


    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleLogin = (e) => {
        e.preventDefault();
        if (userIdInput) {
            setMyId(userIdInput);
            socket.emit('join', userIdInput);
            setIsLoggedIn(true);
        }
    };

    const callUser = (id) => {
        setRecipientId(id);
        setCallEnded(false);
        const peer = new Peer({
            initiator: true,
            trickle: false,
            stream: stream,
        });

        peer.on('signal', (data) => {
            socket.emit('call-user', {
                userToCall: id,
                signalData: data,
                from: myId,
            });
        });

        peer.on('stream', (currentStream) => {
            if (userVideo.current) {
                userVideo.current.srcObject = currentStream;
            }
        });

        socket.on('call-accepted', (signal) => {
            setCallAccepted(true);
            peer.signal(signal);
        });

        connectionRef.current = peer;
    };

    const answerCall = () => {
        setCallAccepted(true);
        setCallEnded(false);
        setReceivingCall(false);
        setRecipientId(caller);

        const peer = new Peer({
            initiator: false,
            trickle: false,
            stream: stream,
        });

        peer.on('signal', (data) => {
            socket.emit('answer-call', { signal: data, to: caller });
        });

        peer.on('stream', (currentStream) => {
            if(userVideo.current) {
               userVideo.current.srcObject = currentStream;
            }
        });

        peer.signal(callerSignal);
        connectionRef.current = peer;
    };

    const leaveCall = (shouldEmit = true) => {
        setCallEnded(true);
        setCallAccepted(false);
        setReceivingCall(false);
        
        if (shouldEmit) {
            socket.emit('end-call', { to: recipientId || caller });
        }

        if (connectionRef.current) {
            connectionRef.current.destroy();
        }
        
        // Reset states
        setRecipientId('');
        setCaller('');

        // Re-enable media tracks in case they were disabled
        if (stream) {
            stream.getTracks().forEach(track => track.enabled = true);
        }
        setIsMuted(false);
        setIsVideoOff(false);
    };

    const handleSendMessage = (e) => {
        e.preventDefault();
        if (newMessage.trim() && recipientId) {
            socket.emit('send-message', {
                senderId: myId,
                recipientId: recipientId,
                text: newMessage,
            });
            setNewMessage('');
        }
    };
    
    const toggleMute = () => {
        if(stream) {
            stream.getAudioTracks().forEach(track => track.enabled = !track.enabled);
            setIsMuted(!isMuted);
        }
    };

    const toggleVideo = () => {
        if(stream) {
            stream.getVideoTracks().forEach(track => track.enabled = !track.enabled);
            setIsVideoOff(!isVideoOff);
        }
    };
    
    // Determine if the main video view should show the user's video or the peer's video
    const mainVideoSrc = callAccepted && !callEnded ? userVideo : myVideo;
    const pipVideoSrc = callAccepted && !callEnded ? myVideo : null;

    if (!isLoggedIn) {
        return (
            <div className="bg-gray-900 min-h-screen flex items-center justify-center">
                <div className="bg-gray-800 p-8 rounded-lg shadow-xl w-full max-w-sm">
                    <h1 className="text-3xl font-bold text-center text-teal-400 mb-6">Join Chat</h1>
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
                <h1 className="text-2xl font-bold mb-4 text-teal-400">Chat & Call</h1>
                <h2 className="text-lg font-semibold mb-2">Your ID: <span className="font-mono text-green-400">{myId}</span></h2>
                <div className="flex-grow">
                    <h3 className="text-md font-semibold mb-2 text-gray-400">Online Users</h3>
                    <ul>
                        {users.map(user => (
                            <li key={user}
                                className={`p-2 rounded-lg mb-2 cursor-pointer flex justify-between items-center transition-all ${recipientId === user ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}
                                onClick={() => setRecipientId(user)}>
                                <span>{user}</span>
                                {(callEnded || !callAccepted) && <button onClick={(e) => { e.stopPropagation(); callUser(user); }} className="p-1 bg-green-500 rounded-full hover:bg-green-600"><Phone size={16} /></button>}
                            </li>
                        ))}
                    </ul>
                </div>
            </div>

            {/* Main Content */}
            <div className="w-3/4 flex flex-col">
                {/* Video Area */}
                <div className="flex-grow bg-black flex justify-center items-center p-4 relative">
                    {/* Main Video Display */}
                     <video playsInline muted={mainVideoSrc === myVideo} ref={mainVideoSrc} autoPlay className="max-w-full max-h-full rounded-lg" />

                    {/* Picture-in-Picture Video */}
                    {pipVideoSrc && (
                         <div className="absolute w-48 bottom-4 right-4 z-10">
                            <video playsInline muted ref={pipVideoSrc} autoPlay className="w-full rounded-lg" />
                            {isVideoOff && <div className="absolute top-0 left-0 w-full h-full bg-gray-800 flex items-center justify-center text-white font-bold rounded-lg"><VideoOff /></div>}
                        </div>
                    )}
                    
                    {/* Call Controls */}
                    {callAccepted && !callEnded && (
                        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20 flex gap-4 bg-gray-800/50 backdrop-blur-sm p-3 rounded-full">
                            <button onClick={toggleMute} className={`p-3 rounded-full ${isMuted ? 'bg-yellow-500' : 'bg-gray-600'} hover:bg-gray-500`}>
                                {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
                            </button>
                            <button onClick={toggleVideo} className={`p-3 rounded-full ${isVideoOff ? 'bg-yellow-500' : 'bg-gray-600'} hover:bg-gray-500`}>
                                {isVideoOff ? <VideoOff size={20} /> : <Video size={20} />}
                            </button>
                            <button onClick={() => leaveCall()} className="p-3 bg-red-600 rounded-full hover:bg-red-700">
                                <PhoneOff size={20} />
                            </button>
                        </div>
                    )}
                </div>

                {/* Chat Area */}
                <div className="h-1/3 bg-gray-800 border-t border-gray-700 flex flex-col p-4">
                    <h3 className="text-lg font-semibold mb-2">Chat with: <span className="text-teal-400">{recipientId || "Select a user"}</span></h3>
                    <div className="flex-grow overflow-y-auto mb-2 pr-2">
                        {messages.filter(m => (m.senderId === myId && m.recipientId === recipientId) || (m.senderId === recipientId && m.recipientId === myId)).map((msg, i) => (
                            <div key={i} className={`flex ${msg.senderId === myId ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-xs lg:max-w-md p-3 rounded-lg mb-2 ${msg.senderId === myId ? 'bg-teal-600' : 'bg-gray-600'}`}>
                                    <p>{msg.text}</p>
                                </div>
                            </div>
                        ))}
                        <div ref={messagesEndRef} />
                    </div>
                    <form onSubmit={handleSendMessage} className="flex">
                        <input type="text" value={newMessage} onChange={(e) => setNewMessage(e.target.value)}
                            placeholder="Type a message..." disabled={!recipientId}
                            className="flex-grow bg-gray-700 p-2 rounded-l-lg focus:outline-none focus:ring-2 focus:ring-teal-500 disabled:opacity-50" />
                        <button type="submit" disabled={!recipientId}
                            className="bg-teal-600 p-2 rounded-r-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed">
                            <Send size={20} />
                        </button>
                    </form>
                </div>
            </div>

            {/* Incoming Call Modal */}
            {receivingCall && !callAccepted && (
                <div className="absolute inset-0 bg-black/70 flex justify-center items-center z-50">
                    <div className="bg-gray-800 p-8 rounded-lg shadow-xl text-center">
                        <h2 className="text-2xl mb-4">{caller} is calling...</h2>
                        <div className="flex justify-center gap-4">
                            <button onClick={answerCall} className="px-6 py-2 bg-green-500 rounded-lg hover:bg-green-600">Answer</button>
                            <button onClick={() => setReceivingCall(false)} className="px-6 py-2 bg-red-500 rounded-lg hover:bg-red-600">Decline</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default App;