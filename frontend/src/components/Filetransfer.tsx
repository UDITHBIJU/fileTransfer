import React from "react";
import { useEffect, useState } from "react";
import io, { Socket } from "socket.io-client";
import { v4 as uuidv4 } from "uuid";

function Filetransfer() {
	const [isConnected, setIsConnected] = useState(false);
	const [socketId, setSocketId] = useState<string | null>(null);
	const [apiResponse, setApiResponse] = useState<string | null>(null);

	useEffect(() => {
		//get or create device id for making only one socket id for a device

		let deviceId = localStorage.getItem("deviceId");

		if (!deviceId) {
			deviceId = uuidv4(); // Generate a new UUID
			localStorage.setItem("deviceId", deviceId);
		}

		//dynamic backend URL based on environment
		const isLocal =
			window.location.hostname === "localhost" ||
			window.location.hostname === "127.0.0.1";
		const backendUrl = isLocal
			? "http://localhost:4001"
			: "http://192.168.1.77:4001";

		//check if a socket is already active
		if (!(window as any).activeSocket) {
			//connection to the socket.io server
			const socket: Socket = io(backendUrl, {
				reconnection: true,
				query: { deviceId },
			});

			//store socket globaly
			(window as any).activeSocket = socket;

			//handle connection
			socket.on("connect", () => {
				setIsConnected(true);
				if (socket.id) {
					setSocketId(socket.id);
				}
				console.log(
					`Connected with socket ID: ${socket.id},device ID: ${deviceId}`
				);
			});

			// handle disconnection
			socket.on("disconnect", () => {
				setIsConnected(false);
				setSocketId(null);
				console.log("Disconnected from server");
			});

			//test API endpoint
			fetch(`${backendUrl}/`)
				.then((res) => res.json())
				.then((data) => {
					setApiResponse(data.message);
					console.log(data.message);
				})
				.catch((error) => {
					console.error("Error fetching API:", error);
				});

			// clean up function to disconnect the socket
			return () => {
				socket.disconnect();
        delete (window as any).activeSocket;
				console.log("Socket disconnected");
			};
		}
	}, []);

	return (
		<div>
			<h1>File Transfer Test Client</h1>
			<p>Connection Status: {isConnected ? "Connected" : "Disconnected"}</p>
			<p>Socket ID: {socketId || "Not connected"}</p>
			<p>API Response: {apiResponse || "Loading..."}</p>
		</div>
	);
}

export default Filetransfer;
