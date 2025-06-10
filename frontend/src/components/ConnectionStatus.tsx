
import React from "react";
import { useSocketContext } from "../context/socketProvider";


const ConnectionStatus = () => {

  const { isConnected, socketId, apiResponse } = useSocketContext();
	return (
		<div className="mb-4">
			<h2 className="text-lg font-semibold">Connection Status</h2>
			<p>Status: {isConnected ? "Connected" : "Disconnected"}</p>
		</div>
	);
};

export default ConnectionStatus;

