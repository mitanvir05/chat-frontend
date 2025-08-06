import React, { useState, useEffect, useRef } from "react";
import io from "socket.io-client";
import { Send, MessageSquare } from "lucide-react";

// --- Connect to your backend server ---
// Make sure your backend server is running
const socket = io("http://localhost:5000");

const App = () => {
  // State Management
  const [myId, setMyId] = useState("");
  const [userIdInput, setUserIdInput] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [users, setUsers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [recipientId, setRecipientId] = useState("");

  // Refs
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (!isLoggedIn) return;

    // Socket event listeners
    socket.on("update-user-list", (userList) => {
      setUsers(userList.filter((u) => u !== myId));
    });

    socket.on("load-messages", (loadedMessages) => {
      setMessages(loadedMessages);
    });

    socket.on("new-message", (message) => {
      setMessages((prev) => [...prev, message]);
    });

    return () => {
      socket.off("update-user-list");
      socket.off("load-messages");
      socket.off("new-message");
    };
  }, [isLoggedIn, myId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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
        recipientId: recipientId,
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
                onClick={() => setRecipientId(user)}
                className={`p-2 rounded-lg mb-2 flex justify-between items-center transition-all cursor-pointer ${
                  recipientId === user
                    ? "bg-teal-600"
                    : "bg-gray-700 hover:bg-gray-600"
                }`}
              >
                <span>{user}</span>
                <MessageSquare size={16} />
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Main Content */}
      <div className="w-3/4 flex flex-col">
        {/* Chat Area */}
        <div className="h-full bg-gray-800 flex flex-col p-4">
          <h3 className="text-lg font-semibold mb-2">
            Chat with:{" "}
            <span className="text-teal-400">
              {recipientId || "Select a user"}
            </span>
          </h3>
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
    </div>
  );
};

export default App;
