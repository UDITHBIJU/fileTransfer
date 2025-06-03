
import React from "react";
import { useSocketContext } from "../context/socketProvider";
import { type Peer } from "../utils/types";

interface PeerListProps {
  peerSocketIds: string[];
  peers: { [deviceId: string]: Peer };
  socketId: string;
}

const PeerList = () => {
  const { peerSocketIds, peers, socketId } = useSocketContext();
  if (!peerSocketIds || peerSocketIds.length === 0) {
    return (
      <div className="p-4 border rounded">
        <h2 className="text-lg font-bold mb-2">Available Peers</h2>
        <p>No peers available.</p>
      </div>
    );
  }

  return (
    <div className="p-4 border rounded">
      <h2 className="text-lg font-bold mb-2">Available Peers</h2>
      <ul className="space-y-2">
        {peerSocketIds.map((peerSocketId) => {
          const deviceId = Object.keys(peers).find(
            (id) => peers[id].socketId === peerSocketId
          );
          const peer = deviceId ? peers[deviceId] : null;
          const displayName = peer?.deviceName || deviceId || peerSocketId;
          return (
            <li key={peerSocketId} className="p-2 border rounded">
              {displayName} {peerSocketId === socketId && "(You)"}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default PeerList;

// components/PeerList.tsx


